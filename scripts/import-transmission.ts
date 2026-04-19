/**
 * Download HIFLD US Electric Power Transmission Lines and import into
 * `transmission_lines`.
 *
 * Cached at ./data/transmission.geojson (gitignored).
 *
 * Usage:
 *   bun run scripts/import-transmission.ts
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.
 */
import { existsSync, mkdirSync, createWriteStream, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// HIFLD ArcGIS open-data FeatureServer for "Electric Power Transmission Lines"
// Returns full dataset as GeoJSON.
const HIFLD_URL =
  "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0/query?where=1%3D1&outFields=OWNER,VOLTAGE,VOLT_CLASS&outSR=4326&f=geojson&resultRecordCount=200000";

const CACHE = "./data/transmission.geojson";

if (!existsSync(CACHE)) {
  if (!existsSync("./data")) mkdirSync("./data");
  console.log("Downloading transmission lines (this is ~150MB)…");
  const res = await fetch(HIFLD_URL);
  if (!res.ok || !res.body) {
    console.error(`Download failed: ${res.status}`);
    process.exit(1);
  }
  const stream = createWriteStream(CACHE);
  await finished(Readable.fromWeb(res.body as never).pipe(stream));
  console.log(`Cached to ${CACHE}`);
} else {
  console.log(`Using cached ${CACHE}`);
}

type Feature = {
  geometry?: { type: string; coordinates: number[][] | number[][][] } | null;
  properties: Record<string, unknown>;
};

const fc = JSON.parse(readFileSync(CACHE, "utf8")) as { features: Feature[] };
console.log(`Loaded ${fc.features.length} features.`);

const supabase = createClient(url, key);

function toLineWkts(geom: NonNullable<Feature["geometry"]>): string[] {
  if (geom.type === "LineString") {
    const coords = geom.coordinates as number[][];
    return [`LINESTRING(${coords.map((c) => `${c[0]} ${c[1]}`).join(", ")})`];
  }
  if (geom.type === "MultiLineString") {
    const multi = geom.coordinates as number[][][];
    return multi.map((line) => `LINESTRING(${line.map((c) => `${c[0]} ${c[1]}`).join(", ")})`);
  }
  return [];
}

const rows: Array<Record<string, unknown>> = [];
for (const f of fc.features) {
  if (!f.geometry) continue;
  const owner = (f.properties.OWNER ?? null) as string | null;
  const voltageRaw = Number(f.properties.VOLTAGE);
  const voltage = Number.isFinite(voltageRaw) && voltageRaw > 0 ? voltageRaw : null;
  const voltage_class = (f.properties.VOLT_CLASS ?? null) as string | null;
  for (const wkt of toLineWkts(f.geometry)) {
    rows.push({ owner, voltage, voltage_class, geom: `SRID=4326;${wkt}` });
  }
}

console.log(`Prepared ${rows.length} rows. Inserting…`);
const BATCH = 500;
for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  const { error } = await supabase.from("transmission_lines").insert(chunk);
  if (error) {
    console.error(`\nBatch ${i} failed:`, error.message);
    process.exit(1);
  }
  process.stdout.write(`  inserted ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`);
}
console.log("\nDone.");
