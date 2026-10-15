mod cursor;
#[cfg(debug_assertions)]
mod devtools;
mod environment;
mod location;
mod menu;
mod solar;
mod weather;

use cursor::CursorTracker;
use environment::EnvironmentService;
use tauri_plugin_window_state::StateFlags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Solo posicion y tamano: el resto del estado de la ventana es fijo por diseno.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE)
                .build(),
        )
        .manage(CursorTracker::default())
        .manage(EnvironmentService::default())
        .on_menu_event(menu::handle_menu_event)
        .invoke_handler(tauri::generate_handler![
            cursor::start_cursor_tracking,
            environment::start_environment,
            menu::show_context_menu,
            #[cfg(debug_assertions)]
            devtools::dev_set_window_size
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
