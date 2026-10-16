#version 300 es
#include "common.glsl"
#include "sky.glsl"
#include "cache.glsl"

out vec4 out_color;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  CachedSample cached = read_cached(uv);
  vec3 origin = eye_position();
  vec3 direction = view_ray(uv, aspect);
  vec3 sun = sun_direction(aspect);
  float above = smoothstep(-2.0, 5.0, u_sun_altitude);
  float water_t = direction.y < 0.0 ? origin.y / -direction.y : -1.0;

  vec3 background;
  if (water_t < 0.0) {
    // Cielo con estrellas y nubes vivas.
    background = to_linear(cached.extra_rgb) + star_field(direction);
    vec4 cloud = cloud_layer(origin, direction, sun);
    background = apply_cloud_deck(mix(background, cloud.rgb, cloud.a));
  } else {
    vec3 surface = origin + direction * water_t;
    // Ondas: zonas de agua rizada por el viento que se desplazan y rompen el reflejo.
    float gusts = smoothstep(0.35, 0.8, fbm(surface.xz * 0.004 + vec2(u_time * 0.01, 0.0), 4));
    float roughness = 0.15 + u_wind_strength * 0.6 + gusts * (0.3 + u_wind_strength);
    vec2 flow = vec2(u_time * 0.25, u_time * 0.12);
    vec2 ripple = vec2(noise(surface.xz * 0.35 + flow), noise(surface.xz * 0.35 - flow + 11.0)) - 0.5;
    ripple += (vec2(noise(surface.xz * 1.3 + flow * 2.0), noise(surface.xz * 1.3 - flow * 2.0 + 5.0)) - 0.5) * 0.5;
    vec2 offset = ripple * roughness * 2.5 / water_t;
    vec4 mirror = texture(u_cached_extra, uv + vec2(offset.x * 0.4, offset.y));
    vec3 reflection = to_linear(mirror.rgb);

    // El cielo reflejado tambien lleva sus nubes, moviendose a la vez que las de arriba.
    vec3 reflected = reflect(direction, vec3(0.0, 1.0, 0.0));
    vec4 cloud = cloud_layer(surface, reflected, sun);
    reflection = mix(reflection, cloud.rgb, cloud.a * mirror.a);
    reflection = mix(reflection, apply_cloud_deck(reflection), mirror.a);

    // Fresnel: cerca se ve el agua oscura del lago, lejos casi todo es reflejo.
    float facing = clamp(-direction.y + dot(ripple, vec2(0.05)), 0.0, 1.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
    vec3 water = vec3(0.01, 0.025, 0.03) * (0.3 + 0.7 * u_daylight) + to_linear(u_sky_top) * 0.03;
    background = mix(water, reflection, clamp(fresnel * 1.15, 0.0, 1.0));

    // Niebla al amanecer: jirones que se deslizan sobre el agua con la hora dorada y el frio.
    float cold = clamp((12.0 - u_temperature) / 16.0, 0.0, 1.0);
    float mist_amount = u_golden_hour * (0.35 + 0.65 * cold) * 0.7 + u_fog * 0.6;
    float wisps = smoothstep(0.4, 0.8, fbm(surface.xz * vec2(0.006, 0.02) + vec2(u_time * 0.02, 0.0), 5));
    vec3 mist_color = mix(to_linear(u_fog_color), to_linear(u_sun_color) * 0.9, u_golden_hour * above * 0.5);
    background = mix(background, mist_color * (0.35 + 0.65 * u_daylight), clamp(mist_amount * wisps * smoothstep(20.0, 300.0, water_t), 0.0, 0.85));
  }

  vec3 color = background;
  float land_t = -DEPTH_SCALE * log(max(1.0 - cached.depth, 1e-4));
  if (cached.coverage > 0.004 && (water_t < 0.0 || land_t < water_t)) {
    vec3 land = to_linear(cached.color);
    vec3 p = origin + direction * land_t;
    if (sun.y > 0.02) {
      float shadow = cloud_density(p.xz + sun.xz / sun.y * (CLOUD_HEIGHT - p.y));
      land *= mix(1.0, 0.5, shadow * above * (1.0 - u_cloud_deck * 0.8));
    }
    color = mix(background, land, cached.coverage);
  }

  float horizon_band = exp(-abs(direction.y) * 16.0);
  color = mix(color, to_linear(u_fog_color) * (0.4 + 0.6 * u_daylight), clamp(u_fog * (0.3 + 0.6 * horizon_band), 0.0, 0.85));
  color = mix(color, vec3(luminance(color)), u_rain * 0.3);
  color *= 1.0 - u_rain * 0.12;
  out_color = encode_output(color);
}
