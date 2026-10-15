import { shaderScene } from "../api";
import boatMarkup from "./boat.html?raw";
import fragment from "./sea.frag?raw";
import "./scene.css";

export default shaderScene({
  fragment,
  maxPixelRatio: 1.25,
  overlay: boatMarkup,
  setUniforms(u, world) {
    const { palette } = world;
    u.color("u_sky_top", palette.skyTop);
    u.color("u_sky_middle", palette.skyMiddle);
    u.color("u_sky_horizon", palette.skyHorizon);
    u.color("u_sun_color", palette.sun);
    u.color("u_deck_color", palette.cloudDeck);
    u.float("u_sun_x", world.sunX);
    u.float("u_sun_altitude", world.sunAltitude);
    u.float("u_sun_visibility", palette.sunVisibility);
    u.float("u_stars", palette.starsVisibility);
    u.float("u_cloud_deck", palette.cloudDeckOpacity);
    u.color("u_fog_color", palette.fog);
    u.float("u_daylight", world.daylight);
    u.float("u_cloud_cover", world.cloudCover);
    u.float("u_fog", world.fogDensity);
    u.float("u_wind", world.windStrength);
    u.float("u_wind_drift", world.windDrift);
    u.float("u_rain", world.rainIntensity);
  },
});
