#version 300 es
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

out vec4 out_color;

const float PI = 3.14159265;
const float TAN_HALF_FOV = 0.466;
const float HORIZON = 0.38;
const float LAKE_LEVEL = 0.335;
const float NEAR_SHORE = 0.13;

// Atmosfera terrestre en metros (dispersion simple de Rayleigh y Mie).
const float EARTH_RADIUS = 6360e3;
const float ATMOSPHERE_RADIUS = 6420e3;
const float RAYLEIGH_HEIGHT = 7994.0;
const float MIE_HEIGHT = 1200.0;
const vec3 RAYLEIGH_BETA = vec3(5.5e-6, 13.0e-6, 22.4e-6);
const vec3 MIE_BETA = vec3(21e-6);
const float SUN_INTENSITY = 20.0;
const int VIEW_STEPS = 12;
const int LIGHT_STEPS = 6;
// Desplazamiento maximo por parallax para un plano de profundidad 1 (fraccion de la altura).
const vec2 PARALLAX_RANGE = vec2(0.06, 0.035);

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    amplitude *= 0.5;
  }
  return value;
}

float ridge(float x, float seed) {
  float value = 0.0;
  float amplitude = 0.55;
  float frequency = 1.0;
  for (int i = 0; i < 5; i++) {
    float n = noise(vec2(x * frequency, seed));
    value += amplitude * (1.0 - abs(n * 2.0 - 1.0));
    frequency *= 2.1;
    amplitude *= 0.48;
  }
  return value;
}

vec3 to_linear(vec3 c) {
  return pow(c, vec3(2.2));
}

float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec2 ray_sphere(vec3 origin, vec3 direction, float radius) {
  float b = dot(origin, direction);
  float c = dot(origin, origin) - radius * radius;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e9, -1e9);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

vec3 atmosphere(vec3 direction, vec3 sun) {
  vec3 origin = vec3(0.0, EARTH_RADIUS + 600.0, 0.0);
  float t_max = ray_sphere(origin, direction, ATMOSPHERE_RADIUS).y;
  vec2 ground = ray_sphere(origin, direction, EARTH_RADIUS);
  if (ground.x > 0.0) t_max = min(t_max, ground.x);
  float segment = t_max / float(VIEW_STEPS);

  float mu = dot(direction, sun);
  float phase_r = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = 0.76;
  float phase_m = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));

  vec3 sum_r = vec3(0.0);
  vec3 sum_m = vec3(0.0);
  float depth_r = 0.0;
  float depth_m = 0.0;
  for (int i = 0; i < VIEW_STEPS; i++) {
    vec3 p = origin + direction * (segment * (float(i) + 0.5));
    float height = length(p) - EARTH_RADIUS;
    float step_r = exp(-height / RAYLEIGH_HEIGHT) * segment;
    float step_m = exp(-height / MIE_HEIGHT) * segment;
    depth_r += step_r;
    depth_m += step_m;

    float light_segment = ray_sphere(p, sun, ATMOSPHERE_RADIUS).y / float(LIGHT_STEPS);
    float light_r = 0.0;
    float light_m = 0.0;
    bool lit = true;
    for (int j = 0; j < LIGHT_STEPS; j++) {
      vec3 q = p + sun * (light_segment * (float(j) + 0.5));
      float light_height = length(q) - EARTH_RADIUS;
      if (light_height < 0.0) {
        lit = false;
        break;
      }
      light_r += exp(-light_height / RAYLEIGH_HEIGHT) * light_segment;
      light_m += exp(-light_height / MIE_HEIGHT) * light_segment;
    }
    if (lit) {
      vec3 attenuation = exp(-(RAYLEIGH_BETA * (depth_r + light_r) + MIE_BETA * 1.1 * (depth_m + light_m)));
      sum_r += attenuation * step_r;
      sum_m += attenuation * step_m;
    }
  }
  return SUN_INTENSITY * (sum_r * RAYLEIGH_BETA * phase_r + sum_m * MIE_BETA * phase_m);
}

// Desplazamiento del contenido (x a la derecha, y hacia arriba) de un plano segun su profundidad.
// u_parallax llega con y positiva hacia abajo, como en CSS.
vec2 parallax_shift(float depth) {
  return vec2(u_parallax.x, -u_parallax.y) * PARALLAX_RANGE * depth;
}

vec3 view_ray(vec2 uv, float aspect) {
  vec2 view = vec2((uv.x - 0.5) * aspect, uv.y - HORIZON) * 2.0 * TAN_HALF_FOV;
  return normalize(vec3(view, 1.0));
}

struct Light {
  vec3 sun_dir;
  vec3 sun;
  vec3 ambient;
};

Light scene_light(float aspect) {
  float altitude = radians(u_sun_altitude);
  // El sol recorre el ancho visible de la ventana, igual que en el resto de escenas.
  float azimuth = atan((u_sun_x - 0.5) * 2.0 * TAN_HALF_FOV * aspect * 0.9);
  Light light;
  light.sun_dir = normalize(vec3(sin(azimuth) * cos(altitude), sin(altitude), cos(azimuth) * cos(altitude)));
  float above = smoothstep(-2.0, 6.0, u_sun_altitude);
  light.sun = to_linear(u_sun_color) * 2.2 * above * mix(1.0, 0.25, u_cloud_deck);
  vec3 sky_mean = to_linear(mix(u_sky_horizon, u_sky_top, 0.5));
  light.ambient = sky_mean * (0.35 + 0.45 * u_daylight) + vec3(0.004, 0.006, 0.012);
  return light;
}

vec4 clouds(vec3 direction, Light light) {
  if (direction.y <= 0.0) return vec4(0.0);
  float wind_sign = abs(u_wind_drift) > 0.05 ? sign(u_wind_drift) : 1.0;
  float speed = 0.004 + 0.022 * u_wind_strength;
  vec2 p = direction.xz / direction.y * 0.55;
  p.x -= u_time * speed * wind_sign;
  p.y += u_time * 0.0015;

  float coverage = clamp(max(u_cloud_cover, u_cloud_deck), 0.0, 1.0);
  float low = 1.0 - coverage - 0.05;
  float density = smoothstep(low, low + 0.4, fbm(p * 1.4));
  float toward_sun = smoothstep(low, low + 0.4, fbm((p + light.sun_dir.xz * 0.09) * 1.4));
  float transmittance = exp(-toward_sun * 2.6);

  // Borde plateado cuando las nubes estan cerca del sol.
  float silver = pow(max(dot(direction, light.sun_dir), 0.0), 8.0) * (1.0 - density) * 1.5;
  vec3 color = light.ambient * 0.9 + light.sun * (0.35 + 0.65 * transmittance + silver);
  color = mix(color, to_linear(u_deck_color) * (0.4 + 0.6 * u_daylight), u_rain * 0.6);
  float fade = smoothstep(0.0, 0.14, direction.y);
  return vec4(color, density * fade * 0.96);
}

vec3 sky(vec3 direction, Light light, vec2 uv, bool reflection) {
  vec3 color;
  if (reflection) {
    float t = clamp(direction.y * 2.2, 0.0, 1.0);
    color = to_linear(mix(u_sky_horizon, u_sky_top, t)) * 0.9;
  } else {
    vec3 hdr = atmosphere(direction, light.sun_dir);
    float mu = dot(direction, light.sun_dir);
    hdr += to_linear(u_sun_color) * smoothstep(0.99985, 0.99995, mu) * 30.0 * u_sun_visibility;
    color = 1.0 - exp(-hdr * 1.4);

    float night = 1.0 - smoothstep(-8.0, 2.0, u_sun_altitude);
    vec3 night_sky = to_linear(mix(u_sky_horizon, u_sky_top, clamp(direction.y * 2.0, 0.0, 1.0)));
    color += night_sky * night;

    vec2 cell = floor(uv * u_resolution / 2.0);
    float star = step(0.9975, hash(cell)) * hash(cell + 3.1);
    float twinkle = 0.75 + 0.25 * sin(u_time * 1.3 + hash(cell + 7.7) * 40.0);
    color += vec3(star * twinkle) * u_stars * smoothstep(0.02, 0.2, direction.y);
  }

  vec4 cloud = clouds(direction, light);
  color = mix(color, cloud.rgb, cloud.a);
  color = mix(color, to_linear(u_deck_color) * (0.25 + 0.75 * u_daylight), u_cloud_deck * 0.85);
  return color;
}

float range_height(float x, int layer) {
  if (layer == 0) return LAKE_LEVEL + 0.015 + 0.2 * ridge(x * 1.25 + 1.7, 3.0) - 0.05;
  if (layer == 1) return LAKE_LEVEL + 0.005 + 0.12 * ridge(x * 2.1 + 5.1, 11.0) - 0.03;
  return LAKE_LEVEL + 0.04 * ridge(x * 3.6 + 9.3, 23.0);
}

float layer_depth(int layer) {
  if (layer == 0) return 0.85;
  if (layer == 1) return 0.7;
  return 0.55;
}

vec3 layer_albedo(int layer) {
  if (layer == 0) return to_linear(vec3(0.42, 0.45, 0.5));
  if (layer == 1) return to_linear(vec3(0.3, 0.34, 0.3));
  return to_linear(vec3(0.14, 0.22, 0.13));
}

float layer_haze(int layer) {
  if (layer == 0) return 0.55;
  if (layer == 1) return 0.35;
  return 0.18;
}

// Devuelve la capa de montana que cubre el punto, o -1 si es cielo.
int mountain_at(vec2 uv, float aspect, out float height, out float x) {
  for (int layer = 2; layer >= 0; layer--) {
    vec2 shift = parallax_shift(layer_depth(layer));
    float lx = (uv.x - 0.5) * aspect - shift.x;
    float h = range_height(lx, layer) + shift.y;
    if (uv.y < h) {
      height = h;
      x = lx;
      return layer;
    }
  }
  return -1;
}

vec3 shade_mountain(int layer, float x, float height, float y, Light light) {
  float e = 0.002;
  float slope = (range_height(x + e, layer) - range_height(x - e, layer)) / (2.0 * e);
  vec2 normal = normalize(vec2(-slope, 1.0));
  vec2 to_sun = normalize(vec2(light.sun_dir.x, max(light.sun_dir.y, 0.05)));
  float diffuse = max(dot(normal, to_sun), 0.0);
  float occlusion = mix(0.55, 1.0, clamp((y - LAKE_LEVEL) / max(height - LAKE_LEVEL, 0.001), 0.0, 1.0));

  vec3 albedo = layer_albedo(layer);
  if (layer == 0) {
    // La cota de nieve baja con el frio y cuando esta nevando.
    float cold = clamp((8.0 - u_temperature) / 16.0, 0.0, 1.0);
    float snow_line = mix(0.72, 0.38, max(cold, u_snow));
    float relative = (y - LAKE_LEVEL) / max(height - LAKE_LEVEL, 0.001);
    float snow = smoothstep(snow_line - 0.04, snow_line + 0.04, relative + (noise(vec2(x * 60.0, y * 90.0)) - 0.5) * 0.12);
    albedo = mix(albedo, vec3(0.85, 0.88, 0.92), snow);
  }

  vec3 color = albedo * (light.ambient * occlusion + light.sun * diffuse * occlusion);
  vec3 haze_color = to_linear(u_sky_horizon) * (0.6 + 0.4 * u_daylight);
  return mix(color, haze_color, clamp(layer_haze(layer) + u_fog * 0.4, 0.0, 1.0));
}

vec3 land_or_sky(vec2 uv, float aspect, Light light, bool reflection) {
  float height;
  float x;
  int layer = mountain_at(uv, aspect, height, x);
  // height ya incluye el desplazamiento de parallax: se compara con la altura en pantalla.
  if (layer >= 0) return shade_mountain(layer, x, height, uv.y, light);
  vec2 shift = parallax_shift(1.0);
  return sky(view_ray(uv - vec2(shift.x / aspect, shift.y), aspect), light, uv, reflection);
}

float shore_height(float x) {
  return NEAR_SHORE + 0.03 * fbm(vec2(x * 2.5, 41.0));
}

// Pinos en la orilla cercana, mas densos hacia los bordes para dejar libre la vista del lago.
float tree_height(float x, float base) {
  float cell = floor(x * 34.0);
  float local = fract(x * 34.0);
  float edge = smoothstep(0.15, 0.75, abs(x));
  float present = step(0.55 - edge * 0.5, hash(vec2(cell, 7.0)));
  float tall = 0.05 + 0.11 * hash(vec2(cell, 13.0)) * (0.5 + edge);
  float profile = 1.0 - abs(local * 2.0 - 1.0);
  return base + present * tall * pow(profile, 0.8);
}

vec3 foreground(vec2 uv, float aspect, Light light, out bool covered) {
  vec2 shift = parallax_shift(0.3);
  float x = (uv.x - 0.5) * aspect - shift.x;
  float y = uv.y - shift.y;
  float base = shore_height(x);
  float sway = sin(u_time * (0.8 + 1.6 * u_wind_strength) + floor(x * 34.0)) * (0.0015 + 0.004 * u_wind_strength);
  float trees = tree_height(x + sway * max(y - base, 0.0) * 12.0, base);
  covered = y < max(base, trees);
  if (!covered) return vec3(0.0);

  vec3 ground = to_linear(vec3(0.1, 0.13, 0.08));
  vec3 needles = to_linear(vec3(0.05, 0.09, 0.06));
  vec3 albedo = y < base ? ground : needles;
  float rim = pow(max(light.sun_dir.y, 0.0), 0.5) * 0.25;
  return albedo * (light.ambient * 0.8 + light.sun * (0.25 + rim));
}

vec3 lake(vec2 uv, float aspect, Light light) {
  float near = clamp((LAKE_LEVEL - uv.y) / (LAKE_LEVEL - NEAR_SHORE), 0.0, 1.0);
  float speed = 0.4 + 1.8 * u_wind_strength;
  float ripple = noise(vec2(uv.x * aspect * (30.0 + near * 60.0), uv.y * 180.0 - u_time * speed));
  float strength = (0.002 + 0.012 * u_wind_strength) * (0.4 + near);
  float offset = (ripple - 0.5) * strength;

  vec2 mirrored = vec2(uv.x + offset * 0.5, LAKE_LEVEL + (LAKE_LEVEL - uv.y) + offset);
  vec3 reflected = land_or_sky(mirrored, aspect, light, true);
  vec3 body = to_linear(vec3(0.03, 0.08, 0.09)) * (light.ambient * 2.0 + light.sun * 0.1);
  float fresnel = mix(0.9, 0.35, near);
  vec3 color = mix(body, reflected, fresnel);

  // Estela de destellos bajo el sol.
  float sun_screen_x = 0.5 + light.sun_dir.x / max(light.sun_dir.z, 0.2) / (2.0 * TAN_HALF_FOV * aspect);
  float band = exp(-pow((uv.x - sun_screen_x) * aspect * (3.0 + near * 5.0), 2.0) * 4.0);
  float sparkle = pow(ripple, 10.0) * band * u_sun_visibility * smoothstep(0.0, 4.0, u_sun_altitude);
  color += to_linear(u_sun_color) * sparkle * 2.5;
  return color;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  Light light = scene_light(aspect);

  bool covered;
  vec3 color = foreground(uv, aspect, light, covered);
  if (!covered) {
    if (uv.y < LAKE_LEVEL) {
      color = lake(uv, aspect, light);
    } else {
      color = land_or_sky(uv, aspect, light, false);
    }
  }

  // Niebla de altura, mas densa sobre el agua y al pie de las montanas.
  float fog_profile = 0.25 + 0.75 * exp(-abs(uv.y - LAKE_LEVEL) * 7.0);
  vec3 fog_color = to_linear(u_fog_color);
  color = mix(color, fog_color, clamp(u_fog * fog_profile, 0.0, 0.92));

  // La lluvia apaga y desatura el paisaje.
  color = mix(color, vec3(luminance(color)), u_rain * 0.35);
  color *= 1.0 - u_rain * 0.18;

  color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
  // Tramado minimo para evitar bandas en los degradados del cielo.
  color += (hash(gl_FragCoord.xy + fract(u_time)) - 0.5) / 255.0;
  out_color = vec4(color, 1.0);
}
