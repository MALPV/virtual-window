#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_slide;
uniform float u_wind;
uniform float u_light;
uniform vec3 u_sky;
uniform vec3 u_ground;

out vec4 out_color;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash2(vec2 p) {
  return vec2(hash(p), hash(p + 19.19));
}

vec4 over(vec4 top, vec4 bottom) {
  return top + bottom * (1.0 - top.a);
}

// Una gota es una lente que invierte la imagen: arriba se ve el suelo y abajo el cielo.
vec4 lens(vec2 offset, float radius, float alpha) {
  if (alpha <= 0.0) return vec4(0.0);
  vec2 n = offset / radius;
  float r = length(n);
  if (r >= 1.0) return vec4(0.0);
  vec3 inside = mix(u_ground, u_sky, smoothstep(0.55, -0.65, n.y));
  inside *= mix(0.92, 1.12, 1.0 - r * r);
  vec3 color = mix(inside, inside * 0.3, smoothstep(0.62, 1.0, r) * 0.85);
  vec2 shine = n - vec2(-0.3, 0.38);
  float highlight = exp(-dot(shine, shine) * 28.0) * (0.45 + 0.55 * u_light);
  // De noche el cuerpo de la gota casi no tapa el paisaje: es cristal oscuro, no una mancha opaca.
  float body = smoothstep(1.0, 0.8, r) * alpha * (0.3 + 0.7 * u_light);
  float a = max(body, highlight * alpha);
  return vec4(color * body + vec3(highlight * alpha), a);
}

vec4 resting_drops(vec2 p, float scale, float seed, float max_radius) {
  vec2 grid = p * scale;
  vec2 cell = floor(grid);
  vec2 local = fract(grid) - 0.5;
  vec2 rnd = hash2(cell + seed);
  float present = step(1.0 - u_intensity * 0.85, hash(cell + seed + 4.1));
  // Cada gota aparece de golpe y se evapora despacio, cada una a su ritmo.
  float life = fract(u_time * (0.03 + 0.06 * rnd.x) + rnd.y);
  float visible = smoothstep(0.0, 0.04, life) * smoothstep(1.0, 0.55, life);
  vec2 center = (rnd - 0.5) * 0.7;
  float radius = mix(0.35, 1.0, hash(cell + seed + 2.3)) * max_radius;
  return lens(local - center, radius, visible * present);
}

vec4 sliding_drops(vec2 p, float seed) {
  vec2 scale = vec2(4.0, 1.5);
  p.x += p.y * u_wind * 0.25;
  vec2 grid = p * scale;
  float column = floor(grid.x);
  float column_hash = hash(vec2(column, seed));

  // Avance a tirones: la gota se queda pegada y luego resbala de golpe.
  float k = u_time * (0.12 + 0.2 * column_hash) + column_hash * 10.0;
  float progress = floor(k) + smoothstep(0.5, 1.0, fract(k));
  grid.y += progress;

  vec2 cell = vec2(column, floor(grid.y));
  vec2 local = fract(grid) - 0.5;
  float present = step(1.0 - u_intensity * u_slide * 0.7, hash(cell + seed + 1.7));
  float wobble = sin(grid.y * 9.0 + column_hash * 20.0) * 0.06;
  vec2 center = vec2((hash(cell + seed) - 0.5) * 0.5 + wobble, -0.1);
  float radius = mix(0.016, 0.028, hash(cell + seed + 3.3));
  vec4 drop = lens((local - center) / scale, radius, present);

  // Estela de gotitas que deja al resbalar, cada vez mas escasa hacia arriba.
  float trail_row = floor(local.y * 10.0);
  vec2 trail_local = vec2(local.x - center.x, fract(local.y * 10.0) - 0.5);
  float trail_active = present * step(center.y + 0.05, local.y) * (1.0 - smoothstep(0.0, 0.5, local.y));
  trail_active *= step(0.4, hash(vec2(column, trail_row + cell.y * 13.0) + seed));
  vec4 trail = lens(trail_local / vec2(scale.x, scale.y * 10.0), radius * 0.3, trail_active);
  return over(drop, trail);
}

void main() {
  vec2 p = gl_FragCoord.xy / u_resolution.y;
  vec4 color = resting_drops(p, 34.0, 1.0, 0.16);
  color = over(resting_drops(p, 13.0, 7.0, 0.14), color);
  color = over(sliding_drops(p, 3.0), color);
  color = over(sliding_drops(p + vec2(0.11, 0.37), 11.0), color);
  out_color = color * 0.92;
}
