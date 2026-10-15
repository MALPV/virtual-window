use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, EventTarget, Runtime, State};

use crate::MAIN_WINDOW;

pub const SETTINGS_FILE_NAME: &str = "settings.json";
pub const SETTINGS_CHANGED_EVENT: &str = "settings-changed";

pub const BRIGHTNESS_LEVELS: [u8; 5] = [100, 85, 70, 55, 40];
const MAX_SCENE_ID_LENGTH: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FrameStyle {
    Classic,
    Modern,
    Industrial,
}

impl FrameStyle {
    pub const ALL: [FrameStyle; 3] = [
        FrameStyle::Classic,
        FrameStyle::Modern,
        FrameStyle::Industrial,
    ];

    pub fn id(self) -> &'static str {
        match self {
            FrameStyle::Classic => "classic",
            FrameStyle::Modern => "modern",
            FrameStyle::Industrial => "industrial",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|style| style.id() == id)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FrameColor {
    Ivory,
    White,
    Oak,
    Walnut,
    Black,
    Sage,
}

impl FrameColor {
    pub const ALL: [FrameColor; 6] = [
        FrameColor::Ivory,
        FrameColor::White,
        FrameColor::Oak,
        FrameColor::Walnut,
        FrameColor::Black,
        FrameColor::Sage,
    ];

    pub fn id(self) -> &'static str {
        match self {
            FrameColor::Ivory => "ivory",
            FrameColor::White => "white",
            FrameColor::Oak => "oak",
            FrameColor::Walnut => "walnut",
            FrameColor::Black => "black",
            FrameColor::Sage => "sage",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|color| color.id() == id)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Selected scene id; None means the default scene.
    pub scene: Option<String>,
    pub frame_style: FrameStyle,
    pub frame_color: FrameColor,
    /// Percentage, one of BRIGHTNESS_LEVELS.
    pub brightness: u8,
    /// Fewer stimuli: hides ambient details and softens motion.
    pub focus: bool,
    pub reduce_motion: bool,
    pub always_on_top: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            scene: None,
            frame_style: FrameStyle::Classic,
            frame_color: FrameColor::Ivory,
            brightness: 100,
            focus: false,
            reduce_motion: false,
            always_on_top: true,
        }
    }
}

pub fn is_valid_scene_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_SCENE_ID_LENGTH
        && !id.starts_with('-')
        && !id.ends_with('-')
        && !id.contains("--")
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// Snaps any value to the closest supported brightness level.
pub fn snap_brightness(value: u8) -> u8 {
    BRIGHTNESS_LEVELS
        .into_iter()
        .min_by_key(|level| level.abs_diff(value))
        .unwrap_or(100)
}

impl Settings {
    /// Repairs values that a hand-edited or older settings file could contain.
    fn sanitized(mut self) -> Self {
        self.brightness = snap_brightness(self.brightness);
        if self
            .scene
            .as_deref()
            .is_some_and(|id| !is_valid_scene_id(id))
        {
            self.scene = None;
        }
        self
    }
}

fn read_settings(path: &Path) -> Option<Settings> {
    let contents = fs::read_to_string(path).ok()?;
    match serde_json::from_str::<Settings>(&contents) {
        Ok(settings) => Some(settings.sanitized()),
        Err(error) => {
            eprintln!("ignoring invalid settings file: {error}");
            None
        }
    }
}

fn write_settings(path: &Path, settings: &Settings) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let contents = serde_json::to_string_pretty(settings).map_err(io::Error::other)?;
    // Escritura atomica: un cierre a mitad de escritura no deja ajustes corruptos.
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, contents)?;
    fs::rename(&temp_path, path)
}

pub struct SettingsStore {
    path: Option<PathBuf>,
    current: Mutex<Settings>,
}

impl SettingsStore {
    pub fn load(path: Option<PathBuf>) -> Self {
        let current = path.as_deref().and_then(read_settings).unwrap_or_default();
        Self {
            path,
            current: Mutex::new(current),
        }
    }

    pub fn get(&self) -> Settings {
        self.current
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Applies `change`, persists the result and returns it. Persisting is best effort:
    /// the new settings stay active for this session even if the disk write fails.
    pub fn update(&self, change: impl FnOnce(&mut Settings)) -> Settings {
        let updated = {
            let mut current = self
                .current
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            change(&mut current);
            *current = current.clone().sanitized();
            current.clone()
        };
        if let Some(path) = &self.path
            && let Err(error) = write_settings(path, &updated)
        {
            eprintln!("failed to save settings: {error}");
        }
        updated
    }
}

pub fn emit_settings<R: Runtime>(app: &AppHandle<R>, settings: &Settings) {
    if let Err(error) = app.emit_to(
        EventTarget::webview_window(MAIN_WINDOW),
        SETTINGS_CHANGED_EVENT,
        settings,
    ) {
        eprintln!("failed to emit settings: {error}");
    }
}

#[tauri::command]
pub fn get_settings(store: State<'_, SettingsStore>) -> Settings {
    store.get()
}

/// Saves the scene picked outside the native menu (the dev simulator) and broadcasts the change.
#[tauri::command]
pub fn set_scene<R: Runtime>(
    app: AppHandle<R>,
    store: State<'_, SettingsStore>,
    id: String,
) -> Result<Settings, String> {
    if !is_valid_scene_id(&id) {
        return Err(format!("invalid scene id: {id}"));
    }
    let settings = store.update(|settings| settings.scene = Some(id));
    emit_settings(&app, &settings);
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir()
            .join(format!(
                "window-widget-settings-{}-{name}",
                std::process::id()
            ))
            .join(SETTINGS_FILE_NAME)
    }

    #[test]
    fn defaults_are_classic_ivory_full_brightness_on_top() {
        let settings = Settings::default();
        assert_eq!(settings.frame_style, FrameStyle::Classic);
        assert_eq!(settings.frame_color, FrameColor::Ivory);
        assert_eq!(settings.brightness, 100);
        assert!(settings.always_on_top);
        assert!(!settings.focus);
    }

    #[test]
    fn brightness_snaps_to_the_closest_level() {
        assert_eq!(snap_brightness(100), 100);
        assert_eq!(snap_brightness(90), 85);
        assert_eq!(snap_brightness(0), 40);
        assert_eq!(snap_brightness(255), 100);
    }

    #[test]
    fn serializes_with_camel_case_and_lowercase_enums() {
        let json = serde_json::to_value(Settings::default()).unwrap();
        assert_eq!(json["frameStyle"], "classic");
        assert_eq!(json["frameColor"], "ivory");
        assert_eq!(json["alwaysOnTop"], true);
        assert!(json["scene"].is_null());
    }

    #[test]
    fn missing_fields_take_defaults_and_bad_values_are_repaired() {
        let partial: Settings =
            serde_json::from_str(r#"{"frameColor":"walnut","brightness":62,"scene":"Bad Id"}"#)
                .unwrap();
        let repaired = partial.sanitized();
        assert_eq!(repaired.frame_color, FrameColor::Walnut);
        assert_eq!(repaired.frame_style, FrameStyle::Classic);
        assert_eq!(repaired.brightness, 55);
        assert_eq!(repaired.scene, None);
    }

    #[test]
    fn ids_round_trip() {
        for style in FrameStyle::ALL {
            assert_eq!(FrameStyle::from_id(style.id()), Some(style));
        }
        for color in FrameColor::ALL {
            assert_eq!(FrameColor::from_id(color.id()), Some(color));
        }
        assert_eq!(FrameStyle::from_id("gothic"), None);
    }

    #[test]
    fn store_persists_updates_and_reloads_them() {
        let path = temp_path("persist");
        let store = SettingsStore::load(Some(path.clone()));
        assert_eq!(store.get(), Settings::default());

        let updated = store.update(|settings| {
            settings.frame_style = FrameStyle::Industrial;
            settings.scene = Some("rooftops".to_string());
        });
        assert_eq!(updated.frame_style, FrameStyle::Industrial);

        let reloaded = SettingsStore::load(Some(path.clone()));
        assert_eq!(reloaded.get(), updated);

        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn corrupt_file_falls_back_to_defaults() {
        let path = temp_path("corrupt");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(
            SettingsStore::load(Some(path.clone())).get(),
            Settings::default()
        );
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn scene_ids_must_be_kebab_case() {
        assert!(is_valid_scene_id("alpine-lake"));
        assert!(is_valid_scene_id("open-sea-2"));
        assert!(!is_valid_scene_id(""));
        assert!(!is_valid_scene_id("Alpine"));
        assert!(!is_valid_scene_id("-lake"));
        assert!(!is_valid_scene_id("lake-"));
        assert!(!is_valid_scene_id("a--b"));
        assert!(!is_valid_scene_id("a b"));
        assert!(!is_valid_scene_id(&"a".repeat(MAX_SCENE_ID_LENGTH + 1)));
    }
}
