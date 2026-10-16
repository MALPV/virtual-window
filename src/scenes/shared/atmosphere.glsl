// Dispersion simple de Rayleigh y Mie en una atmosfera terrestre (metros).
const float EARTH_RADIUS = 6360e3;
const float ATMOSPHERE_RADIUS = 6420e3;
const float RAYLEIGH_HEIGHT = 7994.0;
const float MIE_HEIGHT = 1200.0;
const vec3 RAYLEIGH_BETA = vec3(5.5e-6, 13.0e-6, 22.4e-6);
const vec3 MIE_BETA = vec3(21e-6);
const float SUN_INTENSITY = 20.0;

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
