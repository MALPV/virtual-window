#version 300 es
#include "common.glsl"
#include "atmosphere.glsl"

// Salida 0: arena premultiplicada por su cobertura. Salida 1: cielo en rgb y profundidad en alfa.
layout(location = 0) out vec4 out_color;
layout(location = 1) out vec4 out_extra;

const float MAX_DISTANCE = 7000.0;

int octaves_at(float distance) {
  return int(clamp(6.0 - log2(1.0 + distance * 0.01), 3.0, 6.0));
}

float march(vec3 origin, vec3 direction) {
  float t = 0.3;
  for (int i = 0; i < 220; i++) {
    vec3 p = origin + direction * t;
    float h = p.y - land_height(p.xz, octaves_at(t));
    if (h < 0.002 * t) return t;
    t += max(h * 0.45, 0.004 * t);
    if (t > MAX_DISTANCE) break;
  }
  return -1.0;
}

vec3 normal_at(vec3 p, float t) {
  float e = max(0.003 * t, 0.03);
  int octaves = octaves_at(t);
  float h = land_height(p.xz, octaves);
  vec3 normal = normalize(vec3(h - land_height(p.xz + vec2(e, 0.0), octaves), e, h - land_height(p.xz + vec2(0.0, e), octaves)));
  // Ondulaciones de arena perpendiculares al viento: solo de cerca, donde se aprecian.
  float near = 1.0 - smoothstep(20.0, 120.0, t);
  float phase = dot(p.xz, vec2(0.35, 0.94)) * 4.5 + noise(p.xz * 0.2) * 5.0;
  vec2 ripple = vec2(0.35, 0.94) * cos(phase) * 0.1 * near;
  return normalize(normal + vec3(ripple.x, 0.0, ripple.y));
}

float soft_shadow(vec3 origin, vec3 sun) {
  if (sun.y <= 0.0) return 0.0;
  float result = 1.0;
  float t = 0.3;
  for (int i = 0; i < 44; i++) {
    vec3 p = origin + sun * t;
    float h = p.y - land_height(p.xz, 4);
    result = min(result, 12.0 * h / t);
    if (result < 0.01 || t > 2500.0) break;
    t += clamp(h * 0.6, 0.3 + 0.02 * t, 60.0);
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
  sky_color += moon_disc(direction, sun) + moon_halo(direction);
  out_extra = vec4(pow(aces(sky_color * 1.1), vec3(1.0 / 2.2)), 0.0);

  float t = march(origin, direction);
  if (t < 0.0) {
    out_color = vec4(0.0);
    return;
  }

  vec3 p = origin + direction * t;
  vec3 normal = normal_at(p, t);
  float lod = 1.0 + t * 0.003;
  vec3 sand = mix(vec3(0.4, 0.25, 0.13), vec3(0.48, 0.32, 0.18), fbm(p.xz * 0.02 / lod, 3));
  // Los valles entre dunas reciben menos luz del cielo que las crestas.
  float trough = smoothstep(-70.0, 10.0, p.y - land_height(p.xz + vec2(0.0, 60.0), 3) * 0.0);

  float above = smoothstep(-2.0, 5.0, u_sun_altitude);
  vec3 sun_light = to_linear(u_sun_color) * 2.3 * above * mix(1.0, 0.3, u_cloud_deck);
  // Las sombras del desierto son azuladas: solo las ilumina el cielo. La arena devuelve luz calida.
  vec3 sky_light = to_linear(mix(u_sky_horizon, u_sky_top, 0.7)) * (0.35 + 0.55 * u_daylight) + vec3(0.008, 0.01, 0.018);
  vec3 bounce = sun_light * vec3(0.9, 0.65, 0.4) * 0.07 * (0.8 - 0.5 * normal.y);
  // El margen del rayo de sombra crece con la distancia para evitar anillos de autosombreado.
  float shadow = soft_shadow(p + normal * (0.08 + 0.003 * t), sun);
  float diffuse = max(dot(normal, sun), 0.0) * shadow;
  // A contraluz las crestas vistas de canto brillan: es lo que dibuja las dunas al atardecer.
  float grazing = pow(1.0 - max(dot(normal, -direction), 0.0), 3.0);
  float rim = pow(max(dot(direction, sun), 0.0), 6.0) * grazing * 0.8;
  vec3 color = sand * (sun_light * (diffuse + rim) + sky_light * (0.5 + 0.5 * normal.y) * (0.6 + 0.4 * trough) + bounce + moonlight_on(normal) * 1.3);

  float extinction = exp(-t * (0.00018 + u_fog * 0.0022 + u_rain * 0.0006 + u_wind_strength * 0.00025));
  vec3 haze = mix(sky * 0.85, to_linear(u_deck_color) * (0.3 + 0.7 * u_daylight), u_cloud_deck * 0.85);
  haze *= min(1.0, 0.55 / max(luminance(haze), 1e-3));
  haze = mix(haze, to_linear(u_fog_color) * (0.4 + 0.6 * u_daylight), u_fog * 0.8);
  color = color * extinction + haze * (1.0 - extinction);

  // Exposicion algo mas baja: el desierto es muy luminoso y la arena no debe quemarse.
  out_color = vec4(pow(aces(color * 0.85), vec3(1.0 / 2.2)), 1.0);
  out_extra.a = max(1.0 - exp(-t / DEPTH_SCALE), 1.0 / 255.0);
}
