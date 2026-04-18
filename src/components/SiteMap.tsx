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

type DiversityStatus = "interstate_only" | "intrastate_only" | "mixed" | "none";

export type AnalyzeResponse = {
  input: { lat: number; lon: number };
  redundancy: {
    min_cut_estimate: number;
    diversity_status: DiversityStatus;
    interstate_count: number;
    intrastate_count: number;
    unique_operators: number;
    unique_paths: Array<{ operator: string; pipe_type: string; count: number }>;
  };
  nearby_pipeline_count: number;
  nearby_pipelines_geo: Array<{
    id: number;
    name: string | null;
    operator: string | null;
    pipe_type: string | null;
    material: string | null;
    vintage_year: number | null;
    distance_m: number;
    geom_geojson: string;
  }>;
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

const COLOR_INTERSTATE = "#fb923c"; // orange
const COLOR_INTRASTATE = "#22d3ee"; // cyan
const COLOR_OTHER = "#a1a1aa";      // zinc

function classifyType(t: string | null | undefined): "interstate" | "intrastate" | "other" {
  const v = (t ?? "").toLowerCase();
  if (v.includes("interstate")) return "interstate";
  if (v.includes("intrastate")) return "intrastate";
  return "other";
}

function colorFor(t: string | null | undefined): string {
  const c = classifyType(t);
  return c === "interstate" ? COLOR_INTERSTATE : c === "intrastate" ? COLOR_INTRASTATE : COLOR_OTHER;
}

function diversityLabel(d: DiversityStatus): string {
  switch (d) {
    case "interstate_only": return "Interstate only";
    case "intrastate_only": return "Intrastate only";
    case "mixed": return "Mixed (interstate + intrastate)";
    case "none": return "No nearby supply";
  }
}

function popupHtml(d: AnalyzeResponse): string {
  const km = (m: number) => (m / 1000).toFixed(1) + " km";
  const pipes = d.top_pipelines
    .map(
      (p) =>
        `<li><span style="color:${colorFor(p.pipe_type)}">●</span> ${p.name ?? "Unnamed"} <span style="color:var(--muted-foreground)">— ${p.operator ?? "?"}, ${km(p.distance_m)}</span></li>`,
    )
    .join("");

  return `
    <div style="min-width:280px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
        <strong style="font-size:14px">Supply Redundancy</strong>
        <span style="background:var(--primary);color:var(--primary-foreground);padding:2px 8px;border-radius:6px;font-weight:600">
          min-cut ≈ ${d.redundancy.min_cut_estimate}
        </span>
      </div>
      <div style="color:var(--muted-foreground);font-size:11px;margin-bottom:8px">
        ${d.input.lat.toFixed(3)}°, ${d.input.lon.toFixed(3)}° · ${d.nearby_pipeline_count} segments within 80 km
      </div>
      <table style="width:100%;font-size:12px;border-collapse:collapse">
        <tr><td>Diversity status</td><td style="text-align:right"><strong>${diversityLabel(d.redundancy.diversity_status)}</strong></td></tr>
        <tr><td>Interstate / Intrastate</td><td style="text-align:right">
          <span style="color:${COLOR_INTERSTATE}">${d.redundancy.interstate_count}</span>
          /
          <span style="color:${COLOR_INTRASTATE}">${d.redundancy.intrastate_count}</span>
        </td></tr>
        <tr><td>Unique operators</td><td style="text-align:right">${d.redundancy.unique_operators}</td></tr>
        <tr><td>Independent paths</td><td style="text-align:right">${d.redundancy.min_cut_estimate}</td></tr>
      </table>
      ${pipes ? `<div style="margin-top:8px"><div style="color:var(--muted-foreground);font-size:11px;margin-bottom:2px">Closest pipelines</div><ul style="margin:0;padding-left:16px;font-size:11px">${pipes}</ul></div>` : ""}
    </div>
  `;
}

export function SiteMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const pipelineLayerRef = useRef<L.LayerGroup | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [39.5, -98.35],
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

    pipelineLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", async (ev: L.LeafletMouseEvent) => {
      const { lat, lng } = ev.latlng;
      setLoading(true);
      setLastError(null);

      pipelineLayerRef.current?.clearLayers();
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

        // Draw nearby pipeline geometries
        const layer = pipelineLayerRef.current;
        if (layer) {
          for (const p of data.nearby_pipelines_geo) {
            try {
              const geo = JSON.parse(p.geom_geojson);
              L.geoJSON(geo, {
                style: {
                  color: colorFor(p.pipe_type),
                  weight: 2,
                  opacity: 0.85,
                },
              })
                .bindTooltip(
                  `${p.name ?? "Unnamed"} · ${p.operator ?? "?"} · ${p.pipe_type ?? "?"}`,
                  { sticky: true },
                )
                .addTo(layer);
            } catch {
              // skip bad geom
            }
          }
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
      <div className="absolute left-4 bottom-4 z-[1000] rounded-md border border-border bg-card/90 px-3 py-2 text-xs shadow-lg backdrop-blur">
        <div className="mb-1 font-semibold">Pipeline legend</div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-[3px] w-5" style={{ background: COLOR_INTERSTATE }} />
          Interstate
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-[3px] w-5" style={{ background: COLOR_INTRASTATE }} />
          Intrastate
        </div>
      </div>
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
