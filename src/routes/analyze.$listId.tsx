import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from "recharts";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download } from "lucide-react";

export const Route = createFileRoute("/analyze/$listId")({
  component: AnalyzePage,
  head: () => ({
    meta: [
      { title: "Site Cluster Analysis — BTM Datacenter Siting" },
      { name: "description", content: "ML-driven cluster analysis and similarity search across your saved BTM sites." },
    ],
  }),
});

type ClusteredPoint = {
  id: string;
  lat: number;
  lon: number;
  label: string | null;
  gas_m: number | null;
  power_m: number | null;
  school_m: number | null;
  cluster: number;
  pca: [number, number];
  similarity_to_centroid: number;
};

type ClusterProfile = {
  cluster: number;
  size: number;
  mean_gas_km: number;
  mean_power_km: number;
  mean_school_km: number;
  archetype: string;
};

const CLUSTER_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#a855f7"];

function compositeScore(p: ClusteredPoint): number {
  // Lower distances = better. Normalize roughly to 0..100.
  const gas = p.gas_m == null ? 50 : Math.max(0, 100 - (p.gas_m / 1000) * 2);
  const pwr = p.power_m == null ? 50 : Math.max(0, 100 - (p.power_m / 1000) * 2);
  const sch = p.school_m == null ? 50 : Math.min(100, (p.school_m / 1000) * 2);
  return Math.round(gas * 0.4 + pwr * 0.4 + sch * 0.2);
}

function AnalyzePage() {
  const { listId } = useParams({ from: "/analyze/$listId" });
  const [points, setPoints] = useState<ClusteredPoint[]>([]);
  const [profiles, setProfiles] = useState<ClusterProfile[]>([]);
  const [colorMode, setColorMode] = useState<"cluster" | "composite">("cluster");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/list-analyze?list_id=${encodeURIComponent(listId)}`);
        const text = await res.text();
        let data: { clustered?: ClusteredPoint[]; profiles?: ClusterProfile[]; error?: string };
        try { data = JSON.parse(text); } catch { throw new Error(text.slice(0, 200)); }
        if (cancelled) return;
        if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
        setPoints(data.clustered ?? []);
        setProfiles(data.profiles ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [listId]);

  const colored = useMemo(() => {
    return points.map((p) => ({
      ...p,
      composite: compositeScore(p),
      color: colorMode === "cluster"
        ? CLUSTER_COLORS[p.cluster % CLUSTER_COLORS.length]
        : compositeColor(compositeScore(p)),
    }));
  }, [points, colorMode]);

  const topSimilar = useMemo(() =>
    [...points].sort((a, b) => b.similarity_to_centroid - a.similarity_to_centroid).slice(0, 10),
    [points]);

  function exportCsv() {
    const header = "id,lat,lon,label,gas_km,power_km,school_km,cluster,similarity\n";
    const rows = points.map((p) =>
      [p.id, p.lat, p.lon, p.label ?? "", fmtKm(p.gas_m), fmtKm(p.power_m), fmtKm(p.school_m),
       p.cluster, p.similarity_to_centroid.toFixed(3)].join(","),
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `analysis-${listId}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/40 px-4 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button asChild size="sm" variant="ghost">
              <Link to="/"><ArrowLeft className="mr-1 h-4 w-4" /> Back to map</Link>
            </Button>
            <div>
              <h1 className="text-lg font-semibold">Site Cluster Analysis</h1>
              <p className="text-xs text-muted-foreground">{points.length} points · {profiles.length} clusters</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5 text-xs">
              <button
                className={`rounded px-2 py-1 ${colorMode === "cluster" ? "bg-primary text-primary-foreground" : ""}`}
                onClick={() => setColorMode("cluster")}
              >Color: Cluster</button>
              <button
                className={`rounded px-2 py-1 ${colorMode === "composite" ? "bg-primary text-primary-foreground" : ""}`}
                onClick={() => setColorMode("composite")}
              >Color: Score</button>
            </div>
            <Button size="sm" variant="secondary" onClick={exportCsv} disabled={points.length === 0}>
              <Download className="mr-1 h-4 w-4" /> CSV
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 p-4">
        {loading && <div className="text-sm text-muted-foreground">Computing clusters…</div>}
        {error && <div className="text-sm text-destructive">{error}</div>}

        {!loading && !error && (
          <>
            {/* Map + PCA scatter side by side */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Mini map */}
              <Panel title="Geographic distribution">
                <MiniMap points={colored} />
              </Panel>
              {/* PCA scatter */}
              <Panel title="Site embedding (PCA 2D)">
                <div className="h-80 w-full">
                  <ResponsiveContainer>
                    <ScatterChart margin={{ top: 10, right: 10, bottom: 30, left: 0 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                      <XAxis type="number" dataKey="x" name="PC1" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} label={{ value: "PC1", position: "insideBottom", offset: -10, fontSize: 11 }} />
                      <YAxis type="number" dataKey="y" name="PC2" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} label={{ value: "PC2", angle: -90, position: "insideLeft", fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                        formatter={(value: number, name: string) => [value.toFixed(2), name]}
                        labelFormatter={() => ""}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {colorMode === "cluster" ? profiles.map((pr) => (
                        <Scatter
                          key={pr.cluster}
                          name={`C${pr.cluster}: ${pr.archetype}`}
                          data={colored.filter((p) => p.cluster === pr.cluster).map((p) => ({ x: p.pca[0], y: p.pca[1], color: p.color }))}
                          fill={CLUSTER_COLORS[pr.cluster % CLUSTER_COLORS.length]}
                        />
                      )) : (
                        <Scatter
                          name="Sites (by composite score)"
                          data={colored.map((p) => ({ x: p.pca[0], y: p.pca[1], color: p.color }))}
                        >
                          {colored.map((p, i) => (
                            <Cell key={i} fill={p.color} />
                          ))}
                        </Scatter>
                      )}
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </div>

            {/* Cluster profiles + Top similar */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Panel title="Cluster archetypes">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr><th className="px-2 py-1 text-left">Cluster</th><th>Archetype</th><th>Size</th><th>Gas km</th><th>Power km</th><th>School km</th></tr>
                  </thead>
                  <tbody>
                    {profiles.map((p) => (
                      <tr key={p.cluster} className="border-t border-border">
                        <td className="px-2 py-1.5">
                          <span className="inline-block h-3 w-3 rounded-sm align-middle" style={{ background: CLUSTER_COLORS[p.cluster % CLUSTER_COLORS.length] }} /> C{p.cluster}
                        </td>
                        <td className="text-center">{p.archetype}</td>
                        <td className="text-center tabular-nums">{p.size}</td>
                        <td className="text-center tabular-nums">{p.mean_gas_km}</td>
                        <td className="text-center tabular-nums">{p.mean_power_km}</td>
                        <td className="text-center tabular-nums">{p.mean_school_km}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>

              <Panel title="Top 10 most similar to cluster centroid">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr><th className="px-2 py-1 text-left">Lat / Lon</th><th>Cluster</th><th>Gas</th><th>Power</th><th>School</th><th>Sim.</th></tr>
                  </thead>
                  <tbody>
                    {topSimilar.map((p) => (
                      <tr key={p.id} className="border-t border-border">
                        <td className="px-2 py-1.5 tabular-nums">{p.lat.toFixed(3)}, {p.lon.toFixed(3)}</td>
                        <td className="text-center">
                          <span className="inline-block h-3 w-3 rounded-sm align-middle" style={{ background: CLUSTER_COLORS[p.cluster % CLUSTER_COLORS.length] }} /> C{p.cluster}
                        </td>
                        <td className="text-center tabular-nums">{fmtKm(p.gas_m)}</td>
                        <td className="text-center tabular-nums">{fmtKm(p.power_m)}</td>
                        <td className="text-center tabular-nums">{fmtKm(p.school_m)}</td>
                        <td className="text-center tabular-nums">{p.similarity_to_centroid.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-card/60 p-3">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function MiniMap({ points }: { points: Array<ClusteredPoint & { color: string }> }) {
  // Simple SVG projection of CONUS bounds.
  const W = 560, H = 320;
  const minLon = -125, maxLon = -67, minLat = 24, maxLat = 50;
  const project = (lat: number, lon: number) => {
    const x = ((lon - minLon) / (maxLon - minLon)) * W;
    const y = H - ((lat - minLat) / (maxLat - minLat)) * H;
    return { x, y };
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-md bg-background/50">
      <rect x={0} y={0} width={W} height={H} fill="hsl(var(--muted))" opacity={0.15} />
      {points.map((p) => {
        const { x, y } = project(p.lat, p.lon);
        return <circle key={p.id} cx={x} cy={y} r={5} fill={p.color} stroke="#000" strokeOpacity={0.4} />;
      })}
    </svg>
  );
}

function compositeColor(score: number): string {
  // Red → Yellow → Green
  if (score >= 70) return "#22c55e";
  if (score >= 50) return "#eab308";
  if (score >= 30) return "#f97316";
  return "#ef4444";
}

function fmtKm(m: number | null) {
  if (m == null) return "—";
  return (m / 1000).toFixed(1);
}
