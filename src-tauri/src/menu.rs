use serde::{Deserialize, Serialize};
use tauri::menu::{
    CheckMenuItem, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu,
};
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime, WebviewWindow};

pub const MAIN_WINDOW: &str = "main";
pub const SCENE_SELECTED_EVENT: &str = "scene-selected";

const MENU_ALWAYS_ON_TOP: &str = "always-on-top";
const MENU_ATTRIBUTION: &str = "attribution";
const MENU_CLOSE: &str = "close";
const SCENE_ID_PREFIX: &str = "scene:";

const MAX_SCENES: usize = 64;
const MAX_SCENE_ID_LENGTH: usize = 64;
const MAX_SCENE_NAME_CHARS: usize = 48;

struct MenuLabels {
    scene: &'static str,
    always_on_top: &'static str,
    close: &'static str,
    attribution: &'static str,
}

const LABELS_ES: MenuLabels = MenuLabels {
    scene: "Escena",
    always_on_top: "Siempre encima",
    close: "Cerrar",
    attribution: "Datos del clima: Open-Meteo.com",
};

const LABELS_EN: MenuLabels = MenuLabels {
    scene: "Scene",
    always_on_top: "Always on top",
    close: "Close",
    attribution: "Weather data: Open-Meteo.com",
};

/// Picks menu labels from a BCP 47 locale (e.g. "es-CL"). English is the default.
fn menu_labels(locale: &str) -> &'static MenuLabels {
    let language = locale.split(['-', '_']).next().unwrap_or_default();
    if language.eq_ignore_ascii_case("es") {
        &LABELS_ES
    } else {
        &LABELS_EN
    }
}

#[derive(Debug, Deserialize)]
pub struct SceneOption {
    id: String,
    name: String,
}

#[derive(Clone, Serialize)]
struct SceneSelected {
    id: String,
}

fn is_valid_scene_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_SCENE_ID_LENGTH
        && !id.starts_with('-')
        && !id.ends_with('-')
        && !id.contains("--")
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn is_valid_scene_name(name: &str) -> bool {
    let length = name.chars().count();
    length > 0 && length <= MAX_SCENE_NAME_CHARS && !name.chars().any(char::is_control)
}

// El frontend es de confianza pero sus datos terminan en un menu nativo: se validan igualmente.
fn validate_scenes(scenes: &[SceneOption], active_scene: &str) -> Result<(), String> {
    if scenes.len() > MAX_SCENES {
        return Err(format!("too many scenes: {}", scenes.len()));
    }
    if let Some(invalid) = scenes
        .iter()
        .find(|scene| !is_valid_scene_id(&scene.id) || !is_valid_scene_name(&scene.name))
    {
        return Err(format!("invalid scene option: {invalid:?}"));
    }
    if !active_scene.is_empty() && !is_valid_scene_id(active_scene) {
        return Err("invalid active scene id".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn show_context_menu<R: Runtime>(
    window: WebviewWindow<R>,
    locale: String,
    scenes: Vec<SceneOption>,
    active_scene: String,
) -> Result<(), String> {
    validate_scenes(&scenes, &active_scene)?;
    let labels = menu_labels(&locale);

    let build_and_show = || -> tauri::Result<()> {
        let scene_items = scenes
            .iter()
            .map(|scene| {
                CheckMenuItem::with_id(
                    &window,
                    format!("{SCENE_ID_PREFIX}{}", scene.id),
                    &scene.name,
                    true,
                    scene.id == active_scene,
                    None::<&str>,
                )
            })
            .collect::<tauri::Result<Vec<_>>>()?;
        let scene_refs: Vec<&dyn IsMenuItem<R>> = scene_items
            .iter()
            .map(|item| item as &dyn IsMenuItem<R>)
            .collect();
        let scene_menu =
            Submenu::with_items(&window, labels.scene, !scene_refs.is_empty(), &scene_refs)?;

        let menu = Menu::with_items(
            &window,
            &[
                &scene_menu,
                &CheckMenuItem::with_id(
                    &window,
                    MENU_ALWAYS_ON_TOP,
                    labels.always_on_top,
                    true,
                    window.is_always_on_top()?,
                    None::<&str>,
                )?,
                &PredefinedMenuItem::separator(&window)?,
                // Atribucion exigida por la licencia CC BY 4.0 de los datos de Open-Meteo.
                &MenuItem::with_id(
                    &window,
                    MENU_ATTRIBUTION,
                    labels.attribution,
                    false,
                    None::<&str>,
                )?,
                &PredefinedMenuItem::separator(&window)?,
                &MenuItem::with_id(&window, MENU_CLOSE, labels.close, true, None::<&str>)?,
            ],
        )?;
        window.popup_menu(&menu)
    };
    build_and_show().map_err(|error| error.to_string())
}

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let id = event.id().as_ref();
    let result = if let Some(scene_id) = id.strip_prefix(SCENE_ID_PREFIX) {
        window.emit_to(
            EventTarget::webview_window(MAIN_WINDOW),
            SCENE_SELECTED_EVENT,
            SceneSelected {
                id: scene_id.to_string(),
            },
        )
    } else {
        match id {
            MENU_ALWAYS_ON_TOP => window
                .is_always_on_top()
                .and_then(|current| window.set_always_on_top(!current)),
            MENU_CLOSE => window.close(),
            _ => Ok(()),
        }
    };
    if let Err(error) = result {
        eprintln!("menu action failed: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scene(id: &str, name: &str) -> SceneOption {
        SceneOption {
            id: id.to_string(),
            name: name.to_string(),
        }
    }

    #[test]
    fn spanish_locales_get_spanish_labels() {
        assert_eq!(menu_labels("es").close, "Cerrar");
        assert_eq!(menu_labels("es-CL").close, "Cerrar");
        assert_eq!(menu_labels("ES_es").close, "Cerrar");
    }

    #[test]
    fn other_or_invalid_locales_fall_back_to_english() {
        assert_eq!(menu_labels("en-US").close, "Close");
        assert_eq!(menu_labels("pt-BR").close, "Close");
        assert_eq!(menu_labels("").close, "Close");
        assert_eq!(menu_labels("estonian").close, "Close");
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

    #[test]
    fn scene_names_reject_control_characters_and_overflow() {
        assert!(is_valid_scene_name("Lago alpino"));
        assert!(is_valid_scene_name("Tejados de Tokio"));
        assert!(!is_valid_scene_name(""));
        assert!(!is_valid_scene_name("bad\nname"));
        assert!(!is_valid_scene_name(&"x".repeat(MAX_SCENE_NAME_CHARS + 1)));
    }

    #[test]
    fn scene_list_validation() {
        let ok = vec![
            scene("alpine-lake", "Alpine lake"),
            scene("rooftops", "Rooftops"),
        ];
        assert!(validate_scenes(&ok, "alpine-lake").is_ok());
        assert!(validate_scenes(&ok, "").is_ok());
        assert!(validate_scenes(&ok, "Bad Id").is_err());
        assert!(validate_scenes(&[scene("BAD", "x")], "").is_err());

        let too_many: Vec<_> = (0..=MAX_SCENES)
            .map(|i| scene(&format!("s{i}"), "S"))
            .collect();
        assert!(validate_scenes(&too_many, "").is_err());
    }
}
