// Fragmento comun a los dos pases de la ciudad.
#include "uniforms.glsl"
#include "noise.glsl"

// Vista desde un octavo piso: el ojo a 30 m mira algo hacia abajo, por encima de los tejados cercanos.
const float WINDOW_DISTANCE = 1.0;
const float TAN_HALF_FOV = 0.42;
const float LOOK_DOWN = 0.12;
const float EYE_HEIGHT = 30.0;
const vec2 EYE_RANGE = vec2(0.09, 0.06);
const float CLOUD_HEIGHT = 1300.0;
const float DEPTH_SCALE = 500.0;

#include "window.glsl"

// Manzanas en reticula: un edificio por celda, separadas por calles. La reticula esta girada
// respecto a la ventana para no mirar justo a lo largo de una calle.
const float CELL = 34.0;
const float STREET = 9.0;
const mat2 GRID = mat2(0.866, 0.5, -0.5, 0.866);

vec3 to_grid(vec3 p) {
  return vec3(GRID * p.xz, p.y).xzy;
}

// Medio ancho (x), medio fondo (z) y altura del edificio de una celda.
vec3 building(vec2 cell) {
  vec2 center = (cell + 0.5) * CELL;
  float distance = length(center);
  // Nuestro propio edificio y la calle frente a la ventana quedan libres.
  if (center.y < CELL && abs(center.x) < CELL * 1.5) return vec3(0.0);
  float downtown = smoothstep(300.0, 1800.0, distance);
  float height = 9.0 + 24.0 * hash12(cell + 3.1);
  if (hash12(cell) > 0.9 - 0.14 * downtown) height = 50.0 + (80.0 + 120.0 * downtown) * hash12(cell + 7.7);
  // Cerca de la ventana los edificios quedan por debajo del ojo, para ver por encima de los tejados.
  height = mix(height, min(height, 12.0 + 8.0 * hash12(cell + 5.1)), 1.0 - smoothstep(90.0, 300.0, distance));
  vec2 half_size = (CELL - STREET) * 0.5 * vec2(0.62 + 0.38 * hash12(cell + 1.3), 0.62 + 0.38 * hash12(cell + 2.9));
  return vec3(half_size, height);
}

float box(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Distancia a la ciudad (edificios de la celda actual y el suelo).
float city_distance(vec3 world) {
  vec3 p = to_grid(world);
  vec2 cell = floor(p.xz / CELL);
  vec2 local = p.xz - (cell + 0.5) * CELL;
  vec3 b = building(cell);
  float d = p.y;
  if (b.z > 0.5) {
    d = min(d, box(vec3(local.x, p.y - b.z * 0.5, local.y), vec3(b.x, b.z * 0.5, b.y)));
    // Casetas y maquinas en la azotea.
    vec2 offset = (vec2(hash12(cell + 4.4), hash12(cell + 5.5)) - 0.5) * b.xy;
    d = min(d, box(vec3(local.x - offset.x, p.y - b.z - 1.4, local.y - offset.y), vec3(2.2, 1.4, 1.8)));
  }
  return d;
}

// Distancia al borde de la celda: limita el paso para no atravesar el edificio vecino.
float cell_margin(vec3 world) {
  vec3 p = to_grid(world);
  vec2 local = p.xz - (floor(p.xz / CELL) + 0.5) * CELL;
  vec2 to_edge = CELL * 0.5 - abs(local);
  return min(to_edge.x, to_edge.y) + 0.6;
}
