// Fragmento comun a los dos pases del desierto.
#include "uniforms.glsl"
#include "noise.glsl"

// Refugio en lo alto de una duna alta: el ojo a 35 m mira algo hacia abajo sobre un mar de dunas
// cuyas crestas lejanas asoman en capas.
const float WINDOW_DISTANCE = 1.0;
const float TAN_HALF_FOV = 0.42;
const float LOOK_DOWN = 0.14;
const float EYE_HEIGHT = 35.0;
const vec2 EYE_RANGE = vec2(0.09, 0.06);
const float CLOUD_HEIGHT = 1500.0;
const float DEPTH_SCALE = 450.0;

#include "window.glsl"

// Perfil de duna: ladera suave a barlovento y cara empinada a sotavento, con la cresta redondeada.
float dune_profile(float u) {
  float f = fract(u);
  float rise = smoothstep(0.0, 0.78, f);
  float fall = 1.0 - smoothstep(0.78, 1.0, f);
  return min(rise, fall);
}

float dunes(vec2 p, int octaves) {
  // Crestas serpenteantes en diagonal a la mirada: asi hay caras orientadas al sol en cualquier
  // hora y las crestas se iluminan a contraluz.
  vec2 q = p * 0.006;
  q += vec2(fbm(q * 0.6, 3), fbm(q * 0.6 + 3.0, 3)) * 1.8;
  float big = dune_profile(q.y + q.x * 0.7) * (45.0 + 40.0 * fbm(q * 0.3, 2));
  // Dunas pequenas suaves que se desvanecen con la distancia (con menos octavas) para no hacer moire.
  vec2 r = p * 0.011 + vec2(5.0, 1.0);
  r += vec2(fbm(r * 0.5, 2), fbm(r * 0.5 + 7.0, 2)) * 1.2;
  float small = smoothstep(0.0, 1.0, dune_profile(r.y - r.x * 0.5)) * 5.0 * smoothstep(3.0, 5.0, float(octaves));
  float swell = (fbm(p * 0.0015, octaves) - 0.5) * 60.0;
  // Las dunas crecen con la distancia: sus crestas se superponen en capas hasta el horizonte.
  float rise = smoothstep(250.0, 2500.0, p.y) * 70.0;
  return big + small + swell + rise;
}

float land_height(vec2 p, int octaves) {
  float near = length(p);
  // Nuestra duna: la ventana esta en su cima y la arena cae en pendiente hacia el campo de dunas.
  float own = 25.0 - near * 0.32 + (fbm(p * 0.05, 2) - 0.5) * 2.0;
  return max(own, dunes(p, octaves) - 55.0);
}
