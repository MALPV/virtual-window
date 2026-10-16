#version 300 es
#include "common.glsl"
#include "sky.glsl"
#include "ocean.glsl"

uniform sampler2D u_cached;

out vec4 out_color;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec4 cached = texture(u_cached, uv);
  vec3 origin = eye_position();
  vec3 direction = view_ray(uv, aspect);
  vec3 sun = sun_direction(aspect);

  float land_t = cached.a > 0.5 / 255.0 ? -DEPTH_SCALE * log(max(1.0 - cached.a, 1e-4)) : 1e9;
  float sea_t = trace_sea(origin, direction);
  vec3 color;

  if (land_t < 1e8 && (sea_t < 0.0 || land_t < sea_t)) {
    color = to_linear(cached.rgb);
    vec3 p = origin + direction * land_t;
    // Sombras de las nubes recorriendo la costa.
    if (sun.y > 0.02) {
      float shadow = cloud_density(p.xz + sun.xz / sun.y * (CLOUD_HEIGHT - p.y));
      color *= mix(1.0, 0.5, shadow * smoothstep(-2.0, 5.0, u_sun_altitude) * (1.0 - u_cloud_deck * 0.8));
    }
  } else if (sea_t > 0.0) {
    color = sea_color(origin, direction, sea_t, sun);
    // Rompientes: espuma donde el fondo sube junto a los acantilados, al ritmo de las olas.
    vec3 p = origin + direction * sea_t;
    float depth = -land_height(p.xz, 4);
    float shore = 1.0 - smoothstep(0.5, 7.5, depth);
    float surge = 0.5 + 0.5 * sin(u_time * (0.7 + 0.5 * u_wind_strength) - depth * 0.9 + noise(p.xz * 0.05) * 6.0);
    float lace = smoothstep(0.35, 0.8, fbm(p.xz * 0.25 + vec2(u_time * 0.15, -u_time * 0.1), 4));
    float foam = shore * clamp(surge * 0.6 + lace * 0.7, 0.0, 1.0);
    vec3 foam_color = to_linear(vec3(0.9, 0.93, 0.95)) * (0.25 + 0.75 * u_daylight);
    color = mix(color, foam_color, foam * 0.85 * exp(-sea_t * 0.0012));
  } else {
    color = sky(origin, direction, sun, true);
  }

  float horizon_band = exp(-abs(direction.y) * 18.0);
  color = mix(color, to_linear(u_fog_color) * (0.4 + 0.6 * u_daylight), clamp(u_fog * (0.35 + 0.65 * horizon_band), 0.0, 0.9));
  color *= 1.0 - u_rain * 0.12;
  out_color = encode_output(aces(color * 1.1));
}
