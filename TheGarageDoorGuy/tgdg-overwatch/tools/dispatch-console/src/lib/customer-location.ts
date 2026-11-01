import type { FitOptions } from "./availability";
import type { ZipProximity } from "./zip-distance";

// Reads the customer's location from a console request: `lat` + `lng` (from the address lookup)
// and/or `zip`. At least one is needed. Kept in one place so every route checks it the same way.

export type CustomerLocation =
  | { ok: true; zip: string | null; point: { lat: number; lng: number } | null }
  | { ok: false; error: string };

export function readCustomerLocation(params: URLSearchParams, required: boolean): CustomerLocation {
  const zip = params.get("zip");
  if (zip !== null && zip !== "" && !/^\d{5}$/.test(zip)) return { ok: false, error: "zip must be a 5-digit zip code" };
  const latText = params.get("lat");
  const lngText = params.get("lng");
  let point: { lat: number; lng: number } | null = null;
  if (latText !== null || lngText !== null) {
    const lat = Number(latText);
    const lng = Number(lngText);
    if (latText === null || lngText === null || latText === "" || lngText === "" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return { ok: false, error: "lat and lng must both be valid coordinates" };
    }
    point = { lat, lng };
  }
  const cleanZip = zip ? zip : null;
  if (required && !cleanZip && !point) return { ok: false, error: "Enter the customer's address (or at least a 5-digit zip code)." };
  return { ok: true, zip: cleanZip, point };
}

export function fitFor(loc: { zip: string | null; point: { lat: number; lng: number } | null }, proximity: ZipProximity): FitOptions | undefined {
  if (!loc.zip && !loc.point) return undefined;
  return { customerZip: loc.zip, customerPoint: loc.point, proximity };
}
