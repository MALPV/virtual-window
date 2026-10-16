#version 300 es
#include "common.glsl"
#include "sky.glsl"

uniform sampler2D u_cached;

out vec4 out_color;



void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec4 cached = texture(u_cached, uv);
  vec3 color = to_linear(cached.rgb);

  vec3 origin = eye_position();
  vec3 direction = view_ray(uv, aspect);
  vec3 sun = sun_direction(aspect);
  float above = smoothstep(-2.0, 5.0, u_sun_altitude);

  if (cached.a < 0.5 / 255.0) {
    // Cielo: estrellas que titilan y nubes vivas.
    color += star_field(direction);
    vec4 cloud = cloud_layer(origin, direction, sun);
    color = mix(color, cloud.rgb, cloud.a);
    color = mix(color, to_linear(u_deck_color) * (0.25 + 0.75 * u_daylight), u_cloud_deck * 0.85);
  } else {
    float t = -DEPTH_SCALE * log(max(1.0 - cached.a, 1e-4));
    vec3 p = origin + direction * t;

    // Sombras de las nubes recorriendo el terreno.
    if (sun.y > 0.02) {
      vec2 shadow_point = p.xz + sun.xz / sun.y * (CLOUD_HEIGHT - p.y);
      float shadow = cloud_density(shadow_point);
      color *= mix(1.0, 0.45, shadow * above * (1.0 - u_cloud_deck * 0.8));
    }

    // Bruma que se mueve despacio en el fondo del valle.
    vec2 mist_flow = vec2(u_time * (0.8 + 3.0 * u_wind_strength), u_time * 0.3);
    float mist = fbm((p.xz + mist_flow) * 0.02, 4);
    float low = 1.0 - smoothstep(-380.0, -250.0, p.y);
    float amount = low * smoothstep(0.35, 0.75, mist) * (0.18 + 0.6 * u_fog);
    color = mix(color, to_linear(u_fog_color) * (0.4 + 0.6 * u_daylight), amount);
  }

  // La lluvia apaga y desatura el paisaje.
  color = mix(color, vec3(luminance(color)), u_rain * 0.35);
  color *= 1.0 - u_rain * 0.15;

  out_color = encode_output(color);
}
