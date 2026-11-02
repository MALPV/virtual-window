use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

const IPAPI_URL: &str = "https://ipapi.co/json/";
const IPWHOIS_URL: &str = "https://ipwho.is/";
const CACHE_TTL_SECONDS: u64 = 12 * 3600;
const MAX_CLOCK_SKEW_SECONDS: u64 = 300;

pub const CACHE_FILE_NAME: &str = "location.json";
pub const REFRESH_INTERVAL_SECONDS: u64 = CACHE_TTL_SECONDS;

/// Coordinates rounded to two decimals (about 1 km): enough for sky and weather,
/// without keeping a more precise location than needed.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Coordinates {
    pub latitude: f64,
    pub longitude: f64,
}

impl Coordinates {
    pub fn new(latitude: f64, longitude: f64) -> Option<Self> {
        let valid = latitude.is_finite()
            && longitude.is_finite()
            && (-90.0..=90.0).contains(&latitude)
            && (-180.0..=180.0).contains(&longitude);
        valid.then(|| Self {
            latitude: round_to_hundredths(latitude),
            longitude: round_to_hundredths(longitude),
        })
    }
}

fn round_to_hundredths(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedLocation {
    latitude: f64,
    longitude: f64,
    fetched_at: u64,
}

impl CachedLocation {
    fn coordinates(&self) -> Option<Coordinates> {
        Coordinates::new(self.latitude, self.longitude)
    }

    fn is_fresh(&self, now: u64) -> bool {
        self.fetched_at <= now + MAX_CLOCK_SKEW_SECONDS
            && now.saturating_sub(self.fetched_at) < CACHE_TTL_SECONDS
    }
}

fn read_cache(path: &Path) -> Option<CachedLocation> {
    let contents = fs::read_to_string(path).ok()?;
    let cached: CachedLocation = serde_json::from_str(&contents).ok()?;
    cached.coordinates().is_some().then_some(cached)
}

/// Cached coordinates regardless of age, for an immediate first render before any network call.
pub fn cached_coordinates(path: &Path) -> Option<Coordinates> {
    read_cache(path).and_then(|cached| cached.coordinates())
}

fn write_cache(path: &Path, coordinates: Coordinates, now: u64) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let cached = CachedLocation {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        fetched_at: now,
    };
    let contents = serde_json::to_string(&cached).map_err(io::Error::other)?;
    // Escritura atomica: un cierre a mitad de escritura no deja una cache corrupta.
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, contents)?;
    fs::rename(&temp_path, path)
}

#[derive(Deserialize)]
struct IpapiResponse {
    latitude: Option<f64>,
    longitude: Option<f64>,
    #[serde(default)]
    error: bool,
    reason: Option<String>,
}

#[derive(Deserialize)]
struct IpwhoisResponse {
    success: bool,
    latitude: Option<f64>,
    longitude: Option<f64>,
    message: Option<String>,
}

fn coordinates_from(latitude: Option<f64>, longitude: Option<f64>) -> Result<Coordinates, String> {
    match (latitude, longitude) {
        (Some(lat), Some(lon)) => {
            Coordinates::new(lat, lon).ok_or_else(|| "coordinates out of range".to_string())
        }
        _ => Err("missing coordinates".to_string()),
    }
}

fn parse_ipapi(body: &str) -> Result<Coordinates, String> {
    let response: IpapiResponse = serde_json::from_str(body).map_err(|error| error.to_string())?;
    if response.error {
        return Err(response
            .reason
            .unwrap_or_else(|| "provider error".to_string()));
    }
    coordinates_from(response.latitude, response.longitude)
}

fn parse_ipwhois(body: &str) -> Result<Coordinates, String> {
    let response: IpwhoisResponse =
        serde_json::from_str(body).map_err(|error| error.to_string())?;
    if !response.success {
        return Err(response
            .message
            .unwrap_or_else(|| "provider error".to_string()));
    }
    coordinates_from(response.latitude, response.longitude)
}

async fn fetch_body(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let response = response
        .error_for_status()
        .map_err(|error| error.to_string())?;
    response.text().await.map_err(|error| error.to_string())
}

async fn fetch_ip_location(client: &reqwest::Client) -> Result<Coordinates, String> {
    let primary = match fetch_body(client, IPAPI_URL).await {
        Ok(body) => parse_ipapi(&body),
        Err(error) => Err(error),
    };
    let primary_error = match primary {
        Ok(coordinates) => return Ok(coordinates),
        Err(error) => error,
    };

    let fallback = match fetch_body(client, IPWHOIS_URL).await {
        Ok(body) => parse_ipwhois(&body),
        Err(error) => Err(error),
    };
    fallback
        .map_err(|fallback_error| format!("ipapi.co: {primary_error}; ipwho.is: {fallback_error}"))
}

/// Returns a fresh cached location if available; otherwise geolocates by IP.
/// When the network fails, falls back to the stale cache before giving up.
pub async fn resolve(
    client: &reqwest::Client,
    cache_path: Option<&Path>,
    now: u64,
) -> Option<Coordinates> {
    let cached = cache_path.and_then(read_cache);
    if let Some(cached) = &cached
        && cached.is_fresh(now)
    {
        return cached.coordinates();
    }

    match fetch_ip_location(client).await {
        Ok(coordinates) => {
            if let Some(path) = cache_path
                && let Err(error) = write_cache(path, coordinates, now)
            {
                eprintln!("failed to write location cache: {error}");
            }
            Some(coordinates)
        }
        Err(error) => {
            eprintln!("ip geolocation failed: {error}");
            cached.and_then(|cached| cached.coordinates())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_cache_path(name: &str) -> PathBuf {
        std::env::temp_dir()
            .join(format!("virtual-window-test-{}-{name}", std::process::id()))
            .join(CACHE_FILE_NAME)
    }

    #[test]
    fn coordinates_are_validated_and_rounded() {
        assert_eq!(
            Coordinates::new(40.416_775, -3.703_790),
            Some(Coordinates {
                latitude: 40.42,
                longitude: -3.7
            })
        );
        assert!(Coordinates::new(91.0, 0.0).is_none());
        assert!(Coordinates::new(0.0, -180.5).is_none());
        assert!(Coordinates::new(f64::NAN, 0.0).is_none());
    }

    #[test]
    fn parses_ipapi_success_and_error() {
        let ok = r#"{"ip":"1.2.3.4","city":"Madrid","latitude":40.4163,"longitude":-3.6934}"#;
        assert_eq!(
            parse_ipapi(ok),
            Ok(Coordinates {
                latitude: 40.42,
                longitude: -3.69
            })
        );

        let limited = r#"{"error":true,"reason":"RateLimited"}"#;
        assert_eq!(parse_ipapi(limited), Err("RateLimited".to_string()));

        assert!(parse_ipapi(r#"{"city":"Madrid"}"#).is_err());
        assert!(parse_ipapi("not json").is_err());
    }

    #[test]
    fn parses_ipwhois_success_and_error() {
        let ok = r#"{"success":true,"latitude":-33.8688,"longitude":151.2093}"#;
        assert_eq!(
            parse_ipwhois(ok),
            Ok(Coordinates {
                latitude: -33.87,
                longitude: 151.21
            })
        );

        let failed = r#"{"success":false,"message":"Reserved range"}"#;
        assert_eq!(parse_ipwhois(failed), Err("Reserved range".to_string()));
    }

    #[test]
    fn cache_round_trip_and_freshness() {
        let path = temp_cache_path("round-trip");
        let coordinates = Coordinates {
            latitude: 10.5,
            longitude: -20.25,
        };
        write_cache(&path, coordinates, 1_000_000).unwrap();

        let cached = read_cache(&path).unwrap();
        assert_eq!(cached.coordinates(), Some(coordinates));
        assert!(cached.is_fresh(1_000_000 + CACHE_TTL_SECONDS - 1));
        assert!(!cached.is_fresh(1_000_000 + CACHE_TTL_SECONDS));
        // Una marca de tiempo en el futuro indica reloj cambiado: se trata como caducada.
        assert!(!cached.is_fresh(1_000_000 - MAX_CLOCK_SKEW_SECONDS - 1));

        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn corrupt_or_invalid_cache_is_ignored() {
        let path = temp_cache_path("corrupt");
        fs::create_dir_all(path.parent().unwrap()).unwrap();

        fs::write(&path, "{ broken").unwrap();
        assert!(read_cache(&path).is_none());

        fs::write(&path, r#"{"latitude":200.0,"longitude":0.0,"fetchedAt":1}"#).unwrap();
        assert!(read_cache(&path).is_none());

        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
