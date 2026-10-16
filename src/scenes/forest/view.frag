#version 300 es
#include "common.glsl"
#include "sky.glsl"
#include "cache.glsl"

out vec4 out_color;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  CachedSample cached = read_cached(uv);
  vec3 origin = eye_position();
  vec3 direction = view_ray(uv, aspect);
  vec3 sun = sun_direction(aspect);
  float above = smoothstep(-2.0, 5.0, u_sun_altitude);

  vec3 sky_color = to_linear(cached.extra_rgb) + star_field(direction);
  vec4 cloud = cloud_layer(origin, direction, sun);
  sky_color = apply_cloud_deck(mix(sky_color, cloud.rgb, cloud.a));

  vec3 color = sky_color;
  if (cached.coverage > 0.004) {
    vec3 forest = to_linear(cached.color);
    float t = -DEPTH_SCALE * log(max(1.0 - cached.depth, 1e-4));
    vec3 p = origin + direction * t;
    if (sun.y > 0.02) {
      float shadow = cloud_density(p.xz + sun.xz / sun.y * (CLOUD_HEIGHT - p.y));
      forest *= mix(1.0, 0.5, shadow * above * (1.0 - u_cloud_deck * 0.8));
    }
    // Jirones de niebla que se deslizan entre las colinas.
    vec2 flow = vec2(u_time * (1.2 + 4.0 * u_wind_strength), u_time * 0.4);
    float wisps = smoothstep(0.42, 0.8, fbm((p.xz + flow) * vec2(0.004, 0.012), 5));
    float low = 1.0 - smoothstep(-60.0, 20.0, p.y);
    float amount = low * wisps * (0.2 + 0.45 * u_golden_hour + 0.6 * u_fog) * smoothstep(150.0, 600.0, t);
    vec3 mist = mix(to_linear(u_fog_color), to_linear(u_sun_color), u_golden_hour * above * 0.4) * (0.35 + 0.65 * u_daylight);
    forest = mix(forest, mist, clamp(amount, 0.0, 0.8));
    color = mix(sky_color, forest, cached.coverage);
  }

  color = mix(color, vec3(luminance(color)), u_rain * 0.3);
  color *= 1.0 - u_rain * 0.12;
  out_color = encode_output(color);
}
