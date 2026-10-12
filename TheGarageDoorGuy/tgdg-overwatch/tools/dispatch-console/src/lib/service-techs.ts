// Who the console offers for which kind of call. Pure and dependency-free so it
// can be tested on its own. Each technician's classification is set on the Admin
// screen (/admin) and stored on the Technician row.

/** The kind of call the dispatcher is handling. */
export type CallType = "residential" | "commercial";

/** How a technician is classified. "hybrid" works both kinds of call. */
export type Classification = "residential" | "commercial" | "hybrid";

export const CLASSIFICATIONS: readonly Classification[] = ["residential", "commercial", "hybrid"];

export function parseCallType(value: string | null | undefined): CallType | null {
  return value === "residential" || value === "commercial" ? value : null;
}

/** Accepts only the exact stored values; anything else (including empty) is "not classified". */
export function parseClassification(value: unknown): Classification | null {
  return value === "residential" || value === "commercial" || value === "hybrid" ? value : null;
}

/**
 * Is a technician with this classification offered for this kind of call?
 * - residential: residential calls only
 * - commercial:  commercial calls only
 * - hybrid:      both
 * - not classified (null/anything else): never offered
 */
export function isOfferedFor(classification: string | null | undefined, type: CallType): boolean {
  const c = parseClassification(classification);
  return c === "hybrid" || c === type;
}
