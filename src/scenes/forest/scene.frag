#version 300 es
#include "common.glsl"
#include "atmosphere.glsl"

// Salida 0: bosque premultiplicado por su cobertura. Salida 1: cielo en rgb y profundidad en alfa.
layout(location = 0) out vec4 out_color;
layout(location = 1) out vec4 out_extra;

const float MAX_DISTANCE = 7000.0;

int octaves_at(float distance) {
  return int(clamp(7.0 - log2(1.0 + distance * 0.01), 3.0, 7.0));
}

float march(vec3 origin, vec3 direction) {
  float t = 0.5;
  for (int i = 0; i < 260; i++) {
    vec3 p = origin + direction * t;
    float h = p.y - land_height(p.xz, octaves_at(t));
    if (h < 0.002 * t) return t;
    // Pasos cortos cerca: las copas son cupulas empinadas.
    t += max(h * (t < 500.0 ? 0.28 : 0.45), 0.004 * t);
    if (t > MAX_DISTANCE) break;
  }
  return -1.0;
}

vec3 normal_at(vec3 p, float t) {
  float e = max(0.003 * t, 0.05);
  int octaves = octaves_at(t);
  float h = land_height(p.xz, octaves);
  vec3 normal = normalize(vec3(h - land_height(p.xz + vec2(e, 0.0), octaves), e, h - land_height(p.xz + vec2(0.0, e), octaves)));
  // Follaje: relieve fino de hojas solo de cerca.
  float near = 1.0 - smoothstep(80.0, 400.0, t);
  vec2 leaves = vec2(noise(p.xz * 1.8 + p.y), noise(p.zx * 1.8 - p.y)) - 0.5;
  return normalize(normal + vec3(leaves.x, 0.0, leaves.y) * 0.6 * near);
}

float soft_shadow(vec3 origin, vec3 sun) {
  if (sun.y <= 0.0) return 0.0;
  float result = 1.0;
  float t = 0.5;
  for (int i = 0; i < 40; i++) {
    vec3 p = origin + sun * t;
    float h = p.y - land_height(p.xz, 4);
    result = min(result, 8.0 * h / t);
    if (result < 0.01 || t > 2500.0) break;
    t += clamp(h * 0.5, 0.5 + 0.02 * t, 60.0);
  }
  return clamp(result, 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec3 origin = eye_position();
  vec3 direction = view_ray(uv, aspect);
  vec3 sun = sun_direction(aspect);

  vec3 sky = atmosphere(direction, sun);
  float night = 1.0 - smoothstep(-8.0, 2.0, u_sun_altitude);
  sky += to_linear(mix(u_sky_horizon, u_sky_top, clamp(direction.y * 2.0, 0.0, 1.0))) * 1.1 * night;
  float mu = dot(direction, sun);
  vec3 sky_color = sky + to_linear(u_sun_color) * smoothstep(0.99985, 0.99995, mu) * 40.0 * u_sun_visibility;
  out_extra = vec4(pow(aces(sky_color * 1.1), vec3(1.0 / 2.2)), 0.0);

  float t = march(origin, direction);
  if (t < 0.0) {
    out_color = vec4(0.0);
    return;
  }

  vec3 p = origin + direction * t;
  vec3 normal = normal_at(p, t);
  float ground = ground_height(p.xz, 5);
  vec2 cell = floor(p.xz / TREE_CELL);
  float tree_tone = hash12(cell + 11.0);
  vec3 leaves = mix(vec3(0.035, 0.07, 0.03), vec3(0.07, 0.11, 0.04), tree_tone);
  leaves = mix(leaves, vec3(0.12, 0.11, 0.04), step(0.93, tree_tone));
  float lod = 1.0 + t * 0.003;
  leaves *= 0.75 + 0.5 * fbm(p.xz * 0.5 / lod, 3);
  vec3 albedo = p.y - ground > 1.0 ? leaves : vec3(0.08, 0.1, 0.05);

  float above = smoothstep(-2.0, 5.0, u_sun_altitude);
  vec3 sun_light = to_linear(u_sun_color) * 2.6 * above * mix(1.0, 0.3, u_cloud_deck);
  vec3 sky_tint = to_linear(mix(u_sky_horizon, u_sky_top, 0.6));
  vec3 sky_light = mix(sky_tint, vec3(luminance(sky_tint)), 0.4) * (0.3 + 0.5 * u_daylight) + vec3(0.01, 0.014, 0.02);
  float shadow = soft_shadow(p + normal * 0.1, sun);
  float diffuse = max(dot(normal, sun), 0.0) * shadow;
  // Hojas a contraluz: dejan pasar algo de luz y brillan en el borde de las copas.
  float translucency = pow(max(dot(direction, sun), 0.0), 4.0) * shadow * 0.6;
  // Los huecos entre copas reciben menos luz del cielo.
  float occlusion = clamp(0.45 + (p.y - ground) / 30.0, 0.45, 1.0);
  vec3 color = albedo * (sun_light * (diffuse + translucency) + sky_light * (0.5 + 0.5 * normal.y) * occlusion);

  // Perspectiva aerea y niebla acumulada en los valles: las crestas lejanas se vuelven azuladas.
  float morning_mist = 0.25 + u_golden_hour * 0.5 + u_fog;
  float valley = exp(-max(p.y + 40.0, 0.0) / 35.0);
  float extinction = exp(-t * (0.00025 + u_fog * 0.002 + u_rain * 0.0006 + valley * 0.0012 * morning_mist));
  vec3 haze = mix(sky * 0.85, to_linear(u_deck_color) * (0.3 + 0.7 * u_daylight), u_cloud_deck * 0.85);
  haze *= min(1.0, 0.5 / max(luminance(haze), 1e-3));
  haze = mix(haze, to_linear(u_fog_color) * (0.4 + 0.6 * u_daylight), clamp(u_fog * 0.8 + valley * 0.3, 0.0, 1.0));
  color = color * extinction + haze * (1.0 - extinction);

  out_color = vec4(pow(aces(color * 1.1), vec3(1.0 / 2.2)), 1.0);
  out_extra.a = max(1.0 - exp(-t / DEPTH_SCALE), 1.0 / 255.0);
}
