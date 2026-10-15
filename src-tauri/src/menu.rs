use serde::Deserialize;
use tauri::menu::{
    CheckMenuItem, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu,
};
use tauri::{AppHandle, Manager, Runtime, State, WebviewWindow};

use crate::MAIN_WINDOW;
use crate::settings::{
    BRIGHTNESS_LEVELS, FrameColor, FrameStyle, Settings, SettingsStore, emit_settings,
    is_valid_scene_id,
};

const MENU_ALWAYS_ON_TOP: &str = "always-on-top";
const MENU_FOCUS: &str = "focus";
const MENU_REDUCE_MOTION: &str = "reduce-motion";
const MENU_ATTRIBUTION: &str = "attribution";
const MENU_CLOSE: &str = "close";
const SCENE_PREFIX: &str = "scene:";
const FRAME_STYLE_PREFIX: &str = "frame-style:";
const FRAME_COLOR_PREFIX: &str = "frame-color:";
const BRIGHTNESS_PREFIX: &str = "brightness:";

const MAX_SCENES: usize = 64;
const MAX_SCENE_NAME_CHARS: usize = 48;

struct MenuLabels {
    scene: &'static str,
    frame: &'static str,
    frame_style: &'static str,
    frame_color: &'static str,
    brightness: &'static str,
    focus: &'static str,
    reduce_motion: &'static str,
    always_on_top: &'static str,
    close: &'static str,
    attribution: &'static str,
    styles: fn(FrameStyle) -> &'static str,
    colors: fn(FrameColor) -> &'static str,
}

const LABELS_ES: MenuLabels = MenuLabels {
    scene: "Escena",
    frame: "Marco",
    frame_style: "Estilo",
    frame_color: "Color",
    brightness: "Brillo",
    focus: "Modo concentración",
    reduce_motion: "Reducir movimiento",
    always_on_top: "Siempre encima",
    close: "Cerrar",
    attribution: "Datos del clima: Open-Meteo.com",
    styles: |style| match style {
        FrameStyle::Classic => "Clásico",
        FrameStyle::Modern => "Moderno",
        FrameStyle::Industrial => "Industrial",
    },
    colors: |color| match color {
        FrameColor::Ivory => "Marfil",
        FrameColor::White => "Blanco",
        FrameColor::Oak => "Roble",
        FrameColor::Walnut => "Nogal",
        FrameColor::Black => "Negro",
        FrameColor::Sage => "Salvia",
    },
};

const LABELS_EN: MenuLabels = MenuLabels {
    scene: "Scene",
    frame: "Frame",
    frame_style: "Style",
    frame_color: "Color",
    brightness: "Brightness",
    focus: "Focus mode",
    reduce_motion: "Reduce motion",
    always_on_top: "Always on top",
    close: "Close",
    attribution: "Weather data: Open-Meteo.com",
    styles: |style| match style {
        FrameStyle::Classic => "Classic",
        FrameStyle::Modern => "Modern",
        FrameStyle::Industrial => "Industrial",
    },
    colors: |color| match color {
        FrameColor::Ivory => "Ivory",
        FrameColor::White => "White",
        FrameColor::Oak => "Oak",
        FrameColor::Walnut => "Walnut",
        FrameColor::Black => "Black",
        FrameColor::Sage => "Sage",
    },
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

fn is_valid_scene_name(name: &str) -> bool {
    let length = name.chars().count();
    length > 0 && length <= MAX_SCENE_NAME_CHARS && !name.chars().any(char::is_control)
}

// El frontend es de confianza pero sus datos terminan en un menu nativo: se validan igualmente.
fn validate_scenes(scenes: &[SceneOption]) -> Result<(), String> {
    if scenes.len() > MAX_SCENES {
        return Err(format!("too many scenes: {}", scenes.len()));
    }
    match scenes
        .iter()
        .find(|scene| !is_valid_scene_id(&scene.id) || !is_valid_scene_name(&scene.name))
    {
        Some(invalid) => Err(format!("invalid scene option: {invalid:?}")),
        None => Ok(()),
    }
}

/// A setting change requested from the menu.
#[derive(Debug, PartialEq, Eq)]
enum MenuAction {
    Scene(String),
    FrameStyle(FrameStyle),
    FrameColor(FrameColor),
    Brightness(u8),
    ToggleFocus,
    ToggleReduceMotion,
    ToggleAlwaysOnTop,
    Close,
}

fn parse_menu_action(id: &str) -> Option<MenuAction> {
    if let Some(scene) = id.strip_prefix(SCENE_PREFIX) {
        return is_valid_scene_id(scene).then(|| MenuAction::Scene(scene.to_string()));
    }
    if let Some(style) = id.strip_prefix(FRAME_STYLE_PREFIX) {
        return FrameStyle::from_id(style).map(MenuAction::FrameStyle);
    }
    if let Some(color) = id.strip_prefix(FRAME_COLOR_PREFIX) {
        return FrameColor::from_id(color).map(MenuAction::FrameColor);
    }
    if let Some(level) = id.strip_prefix(BRIGHTNESS_PREFIX) {
        return level
            .parse::<u8>()
            .ok()
            .filter(|level| BRIGHTNESS_LEVELS.contains(level))
            .map(MenuAction::Brightness);
    }
    match id {
        MENU_FOCUS => Some(MenuAction::ToggleFocus),
        MENU_REDUCE_MOTION => Some(MenuAction::ToggleReduceMotion),
        MENU_ALWAYS_ON_TOP => Some(MenuAction::ToggleAlwaysOnTop),
        MENU_CLOSE => Some(MenuAction::Close),
        _ => None,
    }
}

fn apply_action(settings: &mut Settings, action: &MenuAction) {
    match action {
        MenuAction::Scene(id) => settings.scene = Some(id.clone()),
        MenuAction::FrameStyle(style) => settings.frame_style = *style,
        MenuAction::FrameColor(color) => settings.frame_color = *color,
        MenuAction::Brightness(level) => settings.brightness = *level,
        MenuAction::ToggleFocus => settings.focus = !settings.focus,
        MenuAction::ToggleReduceMotion => settings.reduce_motion = !settings.reduce_motion,
        MenuAction::ToggleAlwaysOnTop => settings.always_on_top = !settings.always_on_top,
        MenuAction::Close => {}
    }
}

fn check_item<R: Runtime>(
    window: &WebviewWindow<R>,
    id: String,
    label: &str,
    checked: bool,
) -> tauri::Result<CheckMenuItem<R>> {
    CheckMenuItem::with_id(window, id, label, true, checked, None::<&str>)
}

fn submenu<R: Runtime>(
    window: &WebviewWindow<R>,
    label: &str,
    items: &[CheckMenuItem<R>],
) -> tauri::Result<Submenu<R>> {
    let refs: Vec<&dyn IsMenuItem<R>> = items
        .iter()
        .map(|item| item as &dyn IsMenuItem<R>)
        .collect();
    Submenu::with_items(window, label, !refs.is_empty(), &refs)
}

fn build_menu<R: Runtime>(
    window: &WebviewWindow<R>,
    labels: &MenuLabels,
    scenes: &[SceneOption],
    settings: &Settings,
    active_scene: &str,
) -> tauri::Result<Menu<R>> {
    let scene_items = scenes
        .iter()
        .map(|scene| {
            check_item(
                window,
                format!("{SCENE_PREFIX}{}", scene.id),
                &scene.name,
                scene.id == active_scene,
            )
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let scene_menu = submenu(window, labels.scene, &scene_items)?;

    let style_items = FrameStyle::ALL
        .into_iter()
        .map(|style| {
            check_item(
                window,
                format!("{FRAME_STYLE_PREFIX}{}", style.id()),
                (labels.styles)(style),
                style == settings.frame_style,
            )
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let color_items = FrameColor::ALL
        .into_iter()
        .map(|color| {
            check_item(
                window,
                format!("{FRAME_COLOR_PREFIX}{}", color.id()),
                (labels.colors)(color),
                color == settings.frame_color,
            )
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let frame_menu = Submenu::with_items(
        window,
        labels.frame,
        true,
        &[
            &submenu(window, labels.frame_style, &style_items)?,
            &submenu(window, labels.frame_color, &color_items)?,
        ],
    )?;

    let brightness_items = BRIGHTNESS_LEVELS
        .into_iter()
        .map(|level| {
            check_item(
                window,
                format!("{BRIGHTNESS_PREFIX}{level}"),
                &format!("{level}%"),
                level == settings.brightness,
            )
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let brightness_menu = submenu(window, labels.brightness, &brightness_items)?;

    Menu::with_items(
        window,
        &[
            &scene_menu,
            &frame_menu,
            &brightness_menu,
            &PredefinedMenuItem::separator(window)?,
            &check_item(window, MENU_FOCUS.to_string(), labels.focus, settings.focus)?,
            &check_item(
                window,
                MENU_REDUCE_MOTION.to_string(),
                labels.reduce_motion,
                settings.reduce_motion,
            )?,
            &check_item(
                window,
                MENU_ALWAYS_ON_TOP.to_string(),
                labels.always_on_top,
                settings.always_on_top,
            )?,
            &PredefinedMenuItem::separator(window)?,
            // Atribucion exigida por la licencia CC BY 4.0 de los datos de Open-Meteo.
            &MenuItem::with_id(
                window,
                MENU_ATTRIBUTION,
                labels.attribution,
                false,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(window)?,
            &MenuItem::with_id(window, MENU_CLOSE, labels.close, true, None::<&str>)?,
        ],
    )
}

/// `active_scene` is the scene currently shown, which can differ from the saved one if it failed to load.
#[tauri::command]
pub async fn show_context_menu<R: Runtime>(
    window: WebviewWindow<R>,
    store: State<'_, SettingsStore>,
    locale: String,
    scenes: Vec<SceneOption>,
    active_scene: String,
) -> Result<(), String> {
    validate_scenes(&scenes)?;
    if !active_scene.is_empty() && !is_valid_scene_id(&active_scene) {
        return Err("invalid active scene id".to_string());
    }
    let settings = store.get();
    let menu = build_menu(
        &window,
        menu_labels(&locale),
        &scenes,
        &settings,
        &active_scene,
    )
    .map_err(|error| error.to_string())?;
    window.popup_menu(&menu).map_err(|error| error.to_string())
}

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let Some(action) = parse_menu_action(event.id().as_ref()) else {
        return;
    };
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    if action == MenuAction::Close {
        if let Err(error) = window.close() {
            eprintln!("failed to close window: {error}");
        }
        return;
    }

    let settings = app
        .state::<SettingsStore>()
        .update(|settings| apply_action(settings, &action));
    if action == MenuAction::ToggleAlwaysOnTop
        && let Err(error) = window.set_always_on_top(settings.always_on_top)
    {
        eprintln!("failed to change always on top: {error}");
    }
    emit_settings(app, &settings);
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
        assert_eq!((menu_labels("es").colors)(FrameColor::Walnut), "Nogal");
    }

    #[test]
    fn other_or_invalid_locales_fall_back_to_english() {
        assert_eq!(menu_labels("en-US").close, "Close");
        assert_eq!(menu_labels("pt-BR").close, "Close");
        assert_eq!(menu_labels("").close, "Close");
        assert_eq!(menu_labels("estonian").close, "Close");
    }

    #[test]
    fn scene_names_reject_control_characters_and_overflow() {
        assert!(is_valid_scene_name("Lago alpino"));
        assert!(!is_valid_scene_name(""));
        assert!(!is_valid_scene_name("bad\nname"));
        assert!(!is_valid_scene_name(&"x".repeat(MAX_SCENE_NAME_CHARS + 1)));
    }

    #[test]
    fn scene_list_validation() {
        assert!(validate_scenes(&[scene("alpine-lake", "Alpine lake")]).is_ok());
        assert!(validate_scenes(&[scene("BAD", "x")]).is_err());
        let too_many: Vec<_> = (0..=MAX_SCENES)
            .map(|i| scene(&format!("s{i}"), "S"))
            .collect();
        assert!(validate_scenes(&too_many).is_err());
    }

    #[test]
    fn parses_every_menu_action() {
        assert_eq!(
            parse_menu_action("scene:rooftops"),
            Some(MenuAction::Scene("rooftops".to_string()))
        );
        assert_eq!(
            parse_menu_action("frame-style:modern"),
            Some(MenuAction::FrameStyle(FrameStyle::Modern))
        );
        assert_eq!(
            parse_menu_action("frame-color:sage"),
            Some(MenuAction::FrameColor(FrameColor::Sage))
        );
        assert_eq!(
            parse_menu_action("brightness:70"),
            Some(MenuAction::Brightness(70))
        );
        assert_eq!(parse_menu_action("focus"), Some(MenuAction::ToggleFocus));
        assert_eq!(
            parse_menu_action("reduce-motion"),
            Some(MenuAction::ToggleReduceMotion)
        );
        assert_eq!(
            parse_menu_action("always-on-top"),
            Some(MenuAction::ToggleAlwaysOnTop)
        );
        assert_eq!(parse_menu_action("close"), Some(MenuAction::Close));
    }

    #[test]
    fn rejects_unknown_or_out_of_range_menu_ids() {
        assert_eq!(parse_menu_action("scene:Bad Id"), None);
        assert_eq!(parse_menu_action("frame-style:gothic"), None);
        assert_eq!(parse_menu_action("brightness:63"), None);
        assert_eq!(parse_menu_action("brightness:abc"), None);
        assert_eq!(parse_menu_action("attribution"), None);
    }

    #[test]
    fn actions_update_settings() {
        let mut settings = Settings::default();
        apply_action(&mut settings, &MenuAction::FrameColor(FrameColor::Black));
        apply_action(&mut settings, &MenuAction::Brightness(55));
        apply_action(&mut settings, &MenuAction::ToggleFocus);
        apply_action(&mut settings, &MenuAction::ToggleAlwaysOnTop);
        apply_action(&mut settings, &MenuAction::Scene("open-sea".to_string()));
        assert_eq!(settings.frame_color, FrameColor::Black);
        assert_eq!(settings.brightness, 55);
        assert!(settings.focus);
        assert!(!settings.always_on_top);
        assert_eq!(settings.scene.as_deref(), Some("open-sea"));
    }
}
