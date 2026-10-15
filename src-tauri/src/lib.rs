mod cursor;
#[cfg(debug_assertions)]
mod devtools;
mod environment;
mod location;
mod menu;
mod settings;
mod solar;
mod weather;

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

use cursor::CursorTracker;
use environment::EnvironmentService;
use settings::SettingsStore;

pub const MAIN_WINDOW: &str = "main";

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
        .setup(|app| {
            let path = app
                .path()
                .app_config_dir()
                .ok()
                .map(|dir| dir.join(settings::SETTINGS_FILE_NAME));
            let store = SettingsStore::load(path);
            if let Some(window) = app.get_webview_window(MAIN_WINDOW)
                && let Err(error) = window.set_always_on_top(store.get().always_on_top)
            {
                eprintln!("failed to apply always on top: {error}");
            }
            app.manage(store);
            Ok(())
        })
        .on_menu_event(menu::handle_menu_event)
        .invoke_handler(tauri::generate_handler![
            cursor::start_cursor_tracking,
            environment::start_environment,
            menu::show_context_menu,
            settings::get_settings,
            settings::set_scene,
            #[cfg(debug_assertions)]
            devtools::dev_set_window_size
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
