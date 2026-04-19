import { useEffect, useRef, useState } from "react";
import L from "leaflet";

// Fix default marker icon URLs (bundlers strip the relative paths).
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

import { ToolsSidebar, type OptimalFilters } from "@/components/ToolsSidebar";
import { SearchResultsPanel, type SearchResult } from "@/components/SearchResultsPanel";

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
  operator_reliability?: { operator: string | null; matched_name: string | null; score: number | null };
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
const COLOR_POWER = "#facc15";

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
        <tr><td style="padding:2px 0">Operator reliability</td><td style="text-align:right">${
          d.operator_reliability && d.operator_reliability.score != null
            ? `<strong>${d.operator_reliability.score.toFixed(1)}</strong> <span style="color:var(--muted-foreground)">(${d.operator_reliability.matched_name ?? d.operator_reliability.operator ?? ""})</span>`
            : `<span style="color:var(--muted-foreground)">—</span>`
        }</td></tr>
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
  const allGasLayerRef = useRef<L.LayerGroup | null>(null);
  const allPowerLayerRef = useRef<L.LayerGroup | null>(null);
  const optimalLayerRef = useRef<L.LayerGroup | null>(null);
  const listItemsLayerRef = useRef<L.LayerGroup | null>(null);

  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState(80);
  const [showGas, setShowGas] = useState(false);
  const [gasLoading, setGasLoading] = useState(false);
  const [showPower, setShowPower] = useState(false);
  const [powerLoading, setPowerLoading] = useState(false);
  const [latInput, setLatInput] = useState("");
  const [lonInput, setLonInput] = useState("");

  const [filters, setFilters] = useState<OptimalFilters>({
    region: "all",
    pipe_class: "both",
    max_gas_km: 50,
    max_power_km: 50,
    max_school_km: 0,
  });
  const [optimalLoading, setOptimalLoading] = useState(false);
  const [optimalCount, setOptimalCount] = useState<number | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);

  // Places list state
  const [addByClick, setAddByClick] = useState(false);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [listRefreshTick, setListRefreshTick] = useState(0);
  const [lastClick, setLastClick] = useState<{ lat: number; lon: number } | null>(null);
  const activeListIdRef = useRef(activeListId);
  useEffect(() => { activeListIdRef.current = activeListId; }, [activeListId]);

  const radiusRef = useRef(radiusKm);
  useEffect(() => { radiusRef.current = radiusKm; }, [radiusKm]);

  async function analyzeAt(lat: number, lng: number) {
    const map = mapRef.current;
    if (!map) return;
    setLoading(true);
    setLastError(null);
    setLastClick({ lat, lon: lng });

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
      const text = await res.text();
      let data: AnalyzeResponse | { error: string };
      try { data = JSON.parse(text); } catch { throw new Error(text.slice(0, 200) || `HTTP ${res.status}`); }
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

    allGasLayerRef.current = L.layerGroup();
    allPowerLayerRef.current = L.layerGroup();
    pipelineLayerRef.current = L.layerGroup().addTo(map);
    optimalLayerRef.current = L.layerGroup().addTo(map);
    listItemsLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", (ev: L.LeafletMouseEvent) => {
      void analyzeAt(ev.latlng.lat, ev.latlng.lng);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Viewport-based gas pipelines loader.
  useEffect(() => {
    const map = mapRef.current;
    const layer = allGasLayerRef.current;
    if (!map || !layer) return;

    if (!showGas) {
      map.removeLayer(layer);
      layer.clearLayers();
      return;
    }
    map.addLayer(layer);

    const liveMap = map;
    const liveLayer = layer;
    let cancelled = false;
    async function loadVisible() {
      const b = liveMap.getBounds();
      const params = new URLSearchParams({
        min_lat: String(b.getSouth()),
        min_lon: String(b.getWest()),
        max_lat: String(b.getNorth()),
        max_lon: String(b.getEast()),
      });
      setGasLoading(true);
      try {
        const res = await fetch(`/api/pipelines-bbox?${params}`);
        const data = (await res.json()) as { pipelines?: Array<{ pipe_type: string | null; geom_geojson: string }>; error?: string };
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        liveLayer.clearLayers();
        for (const p of data.pipelines ?? []) {
          try {
            L.geoJSON(JSON.parse(p.geom_geojson), {
              style: { color: colorFor(p.pipe_type), weight: 1, opacity: 0.5 },
              interactive: false,
            }).addTo(liveLayer);
          } catch { /* skip */ }
        }
      } catch (e) {
        if (!cancelled) setLastError(e instanceof Error ? e.message : "Failed to load pipelines");
      } finally {
        if (!cancelled) setGasLoading(false);
      }
    }
    void loadVisible();
    map.on("moveend", loadVisible);
    return () => {
      cancelled = true;
      map.off("moveend", loadVisible);
    };
  }, [showGas]);

  // Viewport-based transmission lines loader.
  useEffect(() => {
    const map = mapRef.current;
    const layer = allPowerLayerRef.current;
    if (!map || !layer) return;

    if (!showPower) {
      map.removeLayer(layer);
      layer.clearLayers();
      return;
    }
    map.addLayer(layer);

    const liveMap = map;
    const liveLayer = layer;
    let cancelled = false;
    async function loadVisible() {
      const b = liveMap.getBounds();
      const params = new URLSearchParams({
        min_lat: String(b.getSouth()),
        min_lon: String(b.getWest()),
        max_lat: String(b.getNorth()),
        max_lon: String(b.getEast()),
      });
      setPowerLoading(true);
      try {
        const res = await fetch(`/api/transmission-bbox?${params}`);
        const data = (await res.json()) as { lines?: Array<{ voltage_class: string | null; geom_geojson: string }>; error?: string };
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        liveLayer.clearLayers();
        for (const p of data.lines ?? []) {
          try {
            L.geoJSON(JSON.parse(p.geom_geojson), {
              style: { color: COLOR_POWER, weight: 1, opacity: 0.55 },
              interactive: false,
            }).addTo(liveLayer);
          } catch { /* skip */ }
        }
      } catch (e) {
        if (!cancelled) setLastError(e instanceof Error ? e.message : "Failed to load transmission lines");
      } finally {
        if (!cancelled) setPowerLoading(false);
      }
    }
    void loadVisible();
    map.on("moveend", loadVisible);
    return () => {
      cancelled = true;
      map.off("moveend", loadVisible);
    };
  }, [showPower]);

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
      const text = await res.text();
      let data: { count: number; points: SearchResult[]; error?: string };
      try { data = JSON.parse(text); } catch { throw new Error(text.slice(0, 200) || `HTTP ${res.status}`); }
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);

      const points = data.points ?? [];
      const pinIcon = L.divIcon({
        className: "",
        html: `<div style="width:14px;height:14px;border-radius:50%;background:${COLOR_OPTIMAL};border:2px solid #064e3b;box-shadow:0 0 6px rgba(34,197,94,0.6)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      for (const p of points) {
        L.marker([p.lat, p.lon], { icon: pinIcon })
          .bindTooltip(`${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}° · gas ${p.gas_km}km · pwr ${p.power_km}km`, { direction: "top" })
          .on("click", () => {
            mapRef.current?.flyTo([p.lat, p.lon], 9, { duration: 0.8 });
            void analyzeAt(p.lat, p.lon);
          })
          .addTo(layer);
      }
      setOptimalCount(data.count);
      setSearchResults(points);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "Search failed");
      setOptimalCount(0);
      setSearchResults([]);
    } finally {
      setOptimalLoading(false);
    }
  }

  function handleClearOptimal() {
    optimalLayerRef.current?.clearLayers();
    setOptimalCount(null);
    setSearchResults(null);
  }

  function handleSelectResult(r: SearchResult) {
    mapRef.current?.flyTo([r.lat, r.lon], 9, { duration: 0.8 });
    void analyzeAt(r.lat, r.lon);
  }

  // Render list-item pins on the map
  useEffect(() => {
    const layer = listItemsLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!activeListId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/list-items?list_id=${encodeURIComponent(activeListId)}`);
        const data = (await res.json()) as { items?: Array<{ lat: number; lon: number; label: string | null }> };
        if (cancelled) return;
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:12px;height:12px;border-radius:2px;background:#3b82f6;border:2px solid #1e3a8a"></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        });
        for (const it of data.items ?? []) {
          L.marker([it.lat, it.lon], { icon })
            .bindTooltip(it.label || `${it.lat.toFixed(2)}°, ${it.lon.toFixed(2)}°`)
            .addTo(layer);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [activeListId, listRefreshTick]);

  async function handleAddToList() {
    if (!lastClick || !activeListIdRef.current) return;
    try {
      const { getClientId } = await import("@/lib/clientId");
      const res = await fetch("/api/list-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          list_id: activeListIdRef.current,
          client_id: getClientId(),
          lat: lastClick.lat,
          lon: lastClick.lon,
        }),
      });
      if (!res.ok) throw new Error((await res.text()).slice(0, 200));
      setAddByClick(false);
      setLastClick(null);
      setListRefreshTick((t) => t + 1);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "Add failed");
    }
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
        showGas={showGas}
        setShowGas={setShowGas}
        gasLoading={gasLoading}
        showPower={showPower}
        setShowPower={setShowPower}
        powerLoading={powerLoading}
        loading={loading}
        filters={filters}
        setFilters={setFilters}
        onSearchOptimal={handleSearchOptimal}
        optimalLoading={optimalLoading}
        optimalCount={optimalCount}
        onClearOptimal={handleClearOptimal}
        addByClick={addByClick}
        setAddByClick={setAddByClick}
        activeListId={activeListId}
        setActiveListId={setActiveListId}
        onListItemsChanged={() => setListRefreshTick((t) => t + 1)}
      />

      {addByClick && activeListId && lastClick && !loading && (
        <div className="absolute left-1/2 bottom-20 z-[1000] -translate-x-1/2">
          <button
            type="button"
            onClick={handleAddToList}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90"
          >
            + Add {lastClick.lat.toFixed(2)}°, {lastClick.lon.toFixed(2)}° to list
          </button>
        </div>
      )}

      {searchResults !== null && (
        <SearchResultsPanel
          results={searchResults}
          onSelect={handleSelectResult}
          onClose={handleClearOptimal}
        />
      )}

      {/* Bottom-left legend */}
      <div className="absolute left-4 bottom-4 z-[1000] rounded-md border border-border bg-card/90 px-3 py-2 text-xs shadow-lg backdrop-blur">
        <div className="mb-1 font-semibold">Legend</div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-[3px] w-5" style={{ background: COLOR_INTERSTATE }} />
          Interstate gas
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-[3px] w-5" style={{ background: COLOR_INTRASTATE }} />
          Intrastate gas
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-[3px] w-5" style={{ background: COLOR_POWER }} />
          Electrical grid
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
