//! Commands for the dev simulator. This module only exists in debug builds,
//! so release builds never expose them.

use tauri::{LogicalSize, Runtime, WebviewWindow};

// Debe coincidir con minWidth/minHeight de tauri.conf.json.
const MIN_WIDTH: f64 = 180.0;
const MIN_HEIGHT: f64 = 220.0;
const MAX_SIDE: f64 = 1600.0;

fn bounded_size(width: f64, height: f64) -> Result<(f64, f64), String> {
    if !(width.is_finite() && height.is_finite()) {
        return Err("window size must be finite".to_string());
    }
    Ok((
        width.clamp(MIN_WIDTH, MAX_SIDE),
        height.clamp(MIN_HEIGHT, MAX_SIDE),
    ))
}

/// Resizes the window to the given logical size, clamped to the supported range.
#[tauri::command]
pub async fn dev_set_window_size<R: Runtime>(
    window: WebviewWindow<R>,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let (width, height) = bounded_size(width, height)?;
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_inside_the_range_are_kept() {
        assert_eq!(bounded_size(300.0, 400.0), Ok((300.0, 400.0)));
    }

    #[test]
    fn sizes_are_clamped_to_the_supported_range() {
        assert_eq!(bounded_size(10.0, 10.0), Ok((MIN_WIDTH, MIN_HEIGHT)));
        assert_eq!(bounded_size(9999.0, 9999.0), Ok((MAX_SIDE, MAX_SIDE)));
    }

    #[test]
    fn non_finite_sizes_are_rejected() {
        assert!(bounded_size(f64::NAN, 400.0).is_err());
        assert!(bounded_size(300.0, f64::INFINITY).is_err());
    }
}
