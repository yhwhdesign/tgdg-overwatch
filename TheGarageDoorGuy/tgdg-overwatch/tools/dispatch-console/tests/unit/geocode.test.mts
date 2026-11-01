// The address lookup, against a fake Census geocoder (no network).
import { geocodeAddress, parseCensus, clearGeocodeCache, type FetchLike } from "../../src/lib/geocode.ts";

let passes = 0, failures = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passes++; else { failures++; console.log(`FAIL ${name}  <- got ${JSON.stringify(got)} expected ${JSON.stringify(want)}`); }
};

const MATCH = { result: { addressMatches: [{ matchedAddress: "500 PRESIDENT CLINTON AVE, LITTLE ROCK, AR, 72201", coordinates: { x: -92.2596, y: 34.7466 }, addressComponents: { zip: "72201" } }] } };
const NONE = { result: { addressMatches: [] } };
let calls: string[] = [];
const fake = (body: unknown, ok = true, status = 200): FetchLike => async (url) => { calls.push(url); return { ok, status, json: async () => body }; };
const broken: FetchLike = async () => { throw new Error("network down"); };

(async () => {
  eq("parses a Census match", parseCensus(MATCH), { label: "500 PRESIDENT CLINTON AVE, LITTLE ROCK, AR, 72201", lat: 34.7466, lng: -92.2596, zip: "72201", precision: "address" });
  eq("no match -> null", parseCensus(NONE), null);
  eq("junk -> null", [parseCensus(null), parseCensus({}), parseCensus({ result: { addressMatches: [{ coordinates: {} }] } })], [null, null, null]);

  clearGeocodeCache(); calls = [];
  const r1 = await geocodeAddress("500 President Clinton Ave, Little Rock, AR", fake(MATCH));
  eq("address -> exact point", r1.ok && [r1.place.lat, r1.place.lng, r1.place.zip, r1.place.precision], [34.7466, -92.2596, "72201", "address"]);
  eq("asks the Census once, with the address and JSON format", [calls.length, calls[0].includes("onelineaddress"), calls[0].includes("500%20President"), calls[0].includes("format=json")], [1, true, true, true]);
  await geocodeAddress("500  president clinton ave,  little rock, ar", fake(MATCH));
  eq("same address again (any case/spacing) comes from the cache", calls.length, 1);

  calls = [];
  const z = await geocodeAddress("72201", fake(MATCH));
  eq("a bare zip works like before and skips the lookup", [z.ok && z.place.precision, z.ok && z.place.zip, z.ok && z.place.lat, calls.length], ["zip", "72201", null, 0]);

  const fb = await geocodeAddress("1 Nowhere Lane, Conway AR 72034", fake(NONE));
  eq("no street match but a zip in the text -> zip fallback", fb.ok && [fb.place.precision, fb.place.zip], ["zip", "72034"]);
  const nf = await geocodeAddress("1 Nowhere Lane", fake(NONE));
  eq("no match and no zip -> not-found with a helpful message", !nf.ok && nf.reason, "not-found");
  const down = await geocodeAddress("2 Main St", broken);
  eq("lookup down and no zip -> unavailable", !down.ok && down.reason, "unavailable");
  const downZip = await geocodeAddress("2 Main St, Benton AR 72015", broken);
  eq("lookup down but a zip in the text -> zip fallback, never stuck", downZip.ok && downZip.place.zip, "72015");
  const http = await geocodeAddress("3 Main St", fake({}, false, 500));
  eq("Census error status -> unavailable", !http.ok && http.reason, "unavailable");
  eq("empty input", [(await geocodeAddress("   ")).ok, (await geocodeAddress("")).ok], [false, false]);

  console.log(`${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
