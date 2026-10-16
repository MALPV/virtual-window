#version 300 es
#include "uniforms.glsl"

out vec4 out_color;

#include "noise.glsl"

const float WINDOW_DISTANCE = 1.0;
const float TAN_HALF_FOV = 0.42;
// Mirada algo baja: el horizonte queda por encima del travesano de la ventana clasica.
const float LOOK_DOWN = 0.134;
const float EYE_HEIGHT = 6.0;
const vec2 EYE_RANGE = vec2(0.09, 0.06);
const float CLOUD_HEIGHT = 1200.0;
const float OCEAN_MAX_DISTANCE = 3000.0;

#include "window.glsl"
#include "sky.glsl"
#include "ocean.glsl"

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec3 origin = eye_position();
  vec3 direction = view_ray(uv, aspect);
  vec3 sun = sun_direction(aspect);

  float t = trace_sea(origin, direction);
  vec3 color = t < 0.0 ? sky(origin, direction, sun, true) : sea_color(origin, direction, t, sun);

  // Niebla general hacia el horizonte.
  float horizon_band = exp(-abs(direction.y) * 18.0);
  color = mix(color, to_linear(u_fog_color) * (0.4 + 0.6 * u_daylight), clamp(u_fog * (0.35 + 0.65 * horizon_band), 0.0, 0.9));
  color *= 1.0 - u_rain * 0.12;

  out_color = encode_output(aces(color * 1.1));
}
