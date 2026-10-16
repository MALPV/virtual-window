// Lectura del pase en cache con la silueta suavizada. El pase en cache guarda color premultiplicado
// por la cobertura (alfa) y, en la textura extra, rgb libre y profundidad premultiplicada en alfa.
// En los bordes promedia cuatro muestras (antialias de un texel); en el interior no pierde nitidez.
uniform sampler2D u_cached;
uniform sampler2D u_cached_extra;

struct CachedSample {
  vec3 color;     // color de la capa en cache, codificado sRGB
  float coverage; // 0 fondo, 1 capa, intermedio en la silueta
  vec3 extra_rgb; // dato libre de la escena (sin premultiplicar)
  float depth;    // profundidad codificada de la capa (sin premultiplicar)
};

CachedSample read_cached(vec2 uv) {
  vec2 texel = 1.0 / vec2(textureSize(u_cached, 0));
  vec4 c0 = texture(u_cached, uv + texel * vec2(-0.5, -0.5));
  vec4 c1 = texture(u_cached, uv + texel * vec2(0.5, -0.5));
  vec4 c2 = texture(u_cached, uv + texel * vec2(-0.5, 0.5));
  vec4 c3 = texture(u_cached, uv + texel * vec2(0.5, 0.5));
  float lowest = min(min(c0.a, c1.a), min(c2.a, c3.a));
  float highest = max(max(c0.a, c1.a), max(c2.a, c3.a));

  CachedSample result;
  if (lowest < 0.999 && highest > 0.001) {
    vec4 e0 = texture(u_cached_extra, uv + texel * vec2(-0.5, -0.5));
    vec4 e1 = texture(u_cached_extra, uv + texel * vec2(0.5, -0.5));
    vec4 e2 = texture(u_cached_extra, uv + texel * vec2(-0.5, 0.5));
    vec4 e3 = texture(u_cached_extra, uv + texel * vec2(0.5, 0.5));
    vec4 color_sum = c0 + c1 + c2 + c3;
    vec4 extra_sum = e0 + e1 + e2 + e3;
    result.coverage = color_sum.a * 0.25;
    result.color = color_sum.rgb / max(color_sum.a, 1e-4);
    result.extra_rgb = extra_sum.rgb * 0.25;
    result.depth = extra_sum.a / max(color_sum.a, 1e-4);
  } else {
    vec4 c = texture(u_cached, uv);
    vec4 e = texture(u_cached_extra, uv);
    result.coverage = c.a;
    result.color = c.rgb / max(c.a, 1e-4);
    result.extra_rgb = e.rgb;
    result.depth = e.a / max(c.a, 1e-4);
  }
  return result;
}
