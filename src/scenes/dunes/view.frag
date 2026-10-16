#version 300 es
#include "common.glsl"
#include "sky.glsl"
#include "cache.glsl"

out vec4 out_color;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec3 origin = eye_position();
  vec3 direction = view_ray(uv, aspect);
  vec3 sun = sun_direction(aspect);
  float above = smoothstep(-2.0, 5.0, u_sun_altitude);

  // Calima: con calor y sol alto el aire tiembla sobre el horizonte.
  float heat = smoothstep(24.0, 34.0, u_temperature) * smoothstep(15.0, 40.0, u_sun_altitude) * (1.0 - u_cloud_deck);
  float near_horizon = exp(-abs(direction.y) * 40.0);
  vec2 shimmer = vec2(0.0, sin(uv.x * 140.0 + u_time * 3.0) * noise(uv * 60.0 + u_time)) * 0.0015 * heat * near_horizon;
  CachedSample cached = read_cached(uv + shimmer);

  vec3 sky_color = to_linear(cached.extra_rgb) + star_field(direction);
  vec4 cloud = cloud_layer(origin, direction, sun);
  sky_color = apply_cloud_deck(mix(sky_color, cloud.rgb, cloud.a));

  vec3 color = sky_color;
  if (cached.coverage > 0.004) {
    vec3 sand = to_linear(cached.color);
    float t = -DEPTH_SCALE * log(max(1.0 - cached.depth, 1e-4));
    vec3 p = origin + direction * t;
    if (sun.y > 0.02) {
      float shadow = cloud_density(p.xz + sun.xz / sun.y * (CLOUD_HEIGHT - p.y));
      sand *= mix(1.0, 0.55, shadow * above * (1.0 - u_cloud_deck * 0.8));
    }
    // Arena levantada por el viento que se desliza a ras del suelo.
    float wind_sign = abs(u_wind_drift) > 0.05 ? sign(u_wind_drift) : 1.0;
    vec2 flow = vec2(u_time * wind_sign * (4.0 + 22.0 * u_wind_strength), u_time * 1.5);
    float drift = smoothstep(0.45, 0.85, fbm((p.xz - flow) * vec2(0.03, 0.08), 4));
    float blowing = drift * smoothstep(0.35, 0.9, u_wind_strength) * smoothstep(30.0, 300.0, t) * (1.0 - u_rain);
    vec3 dust = mix(to_linear(vec3(0.75, 0.6, 0.45)), to_linear(u_sun_color), 0.4 * above) * (0.25 + 0.75 * u_daylight);
    sand = mix(sand, dust, blowing * 0.45);
    color = mix(sky_color, sand, cached.coverage);
  }

  color *= 1.0 - u_rain * 0.12;
  out_color = encode_output(color);
}
