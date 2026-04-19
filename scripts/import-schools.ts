/**
 * Import US public schools (NCES EDGE_GEOCODE_PUBLICSCH_2425) into the
 * `schools` table.
 *
 * Source file: EDGE_GEOCODE_PUBLICSCH_2425/EDGE_GEOCODE_PUBLICSCH_2425.TXT
 * (pipe-delimited, no header). Columns of interest:
 *   col 0  = NCES school ID
 *   col 2  = school name
 *   col 13 = latitude
 *   col 14 = longitude
 *
 * Usage:
 *   bun run scripts/import-schools.ts EDGE_GEOCODE_PUBLICSCH_2425/EDGE_GEOCODE_PUBLICSCH_2425.TXT
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const path = process.argv[2];
if (!path) {
  console.error("Usage: bun run scripts/import-schools.ts <path-to-TXT>");
  process.exit(1);
}

const supabase = createClient(url, key);

const BATCH = 1000;
let buffer: Array<Record<string, unknown>> = [];
let inserted = 0;

async function flush() {
  if (buffer.length === 0) return;
  const chunk = buffer;
  buffer = [];
  const { error } = await supabase.from("schools").insert(chunk);
  if (error) {
    console.error(`\nBatch failed at ~${inserted}:`, error.message);
    process.exit(1);
  }
  inserted += chunk.length;
  process.stdout.write(`  inserted ${inserted}\r`);
}

const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });

for await (const line of rl) {
  if (!line.trim()) continue;
  const cols = line.split("|");
  if (cols.length < 15) continue;
  const name = cols[2]?.trim();
  const lat = Number(cols[13]);
  const lon = Number(cols[14]);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  buffer.push({
    name,
    geom: `SRID=4326;POINT(${lon} ${lat})`,
  });
  if (buffer.length >= BATCH) await flush();
}
await flush();
console.log(`\nDone. Inserted ${inserted} schools.`);
