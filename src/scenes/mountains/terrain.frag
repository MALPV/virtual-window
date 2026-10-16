#version 300 es
#include "common.glsl"
#include "atmosphere.glsl"

// Salida 0: terreno premultiplicado por su cobertura. Salida 1: cielo en rgb y profundidad en alfa.
layout(location = 0) out vec4 out_color;
layout(location = 1) out vec4 out_extra;

const float MAX_DISTANCE = 6000.0;
const int MARCH_STEPS = 220;
const int SHADOW_STEPS = 48;



// Ruido con derivadas: permite atenuar los detalles en las pendientes y simular erosion.
vec3 noise_with_derivatives(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  float value = a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
  vec2 derivative = du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx);
  return vec3(value, derivative);
}

float eroded_mountains(vec2 p, int octaves) {
  float value = 0.0;
  float amplitude = 1.0;
  vec2 slope = vec2(0.0);
  mat2 rotate = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 11; i++) {
    if (i >= octaves) break;
    vec3 n = noise_with_derivatives(p);
    slope += n.yz;
    value += amplitude * n.x / (1.0 + dot(slope, slope));
    amplitude *= 0.5;
    p = rotate * p * 2.0;
  }
  return value;
}

// Composicion "a traves del valle": la casa esta en lo alto de una ladera, el fondo del valle queda
// 400 m mas abajo y la ladera de enfrente llena la ventana hasta sus cumbres.
float ground_height(vec2 p, int octaves) {
  float near = length(vec2(p.x * 0.6, p.y));
  // Ladera suave (unos 8,5 grados) durante 300 m y despues caida al valle: la parte baja de la ventana
  // mira justo sobre las copas de la pendiente, el tercio superior sobre la ladera de enfrente.
  float drop = -0.15 * min(near, 900.0) - 265.0 * smoothstep(250.0, 900.0, near);
  float rise = smoothstep(800.0, 1800.0, p.y);
  float range = rise * (440.0 + eroded_mountains(p * 0.0013 + vec2(3.1, 1.7), octaves) * 480.0);
  float valley = (fbm(p * 0.008, 5) - 0.5) * 40.0 * smoothstep(20.0, 200.0, near);
  // Ondulaciones suaves del prado; el detalle fino a esta distancia solo produciria ruido.
  float meadow = (fbm(p * 0.035, 4) - 0.5) * 6.0 * (1.0 - smoothstep(60.0, 300.0, near));
  return drop + range + valley + meadow;
}

const float TREE_CELL = 9.0;

// Abetos sobre el terreno, uno por celda, en la ladera cercana y el fondo del valle (no en la
// cordillera, donde a esa distancia solo serian ruido). Silueta irregular con pisos de ramas.
float tree_height(vec2 p, float ground) {
  float distance = length(p);
  if (distance < 25.0 || distance > 450.0) return 0.0;
  // Pasillo abierto frente a la ventana; los abetos cercanos de los lados enmarcan la vista.
  if (distance < 160.0 && abs(p.x) < 8.0 + distance * 0.12) return 0.0;
  vec2 cell = floor(p / TREE_CELL);
  vec2 local = p - (cell + 0.5) * TREE_CELL;
  vec2 jitter = (vec2(hash12(cell), hash12(cell + 17.0)) - 0.5) * TREE_CELL * 0.45;
  float density = 0.35 + 0.35 * smoothstep(60.0, 250.0, distance);
  if (hash12(cell + 5.3) > density) return 0.0;
  float tall = 12.0 + 12.0 * hash12(cell + 9.1);
  float radius = tall * 0.22;
  vec2 offset = local - jitter;
  float angle = atan(offset.y, offset.x);
  float ragged = 1.0 + 0.45 * (noise(vec2(angle * 2.5 + hash12(cell) * 20.0, hash12(cell + 2.0) * 9.0)) - 0.5);
  float h = tall * (1.0 - length(offset) * ragged / radius);
  if (h <= 0.0) return 0.0;
  // Pisos de ramas: cada piso se ensancha hacia abajo antes del siguiente. La base queda enterrada.
  return h - 1.6 * fract(h * 0.28 + hash12(cell + 4.0)) * smoothstep(tall * 0.97, tall * 0.4, h) - 1.5;
}

float terrain(vec2 p, int octaves) {
  float ground = ground_height(p, octaves);
  if (length(p) > 450.0) return ground;
  return ground + tree_height(p, ground);
}

int octaves_at(float distance) {
  return int(clamp(11.0 - log2(1.0 + distance * 0.02), 4.0, 11.0));
}

float march(vec3 origin, vec3 direction) {
  float t = 0.3;
  for (int i = 0; i < MARCH_STEPS; i++) {
    vec3 p = origin + direction * t;
    float h = p.y - terrain(p.xz, octaves_at(t));
    if (h < 0.002 * t) return t;
    // Pasos cortos cerca: los conos de los pinos son mas empinados que el relieve.
    t += max(h * (t < 400.0 ? 0.22 : 0.45), 0.004 * t);
    if (t > MAX_DISTANCE) break;
  }
  return -1.0;
}

vec3 terrain_normal(vec3 p, float t) {
  float e = max(0.004 * t, 0.02);
  int octaves = min(octaves_at(t) + 2, 11);
  float h = terrain(p.xz, octaves);
  return normalize(vec3(h - terrain(p.xz + vec2(e, 0.0), octaves), e, h - terrain(p.xz + vec2(0.0, e), octaves)));
}

float soft_shadow(vec3 origin, vec3 sun) {
  if (sun.y <= 0.0) return 0.0;
  float result = 1.0;
  float t = 0.5;
  for (int i = 0; i < SHADOW_STEPS; i++) {
    vec3 p = origin + sun * t;
    float h = p.y - terrain(p.xz, 6);
    result = min(result, 10.0 * h / t);
    if (result < 0.01 || t > 3000.0) break;
    t += clamp(h * 0.6, 0.5 + 0.02 * t, 80.0);
  }
  return clamp(result, 0.0, 1.0);
}

vec3 material(vec3 p, vec3 normal, float t) {
  float ground = ground_height(p.xz, 6);
  float above_ground = p.y - ground;
  if (above_ground > 0.2 && length(p.xz) < 450.0) {
    // Copas de abeto: verde oscuro, mas claro en las puntas y con ramas sueltas mas claras.
    float tip = clamp(above_ground / 22.0, 0.0, 1.0);
    float needles = noise(p.xz * 3.0 + p.y * 2.0);
    vec3 base = mix(vec3(0.02, 0.045, 0.03), vec3(0.06, 0.1, 0.05), tip);
    return base * (0.75 + 0.5 * hash12(floor(p.xz / TREE_CELL))) * (0.8 + 0.4 * needles);
  }
  float steep = 1.0 - normal.y;
  // El detalle se suaviza con la distancia para no convertirse en ruido de pixeles.
  float lod = 1.0 + t * 0.003;
  float variation = fbm(p.xz * 0.05 / lod, 4);
  vec3 grass = mix(vec3(0.09, 0.11, 0.05), vec3(0.15, 0.15, 0.07), variation);
  vec3 forest = mix(vec3(0.05, 0.09, 0.04), vec3(0.08, 0.12, 0.05), variation);
  vec3 rock = mix(vec3(0.24, 0.22, 0.2), vec3(0.36, 0.33, 0.3), fbm(p.xz * 0.2 / lod, 3));

  // Bosque en las laderas bajas del valle, prado alpino arriba, roca solo en las pendientes fuertes.
  vec3 albedo = mix(forest, grass, smoothstep(-150.0, 220.0, p.y + (variation - 0.5) * 60.0));
  albedo = mix(albedo, rock, smoothstep(0.4, 0.62, steep + (variation - 0.5) * 0.1));

  // La cota de nieve baja con el frio y cuando nieva.
  float cold = clamp((10.0 - u_temperature) / 20.0, 0.0, 1.0);
  float snow_line = mix(330.0, 60.0, max(cold, u_snow * 0.9));
  float snow = smoothstep(snow_line - 30.0, snow_line + 30.0, p.y + (variation - 0.5) * 80.0);
  snow *= smoothstep(0.55, 0.25, steep);
  return mix(albedo, vec3(0.82, 0.85, 0.9), snow);
}


void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec3 origin = eye_position();
  vec3 direction = view_ray(uv, aspect);
  vec3 sun = sun_direction(aspect);

  vec3 sky = atmosphere(direction, sun);
  float night = 1.0 - smoothstep(-8.0, 2.0, u_sun_altitude);
  vec3 night_sky = to_linear(mix(u_sky_horizon, u_sky_top, clamp(direction.y * 2.0, 0.0, 1.0))) * 1.1;
  sky += night_sky * night;

  float mu = dot(direction, sun);
  vec3 sky_color = sky + to_linear(u_sun_color) * smoothstep(0.99985, 0.99995, mu) * 40.0 * u_sun_visibility;
  sky_color += moon_disc(direction, sun) + moon_halo(direction);
  out_extra = vec4(pow(aces(sky_color * 1.1), vec3(1.0 / 2.2)), 0.0);

  float t = march(origin, direction);
  if (t < 0.0) {
    out_color = vec4(0.0);
    return;
  }
  {
    vec3 p = origin + direction * t;
    vec3 normal = terrain_normal(p, t);
    float above = smoothstep(-2.0, 5.0, u_sun_altitude);
    vec3 sun_light = to_linear(u_sun_color) * 3.2 * above * mix(1.0, 0.3, u_cloud_deck);
    vec3 sky_light = to_linear(mix(u_sky_horizon, u_sky_top, 0.6)) * (0.3 + 0.5 * u_daylight) + vec3(0.012, 0.016, 0.03);
    float diffuse = max(dot(normal, sun), 0.0) * soft_shadow(p + normal * 0.05, sun);
    float hemisphere = 0.5 + 0.5 * normal.y;
    float bounce = max(dot(normal, normalize(vec3(-sun.x, 0.0, -sun.z))), 0.0) * 0.15;
    vec3 albedo = material(p, normal, t);
    vec3 color = albedo * (sun_light * diffuse + sky_light * hemisphere + sun_light * bounce * 0.3 + moonlight_on(normal));

    // Perspectiva aerea: la distancia funde el terreno con el color del cielo en esa direccion.
    float density = 0.00011 + u_fog * 0.0022 + u_rain * 0.0005;
    float valley_haze = exp(-max(p.y + 380.0, 0.0) * 0.02) * (0.002 + u_fog * 0.01);
    float extinction = exp(-t * (density + valley_haze));
    // La bruma toma el color del cielo real: despejado, cubierto o con niebla.
    vec3 haze = mix(sky * 0.9, to_linear(u_deck_color) * (0.3 + 0.7 * u_daylight), u_cloud_deck * 0.85);
    haze = mix(haze, to_linear(u_fog_color) * (0.4 + 0.6 * u_daylight), u_fog * 0.8);
    color = color * extinction + haze * (1.0 - extinction);
    out_color = vec4(pow(aces(color * 1.1), vec3(1.0 / 2.2)), 1.0);
    out_extra.a = max(1.0 - exp(-t / DEPTH_SCALE), 1.0 / 255.0);
  }
}
