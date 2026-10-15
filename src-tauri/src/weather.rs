use serde::{Deserialize, Serialize};

use crate::location::Coordinates;

const OPEN_METEO_URL: &str = "https://api.open-meteo.com/v1/forecast";
const CURRENT_FIELDS: &str =
    "temperature_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m";
const FULL_DRIFT_WIND_KMH: f64 = 50.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Condition {
    Clear,
    Cloudy,
    Overcast,
    Fog,
    Rain,
    Snow,
    Storm,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Weather {
    pub condition: Condition,
    /// From 0 to 1: how strong the precipitation or fog is.
    pub intensity: f64,
    /// From 0 to 1.
    pub cloud_cover: f64,
    /// Degrees Celsius.
    pub temperature: f64,
    /// From -1 (wind pushes left) to 1 (wind pushes right), as seen through the window.
    pub wind_drift: f64,
    /// From 0 (calm) to 1 (strong wind), regardless of direction.
    pub wind_strength: f64,
}

#[derive(Deserialize)]
struct ForecastResponse {
    current: CurrentWeather,
}

#[derive(Deserialize)]
struct CurrentWeather {
    temperature_2m: f64,
    weather_code: u8,
    cloud_cover: f64,
    wind_speed_10m: f64,
    wind_direction_10m: f64,
}

/// Maps WMO weather interpretation codes (as used by Open-Meteo) to a scene condition.
fn classify(code: u8) -> Option<(Condition, f64)> {
    use Condition::*;
    let classified = match code {
        0 | 1 => (Clear, 0.0),
        2 => (Cloudy, 0.0),
        3 => (Overcast, 0.0),
        45 => (Fog, 0.7),
        48 => (Fog, 0.9),
        51 => (Rain, 0.15),
        53 | 56 => (Rain, 0.25),
        55 | 57 => (Rain, 0.35),
        61 => (Rain, 0.4),
        66 => (Rain, 0.45),
        80 => (Rain, 0.45),
        63 => (Rain, 0.65),
        81 => (Rain, 0.7),
        67 => (Rain, 0.85),
        65 => (Rain, 0.95),
        82 => (Rain, 1.0),
        77 => (Snow, 0.25),
        71 => (Snow, 0.35),
        85 => (Snow, 0.5),
        73 => (Snow, 0.6),
        75 => (Snow, 0.9),
        86 => (Snow, 0.9),
        95 => (Storm, 0.75),
        96 => (Storm, 0.85),
        99 => (Storm, 1.0),
        _ => return None,
    };
    Some(classified)
}

fn condition_from_cloud_cover(cloud_cover: f64) -> Condition {
    if cloud_cover < 0.3 {
        Condition::Clear
    } else if cloud_cover < 0.8 {
        Condition::Cloudy
    } else {
        Condition::Overcast
    }
}

/// Horizontal wind component as seen through a window facing the equator.
/// `direction_from` is the meteorological direction the wind blows from, in degrees.
fn wind_strength(speed_kmh: f64) -> f64 {
    (speed_kmh / FULL_DRIFT_WIND_KMH).clamp(0.0, 1.0)
}

fn wind_drift(speed_kmh: f64, direction_from: f64, latitude: f64) -> f64 {
    let strength = wind_strength(speed_kmh);
    // Mirando al sur la derecha es el oeste; mirando al norte, el este.
    let facing = if latitude >= 0.0 { 1.0 } else { -1.0 };
    (strength * direction_from.to_radians().sin() * facing).clamp(-1.0, 1.0)
}

fn parse(body: &str, latitude: f64) -> Result<Weather, String> {
    let response: ForecastResponse =
        serde_json::from_str(body).map_err(|error| error.to_string())?;
    let current = response.current;

    let numbers_are_finite = [
        current.temperature_2m,
        current.cloud_cover,
        current.wind_speed_10m,
        current.wind_direction_10m,
    ]
    .iter()
    .all(|value| value.is_finite());
    if !numbers_are_finite {
        return Err("non-finite values in weather response".to_string());
    }

    let cloud_cover = (current.cloud_cover / 100.0).clamp(0.0, 1.0);
    let (condition, intensity) = classify(current.weather_code)
        .unwrap_or_else(|| (condition_from_cloud_cover(cloud_cover), 0.0));

    Ok(Weather {
        condition,
        intensity,
        cloud_cover,
        temperature: current.temperature_2m,
        wind_drift: wind_drift(current.wind_speed_10m, current.wind_direction_10m, latitude),
        wind_strength: wind_strength(current.wind_speed_10m),
    })
}

pub async fn fetch(client: &reqwest::Client, coordinates: Coordinates) -> Result<Weather, String> {
    let response = client
        .get(OPEN_METEO_URL)
        .query(&[
            ("latitude", coordinates.latitude.to_string()),
            ("longitude", coordinates.longitude.to_string()),
            ("current", CURRENT_FIELDS.to_string()),
            ("wind_speed_unit", "kmh".to_string()),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let body = response.text().await.map_err(|error| error.to_string())?;
    parse(&body, coordinates.latitude)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(code: u8, cloud_cover: f64) -> String {
        format!(
            r#"{{"latitude":40.4,"longitude":-3.7,"current":{{"time":"2026-10-15T10:00","interval":900,
            "temperature_2m":-2.5,"weather_code":{code},"cloud_cover":{cloud_cover},
            "wind_speed_10m":25.0,"wind_direction_10m":90.0}}}}"#
        )
    }

    #[test]
    fn parses_open_meteo_response() {
        let weather = parse(&body(63, 100.0), 40.4).unwrap();
        assert_eq!(weather.condition, Condition::Rain);
        assert_eq!(weather.intensity, 0.65);
        assert_eq!(weather.cloud_cover, 1.0);
        assert_eq!(weather.temperature, -2.5);
        assert!((weather.wind_drift - 0.5).abs() < 1e-9);
        assert!((weather.wind_strength - 0.5).abs() < 1e-9);
    }

    #[test]
    fn parses_real_open_meteo_payload_with_integer_numbers() {
        let real = r#"{"latitude":-33.427067,"longitude":-70.64276,"generationtime_ms":0.15,"utc_offset_seconds":0,"timezone":"GMT","timezone_abbreviation":"GMT","elevation":540.0,"current_units":{"time":"iso8601","interval":"seconds","temperature_2m":"°C","weather_code":"wmo code","cloud_cover":"%","wind_speed_10m":"km/h","wind_direction_10m":"°"},"current":{"time":"2026-10-15T13:45","interval":900,"temperature_2m":15.7,"weather_code":0,"cloud_cover":0,"wind_speed_10m":3.0,"wind_direction_10m":284}}"#;
        let weather = parse(real, -33.45).unwrap();
        assert_eq!(weather.condition, Condition::Clear);
        assert_eq!(weather.cloud_cover, 0.0);
        assert_eq!(weather.temperature, 15.7);
    }

    #[test]
    fn unknown_code_falls_back_to_cloud_cover() {
        assert_eq!(
            parse(&body(42, 10.0), 0.0).unwrap().condition,
            Condition::Clear
        );
        assert_eq!(
            parse(&body(42, 50.0), 0.0).unwrap().condition,
            Condition::Cloudy
        );
        assert_eq!(
            parse(&body(42, 95.0), 0.0).unwrap().condition,
            Condition::Overcast
        );
    }

    #[test]
    fn cloud_cover_is_clamped() {
        assert_eq!(parse(&body(0, 140.0), 0.0).unwrap().cloud_cover, 1.0);
        assert_eq!(parse(&body(0, -5.0), 0.0).unwrap().cloud_cover, 0.0);
    }

    #[test]
    fn invalid_responses_are_rejected() {
        assert!(parse("{}", 0.0).is_err());
        assert!(parse("not json", 0.0).is_err());
        assert!(parse(r#"{"current":{"temperature_2m":1.0}}"#, 0.0).is_err());
    }

    #[test]
    fn classifies_representative_codes() {
        assert_eq!(classify(0), Some((Condition::Clear, 0.0)));
        assert_eq!(classify(3), Some((Condition::Overcast, 0.0)));
        assert_eq!(classify(45).map(|c| c.0), Some(Condition::Fog));
        assert_eq!(classify(75).map(|c| c.0), Some(Condition::Snow));
        assert_eq!(classify(99), Some((Condition::Storm, 1.0)));
        assert_eq!(classify(100), None);
    }

    #[test]
    fn wind_strength_ignores_direction_and_is_clamped() {
        assert_eq!(wind_strength(0.0), 0.0);
        assert!((wind_strength(25.0) - 0.5).abs() < 1e-9);
        assert_eq!(wind_strength(120.0), 1.0);
        assert_eq!(wind_strength(-3.0), 0.0);
    }

    #[test]
    fn wind_drift_depends_on_hemisphere_and_direction() {
        // Viento del este empuja hacia el oeste: a la derecha mirando al sur, a la izquierda mirando al norte.
        assert!((wind_drift(50.0, 90.0, 40.0) - 1.0).abs() < 1e-9);
        assert!((wind_drift(50.0, 90.0, -33.0) + 1.0).abs() < 1e-9);
        assert!(wind_drift(50.0, 0.0, 40.0).abs() < 1e-9);
        assert!((wind_drift(200.0, 270.0, 40.0) + 1.0).abs() < 1e-9);
        assert_eq!(wind_drift(0.0, 90.0, 40.0), 0.0);
    }
}
