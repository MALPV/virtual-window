// Fragmento comun a los dos pases del lago alpino.
#include "uniforms.glsl"
#include "noise.glsl"

// Casa en la ladera, a unos 20 m sobre el agua: el lago ocupa la mitad inferior de la ventana y las
// montanas, levantandose casi desde el agua, se reflejan enteras en el espejo.
const float WINDOW_DISTANCE = 1.0;
const float TAN_HALF_FOV = 0.42;
const float LOOK_DOWN = 0.02;
const float EYE_HEIGHT = 20.0;
const vec2 EYE_RANGE = vec2(0.09, 0.06);
const float CLOUD_HEIGHT = 1100.0;
const float DEPTH_SCALE = 400.0;
const float SNOW_BASE = 520.0;
// Fondo del lago profundo: no se ve (el agua lo cubre) pero deja avanzar rapido a los rayos que
// cruzan el lago, incluidos los del reflejo.
const float LAKE_BED = -40.0;

#include "window.glsl"
#include "terrain.glsl"

// Ladera propia que baja hasta el agua a unos 55 m, el lago, y montanas que se levantan casi desde
// la orilla opuesta a 1,3 km, para que el agua refleje cumbres y no llanura.
float land_height(vec2 p, int octaves) {
  float own_edge = 55.0 + (fbm(vec2(p.x * 0.05, 2.0), 3) - 0.5) * 14.0;
  float slope = (EYE_HEIGHT - 2.0) * (1.0 - smoothstep(0.0, own_edge, p.y));
  float own_mask = 1.0 - smoothstep(own_edge - 4.0, own_edge + 4.0, p.y);
  float own = mix(LAKE_BED, 0.6 + slope + (fbm(p * 0.3, 3) - 0.5) * 0.4, own_mask);

  float shore = p.y + (fbm(vec2(p.x * 0.002, 5.0), 3) - 0.5) * 300.0;
  float far = smoothstep(1250.0, 1340.0, shore);
  // Detalle suave en las faldas: vistas casi a ras, el detalle fino solo produce moire.
  // Bancos rocosos bajos en la orilla opuesta y cumbres de 600-650 m entre 2 y 3 km.
  float banks = 6.0 + fbm(p * 0.006, 2) * 30.0 * smoothstep(1260.0, 1360.0, shore);
  float rise = smoothstep(1300.0, 2500.0, shore);
  float mountains = banks + eroded_mountains(p * 0.0013 + vec2(1.3, 7.1), octaves) * 650.0 * rise;
  return max(own, mix(LAKE_BED, mountains, far));
}
