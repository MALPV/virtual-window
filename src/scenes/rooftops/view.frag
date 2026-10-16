#version 300 es
#include "common.glsl"
#include "sky.glsl"
#include "cache.glsl"

uniform float u_focus;

out vec4 out_color;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  CachedSample cached = read_cached(uv);
  vec3 origin = eye_position();
  vec3 direction = view_ray(uv, aspect);
  vec3 sun = sun_direction(aspect);
  float night = 1.0 - smoothstep(-6.0, 4.0, u_sun_altitude);

  // Cielo: la contaminacion luminica apaga las estrellas y tine de naranja el horizonte de noche.
  vec3 sky_color = sky_gradient(direction, sun) + sun_disc(direction, sun) + star_field(direction) * 0.35 + moon_disc(direction, sun);
  vec3 glow = vec3(0.09, 0.05, 0.025) * night * exp(-max(direction.y, 0.0) * 9.0) * (1.0 + u_cloud_deck * 1.5);
  vec4 cloud = cloud_layer(origin, direction, sun);
  sky_color = apply_cloud_deck(mix(sky_color, cloud.rgb + glow * 2.0, cloud.a)) + glow;

  vec3 color = sky_color;
  if (cached.coverage > 0.004) {
    vec3 city = to_linear(cached.color);
    float t = -DEPTH_SCALE * log(max(1.0 - cached.depth, 1e-4));
    vec3 p = origin + direction * t;
    if (sun.y > 0.02) {
      float shadow = cloud_density(p.xz + sun.xz / sun.y * (CLOUD_HEIGHT - p.y));
      city *= mix(1.0, 0.55, shadow * smoothstep(-2.0, 5.0, u_sun_altitude) * (1.0 - u_cloud_deck * 0.8));
    }
    // Ventanas encendidas al anochecer, con un leve cambio lento de intensidad (sin parpadeos).
    float evening = 1.0 - smoothstep(-2.0, 10.0, u_sun_altitude);
    vec2 block = floor(gl_FragCoord.xy / 6.0);
    float breathe = 1.0 + (1.0 - u_focus) * 0.12 * sin(u_time * 0.2 + hash12(block) * 30.0);
    city += cached.extra_rgb * evening * breathe * 1.4;
    // Calles y tejados mojados con la lluvia: mas oscuros y con algo de brillo.
    city = mix(city, city * 0.7 + sky_color * 0.08, u_rain * 0.7);
    color = mix(sky_color, city, cached.coverage);
  }

  float horizon_band = exp(-abs(direction.y) * 14.0);
  color = mix(color, to_linear(u_fog_color) * (0.4 + 0.6 * u_daylight), clamp(u_fog * (0.3 + 0.6 * horizon_band), 0.0, 0.85));
  color *= 1.0 - u_rain * 0.1;
  out_color = encode_output(aces(color * 1.1));
}
