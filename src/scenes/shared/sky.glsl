// Cielo, nubes y estrellas compartidos. Requiere noise.glsl y que la escena defina CLOUD_HEIGHT.

// Cuanto del sol directo atraviesa niebla y nubes cerradas.
float sun_clearness() {
  return (1.0 - u_fog * 0.85) * pow(1.0 - u_cloud_deck, 2.0);
}

// Degradado del cielo con la paleta del motor y el halo del sol (barato: sirve tambien para reflejos).
vec3 sky_gradient(vec3 direction, vec3 sun) {
  float t = clamp(direction.y, 0.0, 1.0);
  vec3 color = mix(to_linear(u_sky_horizon), to_linear(u_sky_middle), smoothstep(0.0, 0.25, t));
  color = mix(color, to_linear(u_sky_top), smoothstep(0.2, 0.9, t));
  float mu = max(dot(direction, sun), 0.0);
  float halo = pow(mu, 6.0) * 0.25 + pow(mu, 64.0) * 0.5 + pow(mu, 1200.0) * 2.5;
  color += to_linear(u_sun_color) * halo * u_sun_visibility * sun_clearness();
  return color + moon_halo(direction);
}

vec3 sun_disc(vec3 direction, vec3 sun) {
  float mu = dot(direction, sun);
  return to_linear(u_sun_color) * smoothstep(0.99975, 0.9999, mu) * 25.0 * u_sun_visibility * sun_clearness();
}

vec3 star_field(vec3 direction) {
  vec2 cell = floor(gl_FragCoord.xy / 1.5);
  float star = step(0.9985, hash12(cell)) * hash12(cell + 3.7);
  float twinkle = 0.65 + 0.35 * sin(u_time * (0.8 + hash12(cell + 9.1) * 2.0) + hash12(cell + 1.3) * 40.0);
  return vec3(star * star * twinkle * 1.6) * u_stars * smoothstep(0.02, 0.2, direction.y);
}

// Nubes: forma con distorsion de dominio que se desplaza con el viento y evoluciona despacio.
float cloud_density(vec2 position) {
  float wind_sign = abs(u_wind_drift) > 0.05 ? sign(u_wind_drift) : 1.0;
  vec2 p = (position - vec2(wind_sign * (6.0 + 30.0 * u_wind_strength), 2.0) * u_time) * 0.0009;
  vec2 warp = vec2(fbm(p + vec2(u_time * 0.003, 0.0), 5), fbm(p + vec2(5.2, 1.3) - u_time * 0.002, 5));
  float n = fbm(p + warp * 1.4, 5);
  float coverage = clamp(max(u_cloud_cover, u_cloud_deck), 0.0, 1.0);
  float low = 0.78 - coverage * 0.55;
  return smoothstep(low, low + 0.22, n);
}

vec4 cloud_layer(vec3 origin, vec3 direction, vec3 sun) {
  if (direction.y <= 0.01) return vec4(0.0);
  float t = (CLOUD_HEIGHT - origin.y) / direction.y;
  vec2 position = origin.xz + direction.xz * t;
  float density = cloud_density(position);
  if (density <= 0.001) return vec4(0.0);
  float toward_sun = cloud_density(position + sun.xz * 160.0);
  float light = exp(-toward_sun * 2.2);
  float above = smoothstep(-2.0, 5.0, u_sun_altitude);
  vec3 sun_light = to_linear(u_sun_color) * 1.6 * above;
  vec3 ambient = to_linear(mix(u_sky_horizon, u_sky_top, 0.5)) * (0.45 + 0.4 * u_daylight) + vec3(0.004, 0.005, 0.01);
  float silver = pow(max(dot(direction, sun), 0.0), 10.0) * (1.0 - density) * 2.5;
  vec3 color = ambient + sun_light * (0.2 + 0.8 * light + silver);
  color = mix(color, to_linear(u_deck_color) * (0.3 + 0.7 * u_daylight), u_rain * 0.6);
  float fade = smoothstep(0.01, 0.1, direction.y) * exp(-t * 0.00002);
  return vec4(color, density * fade);
}

// Capa uniforme de nubes cuando el cielo esta cubierto.
vec3 apply_cloud_deck(vec3 color) {
  return mix(color, to_linear(u_deck_color) * (0.25 + 0.75 * u_daylight), u_cloud_deck * 0.8);
}

// Cielo completo: degradado, sol, estrellas y nubes. Sin detalles es barato y sirve para reflejos.
vec3 sky(vec3 origin, vec3 direction, vec3 sun, bool with_details) {
  vec3 color = sky_gradient(direction, sun);
  if (with_details) {
    color += sun_disc(direction, sun) + star_field(direction) + moon_disc(direction, sun);
    vec4 cloud = cloud_layer(origin, direction, sun);
    color = mix(color, cloud.rgb, cloud.a);
  } else {
    // En los reflejos basta con el tono medio de las nubes.
    color = mix(color, to_linear(u_deck_color) * (0.35 + 0.65 * u_daylight), u_cloud_cover * 0.35);
  }
  return apply_cloud_deck(color);
}
