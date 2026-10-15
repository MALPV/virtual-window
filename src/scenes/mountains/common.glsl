precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_parallax;
uniform float u_sun_altitude;
uniform float u_sun_x;
uniform float u_sun_visibility;
uniform vec3 u_sun_color;
uniform vec3 u_sky_top;
uniform vec3 u_sky_horizon;
uniform vec3 u_deck_color;
uniform vec3 u_fog_color;
uniform float u_daylight;
uniform float u_stars;
uniform float u_cloud_cover;
uniform float u_cloud_deck;
uniform float u_fog;
uniform float u_rain;
uniform float u_snow;
uniform float u_wind_strength;
uniform float u_wind_drift;
uniform float u_temperature;

const float PI = 3.14159265;

// Optica de ventana: la imagen se proyecta sobre el plano fijo de la ventana y el ojo se desplaza con
// el cursor. Lo lejano acompana al observador y lo cercano no, como al mirar por un cristal real.
const float WINDOW_DISTANCE = 1.0;
const float TAN_HALF_FOV = 0.42;
const float LOOK_DOWN = 0.07;
const float EYE_HEIGHT = 1.7;
const vec2 EYE_RANGE = vec2(0.09, 0.06);

// Profundidad guardada en el alfa del pase en cache: 0 es cielo.
const float DEPTH_SCALE = 300.0;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotate = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    value += amplitude * noise(p);
    p = rotate * p * 2.02;
    amplitude *= 0.5;
  }
  return value;
}

vec3 to_linear(vec3 c) {
  return pow(c, vec3(2.2));
}

vec3 eye_position() {
  return vec3(u_parallax.x * EYE_RANGE.x, EYE_HEIGHT - u_parallax.y * EYE_RANGE.y, 0.0);
}

vec3 view_ray(vec2 uv, float aspect) {
  vec2 v = (uv - 0.5) * 2.0 * TAN_HALF_FOV * WINDOW_DISTANCE * vec2(aspect, 1.0);
  float c = cos(LOOK_DOWN);
  float s = sin(LOOK_DOWN);
  vec3 on_window = vec3(v.x, v.y * c - WINDOW_DISTANCE * s, v.y * s + WINDOW_DISTANCE * c);
  vec3 window_point = vec3(0.0, EYE_HEIGHT, 0.0) + on_window;
  return normalize(window_point - eye_position());
}

vec3 sun_direction(float aspect) {
  float altitude = radians(u_sun_altitude);
  // El sol recorre el ancho visible de la ventana, igual que en el resto de escenas.
  float azimuth = atan((u_sun_x - 0.5) * 2.0 * TAN_HALF_FOV * aspect * 0.9);
  return normalize(vec3(sin(azimuth) * cos(altitude), sin(altitude), cos(azimuth) * cos(altitude)));
}

// Capa de nubes a altura fija; compartida para dibujarlas y para sus sombras sobre el terreno.
const float CLOUD_HEIGHT = 900.0;

float cloud_density(vec2 position) {
  float wind_sign = abs(u_wind_drift) > 0.05 ? sign(u_wind_drift) : 1.0;
  vec2 drift = vec2(wind_sign * (6.0 + 30.0 * u_wind_strength), 3.0) * u_time;
  vec2 p = (position - drift) * 0.0011;
  float coverage = clamp(max(u_cloud_cover, u_cloud_deck), 0.0, 1.0);
  // La forma evoluciona lentamente ademas de desplazarse: las nubes nacen y se deshacen.
  float n = fbm(p + vec2(u_time * 0.004, -u_time * 0.003), 6);
  float low = 1.0 - coverage - 0.08;
  return smoothstep(low, low + 0.35, n);
}
