import { useEffect, useRef, useState } from "react";
import L from "leaflet";

// Fix default marker icon URLs (bundlers strip the relative paths).
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

import { ToolsSidebar, type OptimalFilters } from "@/components/ToolsSidebar";

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
  radius_m: number;
  redundancy: {
    min_cut_estimate: number;
    diversity_status: DiversityStatus;
    interstate_count: number;
    intrastate_count: number;
    unique_operators: number;
    unique_paths: Array<{ operator: string; pipe_type: string; count: number }>;
  };
  nearby_pipeline_count: number;
  gas_distance_m: number | null;
  electricity_distance_m: number | null;
  nearest_school: { name: string | null; distance_m: number } | null;
  place_type: "urban" | "suburban" | "rural" | "unknown";
  predicted_reliability: "NYI";
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

const COLOR_INTERSTATE = "#fb923c";
const COLOR_INTRASTATE = "#22d3ee";
const COLOR_OTHER = "#a1a1aa";
const COLOR_OPTIMAL = "#22c55e";

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
    case "mixed": return "Mixed";
    case "none": return "No nearby supply";
  }
}

function fmtKm(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return "—";
  return (m / 1000).toFixed(1) + " km";
}

function placeTypeLabel(p: AnalyzeResponse["place_type"]): string {
  switch (p) {
    case "urban": return "Urban";
    case "suburban": return "Suburban";
    case "rural": return "Rural";
    default: return "Unknown";
  }
}

function popupHtml(d: AnalyzeResponse): string {
  return `
    <div style="min-width:300px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
        <strong style="font-size:14px">Site Analysis</strong>
        <span style="background:var(--primary);color:var(--primary-foreground);padding:2px 8px;border-radius:6px;font-weight:600">
          min-cut ≈ ${d.redundancy.min_cut_estimate}
        </span>
      </div>
      <div style="color:var(--muted-foreground);font-size:11px;margin-bottom:8px">
        ${d.input.lat.toFixed(3)}°, ${d.input.lon.toFixed(3)}° · ${d.nearby_pipeline_count} segments within ${(d.radius_m / 1000).toFixed(0)} km
      </div>
      <table style="width:100%;font-size:12px;border-collapse:collapse">
        <tr><td style="padding:2px 0">Area</td><td style="text-align:right"><strong>${placeTypeLabel(d.place_type)}</strong></td></tr>
        <tr><td style="padding:2px 0">Gas line distance</td><td style="text-align:right">${fmtKm(d.gas_distance_m)}</td></tr>
        <tr><td style="padding:2px 0">Electricity distance</td><td style="text-align:right">${fmtKm(d.electricity_distance_m)}</td></tr>
        <tr><td style="padding:2px 0">Predicted reliability</td><td style="text-align:right;color:var(--muted-foreground)">NYI</td></tr>
        <tr><td style="padding:2px 0">Min-cut</td><td style="text-align:right"><strong>${d.redundancy.min_cut_estimate}</strong></td></tr>
        <tr><td style="padding:2px 0">Diversity</td><td style="text-align:right"><strong>${diversityLabel(d.redundancy.diversity_status)}</strong></td></tr>
        <tr><td style="padding:2px 0">School proximity</td><td style="text-align:right">${
          d.nearest_school
            ? `${fmtKm(d.nearest_school.distance_m)}${d.nearest_school.name ? ` <span style="color:var(--muted-foreground)">(${d.nearest_school.name})</span>` : ""}`
            : "—"
        }</td></tr>
      </table>
    </div>
  `;
}

export function SiteMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const pipelineLayerRef = useRef<L.LayerGroup | null>(null);
  const allPipelinesLayerRef = useRef<L.LayerGroup | null>(null);
  const optimalLayerRef = useRef<L.LayerGroup | null>(null);

  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState(80);
  const [showAll, setShowAll] = useState(false);
  const [allLoading, setAllLoading] = useState(false);
  const [latInput, setLatInput] = useState("");
  const [lonInput, setLonInput] = useState("");

  const [filters, setFilters] = useState<OptimalFilters>({
    region: "all",
    pipe_class: "both",
    max_gas_km: 50,
    max_power_km: 50,
  });
  const [optimalLoading, setOptimalLoading] = useState(false);
  const [optimalCount, setOptimalCount] = useState<number | null>(null);

  const radiusRef = useRef(radiusKm);
  useEffect(() => { radiusRef.current = radiusKm; }, [radiusKm]);

  async function analyzeAt(lat: number, lng: number) {
    const map = mapRef.current;
    if (!map) return;
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
        body: JSON.stringify({ lat, lon: lng, radius_m: radiusRef.current * 1000 }),
      });
      const data = (await res.json()) as AnalyzeResponse | { error: string };
      if (!res.ok || "error" in data) {
        throw new Error("error" in data ? data.error : `HTTP ${res.status}`);
      }

      const layer = pipelineLayerRef.current;
      if (layer) {
        for (const p of data.nearby_pipelines_geo) {
          try {
            const geo = JSON.parse(p.geom_geojson);
            L.geoJSON(geo, {
              style: { color: colorFor(p.pipe_type), weight: 2, opacity: 0.85 },
            })
              .bindTooltip(`${p.operator || "Unknown operator"} · ${p.pipe_type ?? "?"}`, { sticky: true })
              .addTo(layer);
          } catch { /* skip bad geom */ }
        }
      }
      markerRef.current?.bindPopup(popupHtml(data), { maxWidth: 380 }).openPopup();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Request failed";
      setLastError(msg);
      markerRef.current?.bindPopup(`<span style="color:var(--destructive)">Error: ${msg}</span>`).openPopup();
    } finally {
      setLoading(false);
    }
  }

  // Init map once.
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
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · © <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);

    allPipelinesLayerRef.current = L.layerGroup();
    pipelineLayerRef.current = L.layerGroup().addTo(map);
    optimalLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", (ev: L.LeafletMouseEvent) => {
      void analyzeAt(ev.latlng.lat, ev.latlng.lng);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Viewport-based pipelines loader.
  useEffect(() => {
    const map = mapRef.current;
    const layer = allPipelinesLayerRef.current;
    if (!map || !layer) return;

    if (!showAll) {
      map.removeLayer(layer);
      layer.clearLayers();
      return;
    }
    map.addLayer(layer);

    let cancelled = false;
    async function loadVisible() {
      if (!map) return;
      const b = map.getBounds();
      const params = new URLSearchParams({
        min_lat: String(b.getSouth()),
        min_lon: String(b.getWest()),
        max_lat: String(b.getNorth()),
        max_lon: String(b.getEast()),
      });
      setAllLoading(true);
      try {
        const res = await fetch(`/api/pipelines-bbox?${params}`);
        const data = (await res.json()) as { pipelines?: Array<{ pipe_type: string | null; geom_geojson: string }>; error?: string };
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        layer.clearLayers();
        for (const p of data.pipelines ?? []) {
          try {
            L.geoJSON(JSON.parse(p.geom_geojson), {
              style: { color: colorFor(p.pipe_type), weight: 1, opacity: 0.5 },
              interactive: false,
            }).addTo(layer);
          } catch { /* skip */ }
        }
      } catch (e) {
        if (!cancelled) setLastError(e instanceof Error ? e.message : "Failed to load pipelines");
      } finally {
        if (!cancelled) setAllLoading(false);
      }
    }
    void loadVisible();
    map.on("moveend", loadVisible);
    return () => {
      cancelled = true;
      map.off("moveend", loadVisible);
    };
  }, [showAll]);

  function handleGoToCoords() {
    const lat = parseFloat(latInput);
    const lon = parseFloat(lonInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setLastError("Enter valid lat (-90 to 90) and lon (-180 to 180)");
      return;
    }
    mapRef.current?.flyTo([lat, lon], 8, { duration: 0.8 });
    void analyzeAt(lat, lon);
  }

  async function handleSearchOptimal() {
    const layer = optimalLayerRef.current;
    if (!layer) return;
    setOptimalLoading(true);
    setLastError(null);
    layer.clearLayers();
    try {
      const res = await fetch("/api/optimal-places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as { count: number; geojson: any; error?: string };
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      L.geoJSON(data.geojson, {
        style: { color: COLOR_OPTIMAL, weight: 1, fillColor: COLOR_OPTIMAL, fillOpacity: 0.25, opacity: 0.8 },
      }).addTo(layer);
      setOptimalCount(data.count);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "Search failed");
      setOptimalCount(0);
    } finally {
      setOptimalLoading(false);
    }
  }

  function handleClearOptimal() {
    optimalLayerRef.current?.clearLayers();
    setOptimalCount(null);
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" aria-label="Click anywhere on the United States to analyze a candidate datacenter site" />

      <ToolsSidebar
        latInput={latInput}
        lonInput={lonInput}
        setLatInput={setLatInput}
        setLonInput={setLonInput}
        onAnalyzeCoords={handleGoToCoords}
        radiusKm={radiusKm}
        setRadiusKm={setRadiusKm}
        showAll={showAll}
        setShowAll={setShowAll}
        allLoading={allLoading}
        loading={loading}
        filters={filters}
        setFilters={setFilters}
        onSearchOptimal={handleSearchOptimal}
        optimalLoading={optimalLoading}
        optimalCount={optimalCount}
        onClearOptimal={handleClearOptimal}
      />

      {/* Bottom-left legend */}
      <div className="absolute left-4 bottom-4 z-[1000] rounded-md border border-border bg-card/90 px-3 py-2 text-xs shadow-lg backdrop-blur">
        <div className="mb-1 font-semibold">Legend</div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-[3px] w-5" style={{ background: COLOR_INTERSTATE }} />
          Interstate
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-[3px] w-5" style={{ background: COLOR_INTRASTATE }} />
          Intrastate
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3" style={{ background: COLOR_OPTIMAL, opacity: 0.5 }} />
          Optimal region
        </div>
      </div>

      {loading && (
        <div className="absolute left-1/2 top-4 z-[1000] -translate-x-1/2 rounded-md border border-border bg-card/90 px-3 py-2 text-sm shadow-lg backdrop-blur">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary mr-2 align-middle" />
          Analyzing site…
        </div>
      )}
      {lastError && !loading && (
        <div className="absolute left-1/2 top-4 z-[1000] max-w-xs -translate-x-1/2 rounded-md border border-destructive/40 bg-card/90 px-3 py-2 text-xs text-destructive shadow-lg backdrop-blur">
          {lastError}
        </div>
      )}
    </div>
  );
}
