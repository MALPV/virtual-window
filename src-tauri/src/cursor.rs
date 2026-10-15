use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, EventTarget, Manager, Runtime, State, WebviewWindow};

pub const CURSOR_OFFSET_EVENT: &str = "cursor-offset";

const TRACKING_INTERVAL: Duration = Duration::from_millis(33);
const MIN_EMIT_DELTA: f64 = 0.002;

#[derive(Default)]
pub struct CursorTracker {
    running: AtomicBool,
}

/// Cursor position relative to the window center, normalized by half the monitor size
/// and clamped to [-1, 1] on each axis.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct CursorOffset {
    pub x: f64,
    pub y: f64,
}

impl CursorOffset {
    fn differs_from(&self, other: &CursorOffset) -> bool {
        (self.x - other.x).abs() >= MIN_EMIT_DELTA || (self.y - other.y).abs() >= MIN_EMIT_DELTA
    }
}

pub fn normalize_offset(
    cursor: (f64, f64),
    window_center: (f64, f64),
    half_extent: (f64, f64),
) -> Option<CursorOffset> {
    let (half_width, half_height) = half_extent;
    if !(half_width > 0.0 && half_height > 0.0) {
        return None;
    }
    let x = (cursor.0 - window_center.0) / half_width;
    let y = (cursor.1 - window_center.1) / half_height;
    if !(x.is_finite() && y.is_finite()) {
        return None;
    }
    Some(CursorOffset {
        x: x.clamp(-1.0, 1.0),
        y: y.clamp(-1.0, 1.0),
    })
}

fn read_offset<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<Option<CursorOffset>> {
    let cursor = window.cursor_position()?;
    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let Some(monitor) = window.current_monitor()? else {
        return Ok(None);
    };

    let window_center = (
        f64::from(position.x) + f64::from(size.width) / 2.0,
        f64::from(position.y) + f64::from(size.height) / 2.0,
    );
    let half_extent = (
        f64::from(monitor.size().width) / 2.0,
        f64::from(monitor.size().height) / 2.0,
    );
    Ok(normalize_offset(
        (cursor.x, cursor.y),
        window_center,
        half_extent,
    ))
}

fn track<R: Runtime>(window: WebviewWindow<R>) {
    let target = EventTarget::webview_window(window.label());
    let mut last_emitted: Option<CursorOffset> = None;

    loop {
        match window.is_minimized() {
            // La ventana ya no existe: terminamos el hilo en lugar de reintentar indefinidamente.
            Err(_) => break,
            Ok(true) => {
                thread::sleep(TRACKING_INTERVAL);
                continue;
            }
            Ok(false) => {}
        }

        match read_offset(&window) {
            Ok(Some(offset)) => {
                let changed = last_emitted.is_none_or(|last| offset.differs_from(&last));
                if changed {
                    if window
                        .emit_to(target.clone(), CURSOR_OFFSET_EVENT, offset)
                        .is_err()
                    {
                        break;
                    }
                    last_emitted = Some(offset);
                }
            }
            Ok(None) => {}
            Err(error) => {
                eprintln!("cursor tracking stopped: {error}");
                break;
            }
        }

        thread::sleep(TRACKING_INTERVAL);
    }

    window
        .state::<CursorTracker>()
        .running
        .store(false, Ordering::SeqCst);
}

/// Starts polling the global cursor position and emitting `cursor-offset` events to the caller window.
/// Fails when the platform cannot report a global cursor position (for example, Wayland),
/// so the frontend can fall back to in-window pointer events.
// Es async para que corra fuera del hilo principal: los getters de ventana se despachan al event loop.
#[tauri::command]
pub async fn start_cursor_tracking<R: Runtime>(
    window: WebviewWindow<R>,
    tracker: State<'_, CursorTracker>,
) -> Result<(), String> {
    read_offset(&window).map_err(|error| error.to_string())?;

    if tracker.running.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    thread::spawn(move || track(window));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_at_window_center_is_zero() {
        let offset = normalize_offset((500.0, 300.0), (500.0, 300.0), (960.0, 540.0)).unwrap();
        assert_eq!(offset, CursorOffset { x: 0.0, y: 0.0 });
    }

    #[test]
    fn offset_is_proportional_to_half_monitor_size() {
        let offset = normalize_offset((980.0, 30.0), (500.0, 300.0), (960.0, 540.0)).unwrap();
        assert_eq!(offset, CursorOffset { x: 0.5, y: -0.5 });
    }

    #[test]
    fn offset_is_clamped_when_cursor_is_far_away() {
        let offset = normalize_offset((-5000.0, 9000.0), (500.0, 300.0), (960.0, 540.0)).unwrap();
        assert_eq!(offset, CursorOffset { x: -1.0, y: 1.0 });
    }

    #[test]
    fn invalid_monitor_size_yields_none() {
        assert!(normalize_offset((0.0, 0.0), (0.0, 0.0), (0.0, 540.0)).is_none());
        assert!(normalize_offset((0.0, 0.0), (0.0, 0.0), (960.0, -1.0)).is_none());
        assert!(normalize_offset((0.0, 0.0), (0.0, 0.0), (f64::NAN, 540.0)).is_none());
    }

    #[test]
    fn non_finite_cursor_yields_none() {
        assert!(normalize_offset((f64::NAN, 0.0), (0.0, 0.0), (960.0, 540.0)).is_none());
    }

    #[test]
    fn small_changes_are_not_considered_different() {
        let a = CursorOffset { x: 0.1, y: 0.1 };
        assert!(!a.differs_from(&CursorOffset { x: 0.1005, y: 0.1 }));
        assert!(a.differs_from(&CursorOffset { x: 0.1, y: 0.11 }));
    }
}
