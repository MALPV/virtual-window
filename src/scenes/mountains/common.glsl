// Fragmento comun a los dos pases de la escena de montanas.
#include "uniforms.glsl"
#include "noise.glsl"

// Mirada ligeramente alzada desde un primer piso: el horizonte queda algo por debajo del centro.
const float WINDOW_DISTANCE = 1.0;
const float TAN_HALF_FOV = 0.42;
const float LOOK_DOWN = -0.02;
const float EYE_HEIGHT = 8.0;
const vec2 EYE_RANGE = vec2(0.09, 0.06);
const float CLOUD_HEIGHT = 900.0;

// Profundidad guardada en el alfa del pase en cache: 0 es cielo.
const float DEPTH_SCALE = 300.0;

#include "window.glsl"
