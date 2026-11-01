// Turns the address a dispatcher types into a map point, so the console can measure how far the
// customer is from each technician's jobs.
//
// Uses the U.S. Census Bureau geocoder: free, no account, no API key, no daily cap we will ever hit.
// https://geocoding.geo.census.gov/geocoder/  (the "onelineaddress" lookup)
//
// What is sent: only the address text the dispatcher typed. Nothing about the customer is stored;
// a short in-memory cache just saves repeat lookups while the server is warm.
//
// If the Census can't match the street address but the text contains a 5-digit zip, we fall back
// to that zip (precision "zip") so the dispatcher is never stuck; the screen says so.

export interface GeocodedPlace {
  /** The address as the Census matched it (or "Zip 72201" for a zip-only fallback). */
  label: string;
  lat: number | null;
  lng: number | null;
  zip: string | null;
  /** "address" = matched the street address; "zip" = only the zip code was usable. */
  precision: "address" | "zip";
}

export type GeocodeResult =
  | { ok: true; place: GeocodedPlace }
  | { ok: false; reason: "empty" | "not-found" | "unavailable"; message: string };

/** The fetch we use; swapped for a fake in tests. */
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const TIMEOUT_MS = 8000;
const CACHE_LIMIT = 500;
const cache = new Map<string, GeocodedPlace>();

function zipIn(text: string): string | null {
  const m = /\b(\d{5})(?:-\d{4})?\b\s*$/.exec(text.trim()) ?? /\b(\d{5})(?:-\d{4})?\b/.exec(text);
  return m ? m[1] : null;
}

/** Only digits: the dispatcher typed just a zip code. */
function isBareZip(text: string): boolean {
  return /^\s*\d{5}(-\d{4})?\s*$/.test(text);
}

/** Reads the Census answer defensively; returns the first match or null. */
export function parseCensus(body: unknown): GeocodedPlace | null {
  const matches = (body as { result?: { addressMatches?: unknown[] } })?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length === 0) return null;
  const m = matches[0] as {
    matchedAddress?: string;
    coordinates?: { x?: number; y?: number };
    addressComponents?: { zip?: string };
  };
  const lng = Number(m.coordinates?.x);
  const lat = Number(m.coordinates?.y);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const zip = /^(\d{5})/.exec(m.addressComponents?.zip ?? "")?.[1] ?? zipIn(m.matchedAddress ?? "");
  return { label: m.matchedAddress ?? "", lat, lng, zip, precision: "address" };
}

function zipOnly(zip: string): GeocodedPlace {
  return { label: `Zip ${zip}`, lat: null, lng: null, zip, precision: "zip" };
}

export async function geocodeAddress(raw: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<GeocodeResult> {
  const text = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!text) return { ok: false, reason: "empty", message: "Type the customer's address." };

  // Just a zip: no lookup needed, works exactly like before.
  if (isBareZip(text)) return { ok: true, place: zipOnly(text.slice(0, 5)) };

  const key = text.toLowerCase();
  const cached = cache.get(key);
  if (cached) return { ok: true, place: cached };

  const url = `${CENSUS_URL}?address=${encodeURIComponent(text)}&benchmark=Public_AR_Current&format=json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let place: GeocodedPlace | null = null;
  let unavailable = false;
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (res.ok) place = parseCensus(await res.json());
    else unavailable = true;
  } catch {
    unavailable = true;
  } finally {
    clearTimeout(timer);
  }

  if (place) {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    cache.set(key, place);
    return { ok: true, place };
  }

  // Couldn't place the street address: fall back to the zip in it, if there is one.
  const zip = zipIn(text);
  if (zip) return { ok: true, place: zipOnly(zip) };
  return unavailable
    ? { ok: false, reason: "unavailable", message: "The address lookup isn't answering right now. Add the zip code to the address and try again." }
    : { ok: false, reason: "not-found", message: "Couldn't find that address. Check the spelling, or add the city and zip code." };
}

/** Tests only. */
export function clearGeocodeCache() {
  cache.clear();
}
