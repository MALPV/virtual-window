import {
  dayPhaseOf,
  mixRgb,
  temperatureBandOf,
  windDirectionOf,
  windLevelOf,
  type Precipitation,
  type WorldPalette,
  type WorldState,
} from "./world";

const PRECIPITATION_EPSILON = 0.001;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function blendPalette(from: WorldPalette, to: WorldPalette, t: number): WorldPalette {
  return {
    skyTop: mixRgb(from.skyTop, to.skyTop, t),
    skyMiddle: mixRgb(from.skyMiddle, to.skyMiddle, t),
    skyHorizon: mixRgb(from.skyHorizon, to.skyHorizon, t),
    skyBottom: mixRgb(from.skyBottom, to.skyBottom, t),
    sun: mixRgb(from.sun, to.sun, t),
    cloud: mixRgb(from.cloud, to.cloud, t),
    cloudDeck: mixRgb(from.cloudDeck, to.cloudDeck, t),
    fog: mixRgb(from.fog, to.fog, t),
    sunVisibility: lerp(from.sunVisibility, to.sunVisibility, t),
    starsVisibility: lerp(from.starsVisibility, to.starsVisibility, t),
    cloudDeckOpacity: lerp(from.cloudDeckOpacity, to.cloudDeckOpacity, t),
    landBrightness: lerp(from.landBrightness, to.landBrightness, t),
    landSaturation: lerp(from.landSaturation, to.landSaturation, t),
    frost: lerp(from.frost, to.frost, t),
  };
}

// La precipitacion visible es la que todavia tiene intensidad: asi la lluvia se desvanece en vez de cortarse.
function precipitationOf(rain: number, snow: number): Precipitation {
  if (rain <= PRECIPITATION_EPSILON && snow <= PRECIPITATION_EPSILON) return "none";
  return rain >= snow ? "rain" : "snow";
}

/**
 * Interpolates two worlds. `t` goes from 0 (from) to 1 (to). Continuous values are mixed;
 * discrete values are derived again from the mixed ones so they change gradually too.
 */
export function blendWorld(from: WorldState, to: WorldState, t: number): WorldState {
  if (t <= 0) return from;
  if (t >= 1) return to;

  const sunAltitude = lerp(from.sunAltitude, to.sunAltitude, t);
  const rainIntensity = lerp(from.rainIntensity, to.rainIntensity, t);
  const snowIntensity = lerp(from.snowIntensity, to.snowIntensity, t);
  const windDrift = lerp(from.windDrift, to.windDrift, t);
  const windStrength = lerp(from.windStrength, to.windStrength, t);
  const temperature =
    from.temperature !== null && to.temperature !== null ? lerp(from.temperature, to.temperature, t) : to.temperature;
  const halfway = t >= 0.5;

  return {
    sunAltitude,
    sunX: lerp(from.sunX, to.sunX, t),
    daylight: lerp(from.daylight, to.daylight, t),
    dayPhase: dayPhaseOf(sunAltitude),
    condition: halfway ? to.condition : from.condition,
    cloudCover: lerp(from.cloudCover, to.cloudCover, t),
    precipitation: precipitationOf(rainIntensity, snowIntensity),
    rainIntensity,
    snowIntensity,
    fogDensity: lerp(from.fogDensity, to.fogDensity, t),
    storm: halfway ? to.storm : from.storm,
    windDrift,
    windStrength,
    windLevel: windLevelOf(windStrength),
    windDirection: windDirectionOf(windDrift),
    temperature,
    temperatureBand: temperatureBandOf(temperature),
    weatherKnown: to.weatherKnown,
    locationKnown: to.locationKnown,
    palette: blendPalette(from.palette, to.palette, t),
  };
}

/** Ease-in-out curve so changes start and settle softly. */
export function easeInOut(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}
