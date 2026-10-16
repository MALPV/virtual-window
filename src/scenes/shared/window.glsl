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
