import { useEffect, useRef, useState } from "react";
import L from "leaflet";

// Fix default marker icon URLs (bundlers strip the relative paths).
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

export type AnalyzeResponse = {
  input: { lat: number; lon: number };
  final_score: number;
  redundancy: {
    score: number;
    min_cut_estimate: number;
    interstate_count: number;
    intrastate_count: number;
    unique_operators: number;
  };
  failure_probability: number;
  nearest_water: { name: string; kind: string; distance_m: number } | null;
  nearest_school: { name: string; distance_m: number } | null;
  nearest_grid: { region: string; cost_per_mwh: number; distance_m: number } | null;
  water_score: number;
  school_penalty: number;
  grid_score: number;
  nearby_pipeline_count: number;
  top_pipelines: Array<{
    id: number;
    name: string | null;
    operator: string | null;
    pipe_type: string | null;
    material: string | null;
    vintage_year: number | null;
    distance_m: number;
  }>;
};

function popupHtml(d: AnalyzeResponse): string {
  const km = (m: number) => (m / 1000).toFixed(1) + " km";
  const pct = (n: number) => (n * 100).toFixed(1) + "%";
  const scoreColor =
    d.final_score >= 0.4 ? "var(--score-good)" : d.final_score >= 0.15 ? "var(--score-warn)" : "var(--score-bad)";

  const pipes = d.top_pipelines
    .map(
      (p) =>
        `<li>${p.name ?? "Unnamed"} <span style="color:var(--muted-foreground)">— ${p.material ?? "?"}, ${p.vintage_year ?? "?"}, ${km(p.distance_m)}</span></li>`,
    )
    .join("");

  return `
    <div style="min-width:280px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
        <strong style="font-size:14px">Site Analysis</strong>
        <span style="background:${scoreColor};color:var(--primary-foreground);padding:2px 8px;border-radius:6px;font-weight:600">
          ${d.final_score.toFixed(2)}
        </span>
      </div>
      <div style="color:var(--muted-foreground);font-size:11px;margin-bottom:8px">
        ${d.input.lat.toFixed(3)}°, ${d.input.lon.toFixed(3)}°
      </div>
      <table style="width:100%;font-size:12px;border-collapse:collapse">
        <tr><td>Failure prob (weighted)</td><td style="text-align:right">${pct(d.failure_probability)}</td></tr>
        <tr><td>Redundancy</td><td style="text-align:right">${d.redundancy.score} <span style="color:var(--muted-foreground)">(min-cut~${d.redundancy.min_cut_estimate})</span></td></tr>
        <tr><td>Interstate / Intrastate</td><td style="text-align:right">${d.redundancy.interstate_count} / ${d.redundancy.intrastate_count}</td></tr>
        <tr><td>Operators</td><td style="text-align:right">${d.redundancy.unique_operators}</td></tr>
        <tr><td>Nearest water</td><td style="text-align:right">${d.nearest_water ? `${d.nearest_water.name} (${km(d.nearest_water.distance_m)})` : "—"}</td></tr>
        <tr><td>Nearest school</td><td style="text-align:right">${d.nearest_school ? `${d.nearest_school.name} (${km(d.nearest_school.distance_m)})` : "—"}</td></tr>
        <tr><td>Grid cost</td><td style="text-align:right">${d.nearest_grid ? `${d.nearest_grid.region} — $${Number(d.nearest_grid.cost_per_mwh).toFixed(0)}/MWh` : "—"}</td></tr>
      </table>
      ${pipes ? `<div style="margin-top:8px"><div style="color:var(--muted-foreground);font-size:11px;margin-bottom:2px">Nearby pipelines</div><ul style="margin:0;padding-left:16px;font-size:11px">${pipes}</ul></div>` : ""}
    </div>
  `;
}

export function SiteMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [39.5, -98.35], // continental US center
      zoom: 4,
      worldCopyJump: false,
      preferCanvas: true,
    });
    mapRef.current = map;

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · © <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);

    map.on("click", async (ev: L.LeafletMouseEvent) => {
      const { lat, lng } = ev.latlng;
      setLoading(true);
      setLastError(null);

      if (markerRef.current) markerRef.current.remove();
      markerRef.current = L.marker([lat, lng])
        .addTo(map)
        .bindPopup(`<em style="color:var(--muted-foreground)">Analyzing site…</em>`)
        .openPopup();

      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lon: lng }),
        });
        const data = (await res.json()) as AnalyzeResponse | { error: string };
        if (!res.ok || "error" in data) {
          throw new Error("error" in data ? data.error : `HTTP ${res.status}`);
        }
        markerRef.current?.bindPopup(popupHtml(data), { maxWidth: 360 }).openPopup();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Request failed";
        setLastError(msg);
        markerRef.current?.bindPopup(
          `<span style="color:var(--destructive)">Error: ${msg}</span>`,
        ).openPopup();
      } finally {
        setLoading(false);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" aria-label="Click anywhere on the United States to analyze a candidate datacenter site" />
      {loading && (
        <div className="absolute right-4 top-4 z-[1000] rounded-md border border-border bg-card/90 px-3 py-2 text-sm shadow-lg backdrop-blur">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary mr-2 align-middle" />
          Analyzing site…
        </div>
      )}
      {lastError && !loading && (
        <div className="absolute right-4 top-4 z-[1000] max-w-xs rounded-md border border-destructive/40 bg-card/90 px-3 py-2 text-xs text-destructive shadow-lg backdrop-blur">
          {lastError}
        </div>
      )}
    </div>
  );
}
