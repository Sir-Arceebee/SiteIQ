import { useState } from "react";
import { ChevronDown, ChevronUp, X, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export type SearchResult = {
  lat: number;
  lon: number;
  gas_km: number;
  power_km: number;
  school_km: number | null;
};

type Props = {
  results: SearchResult[];
  onSelect: (r: SearchResult) => void;
  onClose: () => void;
};

export function SearchResultsPanel({ results, onSelect, onClose }: Props) {
  const [minimized, setMinimized] = useState(false);

  return (
    <div className="absolute left-4 top-4 z-[1000] w-80 rounded-md border border-border bg-card/95 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="text-sm font-semibold">
          Search Results <span className="text-muted-foreground font-normal">({results.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setMinimized((m) => !m)} aria-label={minimized ? "Expand" : "Minimize"}>
            {minimized ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!minimized && (
        <ScrollArea className="h-[420px]">
          <ul className="divide-y divide-border">
            {results.length === 0 && (
              <li className="px-3 py-4 text-xs text-muted-foreground">No matches. Try relaxing filters.</li>
            )}
            {results.map((r, i) => (
              <li key={`${r.lat}-${r.lon}-${i}`}>
                <button
                  type="button"
                  onClick={() => onSelect(r)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/50"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--score-good,#22c55e)]" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium tabular-nums">
                      {r.lat.toFixed(3)}°, {r.lon.toFixed(3)}°
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                      gas {r.gas_km} km · power {r.power_km} km
                      {r.school_km !== null && <> · school {r.school_km} km</>}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
