#version 300 es
#include "common.glsl"

out vec4 out_color;

// Atmosfera terrestre en metros (dispersion simple de Rayleigh y Mie).
const float EARTH_RADIUS = 6360e3;
const float ATMOSPHERE_RADIUS = 6420e3;
const float RAYLEIGH_HEIGHT = 7994.0;
const float MIE_HEIGHT = 1200.0;
const vec3 RAYLEIGH_BETA = vec3(5.5e-6, 13.0e-6, 22.4e-6);
const vec3 MIE_BETA = vec3(21e-6);
const float SUN_INTENSITY = 20.0;

const float MAX_DISTANCE = 6000.0;
const int MARCH_STEPS = 220;
const int SHADOW_STEPS = 48;

vec2 ray_sphere(vec3 origin, vec3 direction, float radius) {
  float b = dot(origin, direction);
  float c = dot(origin, origin) - radius * radius;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e9, -1e9);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

vec3 atmosphere(vec3 direction, vec3 sun) {
  vec3 origin = vec3(0.0, EARTH_RADIUS + 800.0, 0.0);
  vec3 dir = normalize(vec3(direction.x, max(direction.y, -0.02), direction.z));
  float t_max = ray_sphere(origin, dir, ATMOSPHERE_RADIUS).y;
  float segment = t_max / 12.0;
  float mu = dot(dir, sun);
  float phase_r = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = 0.76;
  float phase_m = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  vec3 sum_r = vec3(0.0);
  vec3 sum_m = vec3(0.0);
  float depth_r = 0.0;
  float depth_m = 0.0;
  for (int i = 0; i < 12; i++) {
    vec3 p = origin + dir * (segment * (float(i) + 0.5));
    float height = length(p) - EARTH_RADIUS;
    float step_r = exp(-height / RAYLEIGH_HEIGHT) * segment;
    float step_m = exp(-height / MIE_HEIGHT) * segment;
    depth_r += step_r;
    depth_m += step_m;
    float light_segment = ray_sphere(p, sun, ATMOSPHERE_RADIUS).y / 6.0;
    float light_r = 0.0;
    float light_m = 0.0;
    bool lit = true;
    for (int j = 0; j < 6; j++) {
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

// Composicion: prado elevado junto a la ventana, un valle profundo y la cordillera al fondo.
float terrain(vec2 p, int octaves) {
  float near = length(vec2(p.x * 0.7, p.y));
  float drop = -75.0 * smoothstep(9.0, 70.0, near);
  float range = eroded_mountains(p * 0.0021 + vec2(3.1, 1.7), octaves) * 560.0 * smoothstep(140.0, 900.0, p.y);
  float valley = (fbm(p * 0.012, 5) - 0.5) * 18.0 * smoothstep(12.0, 70.0, near);
  float meadow = (fbm(p * 0.35, 4) - 0.5) * 0.7 * (1.0 - smoothstep(8.0, 30.0, near));
  return drop + range + valley + meadow;
}

int octaves_at(float distance) {
  return int(clamp(11.0 - log2(1.0 + distance * 0.02), 4.0, 11.0));
}

float march(vec3 origin, vec3 direction) {
  float t = 0.3;
  for (int i = 0; i < MARCH_STEPS; i++) {
    vec3 p = origin + direction * t;
    float h = p.y - terrain(p.xz, octaves_at(t));
    if (h < 0.002 * t) return t;
    t += max(h * 0.45, 0.004 * t);
    if (t > MAX_DISTANCE) break;
  }
  return -1.0;
}

vec3 terrain_normal(vec3 p, float t) {
  float e = max(0.004 * t, 0.02);
  int octaves = min(octaves_at(t) + 2, 11);
  float h = terrain(p.xz, octaves);
  return normalize(vec3(h - terrain(p.xz + vec2(e, 0.0), octaves), e, h - terrain(p.xz + vec2(0.0, e), octaves)));
}

float soft_shadow(vec3 origin, vec3 sun) {
  if (sun.y <= 0.0) return 0.0;
  float result = 1.0;
  float t = 0.5;
  for (int i = 0; i < SHADOW_STEPS; i++) {
    vec3 p = origin + sun * t;
    float h = p.y - terrain(p.xz, 6);
    result = min(result, 10.0 * h / t);
    if (result < 0.01 || t > 3000.0) break;
    t += clamp(h * 0.6, 0.5 + 0.02 * t, 80.0);
  }
  return clamp(result, 0.0, 1.0);
}

vec3 material(vec3 p, vec3 normal, float t) {
  float steep = 1.0 - normal.y;
  float variation = fbm(p.xz * 0.05, 4);
  vec3 grass = mix(vec3(0.16, 0.22, 0.08), vec3(0.24, 0.27, 0.11), variation);
  vec3 forest = mix(vec3(0.05, 0.09, 0.04), vec3(0.08, 0.12, 0.05), variation);
  vec3 rock = mix(vec3(0.24, 0.22, 0.2), vec3(0.36, 0.33, 0.3), fbm(p.xz * 0.2, 3));

  // Bosque en las laderas bajas del valle, prado alpino arriba, roca en las pendientes fuertes.
  vec3 albedo = mix(forest, grass, smoothstep(-40.0, 60.0, p.y));
  albedo = mix(albedo, rock, smoothstep(0.28, 0.5, steep + (variation - 0.5) * 0.2));

  // La cota de nieve baja con el frio y cuando nieva.
  float cold = clamp((10.0 - u_temperature) / 20.0, 0.0, 1.0);
  float snow_line = mix(330.0, 60.0, max(cold, u_snow * 0.9));
  float snow = smoothstep(snow_line - 30.0, snow_line + 30.0, p.y + (variation - 0.5) * 80.0);
  snow *= smoothstep(0.55, 0.25, steep);
  return mix(albedo, vec3(0.82, 0.85, 0.9), snow);
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

  vec3 sky = atmosphere(direction, sun);
  float night = 1.0 - smoothstep(-8.0, 2.0, u_sun_altitude);
  vec3 night_sky = to_linear(mix(u_sky_horizon, u_sky_top, clamp(direction.y * 2.0, 0.0, 1.0))) * 0.6;
  sky += night_sky * night;

  float t = march(origin, direction);
  vec3 color;
  float depth = 0.0;
  if (t < 0.0) {
    float mu = dot(direction, sun);
    color = sky + to_linear(u_sun_color) * smoothstep(0.99985, 0.99995, mu) * 40.0 * u_sun_visibility;
  } else {
    vec3 p = origin + direction * t;
    vec3 normal = terrain_normal(p, t);
    float above = smoothstep(-2.0, 5.0, u_sun_altitude);
    vec3 sun_light = to_linear(u_sun_color) * 3.2 * above * mix(1.0, 0.3, u_cloud_deck);
    vec3 sky_light = to_linear(mix(u_sky_horizon, u_sky_top, 0.6)) * (0.25 + 0.55 * u_daylight) + vec3(0.002, 0.003, 0.006);
    float diffuse = max(dot(normal, sun), 0.0) * soft_shadow(p + normal * 0.05, sun);
    float hemisphere = 0.5 + 0.5 * normal.y;
    float bounce = max(dot(normal, normalize(vec3(-sun.x, 0.0, -sun.z))), 0.0) * 0.15;
    vec3 albedo = material(p, normal, t);
    color = albedo * (sun_light * diffuse + sky_light * hemisphere + sun_light * bounce * 0.3);

    // Perspectiva aerea: la distancia funde el terreno con el color del cielo en esa direccion.
    float density = 0.00028 + u_fog * 0.0025 + u_rain * 0.0006;
    float valley_haze = exp(-max(p.y + 60.0, 0.0) * 0.03) * (0.004 + u_fog * 0.01);
    float extinction = exp(-t * (density + valley_haze));
    color = color * extinction + sky * 0.9 * (1.0 - extinction);
    depth = max(1.0 - exp(-t / DEPTH_SCALE), 1.0 / 255.0);
  }

  color = aces(color * 1.1);
  color = pow(color, vec3(1.0 / 2.2));
  out_color = vec4(color, depth);
}
