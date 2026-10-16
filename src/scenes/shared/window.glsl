// Optica de ventana: el ojo se mueve con el cursor y la imagen se proyecta sobre el plano fijo del
// cristal. Lo lejano acompana al observador y lo cercano no, como al mirar por una ventana real.
// Requiere que la escena defina antes WINDOW_DISTANCE, TAN_HALF_FOV, LOOK_DOWN, EYE_HEIGHT y EYE_RANGE.

vec3 eye_position() {
  return vec3(u_parallax.x * EYE_RANGE.x, EYE_HEIGHT - u_parallax.y * EYE_RANGE.y, 0.0);
}

vec3 view_ray(vec2 uv, float aspect) {
  vec2 v = (uv - 0.5) * 2.0 * TAN_HALF_FOV * WINDOW_DISTANCE * vec2(aspect, 1.0);
  float c = cos(LOOK_DOWN);
  float s = sin(LOOK_DOWN);
  vec3 on_window = vec3(v.x, v.y * c - WINDOW_DISTANCE * s, v.y * s + WINDOW_DISTANCE * c);
  return normalize(vec3(0.0, EYE_HEIGHT, 0.0) + on_window - eye_position());
}

// El sol recorre el ancho visible de la ventana, igual en todas las escenas.
vec3 sun_direction(float aspect) {
  float altitude = radians(u_sun_altitude);
  float azimuth = atan((u_sun_x - 0.5) * 2.0 * TAN_HALF_FOV * aspect * 0.9);
  return normalize(vec3(sin(azimuth) * cos(altitude), sin(altitude), cos(azimuth) * cos(altitude)));
}

// Luna: misma proyeccion sobre la ventana que el Sol. Requiere noise.glsl.
const vec3 MOON_LIGHT_COLOR = vec3(0.62, 0.7, 0.88);
// Algo mayor que el disco real (0,26 grados) para que se aprecie en una ventana pequena.
const float MOON_RADIUS = 0.012;

vec3 moon_direction() {
  float aspect = u_resolution.x / u_resolution.y;
  float altitude = radians(u_moon_altitude);
  float azimuth = atan((u_moon_x - 0.5) * 2.0 * TAN_HALF_FOV * aspect * 0.9);
  return normalize(vec3(sin(azimuth) * cos(altitude), sin(altitude), cos(azimuth) * cos(altitude)));
}

// Luz de luna difusa sobre una superficie. Sin sombras: es tenue y su coste no compensaria.
vec3 moonlight_on(vec3 normal) {
  return MOON_LIGHT_COLOR * 0.5 * u_moonlight * max(dot(normal, moon_direction()), 0.0);
}

vec3 moon_halo(vec3 direction) {
  float mu = max(dot(direction, moon_direction()), 0.0);
  return MOON_LIGHT_COLOR * (pow(mu, 300.0) * 0.25 + pow(mu, 40.0) * 0.04) * u_moonlight;
}

// Disco lunar con su fase. La parte iluminada mira hacia el Sol en el cielo, asi la fase queda bien
// orientada en ambos hemisferios; su extension sale de la fraccion iluminada real.
vec3 moon_disc(vec3 direction, vec3 sun) {
  vec3 moon = moon_direction();
  if (u_moon_altitude < -2.0 || dot(direction, moon) < cos(MOON_RADIUS * 1.3)) return vec3(0.0);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), moon));
  vec3 up = cross(moon, right);
  vec2 q = vec2(dot(direction - moon, right), dot(direction - moon, up)) / MOON_RADIUS;
  float r2 = dot(q, q);
  float edge = smoothstep(1.0, 0.9, sqrt(r2));
  vec3 normal = normalize(right * q.x + up * q.y - moon * sqrt(max(1.0 - r2, 0.0)));
  vec3 toward_sun = sun - moon * dot(sun, moon);
  vec3 side = length(toward_sun) > 1e-4 ? normalize(toward_sun) : right;
  float cos_elongation = 1.0 - 2.0 * clamp(u_moon_illumination, 0.0, 1.0);
  vec3 light = cos_elongation * moon + sqrt(max(1.0 - cos_elongation * cos_elongation, 0.0)) * side;
  float lit = smoothstep(-0.06, 0.06, dot(normal, light));
  float maria = 0.72 + 0.28 * fbm(q * 2.5 + 3.0, 3);
  vec3 color = mix(vec3(0.03, 0.035, 0.05), vec3(1.0, 0.97, 0.9) * 1.8 * maria, lit);
  float visible = smoothstep(-2.0, 1.0, u_moon_altitude) * (1.0 - u_cloud_deck * 0.9);
  // De dia la Luna se ve palida sobre el cielo claro.
  return color * edge * visible * (1.0 - 0.75 * u_daylight);
}
