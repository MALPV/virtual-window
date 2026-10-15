//! Low-precision solar position (accurate to roughly half a degree), enough to drive the sky.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SunPosition {
    /// Degrees above the horizon (negative below).
    pub elevation: f64,
    /// Degrees clockwise from true north.
    pub azimuth: f64,
}

const UNIX_EPOCH_JULIAN_DAY: f64 = 2_440_587.5;
const J2000_JULIAN_DAY: f64 = 2_451_545.0;
const SECONDS_PER_DAY: f64 = 86_400.0;

pub fn sun_position(latitude: f64, longitude: f64, unix_seconds: f64) -> SunPosition {
    let days = unix_seconds / SECONDS_PER_DAY + UNIX_EPOCH_JULIAN_DAY - J2000_JULIAN_DAY;

    let mean_longitude = (280.460 + 0.985_647_4 * days).rem_euclid(360.0);
    let mean_anomaly = (357.528 + 0.985_600_3 * days)
        .rem_euclid(360.0)
        .to_radians();
    let ecliptic_longitude =
        (mean_longitude + 1.915 * mean_anomaly.sin() + 0.020 * (2.0 * mean_anomaly).sin())
            .to_radians();
    let obliquity = (23.439 - 0.000_000_4 * days).to_radians();

    let right_ascension =
        (obliquity.cos() * ecliptic_longitude.sin()).atan2(ecliptic_longitude.cos());
    let declination = (obliquity.sin() * ecliptic_longitude.sin()).asin();

    let sidereal_degrees =
        (280.460_618_37 + 360.985_647_366_29 * days + longitude).rem_euclid(360.0);
    let hour_angle =
        (sidereal_degrees.to_radians() - right_ascension).rem_euclid(std::f64::consts::TAU);

    let lat = latitude.to_radians();
    let elevation =
        (lat.sin() * declination.sin() + lat.cos() * declination.cos() * hour_angle.cos()).asin();
    let azimuth =
        (-hour_angle.sin()).atan2(lat.cos() * declination.tan() - lat.sin() * hour_angle.cos());

    SunPosition {
        elevation: elevation.to_degrees(),
        azimuth: azimuth.to_degrees().rem_euclid(360.0),
    }
}

/// Horizontal position of the sun in the window, from 0 (left) to 1 (right).
/// La ventana se asume orientada hacia el ecuador. Se proyecta el componente este-oeste del azimut,
/// que es continuo: en los tropicos el sol puede cruzar por el lado del polo sin saltar de un borde al otro.
pub fn sun_track(azimuth: f64, latitude: f64) -> f64 {
    let east_component = azimuth.to_radians().sin();
    let facing = if latitude >= 0.0 { 1.0 } else { -1.0 };
    (0.5 - 0.5 * east_component * facing).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MADRID: (f64, f64) = (40.4168, -3.7038);
    // 2024-06-21T00:00:00Z
    const SUMMER_SOLSTICE_2024: f64 = 1_718_928_000.0;
    // 2024-03-20T00:00:00Z
    const MARCH_EQUINOX_2024: f64 = 1_710_892_800.0;

    fn assert_close(actual: f64, expected: f64, tolerance: f64) {
        assert!(
            (actual - expected).abs() <= tolerance,
            "expected {expected} +/- {tolerance}, got {actual}"
        );
    }

    #[test]
    fn madrid_solar_noon_on_summer_solstice() {
        let sun = sun_position(
            MADRID.0,
            MADRID.1,
            SUMMER_SOLSTICE_2024 + 12.0 * 3600.0 + 16.0 * 60.0,
        );
        assert_close(sun.elevation, 73.0, 1.0);
        assert_close(sun.azimuth, 180.0, 6.0);
    }

    #[test]
    fn madrid_solar_midnight_is_below_horizon() {
        let sun = sun_position(MADRID.0, MADRID.1, SUMMER_SOLSTICE_2024 + 16.0 * 60.0);
        assert_close(sun.elevation, -26.1, 1.5);
    }

    #[test]
    fn equator_sunrise_on_equinox_is_due_east() {
        let sun = sun_position(0.0, 0.0, MARCH_EQUINOX_2024 + 6.0 * 3600.0);
        assert_close(sun.elevation, 0.0, 3.0);
        assert_close(sun.azimuth, 90.0, 3.0);
    }

    #[test]
    fn madrid_morning_sun_is_in_the_east() {
        let sun = sun_position(MADRID.0, MADRID.1, SUMMER_SOLSTICE_2024 + 8.0 * 3600.0);
        assert!(sun.elevation > 0.0);
        assert!(
            sun.azimuth > 45.0 && sun.azimuth < 135.0,
            "azimuth {}",
            sun.azimuth
        );
    }

    const SANTIAGO_DE_CHILE: (f64, f64) = (-33.45, -70.67);
    // 2024-12-21T00:00:00Z
    const DECEMBER_SOLSTICE_2024: f64 = 1_734_739_200.0;

    #[test]
    fn santiago_solar_noon_on_december_solstice_is_high_in_the_north() {
        // El mediodia solar en Santiago cae cerca de las 16:41 UTC (13:41 hora local de verano).
        let sun = sun_position(
            SANTIAGO_DE_CHILE.0,
            SANTIAGO_DE_CHILE.1,
            DECEMBER_SOLSTICE_2024 + 60_060.0,
        );
        assert_close(sun.elevation, 80.0, 1.0);
        assert_close(sun_track(sun.azimuth, SANTIAGO_DE_CHILE.0), 0.5, 0.06);
    }

    #[test]
    fn santiago_winter_noon_sun_is_low() {
        let sun = sun_position(
            SANTIAGO_DE_CHILE.0,
            SANTIAGO_DE_CHILE.1,
            SUMMER_SOLSTICE_2024 + 16.0 * 3600.0 + 46.0 * 60.0,
        );
        assert_close(sun.elevation, 33.1, 1.0);
    }

    #[test]
    fn santiago_morning_sun_appears_on_the_right() {
        // 09:00 hora local: mirando al norte, el este queda a la derecha.
        let sun = sun_position(
            SANTIAGO_DE_CHILE.0,
            SANTIAGO_DE_CHILE.1,
            DECEMBER_SOLSTICE_2024 + 12.0 * 3600.0,
        );
        assert!(sun.elevation > 15.0, "elevation {}", sun.elevation);
        assert!(sun_track(sun.azimuth, SANTIAGO_DE_CHILE.0) > 0.8);
    }

    #[test]
    fn sun_track_moves_left_to_right_facing_the_equator() {
        assert_close(sun_track(90.0, 40.0), 0.0, 1e-9);
        assert_close(sun_track(180.0, 40.0), 0.5, 1e-9);
        assert_close(sun_track(270.0, 40.0), 1.0, 1e-9);

        assert_close(sun_track(270.0, -33.0), 0.0, 1e-9);
        assert_close(sun_track(0.0, -33.0), 0.5, 1e-9);
        assert_close(sun_track(90.0, -33.0), 1.0, 1e-9);
    }

    #[test]
    fn sun_track_is_continuous_when_the_sun_crosses_the_polar_side() {
        // Singapur en junio: al mediodia el sol pasa por el norte, con azimut cruzando 0/360.
        assert_close(sun_track(359.0, 1.35), sun_track(1.0, 1.35), 0.02);
        assert_close(sun_track(0.0, 1.35), 0.5, 1e-9);
    }

    #[test]
    fn singapore_midday_sun_stays_near_the_center() {
        let sun = sun_position(
            1.35,
            103.82,
            SUMMER_SOLSTICE_2024 + 5.0 * 3600.0 + 10.0 * 60.0,
        );
        assert!(sun.elevation > 60.0, "elevation {}", sun.elevation);
        assert_close(sun_track(sun.azimuth, 1.35), 0.5, 0.2);
    }

    #[test]
    fn polar_midnight_sun_is_above_the_horizon() {
        // Tromso (69.65 N) en el solsticio de junio a medianoche solar: sol de medianoche.
        let sun = sun_position(
            69.65,
            18.96,
            SUMMER_SOLSTICE_2024 + 22.0 * 3600.0 + 45.0 * 60.0,
        );
        assert!(sun.elevation > 0.0, "elevation {}", sun.elevation);
    }
}
