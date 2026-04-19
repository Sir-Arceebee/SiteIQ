import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BTM Datacenter Siting — US Pipeline Risk Dashboard" },
      {
        name: "description",
        content:
          "Click anywhere on the US map to score a candidate Behind-The-Meter datacenter site: pipeline failure risk, water access, supply redundancy, school proximity, and grid cost.",
      },
      { property: "og:title", content: "BTM Datacenter Siting Dashboard" },
      {
        property: "og:description",
        content:
          "Interactive US map for siting BTM-powered datacenters using natural-gas pipeline data.",
      },
    ],
  }),
  component: Index,
});

// Leaflet touches `window`, so render the map only on the client.
const SiteMap = lazy(() =>
  import("@/components/SiteMap").then((m) => ({ default: m.SiteMap })),
);

function Index() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-card/40 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:py-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              BTM Datacenter Siting
            </h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              Click anywhere on the US to score the site.
            </p>
          </div>
        </div>
      </header>

      <main className="relative flex-1">
        <div className="absolute inset-0">
          {mounted ? (
            <Suspense fallback={<MapSkeleton />}>
              <SiteMap />
            </Suspense>
          ) : (
            <MapSkeleton />
          )}
        </div>
      </main>

      <footer className="border-t border-border bg-card/40 px-4 py-3 text-[11px] text-muted-foreground">
        Final score = 0.30·redundancy − 0.30·risk + 0.20·water − 0.10·school − 0.10·grid cost. Tweak weights in <code>src/routes/api.analyze.ts</code>.
      </footer>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/40 px-2 py-1">
      <span className="h-2 w-2 rounded-full" style={{ background: swatch }} />
      {label}
    </span>
  );
}

function MapSkeleton() {
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{ background: "var(--gradient-hero)" }}
    >
      <div className="text-sm text-muted-foreground">Loading map…</div>
    </div>
  );
}
