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
uniform float u_sun_x;
uniform float u_sun_altitude;
uniform float u_sun_visibility;
uniform float u_stars;
uniform float u_cloud_deck;
uniform float u_wind;
uniform float u_rain;

out vec4 out_color;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  // El horizonte esta lejos: se desplaza casi como el cielo con el parallax.
  float horizon = 0.42 + u_parallax.y * 0.035;
  vec2 p = vec2(uv.x - u_parallax.x * 0.035, uv.y);

  float sun_height = clamp(u_sun_altitude, -10.0, 70.0) / 70.0;
  vec2 sun = vec2(0.1 + u_sun_x * 0.8, horizon + sun_height * (0.95 - horizon));
  vec3 color;

  if (p.y >= horizon) {
    float t = (p.y - horizon) / (1.0 - horizon);
    color = mix(u_sky_horizon, u_sky_middle, smoothstep(0.0, 0.45, t));
    color = mix(color, u_sky_top, smoothstep(0.4, 1.0, t));

    vec2 cell = floor(vec2(p.x * aspect, p.y) * 140.0);
    float star = step(0.9965, hash(cell)) * u_stars * smoothstep(0.08, 0.35, t);
    color += vec3(star);

    vec2 d = (p - sun) * vec2(aspect, 1.0);
    float dist = length(d);
    float disc = smoothstep(0.034, 0.028, dist);
    float glow = 0.4 * exp(-dist * 8.0);
    color += u_sun_color * (disc + glow) * u_sun_visibility;
    color = mix(color, u_deck_color, u_cloud_deck * 0.85);
  } else {
    float depth = (horizon - p.y) / horizon;
    float perspective = 1.0 / (depth + 0.04);
    vec2 q = vec2((p.x - 0.5) * aspect * perspective, perspective);
    float speed = 0.35 + u_wind * 1.8;
    float amplitude = 0.35 + u_wind * 0.9;
    float wave = sin(q.x * 2.7 + q.y * 5.1 + u_time * speed) * 0.5
      + sin(q.x * 6.3 - q.y * 9.7 + u_time * speed * 1.6) * 0.3
      + sin(q.x * 12.9 + q.y * 17.3 - u_time * speed * 2.4) * 0.2;
    wave *= amplitude;

    vec3 deep = mix(u_sky_top, vec3(0.02, 0.06, 0.12), 0.55);
    vec3 water = mix(u_sky_horizon * 0.75, deep, smoothstep(0.0, 0.9, depth));
    water += wave * 0.035;

    // Estela de reflejos bajo el sol, solo si esta sobre el horizonte.
    float above = smoothstep(horizon - 0.01, horizon + 0.02, sun.y);
    float band = exp(-pow((p.x - sun.x) * aspect * (2.5 + depth * 4.0), 2.0) * 6.0);
    float sparkle = pow(max(0.0, wave / amplitude), 5.0) * band * above * u_sun_visibility;
    water += u_sun_color * sparkle * 1.4;

    water = mix(water, u_sky_horizon, exp(-depth * 16.0) * 0.55);
    water = mix(water, u_deck_color * 0.7, u_cloud_deck * 0.35);
    water *= 1.0 - u_rain * 0.25;
    color = water;
  }

  out_color = vec4(color, 1.0);
}
