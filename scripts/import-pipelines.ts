/**
 * Import the real ArcGIS "Natural Gas Interstate and Intrastate Pipelines"
 * GeoJSON dataset into the `pipelines` table.
 *
 * Usage:
 *   1. Download the GeoJSON from
 *      https://hub.arcgis.com/datasets/fedmaps::natural-gas-interstate-and-intrastate-pipelines/about
 *      and save it as ./data/pipelines.geojson  (gitignore this folder)
 *   2. Make sure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are in your env
 *      (they are auto-injected on Lovable Cloud builds; locally you can copy
 *      them from your Cloud project's Settings → API).
 *   3. Run:  bun run scripts/import-pipelines.ts ./data/pipelines.geojson
 *
 * The script streams features in batches of 500 so it can handle the full
 * dataset (~hundreds of thousands of segments).
 *
 * NOTE: column names below assume the official ArcGIS schema. Adjust the
 * `mapFeature` function if your file's properties are named differently.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

type Feature = {
  type: "Feature";
  geometry: { type: "LineString" | "MultiLineString"; coordinates: number[][] | number[][][] };
  properties: Record<string, unknown>;
};

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}

const path = process.argv[2];
if (!path) {
  console.error("Usage: bun run scripts/import-pipelines.ts <path-to-geojson>");
  process.exit(1);
}

const supabase = createClient(url, key);

function toWkt(geom: Feature["geometry"]): string[] {
  // Returns one WKT string per LineString (MultiLineString -> multiple rows).
  if (geom.type === "LineString") {
    const coords = geom.coordinates as number[][];
    return [`LINESTRING(${coords.map((c) => `${c[0]} ${c[1]}`).join(", ")})`];
  }
  const multi = geom.coordinates as number[][][];
  return multi.map((line) => `LINESTRING(${line.map((c) => `${c[0]} ${c[1]}`).join(", ")})`);
}

function mapFeature(f: Feature) {
  const p = f.properties;
  // Adjust these keys to match the actual ArcGIS field names.
  const name = (p.PipelineName ?? p.NAME ?? p.Name ?? null) as string | null;
  const operator = (p.Operator ?? p.OPERATOR ?? null) as string | null;
  const rawType = String(p.Type ?? p.TYPE ?? "").toLowerCase();
  const pipe_type = rawType.includes("inter") ? "interstate" : rawType.includes("intra") ? "intrastate" : null;
  const material = (p.Material ?? p.MATERIAL ?? null) as string | null;
  const vintage_year = Number(p.YearInstalled ?? p.YEAR ?? 0) || null;
  const diameter_in = Number(p.Diameter ?? p.DIAMETER ?? 0) || null;
  return { name, operator, pipe_type, material, vintage_year, diameter_in };
}

const raw = readFileSync(path, "utf8");
const fc = JSON.parse(raw) as { features: Feature[] };

const rows: Array<Record<string, unknown>> = [];
for (const f of fc.features) {
  if (!f.geometry) continue;
  const meta = mapFeature(f);
  for (const wkt of toWkt(f.geometry)) {
    rows.push({ ...meta, geom: `SRID=4326;${wkt}` });
  }
}

console.log(`Prepared ${rows.length} pipeline rows. Inserting in batches…`);

const BATCH = 500;
for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  const { error } = await supabase.from("pipelines").insert(chunk);
  if (error) {
    console.error(`Batch ${i}-${i + chunk.length} failed:`, error.message);
    process.exit(1);
  }
  process.stdout.write(`  inserted ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`);
}
console.log("\nDone.");
