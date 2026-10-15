const SCENE_KEY = "window.scene";
const SCENE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// localStorage puede no estar disponible (modo privado, cuota): las preferencias son opcionales.
export function loadSceneId(): string | null {
  try {
    const value = localStorage.getItem(SCENE_KEY);
    return value !== null && SCENE_ID_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveSceneId(id: string): void {
  try {
    localStorage.setItem(SCENE_KEY, id);
  } catch (error) {
    console.warn("Could not save scene preference:", error);
  }
}
