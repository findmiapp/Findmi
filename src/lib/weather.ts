// Server-only weather + local-timezone lookup for the Homepage's compact
// Weather / Local Context module. Provider: Open-Meteo
// (https://open-meteo.com) — chosen because it needs NO API key (its
// geocoding + forecast endpoints are free and public), which sidesteps
// every secret-management concern this feature would otherwise carry
// (nothing to read from env, nothing that can leak client-side, nothing
// that "fails" from a missing key). It also returns an IANA timezone
// alongside each geocoded city, which is exactly the "smallest reliable
// approach available from the chosen provider" the task asked for
// instead of building a separate timezone system.
//
// Both calls are cached via Next.js's fetch cache (see the `next.revalidate`
// on each) rather than hit on every homepage render — see callers.

export type WeatherCondition = "clear" | "cloudy" | "fog" | "rain" | "snow" | "storm";

interface GeoResult {
  lat: number;
  lon: number;
  /** Human-readable label for display, e.g. "Staten Island, New York". */
  label: string;
  /** IANA timezone, e.g. "America/New_York" — included directly in
   * Open-Meteo's geocoding response, so no separate timezone lookup. */
  timeZone: string;
}

interface CurrentConditions {
  tempF: number;
  condition: WeatherCondition;
}

export interface WeatherContextData {
  cityLabel: string;
  timeZone: string;
  /** null when the current-conditions call failed but geocoding (city +
   * timezone) succeeded — the module still renders location/date/time,
   * just without the temperature/icon (Section 5's fail-soft rule). */
  conditions: CurrentConditions | null;
}

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

async function geocodeCity(city: string): Promise<GeoResult | null> {
  try {
    const res = await fetch(
      `${GEOCODE_URL}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
      // A city name's coordinates/timezone effectively never change —
      // cache a full day rather than re-resolving it every revalidation.
      { next: { revalidate: 60 * 60 * 24 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const hit = data?.results?.[0];
    if (!hit || typeof hit.latitude !== "number" || typeof hit.longitude !== "number" || typeof hit.timezone !== "string") {
      return null;
    }
    const label = [hit.name, hit.admin1 || hit.country].filter(Boolean).join(", ");
    return { lat: hit.latitude, lon: hit.longitude, label: label || city, timeZone: hit.timezone };
  } catch {
    return null;
  }
}

function mapWeatherCode(code: number): WeatherCondition {
  if (code === 0) return "clear";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if (code >= 71 && code <= 86) return "snow";
  if (code >= 95) return "storm";
  return "cloudy"; // 1–3 (partly cloudy/overcast) and any unmapped code
}

async function fetchCurrentConditions(lat: number, lon: number): Promise<CurrentConditions | null> {
  try {
    const res = await fetch(
      `${FORECAST_URL}?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`,
      // 20 minutes — inside the task's requested 15–30 minute window.
      { next: { revalidate: 60 * 20 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const tempF = data?.current?.temperature_2m;
    const code = data?.current?.weather_code;
    if (typeof tempF !== "number" || typeof code !== "number") return null;
    return { tempF: Math.round(tempF), condition: mapWeatherCode(code) };
  } catch {
    return null;
  }
}

/** Resolves a founder-entered city string into display label + timezone +
 * (best-effort) current conditions. Returns null only when the city
 * itself couldn't be geocoded at all — the component that calls this
 * treats null as "render nothing" and a non-null result with
 * `conditions: null` as "render location/date/time, skip the weather
 * chip", matching Section 5 exactly. */
export async function getWeatherContext(city: string): Promise<WeatherContextData | null> {
  const trimmed = city.trim();
  if (!trimmed) return null;
  const geo = await geocodeCity(trimmed);
  if (!geo) return null;
  const conditions = await fetchCurrentConditions(geo.lat, geo.lon);
  return { cityLabel: geo.label, timeZone: geo.timeZone, conditions };
}
