// @ts-nocheck
import { isOfferedFor, parseCallType, parseClassification, CLASSIFICATIONS } from "../../src/lib/service-techs.ts";
import { createSessionValue, verifySessionValue, passwordMatches, SESSION_HOURS } from "../../src/lib/admin-session.ts";
let passes = 0, failures = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) passes++; else { failures++; console.log(`FAIL ${n}${d ? "  <- " + d : ""}`); } };

// ---- who is offered for which call
const matrix: [string | null | undefined, boolean, boolean][] = [
  ["residential", true, false], ["commercial", false, true], ["hybrid", true, true],
  [null, false, false], [undefined, false, false], ["", false, false], ["Residential", false, false], ["both", false, false],
];
for (const [c, res, com] of matrix) {
  check(`classification ${JSON.stringify(c)}: residential call -> ${res}`, isOfferedFor(c, "residential") === res);
  check(`classification ${JSON.stringify(c)}: commercial call -> ${com}`, isOfferedFor(c, "commercial") === com);
}
check("the three classifications are exactly R, C, H", JSON.stringify(CLASSIFICATIONS) === JSON.stringify(["residential", "commercial", "hybrid"]));
check("parseCallType accepts only exact values", parseCallType("residential") === "residential" && parseCallType("commercial") === "commercial" && [parseCallType("hybrid"), parseCallType("Residential"), parseCallType(""), parseCallType(null)].every((x) => x === null));
check("parseClassification accepts only exact values", ["residential", "commercial", "hybrid"].every((v) => parseClassification(v) === v) && [parseClassification("Hybrid"), parseClassification(""), parseClassification(null), parseClassification(7), parseClassification({})].every((x) => x === null));

// ---- admin session cookie
const PW = "correct horse battery staple", NOW = 1_800_000_000_000;
const v = createSessionValue(PW, NOW);
check("fresh session verifies", verifySessionValue(v, PW, NOW + 1000));
check("session lasts 12 hours", SESSION_HOURS === 12 && verifySessionValue(v, PW, NOW + 11.9 * 3600_000));
check("session expires after 12 hours", !verifySessionValue(v, PW, NOW + 12 * 3600_000 + 1));
check("REJECT: wrong password", !verifySessionValue(v, "another password", NOW + 1000));
check("REJECT: password changed (signs everyone out)", !verifySessionValue(v, PW + "!", NOW + 1000));
const [exp, sig] = v.split(".");
check("REJECT: expiry extended by hand", !verifySessionValue(`${Number(exp) + 999_999_999}.${sig}`, PW, NOW + 1000));
check("REJECT: signature altered", !verifySessionValue(`${exp}.${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`, PW, NOW + 1000));
check("REJECT: signature truncated", !verifySessionValue(`${exp}.${sig.slice(0, 20)}`, PW, NOW + 1000));
check("REJECT: empty / missing / junk", ["", null, undefined, "abc", ".", ".abc", "123.", "notanumber.abc"].every((x) => !verifySessionValue(x as string, PW, NOW)));
check("REJECT: empty server password never validates anything", !verifySessionValue(v, "", NOW + 1000) && !verifySessionValue(createSessionValue("", NOW), "", NOW + 1000));
check("a cookie made with no password can't pass with a real one", !verifySessionValue(createSessionValue("", NOW), PW, NOW + 1000));
check("two sessions at different times differ", createSessionValue(PW, NOW) !== createSessionValue(PW, NOW + 5000));
check("cookie value has no characters that break cookies", /^[0-9]+\.[0-9a-f]+$/.test(v), v);

// ---- password check
check("right password matches", passwordMatches(PW, PW));
check("wrong password rejected", !passwordMatches("nope", PW) && !passwordMatches(PW + " ", PW) && !passwordMatches(PW.toUpperCase(), PW));
check("empty never matches (even against empty)", !passwordMatches("", "") && !passwordMatches("x", ""));
check("very long guess handled without error", !passwordMatches("x".repeat(100_000), PW));
check("different-length guesses are fine", !passwordMatches("a", PW) && !passwordMatches(PW + PW, PW));

console.log(`\n${passes} passed, ${failures} failed`); process.exit(failures ? 1 : 0);
