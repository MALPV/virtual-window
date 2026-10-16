#version 300 es
#include "common.glsl"
#include "sky.glsl"

// Salida 0: ciudad premultiplicada por su cobertura.
// Salida 1: luz de las ventanas encendidas en rgb y profundidad en alfa.
layout(location = 0) out vec4 out_color;
layout(location = 1) out vec4 out_extra;

const float MAX_DISTANCE = 3500.0;

float march(vec3 origin, vec3 direction) {
  float t = 0.5;
  for (int i = 0; i < 320; i++) {
    vec3 p = origin + direction * t;
    float d = city_distance(p);
    if (d < 0.004 * t + 0.01) return t;
    t += max(min(d, cell_margin(p)), 0.002 * t);
    if (t > MAX_DISTANCE) break;
  }
  return -1.0;
}

vec3 city_normal(vec3 p) {
  vec2 e = vec2(0.02, 0.0);
  return normalize(vec3(
    city_distance(p + e.xyy) - city_distance(p - e.xyy),
    city_distance(p + e.yxy) - city_distance(p - e.yxy),
    city_distance(p + e.yyx) - city_distance(p - e.yyx)
  ));
}

float soft_shadow(vec3 origin, vec3 sun) {
  if (sun.y <= 0.0) return 0.0;
  float result = 1.0;
  float t = 0.3;
  for (int i = 0; i < 48; i++) {
    vec3 p = origin + sun * t;
    float d = city_distance(p);
    result = min(result, 8.0 * d / t);
    if (result < 0.01 || t > 600.0) break;
    t += clamp(min(d, cell_margin(p)), 0.3, 25.0);
  }
  return clamp(result, 0.0, 1.0);
}

// Oclusion ambiental: los rincones y la base de los edificios reciben menos luz del cielo.
float ambient_occlusion(vec3 p, vec3 normal) {
  float occlusion = 0.0;
  float weight = 1.0;
  for (int i = 1; i <= 4; i++) {
    float h = 0.8 * float(i);
    occlusion += (h - city_distance(p + normal * h)) * weight;
    weight *= 0.6;
  }
  return clamp(1.0 - occlusion * 0.18, 0.2, 1.0);
}

struct Surface {
  vec3 albedo;
  float glass;
  vec3 emission;
};

Surface surface_at(vec3 world, vec3 world_normal, float t) {
  Surface s;
  s.glass = 0.0;
  s.emission = vec3(0.0);
  // Los patrones de fachada se calculan en el espacio de la reticula de manzanas.
  vec3 p = to_grid(world);
  vec3 normal = to_grid(world_normal);
  vec2 cell = floor(p.xz / CELL);
  if (p.y < 0.05) {
    // Calle: asfalto con aceras algo mas claras.
    vec2 local = abs(p.xz - (cell + 0.5) * CELL);
    float sidewalk = step(CELL * 0.5 - STREET * 0.5 - 2.0, max(local.x, local.y));
    s.albedo = mix(vec3(0.06), vec3(0.14, 0.135, 0.13), 1.0 - sidewalk);
    return s;
  }
  float style = hash12(cell + 9.0);
  vec3 wall = style < 0.35 ? vec3(0.36, 0.34, 0.31) : style < 0.6 ? vec3(0.32, 0.17, 0.12) : style < 0.8 ? vec3(0.5, 0.46, 0.4) : vec3(0.18, 0.2, 0.22);
  wall *= 0.85 + 0.3 * hash12(cell + 6.0);
  if (normal.y > 0.5) {
    s.albedo = vec3(0.1, 0.098, 0.095) * (0.8 + 0.4 * noise(p.xz * 0.3));
    return s;
  }
  // Fachada: rejilla de plantas y ventanas; las torres son muro cortina de cristal.
  bool tower = building(cell).z > 45.0;
  float along = abs(normal.x) > 0.5 ? p.z : p.x;
  vec2 grid = vec2(along / (tower ? 1.8 : 2.4), p.y / 3.2);
  vec2 f = fract(grid);
  vec2 id = floor(grid) + cell * 97.0;
  float lod = smoothstep(200.0, 800.0, t);
  // Ventana con marco y persiana a una altura distinta en cada una.
  float window_mask = tower ? step(0.05, f.x) * step(0.1, f.y) : step(0.24, f.x) * step(f.x, 0.76) * step(0.3, f.y) * step(f.y, 0.86);
  float frame = tower ? 0.0 : (1.0 - step(0.47, abs(f.x - 0.5) * 2.0 - 0.0)) * step(abs(f.x - 0.5), 0.02);
  float blind = step(1.0 - hash12(id + 1.7) * 0.6, (f.y - 0.3) / 0.56) * (tower ? 0.0 : 1.0);
  window_mask *= 1.0 - max(frame, blind * 0.85);
  window_mask = mix(window_mask, tower ? 0.8 : 0.38, lod);
  s.albedo = wall * (blind > 0.5 ? 1.2 : 1.0);
  s.glass = window_mask;
  // Ventanas encendidas: un tercio, en luz calida o fria, distintas en cada planta.
  float lit = step(0.66, hash12(id));
  vec3 warm = vec3(1.0, 0.72, 0.4);
  vec3 cool = vec3(0.75, 0.85, 1.0);
  s.emission = mix(warm, cool, step(0.75, hash12(id + 3.0))) * lit * window_mask * (0.6 + 0.6 * hash12(id + 8.0));
  return s;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec3 origin = eye_position();
  vec3 direction = view_ray(uv, aspect);
  vec3 sun = sun_direction(aspect);

  float t = march(origin, direction);
  if (t < 0.0) {
    out_color = vec4(0.0);
    out_extra = vec4(0.0);
    return;
  }
  vec3 p = origin + direction * t;
  vec3 normal = city_normal(p);
  Surface s = surface_at(p, normal, t);

  float above = smoothstep(-2.0, 5.0, u_sun_altitude);
  vec3 sun_light = to_linear(u_sun_color) * 2.1 * above * mix(1.0, 0.3, u_cloud_deck);
  // Luz de cielo poco saturada mas el rebote calido de calles y fachadas.
  vec3 sky_tint = to_linear(mix(u_sky_horizon, u_sky_top, 0.6));
  vec3 sky_light = mix(sky_tint, vec3(luminance(sky_tint)), 0.65) * (0.3 + 0.45 * u_daylight) + vec3(0.03, 0.025, 0.02) * (0.3 + 0.7 * u_daylight);
  float diffuse = max(dot(normal, sun), 0.0) * soft_shadow(p + normal * 0.05, sun);
  float occlusion = ambient_occlusion(p, normal);
  vec3 lit = s.albedo * (sun_light * diffuse + sky_light * (0.55 + 0.45 * normal.y) * occlusion + moonlight_on(normal));

  // Cristal: refleja el cielo segun el angulo y deja ver un interior oscuro.
  vec3 reflected = reflect(direction, normal);
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(-direction, normal), 0.0), 5.0);
  // Cada cristal refleja algo distinto: ligeras diferencias de inclinacion y de tinte.
  float pane = hash12(floor(vec2(dot(to_grid(p).xz, vec2(1.0)) / 2.0, p.y / 3.2)));
  vec3 glass = mix(vec3(0.015, 0.018, 0.022), sky_gradient(normalize(reflected + vec3(0.0, (pane - 0.5) * 0.15, 0.0)), sun) * (0.6 + 0.35 * pane), 0.25 + 0.75 * fresnel);
  vec3 color = mix(lit, glass * occlusion, s.glass * 0.7);

  // Bruma urbana con la distancia.
  float extinction = exp(-t * (0.00045 + u_fog * 0.003 + u_rain * 0.0008));
  vec3 haze = apply_cloud_deck(sky_gradient(normalize(vec3(direction.x, 0.03, direction.z)), sun));
  haze *= min(1.0, 0.5 / max(luminance(haze), 1e-3));
  haze = mix(haze, to_linear(u_fog_color) * (0.4 + 0.6 * u_daylight), u_fog * 0.8);
  color = color * extinction + haze * (1.0 - extinction);

  out_color = vec4(pow(aces(color * 1.1), vec3(1.0 / 2.2)), 1.0);
  out_extra = vec4(s.emission * extinction * 0.5, max(1.0 - exp(-t / DEPTH_SCALE), 1.0 / 255.0));
}
