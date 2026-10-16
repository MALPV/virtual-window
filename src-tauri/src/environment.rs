use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::location::{self, Coordinates};
use crate::solar;
use crate::weather::{self, Weather};

pub const ENVIRONMENT_EVENT: &str = "environment-updated";

const TICK: Duration = Duration::from_secs(60);
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);
const WEATHER_REFRESH_SECONDS: u64 = 15 * 60;
const WEATHER_RETRY_MIN_SECONDS: u64 = 60;
const WEATHER_MAX_AGE_SECONDS: u64 = 3 * 3600;
const MAX_UTC_OFFSET_MINUTES: i32 = 14 * 60;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentSnapshot {
    pub sun_elevation: f64,
    /// Horizontal sun position in the window, from 0 (left) to 1 (right).
    pub sun_track: f64,
    pub moon_elevation: f64,
    /// Horizontal moon position in the window, from 0 (left) to 1 (right).
    pub moon_track: f64,
    /// Illuminated fraction of the moon, from 0 (new) to 1 (full).
    pub moon_illumination: f64,
    pub moon_waxing: bool,
    /// False when the sky is approximated from the system time zone because no location is known.
    pub location_known: bool,
    pub weather: Option<Weather>,
}

#[derive(Default)]
pub struct EnvironmentService {
    started: AtomicBool,
    latest: Mutex<Option<EnvironmentSnapshot>>,
}

impl EnvironmentService {
    fn latest(&self) -> Option<EnvironmentSnapshot> {
        self.latest
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn store(&self, snapshot: EnvironmentSnapshot) {
        *self
            .latest
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(snapshot);
    }
}

/// Sin ubicacion se aproxima la hora solar con la zona horaria (15 grados por hora) sobre el ecuador:
/// el ciclo dia/noche sigue siendo coherente con el reloj local, aunque sin estaciones.
fn fallback_coordinates(utc_offset_minutes: i32) -> Coordinates {
    let longitude = (f64::from(utc_offset_minutes) / 4.0).clamp(-180.0, 180.0);
    Coordinates {
        latitude: 0.0,
        longitude,
    }
}

fn build_snapshot(
    coordinates: Coordinates,
    location_known: bool,
    weather: Option<Weather>,
    unix_seconds: f64,
) -> EnvironmentSnapshot {
    let sun = solar::sun_position(coordinates.latitude, coordinates.longitude, unix_seconds);
    let moon = solar::moon_position(coordinates.latitude, coordinates.longitude, unix_seconds);
    EnvironmentSnapshot {
        sun_elevation: sun.elevation,
        sun_track: solar::sun_track(sun.azimuth, coordinates.latitude),
        // La Luna usa la misma proyeccion sobre la ventana que el Sol.
        moon_elevation: moon.elevation,
        moon_track: solar::sun_track(moon.azimuth, coordinates.latitude),
        moon_illumination: moon.illumination,
        moon_waxing: moon.waxing,
        location_known,
        weather,
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn build_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .https_only(true)
        .timeout(HTTP_TIMEOUT)
        .user_agent(concat!("WindowWidget/", env!("CARGO_PKG_VERSION")))
        .build()
}

struct ResolvedLocation {
    coordinates: Coordinates,
    resolved_at: u64,
}

struct FetchedWeather {
    weather: Weather,
    fetched_at: u64,
}

fn publish<R: Runtime>(app: &AppHandle<R>, snapshot: EnvironmentSnapshot) {
    app.state::<EnvironmentService>().store(snapshot.clone());
    if let Err(error) = app.emit(ENVIRONMENT_EVENT, snapshot) {
        eprintln!("failed to emit environment update: {error}");
    }
}

// Se usa el reloj de pared (no Instant) para que la programacion sobreviva a la suspension del equipo.
async fn run<R: Runtime>(app: AppHandle<R>, utc_offset_minutes: i32) {
    let client = build_client()
        .inspect_err(|error| eprintln!("failed to build http client: {error}"))
        .ok();
    let cache_path = app
        .path()
        .app_cache_dir()
        .ok()
        .map(|dir| dir.join(location::CACHE_FILE_NAME));
    let fallback = fallback_coordinates(utc_offset_minutes);

    // Primer estado inmediato con la ubicacion en cache (aunque este caducada) para no esperar a la red.
    let cached = cache_path.as_deref().and_then(location::cached_coordinates);
    publish(
        &app,
        build_snapshot(
            cached.unwrap_or(fallback),
            cached.is_some(),
            None,
            unix_now() as f64,
        ),
    );

    let mut location: Option<ResolvedLocation> = None;
    let mut weather: Option<FetchedWeather> = None;
    let mut next_fetch_at = 0;
    let mut retry_delay = WEATHER_RETRY_MIN_SECONDS;

    loop {
        let now = unix_now();

        if let Some(client) = &client
            && now >= next_fetch_at
        {
            if location.as_ref().is_some_and(|resolved| {
                now.saturating_sub(resolved.resolved_at) >= location::REFRESH_INTERVAL_SECONDS
            }) {
                location = None;
            }
            if location.is_none() {
                location = location::resolve(client, cache_path.as_deref(), now)
                    .await
                    .map(|coordinates| ResolvedLocation {
                        coordinates,
                        resolved_at: now,
                    });
            }

            let fetched = match &location {
                Some(resolved) => weather::fetch(client, resolved.coordinates)
                    .await
                    .inspect_err(|error| eprintln!("weather fetch failed: {error}"))
                    .ok(),
                None => None,
            };
            match fetched {
                Some(fresh) => {
                    weather = Some(FetchedWeather {
                        weather: fresh,
                        fetched_at: now,
                    });
                    next_fetch_at = now + WEATHER_REFRESH_SECONDS;
                    retry_delay = WEATHER_RETRY_MIN_SECONDS;
                }
                None => {
                    next_fetch_at = now + retry_delay;
                    retry_delay = (retry_delay * 2).min(WEATHER_REFRESH_SECONDS);
                }
            }
        }

        if weather
            .as_ref()
            .is_some_and(|fetched| now.saturating_sub(fetched.fetched_at) > WEATHER_MAX_AGE_SECONDS)
        {
            weather = None;
        }

        let snapshot = build_snapshot(
            location
                .as_ref()
                .map_or(fallback, |resolved| resolved.coordinates),
            location.is_some(),
            weather.as_ref().map(|fetched| fetched.weather),
            now as f64,
        );
        publish(&app, snapshot);

        tokio::time::sleep(TICK).await;
    }
}

/// Starts the background environment updates (once per app run) and returns the latest snapshot, if any.
/// `utc_offset_minutes` is only used to approximate the sky when the location cannot be resolved.
#[tauri::command]
pub async fn start_environment<R: Runtime>(
    app: AppHandle<R>,
    service: State<'_, EnvironmentService>,
    utc_offset_minutes: i32,
) -> Result<Option<EnvironmentSnapshot>, String> {
    if !(-MAX_UTC_OFFSET_MINUTES..=MAX_UTC_OFFSET_MINUTES).contains(&utc_offset_minutes) {
        return Err(format!("utc offset out of range: {utc_offset_minutes}"));
    }
    if !service.started.swap(true, Ordering::SeqCst) {
        tauri::async_runtime::spawn(run(app, utc_offset_minutes));
    }
    Ok(service.latest())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::weather::Condition;

    #[test]
    fn fallback_longitude_follows_utc_offset() {
        assert_eq!(
            fallback_coordinates(120),
            Coordinates {
                latitude: 0.0,
                longitude: 30.0
            }
        );
        assert_eq!(
            fallback_coordinates(-300),
            Coordinates {
                latitude: 0.0,
                longitude: -75.0
            }
        );
        assert_eq!(fallback_coordinates(840).longitude, 180.0);
    }

    #[test]
    fn snapshot_carries_sun_and_weather() {
        let weather = Weather {
            condition: Condition::Snow,
            intensity: 0.6,
            cloud_cover: 1.0,
            temperature: -3.0,
            wind_drift: 0.2,
            wind_strength: 0.4,
        };
        // 2024-06-21T12:16:00Z en Madrid: sol alto y centrado.
        let snapshot = build_snapshot(
            Coordinates {
                latitude: 40.42,
                longitude: -3.7,
            },
            true,
            Some(weather),
            1_718_972_160.0,
        );
        assert!(snapshot.sun_elevation > 70.0);
        assert!((snapshot.sun_track - 0.5).abs() < 0.05);
        assert!(snapshot.location_known);
        assert_eq!(snapshot.weather, Some(weather));
    }

    #[test]
    fn snapshot_serializes_with_camel_case_fields() {
        let snapshot = EnvironmentSnapshot {
            sun_elevation: 10.0,
            sun_track: 0.3,
            moon_elevation: 20.0,
            moon_track: 0.6,
            moon_illumination: 0.8,
            moon_waxing: true,
            location_known: false,
            weather: None,
        };
        let json = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(json["sunElevation"], 10.0);
        assert_eq!(json["sunTrack"], 0.3);
        assert_eq!(json["locationKnown"], false);
        assert_eq!(json["moonIllumination"], 0.8);
        assert_eq!(json["moonWaxing"], true);
        assert!(json["weather"].is_null());
    }
}
