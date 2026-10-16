// Oceano compartido. Requiere noise.glsl, sky.glsl y que la escena defina OCEAN_MAX_DISTANCE.
const float GRAVITY = 9.81;

// Oleaje: suma de olas direccionales con crestas afiladas. Cada una avanza segun la dispersion
// de las olas de aguas profundas (omega = sqrt(g k)): las largas son mas rapidas que las cortas.
float wave_height(vec2 p, int octaves) {
  float wind = 0.25 + u_wind_strength;
  float height = 0.0;
  float amplitude = 0.35 * wind;
  float wavelength = 26.0;
  float angle = 0.35;
  float sharpness = 1.6 + u_wind_strength * 1.4;
  for (int i = 0; i < 9; i++) {
    if (i >= octaves) break;
    vec2 direction = vec2(cos(angle), sin(angle));
    float k = 2.0 * PI / wavelength;
    float phase = dot(direction, p) * k + u_time * sqrt(GRAVITY * k) + float(i) * 1.7;
    float crest = pow(0.5 + 0.5 * sin(phase + noise(p * k * 0.35) * 2.0), sharpness);
    height += (crest - 0.35) * amplitude;
    amplitude *= 0.62;
    wavelength *= 0.62;
    angle += 2.1;
    sharpness = mix(sharpness, 1.0, 0.25);
  }
  return height;
}

float surface_distance(vec3 p, int octaves) {
  return p.y - wave_height(p.xz, octaves);
}

// Trazado sobre el campo de alturas: acota el cruce con la superficie y lo refina por secantes.
float trace_sea(vec3 origin, vec3 direction) {
  if (direction.y >= 0.0) return -1.0;
  float near = 0.0;
  float far = min(OCEAN_MAX_DISTANCE, (origin.y + 2.0) / -direction.y);
  float d_far = surface_distance(origin + direction * far, 4);
  if (d_far > 0.0) return far;
  float d_near = surface_distance(origin, 4);
  float t = 0.0;
  for (int i = 0; i < 10; i++) {
    t = mix(near, far, d_near / (d_near - d_far));
    float d = surface_distance(origin + direction * t, 4);
    if (d < 0.0) {
      far = t;
      d_far = d;
    } else {
      near = t;
      d_near = d;
    }
  }
  return t;
}

vec3 sea_normal(vec3 p, float distance) {
  float e = max(0.02, distance * 0.0015);
  int octaves = distance < 120.0 ? 9 : 6;
  float h = wave_height(p.xz, octaves);
  return normalize(vec3(h - wave_height(p.xz + vec2(e, 0.0), octaves), e, h - wave_height(p.xz + vec2(0.0, e), octaves)));
}

vec3 sea_color(vec3 origin, vec3 direction, float t, vec3 sun) {
  vec3 p = origin + direction * t;
  vec3 normal = sea_normal(p, t);
  float fresnel = 0.04 + 0.96 * pow(clamp(1.0 - dot(normal, -direction), 0.0, 1.0), 5.0);
  vec3 reflected = sky(p, reflect(direction, normal), sun, false);

  float above = smoothstep(-2.0, 5.0, u_sun_altitude);
  vec3 deep = vec3(0.004, 0.025, 0.045) * (0.25 + 0.75 * u_daylight) + to_linear(u_sky_top) * 0.12;
  vec3 scatter = vec3(0.02, 0.09, 0.08) * above * (0.4 + 0.6 * u_daylight);
  float crest = clamp(wave_height(p.xz, 4) * 1.4 + 0.3, 0.0, 1.0);
  // Luz que atraviesa las crestas a contraluz: el verde azulado de las olas.
  float backlight = pow(max(dot(direction, sun), 0.0), 3.0);
  vec3 refracted = deep + scatter * crest * (0.6 + 1.6 * backlight);

  vec3 color = mix(refracted, reflected, fresnel);
  vec3 halfway = normalize(sun - direction);
  float specular = pow(max(dot(normal, halfway), 0.0), 380.0) * (380.0 + 8.0) / (8.0 * PI);
  color += to_linear(u_sun_color) * specular * 0.6 * u_sun_visibility * sun_clearness();

  float foam = smoothstep(0.55, 0.9, crest) * smoothstep(0.45, 0.9, u_wind_strength) * noise(p.xz * 1.5 + u_time * 0.3);
  color = mix(color, to_linear(vec3(0.85, 0.9, 0.92)) * (0.2 + 0.8 * u_daylight), foam * 0.7);

  // Bruma con la distancia hacia el color del horizonte.
  float haze = 1.0 - exp(-t * (0.0006 + u_fog * 0.006 + u_rain * 0.0015));
  vec3 horizon = sky(p, normalize(vec3(direction.x, 0.001, direction.z)), sun, false);
  return mix(color, mix(horizon, to_linear(u_fog_color), u_fog * 0.6), haze);
}
