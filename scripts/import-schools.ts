/**
 * Import US public schools (NCES EDGE_GEOCODE_PUBLICSCH_2425) into the
 * `schools` table.
 *
 * Source file: either the pipe-delimited .TXT or the .xlsx export from
 *   https://nces.ed.gov/programs/edge/Geographic/SchoolLocations
 *
 * Columns used:
 *   .TXT  →  col 0 = NCES ID, col 2 = NAME, col 13 = LAT, col 14 = LON
 *   .xlsx →  header row (NAME, LAT, LON columns located by name)
 *
 * Usage:
 *   npx tsx scripts/import-schools.ts data/EDGE_GEOCODE_PUBLICSCH_2425.TXT
 *   npx tsx scripts/import-schools.ts data/EDGE_GEOCODE_PUBLICSCH_2425.xlsx
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env (see .env.example).
 */
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (see .env.example)");
  process.exit(1);
}

const path = process.argv[2];
if (!path) {
  console.error("Usage: npx tsx scripts/import-schools.ts <path-to-TXT-or-XLSX>");
  process.exit(1);
}

const supabase = createClient(url, key);

const BATCH = 1000;
let buffer: Array<{ name: string; geom: string }> = [];
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

function push(name: string, lat: number, lon: number) {
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
  buffer.push({ name, geom: `SRID=4326;POINT(${lon} ${lat})` });
}

async function importTxt() {
  const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const cols = line.split("|");
    if (cols.length < 15) continue;
    push(cols[2]?.trim() ?? "", Number(cols[13]), Number(cols[14]));
    if (buffer.length >= BATCH) await flush();
  }
}

async function importXlsx() {
  // Lazy-load to keep TXT users from needing the dep.
  // npm i -D xlsx
  const XLSX = await import("xlsx");
  const wb = XLSX.read(readFileSync(path));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
  for (const r of rows) {
    push(String(r.NAME ?? ""), Number(r.LAT), Number(r.LON));
    if (buffer.length >= BATCH) await flush();
  }
}

const lower = path.toLowerCase();
if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
  await importXlsx();
} else {
  await importTxt();
}
await flush();
console.log(`\nDone. Inserted ${inserted} schools.`);
