#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_parallax;
uniform vec3 u_sky_top;
uniform vec3 u_sky_middle;
uniform vec3 u_sky_horizon;
uniform vec3 u_sun_color;
uniform vec3 u_deck_color;
uniform vec3 u_fog_color;
uniform float u_sun_x;
uniform float u_sun_altitude;
uniform float u_sun_visibility;
uniform float u_daylight;
uniform float u_stars;
uniform float u_cloud_cover;
uniform float u_cloud_deck;
uniform float u_fog;
uniform float u_wind;
uniform float u_wind_drift;
uniform float u_rain;

out vec4 out_color;

const float PI = 3.14159265;
const float GRAVITY = 9.81;

// Optica de ventana: el ojo se mueve con el cursor y la imagen se proyecta sobre el plano fijo del cristal.
const float WINDOW_DISTANCE = 1.0;
const float TAN_HALF_FOV = 0.42;
// Mirada algo baja: el horizonte queda por encima del travesano de la ventana clasica.
const float LOOK_DOWN = 0.134;
const float EYE_HEIGHT = 6.0;
const vec2 EYE_RANGE = vec2(0.09, 0.06);
const float CLOUD_HEIGHT = 1200.0;
const float MAX_DISTANCE = 3000.0;

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

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotate = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = rotate * p * 2.03;
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
  return normalize(vec3(0.0, EYE_HEIGHT, 0.0) + on_window - eye_position());
}

vec3 sun_direction(float aspect) {
  float altitude = radians(u_sun_altitude);
  float azimuth = atan((u_sun_x - 0.5) * 2.0 * TAN_HALF_FOV * aspect * 0.9);
  return normalize(vec3(sin(azimuth) * cos(altitude), sin(altitude), cos(azimuth) * cos(altitude)));
}

// Oleaje: suma de olas direccionales con crestas afiladas. Cada una avanza segun la dispersion
// de las olas de aguas profundas (omega = sqrt(g k)): las largas son mas rapidas que las cortas.
float wave_height(vec2 p, int octaves) {
  float wind = 0.25 + u_wind;
  float height = 0.0;
  float amplitude = 0.35 * wind;
  float wavelength = 26.0;
  float angle = 0.35;
  float sharpness = 1.6 + u_wind * 1.4;
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
  float far = min(MAX_DISTANCE, (origin.y + 2.0) / -direction.y);
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

float cloud_density(vec2 position) {
  float wind_sign = abs(u_wind_drift) > 0.05 ? sign(u_wind_drift) : 1.0;
  vec2 p = (position - vec2(wind_sign * (6.0 + 30.0 * u_wind), 2.0) * u_time) * 0.0009;
  // Distorsion de dominio: formas organicas que evolucionan despacio.
  vec2 warp = vec2(fbm(p + vec2(u_time * 0.003, 0.0)), fbm(p + vec2(5.2, 1.3) - u_time * 0.002));
  float n = fbm(p + warp * 1.4);
  float coverage = clamp(max(u_cloud_cover, u_cloud_deck), 0.0, 1.0);
  float low = 0.78 - coverage * 0.55;
  return smoothstep(low, low + 0.22, n);
}

// Cuanto del sol directo atraviesa niebla y nubes cerradas.
float sun_clearness() {
  return (1.0 - u_fog * 0.85) * pow(1.0 - u_cloud_deck, 2.0);
}

vec3 sky_color(vec3 direction, vec3 sun) {
  float t = clamp(direction.y, 0.0, 1.0);
  vec3 color = mix(to_linear(u_sky_horizon), to_linear(u_sky_middle), smoothstep(0.0, 0.25, t));
  color = mix(color, to_linear(u_sky_top), smoothstep(0.2, 0.9, t));
  float mu = max(dot(direction, sun), 0.0);
  vec3 sun_linear = to_linear(u_sun_color);
  float halo = pow(mu, 6.0) * 0.25 + pow(mu, 64.0) * 0.5 + pow(mu, 1200.0) * 2.5;
  color += sun_linear * halo * u_sun_visibility * sun_clearness();
  return color;
}

vec4 clouds(vec3 origin, vec3 direction, vec3 sun) {
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

vec3 sky(vec3 origin, vec3 direction, vec3 sun, bool with_details) {
  vec3 color = sky_color(direction, sun);
  if (with_details) {
    float mu = dot(direction, sun);
    color += to_linear(u_sun_color) * smoothstep(0.99975, 0.9999, mu) * 25.0 * u_sun_visibility * sun_clearness();
    vec2 cell = floor(gl_FragCoord.xy / 1.5);
    float star = step(0.9985, hash12(cell)) * hash12(cell + 3.7);
    float twinkle = 0.65 + 0.35 * sin(u_time * (0.8 + hash12(cell + 9.1) * 2.0) + hash12(cell + 1.3) * 40.0);
    color += vec3(star * star * twinkle * 1.6) * u_stars * smoothstep(0.02, 0.2, direction.y);
    vec4 cloud = clouds(origin, direction, sun);
    color = mix(color, cloud.rgb, cloud.a);
  } else {
    // En los reflejos basta con el tono medio de las nubes.
    color = mix(color, to_linear(u_deck_color) * (0.35 + 0.65 * u_daylight), u_cloud_cover * 0.35);
  }
  return mix(color, to_linear(u_deck_color) * (0.25 + 0.75 * u_daylight), u_cloud_deck * 0.8);
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

  float foam = smoothstep(0.55, 0.9, crest) * smoothstep(0.45, 0.9, u_wind) * noise(p.xz * 1.5 + u_time * 0.3);
  color = mix(color, to_linear(vec3(0.85, 0.9, 0.92)) * (0.2 + 0.8 * u_daylight), foam * 0.7);

  // Bruma con la distancia hacia el color del horizonte.
  float haze = 1.0 - exp(-t * (0.0006 + u_fog * 0.006 + u_rain * 0.0015));
  vec3 horizon = sky(p, normalize(vec3(direction.x, 0.001, direction.z)), sun, false);
  return mix(color, mix(horizon, to_linear(u_fog_color), u_fog * 0.6), haze);
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

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

  color = aces(color * 1.1);
  color = pow(color, vec3(1.0 / 2.2));
  color += (hash12(gl_FragCoord.xy + fract(u_time) * 17.0) - 0.5) / 255.0;
  out_color = vec4(color, 1.0);
}
