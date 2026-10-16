// Trazado de terreno compartido. Requiere noise.glsl. La escena define despues
// float land_height(vec2 p, int octaves) con el relieve en metros (agua en y = 0 si la hay).
float land_height(vec2 p, int octaves);

// Ruido con derivadas: permite atenuar los detalles en las pendientes y simular erosion.
vec3 noise_with_derivatives(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  float value = a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
  vec2 derivative = du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx);
  return vec3(value, derivative);
}

float eroded_mountains(vec2 p, int octaves) {
  float value = 0.0;
  float amplitude = 1.0;
  vec2 slope = vec2(0.0);
  mat2 rotate = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 11; i++) {
    if (i >= octaves) break;
    vec3 n = noise_with_derivatives(p);
    slope += n.yz;
    value += amplitude * n.x / (1.0 + dot(slope, slope));
    amplitude *= 0.5;
    p = rotate * p * 2.0;
  }
  return value;
}

// Menos octavas con la distancia: el detalle lejano no se ve y solo cuesta.
int octaves_for(float distance, int max_octaves) {
  return int(clamp(float(max_octaves) - log2(1.0 + distance * 0.01), 3.0, float(max_octaves)));
}

float march_land(vec3 origin, vec3 direction, float max_distance, int max_octaves) {
  float t = 0.3;
  for (int i = 0; i < 200; i++) {
    vec3 p = origin + direction * t;
    float h = p.y - land_height(p.xz, octaves_for(t, max_octaves));
    if (h < 0.002 * t) return t;
    t += max(h * 0.4, 0.004 * t);
    if (t > max_distance) break;
  }
  return -1.0;
}

vec3 land_normal(vec3 p, float t, int max_octaves) {
  float e = max(0.004 * t, 0.02);
  int octaves = min(octaves_for(t, max_octaves) + 1, max_octaves);
  float h = land_height(p.xz, octaves);
  return normalize(vec3(h - land_height(p.xz + vec2(e, 0.0), octaves), e, h - land_height(p.xz + vec2(0.0, e), octaves)));
}

float soft_shadow(vec3 origin, vec3 sun) {
  if (sun.y <= 0.0) return 0.0;
  float result = 1.0;
  float t = 0.5;
  for (int i = 0; i < 40; i++) {
    vec3 p = origin + sun * t;
    float h = p.y - land_height(p.xz, 5);
    result = min(result, 10.0 * h / t);
    if (result < 0.01 || t > 3000.0) break;
    t += clamp(h * 0.6, 0.5 + 0.02 * t, 80.0);
  }
  return clamp(result, 0.0, 1.0);
}

// Materiales de montana: bosque abajo, prado alpino, roca en pendientes y nieve segun el frio.
vec3 alpine_material(vec3 p, vec3 normal, float t, float snow_base) {
  float lod = 1.0 + t * 0.003;
  float steep = 1.0 - normal.y;
  float variation = fbm(p.xz * 0.05 / lod, 4);
  vec3 grass = mix(vec3(0.09, 0.11, 0.05), vec3(0.15, 0.15, 0.07), variation);
  vec3 forest = mix(vec3(0.035, 0.06, 0.03), vec3(0.06, 0.09, 0.045), variation);
  vec3 rock = mix(vec3(0.24, 0.22, 0.2), vec3(0.36, 0.33, 0.3), fbm(p.xz * 0.2 / lod, 3));
  vec3 albedo = mix(forest, grass, smoothstep(snow_base - 320.0, snow_base - 80.0, p.y + (variation - 0.5) * 60.0));
  albedo = mix(albedo, rock, smoothstep(0.4, 0.62, steep + (variation - 0.5) * 0.1));
  float cold = clamp((10.0 - u_temperature) / 20.0, 0.0, 1.0);
  float snow_line = mix(snow_base, snow_base - 270.0, max(cold, u_snow * 0.9));
  float snow = smoothstep(snow_line - 30.0, snow_line + 30.0, p.y + (variation - 0.5) * 80.0) * smoothstep(0.55, 0.25, steep);
  return mix(albedo, vec3(0.82, 0.85, 0.9), snow);
}

// Luz directa del sol con sombra suave, cielo menos saturado que el propio cielo y rebote calido.
vec3 light_land(vec3 albedo, vec3 p, vec3 normal, vec3 sun) {
  float above = smoothstep(-2.0, 5.0, u_sun_altitude);
  vec3 sun_light = to_linear(u_sun_color) * 2.8 * above * mix(1.0, 0.3, u_cloud_deck);
  vec3 sky_tint = to_linear(mix(u_sky_horizon, u_sky_top, 0.6));
  vec3 sky_light = mix(sky_tint, vec3(luminance(sky_tint)), 0.4) * (0.3 + 0.5 * u_daylight) + vec3(0.012, 0.016, 0.03);
  vec3 bounce = sun_light * vec3(0.9, 0.8, 0.65) * 0.06 * (0.8 - 0.5 * normal.y);
  float diffuse = max(dot(normal, sun), 0.0) * soft_shadow(p + normal * 0.05, sun);
  return albedo * (sun_light * diffuse + sky_light * (0.5 + 0.5 * normal.y) + bounce);
}
