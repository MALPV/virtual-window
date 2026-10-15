import { resolveIncludes, shaderScene } from "../api";
import common from "./common.glsl?raw";
import terrain from "./terrain.frag?raw";
import view from "./view.frag?raw";

const CHUNKS = { "common.glsl": common };
// Temperatura neutra cuando no se conoce: ni nieve extra ni deshielo.
const UNKNOWN_TEMPERATURE = 10;

export default shaderScene({
  fragment: resolveIncludes(view, CHUNKS),
  cached: { fragment: resolveIncludes(terrain, CHUNKS) },
  maxPixelRatio: 1.25,
  setUniforms(u, world) {
    const { palette } = world;
    u.float("u_sun_altitude", world.sunAltitude);
    u.float("u_sun_x", world.sunX);
    u.float("u_sun_visibility", palette.sunVisibility);
    u.color("u_sun_color", palette.sun);
    u.color("u_sky_top", palette.skyTop);
    u.color("u_sky_horizon", palette.skyHorizon);
    u.color("u_deck_color", palette.cloudDeck);
    u.color("u_fog_color", palette.fog);
    u.float("u_daylight", world.daylight);
    u.float("u_stars", palette.starsVisibility);
    u.float("u_cloud_cover", world.cloudCover);
    u.float("u_cloud_deck", palette.cloudDeckOpacity);
    u.float("u_fog", world.fogDensity);
    u.float("u_rain", world.rainIntensity);
    u.float("u_snow", world.snowIntensity);
    u.float("u_wind_strength", world.windStrength);
    u.float("u_wind_drift", world.windDrift);
    u.float("u_temperature", world.temperature ?? UNKNOWN_TEMPERATURE);
  },
});
