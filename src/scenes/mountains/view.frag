#version 300 es
#include "common.glsl"

uniform sampler2D u_cached;

out vec4 out_color;

float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec4 clouds(vec3 origin, vec3 direction, vec3 sun, vec3 sun_light, vec3 sky_light) {
  if (direction.y <= 0.0) return vec4(0.0);
  float t = (CLOUD_HEIGHT - origin.y) / direction.y;
  vec2 position = origin.xz + direction.xz * t;
  float density = cloud_density(position);
  if (density <= 0.001) return vec4(0.0);

  // Luz a traves de la nube: muestra la densidad hacia el sol para sombrear su interior.
  float toward_sun = cloud_density(position + sun.xz * 140.0);
  float transmittance = exp(-toward_sun * 2.4);
  float forward = pow(max(dot(direction, sun), 0.0), 6.0);
  vec3 color = sky_light * 0.85 + sun_light * (0.25 + 0.75 * transmittance + forward * (1.0 - density) * 2.0);
  color = mix(color, to_linear(u_deck_color) * (0.35 + 0.65 * u_daylight), u_rain * 0.55);

  // Las nubes lejanas se funden con el horizonte.
  float fade = smoothstep(0.0, 0.12, direction.y) * exp(-t * 0.00003);
  return vec4(color, density * fade * 0.97);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec4 cached = texture(u_cached, uv);
  vec3 color = to_linear(cached.rgb);

  vec3 origin = eye_position();
  vec3 direction = view_ray(uv, aspect);
  vec3 sun = sun_direction(aspect);
  float above = smoothstep(-2.0, 5.0, u_sun_altitude);
  vec3 sun_light = to_linear(u_sun_color) * 1.4 * above * mix(1.0, 0.35, u_cloud_deck);
  vec3 sky_light = to_linear(mix(u_sky_horizon, u_sky_top, 0.5)) * (0.3 + 0.5 * u_daylight) + vec3(0.003, 0.004, 0.008);

  if (cached.a < 0.5 / 255.0) {
    // Cielo: estrellas que titilan y nubes vivas.
    vec2 cell = floor(gl_FragCoord.xy / 2.0);
    float star = step(0.9972, hash12(cell)) * hash12(cell + 3.7);
    float twinkle = 0.7 + 0.3 * sin(u_time * (1.0 + hash12(cell + 9.1) * 2.0) + hash12(cell + 1.3) * 40.0);
    color += vec3(star * twinkle) * u_stars * smoothstep(0.03, 0.25, direction.y);

    vec4 cloud = clouds(origin, direction, sun, sun_light, sky_light);
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

  color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
  color += (hash12(gl_FragCoord.xy + fract(u_time) * 17.0) - 0.5) / 255.0;
  out_color = vec4(color, 1.0);
}
