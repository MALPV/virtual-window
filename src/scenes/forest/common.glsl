// Fragmento comun a los dos pases del bosque.
#include "uniforms.glsl"
#include "noise.glsl"

// Cabana en lo alto de una colina de cima plana: el ojo a 100 m mira por encima de un mar de copas
// cercanas (vistas desde arriba, como mejor se representan) hacia crestas que se alejan en capas.
const float WINDOW_DISTANCE = 1.0;
const float TAN_HALF_FOV = 0.42;
const float LOOK_DOWN = 0.14;
const float EYE_HEIGHT = 100.0;
const vec2 EYE_RANGE = vec2(0.09, 0.06);
const float CLOUD_HEIGHT = 1400.0;
const float DEPTH_SCALE = 450.0;
const float TREE_CELL = 7.0;

#include "window.glsl"

// Relieve: nuestra cima junto a la cabana y crestas alargadas que se alejan hacia el fondo.
float ground_height(vec2 p, int octaves) {
  float near = length(p);
  float summit = 70.0 * (1.0 - smoothstep(90.0, 320.0, near));
  // Las crestas suben con la distancia hasta asomar sobre el horizonte en capas de siluetas.
  float ridges = (fbm(p * vec2(0.0011, 0.0034) + vec2(2.0, 0.0), octaves) - 0.5) * 300.0;
  float rise = smoothstep(600.0, 4000.0, p.y) * 420.0;
  float rolling = (fbm(p * 0.006, 3) - 0.5) * 30.0;
  return summit + (ridges + rise + rolling) * smoothstep(150.0, 600.0, near) - 60.0 * smoothstep(150.0, 700.0, near);
}

// Dosel: una copa por celda, mas un dosel bajo continuo entre copas (bosque denso).
// Cerca de la cabana hay un claro para que la vista no quede tapada.
float canopy_height(vec2 p) {
  float near = length(p);
  if (near < 30.0) return 0.0;
  vec2 cell = floor(p / TREE_CELL);
  vec2 jitter = (vec2(hash12(cell), hash12(cell + 7.0)) - 0.5) * TREE_CELL * 0.35;
  vec2 d = p - (cell + 0.5) * TREE_CELL - jitter;
  float radius = TREE_CELL * (0.42 + 0.12 * hash12(cell + 3.0));
  float tall = 14.0 + 10.0 * hash12(cell + 5.0);
  float q = 1.0 - dot(d, d) / (radius * radius);
  // Copa irregular: ramas y masas de follaje sobre la forma redondeada.
  float crown = q > 0.0 ? 0.55 + 0.45 * sqrt(q) : 0.45;
  crown += (noise(p * 0.9 + hash12(cell) * 10.0) - 0.5) * 0.22 + (noise(p * 2.3) - 0.5) * 0.08;
  return tall * crown * smoothstep(30.0, 38.0, near);
}

float land_height(vec2 p, int octaves) {
  float ground = ground_height(p, octaves);
  // Lejos las copas son textura: no hace falta geometria y solo produciria ruido.
  float canopy = length(p) < 1800.0 ? canopy_height(p) : 15.0;
  return ground + canopy;
}
