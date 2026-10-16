#version 300 es
#include "common.glsl"
#include "atmosphere.glsl"

// Salida 0: tierra premultiplicada por su cobertura.
// Salida 1: cielo o reflejo en rgb; profundidad de la tierra, o 1 si el reflejo es cielo, en alfa.
layout(location = 0) out vec4 out_color;
layout(location = 1) out vec4 out_extra;

const float MAX_DISTANCE = 6000.0;

vec3 sky_with_sun(vec3 direction, vec3 sun) {
  vec3 color = atmosphere(direction, sun);
  float night = 1.0 - smoothstep(-8.0, 2.0, u_sun_altitude);
  color += to_linear(mix(u_sky_horizon, u_sky_top, clamp(direction.y * 2.0, 0.0, 1.0))) * 1.1 * night;
  float mu = dot(direction, sun);
  return color + to_linear(u_sun_color) * smoothstep(0.99985, 0.99995, mu) * 40.0 * u_sun_visibility;
}

vec3 shade_land(vec3 origin, vec3 direction, float t, vec3 sun) {
  vec3 p = origin + direction * t;
  vec3 normal = land_normal(p, t, 10);
  vec3 albedo = p.y < 3.0 ? mix(vec3(0.07, 0.09, 0.04), vec3(0.18, 0.16, 0.13), smoothstep(0.6, 1.4, p.y - 0.4 * noise(p.xz))) : alpine_material(p, normal, t, SNOW_BASE);
  vec3 color = light_land(albedo, p, normal, sun);
  float extinction = exp(-t * (0.00012 + u_fog * 0.0022 + u_rain * 0.0005));
  vec3 haze = mix(atmosphere(normalize(vec3(direction.x, 0.02, direction.z)), sun) * 0.7, to_linear(u_deck_color) * (0.3 + 0.7 * u_daylight), u_cloud_deck * 0.85);
  // A contraluz el cielo junto al sol es muy brillante: sin limite, la bruma lavaria las montanas
  // en vez de recortarlas como siluetas contra el cielo encendido.
  haze *= min(1.0, 0.45 / max(luminance(haze), 1e-3));
  haze = mix(haze, to_linear(u_fog_color) * (0.4 + 0.6 * u_daylight), u_fog * 0.8);
  return color * extinction + haze * (1.0 - extinction);
}

vec3 encode(vec3 linear_color) {
  return pow(aces(linear_color * 1.1), vec3(1.0 / 2.2));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec3 origin = eye_position();
  vec3 direction = view_ray(uv, aspect);
  vec3 sun = sun_direction(aspect);

  float land_t = march_land(origin, direction, MAX_DISTANCE, 10);
  float water_t = direction.y < 0.0 ? origin.y / -direction.y : -1.0;
  bool land_first = land_t > 0.0 && (water_t < 0.0 || land_t < water_t) && (origin + direction * land_t).y > 0.05;

  if (land_first) {
    out_color = vec4(encode(shade_land(origin, direction, land_t, sun)), 1.0);
    out_extra = vec4(0.0, 0.0, 0.0, max(1.0 - exp(-land_t / DEPTH_SCALE), 1.0 / 255.0));
    return;
  }

  out_color = vec4(0.0);
  if (water_t < 0.0) {
    out_extra = vec4(encode(sky_with_sun(direction, sun)), 0.0);
    return;
  }

  // Espejo: el reflejo del paisaje en el agua en calma. Las ondas lo deforman en el pase principal.
  vec3 surface = origin + direction * water_t;
  vec3 reflected = reflect(direction, vec3(0.0, 1.0, 0.0));
  vec3 start = surface + reflected * 0.1;
  float hit = march_land(start, reflected, MAX_DISTANCE, 7);
  if (hit > 0.0) {
    out_extra = vec4(encode(shade_land(start, reflected, hit, sun)), 0.0);
  } else {
    out_extra = vec4(encode(sky_with_sun(reflected, sun)), 1.0);
  }
}
