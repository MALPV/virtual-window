#version 300 es
#include "common.glsl"
#include "sky.glsl"

out vec4 out_color;

const int MARCH_STEPS = 180;
const int SHADOW_STEPS = 40;
const float LAND_MAX_DISTANCE = 4000.0;

int octaves_at(float distance) {
  return int(clamp(7.0 - log2(1.0 + distance * 0.01), 3.0, 7.0));
}

float march_land(vec3 origin, vec3 direction) {
  float t = 0.5;
  for (int i = 0; i < MARCH_STEPS; i++) {
    vec3 p = origin + direction * t;
    float h = p.y - land_height(p.xz, octaves_at(t));
    if (h < 0.002 * t) return t;
    t += max(h * 0.4, 0.004 * t);
    if (t > LAND_MAX_DISTANCE) break;
  }
  return -1.0;
}

vec3 land_normal(vec3 p, float t) {
  float e = max(0.004 * t, 0.03);
  int octaves = min(octaves_at(t) + 1, 7);
  float h = land_height(p.xz, octaves);
  return normalize(vec3(h - land_height(p.xz + vec2(e, 0.0), octaves), e, h - land_height(p.xz + vec2(0.0, e), octaves)));
}

float soft_shadow(vec3 origin, vec3 sun) {
  if (sun.y <= 0.0) return 0.0;
  float result = 1.0;
  float t = 0.4;
  for (int i = 0; i < SHADOW_STEPS; i++) {
    vec3 p = origin + sun * t;
    float h = p.y - land_height(p.xz, 4);
    result = min(result, 9.0 * h / t);
    if (result < 0.01 || t > 1500.0) break;
    t += clamp(h * 0.6, 0.4 + 0.02 * t, 60.0);
  }
  return clamp(result, 0.0, 1.0);
}

vec3 material(vec3 p, vec3 normal, float t) {
  float lod = 1.0 + t * 0.004;
  float steep = 1.0 - normal.y;
  float variation = fbm(p.xz * 0.06 / lod, 4);
  // Roca de acantilado con estratos horizontales; hierba y matorral seco en lo alto.
  float strata = 0.5 + 0.5 * sin(p.y * 1.3 + fbm(p.xz * 0.03 / lod, 3) * 3.0);
  vec3 rock = mix(vec3(0.2, 0.15, 0.11), vec3(0.36, 0.28, 0.2), strata * 0.65 + variation * 0.35);
  vec3 grass = mix(vec3(0.07, 0.1, 0.04), vec3(0.15, 0.16, 0.07), variation);
  vec3 albedo = mix(grass, rock, smoothstep(0.35, 0.6, steep + (variation - 0.5) * 0.15));
  // Arena o roca humeda en la base, junto al agua.
  albedo = mix(vec3(0.2, 0.17, 0.13), albedo, smoothstep(0.5, 3.0, p.y));
  return albedo;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec3 origin = eye_position();
  vec3 direction = view_ray(uv, aspect);
  vec3 sun = sun_direction(aspect);

  float t = march_land(origin, direction);
  vec3 p = origin + direction * max(t, 0.0);
  // Lo que queda bajo el nivel del mar lo dibuja el oceano en el pase principal.
  if (t < 0.0 || p.y < 0.25) {
    out_color = vec4(0.0);
    return;
  }

  vec3 normal = land_normal(p, t);
  float above = smoothstep(-2.0, 5.0, u_sun_altitude);
  vec3 sun_light = to_linear(u_sun_color) * 2.4 * above * mix(1.0, 0.3, u_cloud_deck);
  // Luz de cielo menos saturada que el propio cielo, mas un rebote calido del suelo y del agua.
  vec3 sky_tint = to_linear(mix(u_sky_horizon, u_sky_top, 0.6));
  vec3 sky_light = mix(sky_tint, vec3(luminance(sky_tint)), 0.45) * (0.3 + 0.5 * u_daylight) + vec3(0.012, 0.016, 0.03);
  vec3 bounce = sun_light * vec3(0.9, 0.8, 0.65) * 0.08 * (0.5 - 0.5 * normal.y + 0.3);
  float diffuse = max(dot(normal, sun), 0.0) * soft_shadow(p + normal * 0.05, sun);
  vec3 color = material(p, normal, t) * (sun_light * diffuse + sky_light * (0.5 + 0.5 * normal.y) + bounce);

  float extinction = exp(-t * (0.00018 + u_fog * 0.0025 + u_rain * 0.0006));
  vec3 haze = apply_cloud_deck(sky_gradient(normalize(vec3(direction.x, 0.02, direction.z)), sun));
  haze = mix(haze, to_linear(u_fog_color) * (0.4 + 0.6 * u_daylight), u_fog * 0.8);
  color = color * extinction + haze * (1.0 - extinction);

  vec3 encoded = pow(aces(color * 1.1), vec3(1.0 / 2.2));
  out_color = vec4(encoded, max(1.0 - exp(-t / DEPTH_SCALE), 1.0 / 255.0));
}
