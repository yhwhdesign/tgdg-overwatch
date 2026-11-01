// How near are two places? Used to find openings that keep a technician on his route
// instead of driving across town.
//
// A "place" is a job or a customer: its exact map point (latitude/longitude) when we have one,
// and its zip code. With exact points on both sides we measure point to point; otherwise we fall
// back to the center of each zip code (the original zip-only behavior).
//
// This is an ESTIMATE, not directions: straight-line distance, stretched for winding roads and
// converted to minutes at a typical city speed. Free, instant, needs no API key, and good enough
// to tell "on his way" from "other side of town".

export type Centroids = Record<string, readonly [number, number]>;

/** Two places count as "nearby" when the estimated drive is this many minutes or less. */
export const NEAR_DRIVE_MINUTES = 10;
/** Roads are longer than a straight line; real distance is roughly this much more. */
const ROAD_FACTOR = 1.4;
/** Typical average speed on local roads, in miles per hour. */
const AVERAGE_MPH = 30;

/** A job or a customer. Any part may be missing; the more we know, the better the estimate. */
export interface Place {
  zip?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/** First five digits of a zip (so "72201-1234" works), or null if it isn't one. */
export function normalizeZip(value: string | null | undefined): string | null {
  const match = /^\s*(\d{5})/.exec(value ?? "");
  return match ? match[1] : null;
}

/** A usable map point, or null. Rejects missing values, junk, and the 0,0 "unknown" placeholder. */
export function validPoint(lat: unknown, lng: unknown): readonly [number, number] | null {
  const a = typeof lat === "string" ? Number(lat) : lat;
  const b = typeof lng === "string" ? Number(lng) : lng;
  if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180 || (a === 0 && b === 0)) return null;
  return [a, b];
}

export function haversineMiles(a: readonly [number, number], b: readonly [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMiles * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function estimateDriveMinutes(straightLineMiles: number): number {
  return Math.round(((straightLineMiles * ROAD_FACTOR) / AVERAGE_MPH) * 60);
}

export interface Proximity {
  sameZip: boolean;
  /** An estimated drive within NEAR_DRIVE_MINUTES. */
  near: boolean;
  /** Estimated drive in minutes; null when we can't place one of the two. */
  minutes: number | null;
}

/** How far apart two places are (order doesn't matter). */
export type ZipProximity = (a: Place | string | null | undefined, b: Place | string | null | undefined) => Proximity;

function asPlace(value: Place | string | null | undefined): Place {
  if (value == null) return {};
  return typeof value === "string" ? { zip: value } : value;
}

export function makeProximity(table: Centroids): ZipProximity {
  return (left, right) => {
    const a = asPlace(left);
    const b = asPlace(right);
    const zipA = normalizeZip(a.zip);
    const zipB = normalizeZip(b.zip);
    const sameZip = !!zipA && zipA === zipB;
    const exactA = validPoint(a.lat, a.lng);
    const exactB = validPoint(b.lat, b.lng);

    // Best case: two real map points.
    if (exactA && exactB) {
      const minutes = estimateDriveMinutes(haversineMiles(exactA, exactB));
      return { sameZip, near: minutes <= NEAR_DRIVE_MINUTES, minutes };
    }
    // Zip only on at least one side: same zip counts as "right there" (the original rule).
    if (sameZip) return { sameZip: true, near: true, minutes: 0 };
    const pa = exactA ?? (zipA ? table[zipA] : undefined);
    const pb = exactB ?? (zipB ? table[zipB] : undefined);
    if (!pa || !pb) return { sameZip: false, near: false, minutes: null };
    const minutes = estimateDriveMinutes(haversineMiles(pa, pb));
    return { sameZip: false, near: minutes <= NEAR_DRIVE_MINUTES, minutes };
  };
}
