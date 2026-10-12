// How near are two zip codes? Used to find openings that sit next to calls in the same
// or a nearby zip, so technicians stack jobs instead of driving across town.
//
// This is an ESTIMATE, not directions: straight-line distance between the centers of two
// zip codes, stretched for winding roads and converted to minutes at a typical city speed.
// Free, instant, and good enough to tell "same neighborhood" from "other side of town".

export type Centroids = Record<string, readonly [number, number]>;

/** Two different zip codes count as "nearby" when the estimated drive is this many minutes or less. */
export const NEAR_DRIVE_MINUTES = 10;
/** Roads are longer than a straight line; real distance is roughly this much more. */
const ROAD_FACTOR = 1.4;
/** Typical average speed on local roads, in miles per hour. */
const AVERAGE_MPH = 30;

/** First five digits of a zip (so "72201-1234" works), or null if it isn't one. */
export function normalizeZip(value: string | null | undefined): string | null {
  const match = /^\s*(\d{5})/.exec(value ?? "");
  return match ? match[1] : null;
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
  /** Same zip, or an estimated drive within NEAR_DRIVE_MINUTES. */
  near: boolean;
  /** Estimated drive in minutes; 0 for the same zip; null when either zip isn't in the table. */
  minutes: number | null;
}

/** How a customer's zip relates to some other call's zip. */
export type ZipProximity = (customerZip: string, otherZip: string | null | undefined) => Proximity;

export function makeProximity(table: Centroids): ZipProximity {
  return (customerZip, otherZip) => {
    const a = normalizeZip(customerZip);
    const b = normalizeZip(otherZip);
    if (!a || !b) return { sameZip: false, near: false, minutes: null };
    if (a === b) return { sameZip: true, near: true, minutes: 0 };
    const pa = table[a];
    const pb = table[b];
    if (!pa || !pb) return { sameZip: false, near: false, minutes: null };
    const minutes = estimateDriveMinutes(haversineMiles(pa, pb));
    return { sameZip: false, near: minutes <= NEAR_DRIVE_MINUTES, minutes };
  };
}
