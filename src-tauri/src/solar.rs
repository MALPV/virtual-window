//! Low-precision solar and lunar positions (accurate to roughly half a degree), enough to drive the sky.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SunPosition {
    /// Degrees above the horizon (negative below).
    pub elevation: f64,
    /// Degrees clockwise from true north.
    pub azimuth: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MoonPosition {
    /// Degrees above the horizon (negative below), corrected for parallax.
    pub elevation: f64,
    /// Degrees clockwise from true north.
    pub azimuth: f64,
    /// Illuminated fraction of the disc, from 0 (new) to 1 (full).
    pub illumination: f64,
    /// True between new and full moon.
    pub waxing: bool,
}

const UNIX_EPOCH_JULIAN_DAY: f64 = 2_440_587.5;
const J2000_JULIAN_DAY: f64 = 2_451_545.0;
const SECONDS_PER_DAY: f64 = 86_400.0;

fn days_since_j2000(unix_seconds: f64) -> f64 {
    unix_seconds / SECONDS_PER_DAY + UNIX_EPOCH_JULIAN_DAY - J2000_JULIAN_DAY
}

fn obliquity(days: f64) -> f64 {
    (23.439 - 0.000_000_4 * days).to_radians()
}

/// Apparent ecliptic longitude of the sun, in radians.
fn sun_ecliptic_longitude(days: f64) -> f64 {
    let mean_longitude = (280.460 + 0.985_647_4 * days).rem_euclid(360.0);
    let mean_anomaly = (357.528 + 0.985_600_3 * days)
        .rem_euclid(360.0)
        .to_radians();
    (mean_longitude + 1.915 * mean_anomaly.sin() + 0.020 * (2.0 * mean_anomaly).sin()).to_radians()
}

/// Converts equatorial coordinates (radians) to elevation and azimuth (degrees) for an observer.
fn to_horizontal(
    latitude: f64,
    longitude: f64,
    days: f64,
    right_ascension: f64,
    declination: f64,
) -> (f64, f64) {
    let sidereal_degrees =
        (280.460_618_37 + 360.985_647_366_29 * days + longitude).rem_euclid(360.0);
    let hour_angle =
        (sidereal_degrees.to_radians() - right_ascension).rem_euclid(std::f64::consts::TAU);
    let lat = latitude.to_radians();
    let elevation =
        (lat.sin() * declination.sin() + lat.cos() * declination.cos() * hour_angle.cos()).asin();
    let azimuth =
        (-hour_angle.sin()).atan2(lat.cos() * declination.tan() - lat.sin() * hour_angle.cos());
    (
        elevation.to_degrees(),
        azimuth.to_degrees().rem_euclid(360.0),
    )
}

/// Ecliptic longitude and latitude (radians) to right ascension and declination (radians).
fn ecliptic_to_equatorial(longitude: f64, latitude: f64, days: f64) -> (f64, f64) {
    let epsilon = obliquity(days);
    let x = longitude.cos() * latitude.cos();
    let y = longitude.sin() * latitude.cos();
    let z = latitude.sin();
    let ye = y * epsilon.cos() - z * epsilon.sin();
    let ze = y * epsilon.sin() + z * epsilon.cos();
    (ye.atan2(x), ze.atan2((x * x + ye * ye).sqrt()))
}

pub fn sun_position(latitude: f64, longitude: f64, unix_seconds: f64) -> SunPosition {
    let days = days_since_j2000(unix_seconds);
    let (right_ascension, declination) =
        ecliptic_to_equatorial(sun_ecliptic_longitude(days), 0.0, days);
    let (elevation, azimuth) =
        to_horizontal(latitude, longitude, days, right_ascension, declination);
    SunPosition { elevation, azimuth }
}

/// Geocentric ecliptic longitude, latitude (radians) and distance (Earth radii) of the moon,
/// from its mean orbital elements plus the largest periodic perturbations.
fn moon_ecliptic(days: f64) -> (f64, f64, f64) {
    // Elementos referidos al 31 de diciembre de 1999 a las 0:00 UT, 1,5 dias antes de J2000.
    let d = days + 1.5;
    let node = (125.1228 - 0.052_953_808_3 * d).to_radians();
    let inclination = 5.1454_f64.to_radians();
    let perigee = (318.0634 + 0.164_357_322_3 * d).to_radians();
    let semi_major_axis = 60.2666;
    let eccentricity = 0.054_900;
    let mean_anomaly = (115.3654 + 13.064_992_950_9 * d)
        .rem_euclid(360.0)
        .to_radians();

    let mut eccentric = mean_anomaly
        + eccentricity * mean_anomaly.sin() * (1.0 + eccentricity * mean_anomaly.cos());
    for _ in 0..5 {
        eccentric -= (eccentric - eccentricity * eccentric.sin() - mean_anomaly)
            / (1.0 - eccentricity * eccentric.cos());
    }
    let xv = semi_major_axis * (eccentric.cos() - eccentricity);
    let yv = semi_major_axis * (1.0 - eccentricity * eccentricity).sqrt() * eccentric.sin();
    let true_anomaly = yv.atan2(xv);
    let distance = (xv * xv + yv * yv).sqrt();

    let argument = true_anomaly + perigee;
    let xh =
        distance * (node.cos() * argument.cos() - node.sin() * argument.sin() * inclination.cos());
    let yh =
        distance * (node.sin() * argument.cos() + node.cos() * argument.sin() * inclination.cos());
    let zh = distance * argument.sin() * inclination.sin();
    let mut longitude = yh.atan2(xh).to_degrees();
    let mut latitude = zh.atan2((xh * xh + yh * yh).sqrt()).to_degrees();

    let sun_anomaly = (356.0470 + 0.985_600_258_5 * d)
        .rem_euclid(360.0)
        .to_radians();
    let sun_longitude = (282.9404 + 4.709_35e-5 * d).to_radians() + sun_anomaly;
    let moon_longitude = node + perigee + mean_anomaly;
    let elongation = moon_longitude - sun_longitude;
    let latitude_argument = moon_longitude - node;
    let m = mean_anomaly;
    longitude += -1.274 * (m - 2.0 * elongation).sin() + 0.658 * (2.0 * elongation).sin()
        - 0.186 * sun_anomaly.sin()
        - 0.059 * (2.0 * m - 2.0 * elongation).sin()
        - 0.057 * (m - 2.0 * elongation + sun_anomaly).sin()
        + 0.053 * (m + 2.0 * elongation).sin()
        + 0.046 * (2.0 * elongation - sun_anomaly).sin()
        + 0.041 * (m - sun_anomaly).sin()
        - 0.035 * elongation.sin()
        - 0.031 * (m + sun_anomaly).sin()
        - 0.015 * (2.0 * latitude_argument - 2.0 * elongation).sin()
        + 0.011 * (m - 4.0 * elongation).sin();
    latitude += -0.173 * (latitude_argument - 2.0 * elongation).sin()
        - 0.055 * (m - latitude_argument - 2.0 * elongation).sin()
        - 0.046 * (m + latitude_argument - 2.0 * elongation).sin()
        + 0.033 * (latitude_argument + 2.0 * elongation).sin()
        + 0.017 * (2.0 * m + latitude_argument).sin();
    (longitude.to_radians(), latitude.to_radians(), distance)
}

pub fn moon_position(latitude: f64, longitude: f64, unix_seconds: f64) -> MoonPosition {
    let days = days_since_j2000(unix_seconds);
    let (moon_longitude, moon_latitude, distance) = moon_ecliptic(days);
    let (right_ascension, declination) =
        ecliptic_to_equatorial(moon_longitude, moon_latitude, days);
    let (geocentric, azimuth) =
        to_horizontal(latitude, longitude, days, right_ascension, declination);
    // La Luna esta cerca: vista desde la superficie aparece mas baja que desde el centro de la Tierra.
    let parallax = (1.0 / distance).asin().to_degrees();
    let elevation = geocentric - parallax * geocentric.to_radians().cos();

    let separation = moon_longitude - sun_ecliptic_longitude(days);
    let cos_elongation = moon_latitude.cos() * separation.cos();
    MoonPosition {
        elevation,
        azimuth,
        illumination: ((1.0 - cos_elongation) / 2.0).clamp(0.0, 1.0),
        waxing: separation.rem_euclid(std::f64::consts::TAU) < std::f64::consts::PI,
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

    // Fases de la Luna de enero de 2024 (UTC).
    const NEW_MOON_2024_01_11: f64 = 1_704_974_220.0; // 11:57
    const FIRST_QUARTER_2024_01_18: f64 = 1_705_549_920.0; // 03:52
    const FULL_MOON_2024_01_25: f64 = 1_706_205_240.0; // 17:54

    #[test]
    fn moon_illumination_follows_the_phases() {
        let new = moon_position(MADRID.0, MADRID.1, NEW_MOON_2024_01_11);
        let quarter = moon_position(MADRID.0, MADRID.1, FIRST_QUARTER_2024_01_18);
        let full = moon_position(MADRID.0, MADRID.1, FULL_MOON_2024_01_25);
        assert!(new.illumination < 0.02, "new {}", new.illumination);
        assert_close(quarter.illumination, 0.5, 0.06);
        assert!(quarter.waxing);
        assert!(full.illumination > 0.98, "full {}", full.illumination);
    }

    #[test]
    fn winter_full_moon_is_high_over_madrid_at_midnight() {
        // 26 de enero de 2024 a las 00:30 UTC, cerca de la medianoche local.
        let moon = moon_position(MADRID.0, MADRID.1, FULL_MOON_2024_01_25 + 6.6 * 3600.0);
        assert!(moon.elevation > 50.0, "elevation {}", moon.elevation);
    }

    #[test]
    fn full_moon_is_below_the_horizon_at_noon() {
        let moon = moon_position(MADRID.0, MADRID.1, FULL_MOON_2024_01_25 - 5.9 * 3600.0);
        assert!(moon.elevation < 0.0, "elevation {}", moon.elevation);
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
