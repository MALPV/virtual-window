mod cursor;
mod environment;
mod location;
mod menu;
mod solar;
mod weather;

use cursor::CursorTracker;
use environment::EnvironmentService;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CursorTracker::default())
        .manage(EnvironmentService::default())
        .on_menu_event(menu::handle_menu_event)
        .invoke_handler(tauri::generate_handler![
            cursor::start_cursor_tracking,
            environment::start_environment,
            menu::show_context_menu
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
