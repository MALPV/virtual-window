// Fragmento comun a los dos pases de la costa.
#include "uniforms.glsl"
#include "noise.glsl"

// Casa sobre un acantilado: el ojo esta a 40 m sobre el mar y mira algo hacia abajo.
const float WINDOW_DISTANCE = 1.0;
const float TAN_HALF_FOV = 0.42;
const float LOOK_DOWN = 0.134;
const float EYE_HEIGHT = 40.0;
const vec2 EYE_RANGE = vec2(0.09, 0.06);
const float CLOUD_HEIGHT = 1200.0;
const float OCEAN_MAX_DISTANCE = 3000.0;

// Profundidad guardada en el alfa del pase en cache: 0 es mar o cielo.
const float DEPTH_SCALE = 400.0;

#include "window.glsl"

// Linea de costa a la derecha, dentro del campo de vision: empieza a unos 100 m y se aleja con entrantes.
float coastline(float z) {
  return 18.0 + 0.075 * z + (fbm(vec2(z * 0.006, 3.1), 4) - 0.5) * 50.0;
}

const float SEABED = -9.0;

// Tierra: el borde de nuestro acantilado a unos 7 m, y la costa de enfrente con acantilados y colinas.
float land_height(vec2 p, int octaves) {
  float own_edge = 7.0 + (fbm(vec2(p.x * 0.15, 1.7), 3) - 0.5) * 3.0;
  float own_mask = 1.0 - smoothstep(own_edge - 1.0, own_edge + 1.5, p.y);
  float own = mix(SEABED, EYE_HEIGHT - 3.0 + (fbm(p * 0.9, 3) - 0.5) * 0.6, own_mask);

  float inland = p.x - coastline(p.y);
  // Surcos suaves en la cara del acantilado; la erosion domina en horizontal (estratos).
  float cliff = smoothstep(-4.0, 22.0, inland + (fbm(p * vec2(0.02, 0.05), 4) - 0.5) * 9.0) * smoothstep(80.0, 180.0, p.y);
  float plateau = 38.0 + fbm(p * 0.006, octaves) * 70.0;
  float hills = smoothstep(150.0, 900.0, inland) * fbm(p * 0.0025 + 4.0, octaves) * 260.0;
  // Farallones solo junto a la costa, y siempre asomando sobre el agua.
  float stacks = smoothstep(0.84, 0.92, noise(p * 0.035)) * 34.0 * smoothstep(-28.0, -10.0, inland) * smoothstep(120.0, 220.0, p.y);
  float far_land = mix(SEABED, plateau + hills, cliff) + stacks;
  // Cabo lejano al otro lado de la bahia: da profundidad al horizonte.
  float headland_mask = smoothstep(-0.2, -0.32, p.x / max(p.y, 1.0)) * smoothstep(1800.0, 2600.0, p.y);
  float headland = mix(SEABED, 60.0 + fbm(p * 0.003 + 9.0, octaves) * 160.0, headland_mask);
  return max(max(own, far_land), headland);
}
