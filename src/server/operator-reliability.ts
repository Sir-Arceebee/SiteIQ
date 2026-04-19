/**
 * Operator reliability lookup with fuzzy matching.
 *
 * The PHMSA dataset uses canonical operator names (e.g.
 * "ATMOS ENERGY CORPORATION - MID-TEX") while the pipelines GIS layer often
 * has shorter or differently-cased variants ("Atmos Energy"). We normalize
 * both sides and accept partial token-overlap matches.
 */
import { OPERATOR_RELIABILITY_DATA } from "./operator-reliability-data";

export type OperatorMatch = {
  operator: string | null;
  matched_name: string | null;
  score: number | null;
};

const STOPWORDS = new Set([
  "the", "of", "co", "company", "corp", "corporation", "inc", "llc", "ltd",
  "lp", "lc", "city", "town", "dept", "department", "system", "systems",
  "utility", "utilities", "gas", "natural", "energy", "pipeline", "pipelines",
  "service", "services", "and", "a", "div", "division", "operating",
]);

function normalize(s: string): string {
  return s.toLowerCase().replace(/[.,()&]/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(s: string): Set<string> {
  return new Set(
    normalize(s).split(" ").filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

const INDEX = OPERATOR_RELIABILITY_DATA.map((row) => ({
  name: row.name,
  score: row.score,
  norm: normalize(row.name),
  toks: tokens(row.name),
}));

export function lookupOperatorReliability(operator: string | null | undefined): OperatorMatch {
  if (!operator) return { operator: null, matched_name: null, score: null };
  const norm = normalize(operator);
  if (!norm) return { operator, matched_name: null, score: null };

  for (const row of INDEX) if (row.norm === norm) {
    return { operator, matched_name: row.name, score: row.score };
  }
  for (const row of INDEX) {
    if (row.norm.includes(norm) || norm.includes(row.norm)) {
      return { operator, matched_name: row.name, score: row.score };
    }
  }
  const queryToks = tokens(operator);
  if (queryToks.size === 0) return { operator, matched_name: null, score: null };
  let best: { score: number; row: typeof INDEX[number] } | null = null;
  for (const row of INDEX) {
    let inter = 0;
    for (const t of queryToks) if (row.toks.has(t)) inter++;
    if (inter < 2) continue;
    const union = queryToks.size + row.toks.size - inter;
    const sim = inter / union;
    if (sim >= 0.5 && (!best || sim > best.score)) best = { score: sim, row };
  }
  if (best) return { operator, matched_name: best.row.name, score: best.row.score };
  return { operator, matched_name: null, score: null };
}