import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, X, MapPin, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getClientId } from "@/lib/clientId";

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
  // Notifies the map / sidebar that a list got a new item (refresh markers).
  onItemAdded?: (listId: string) => void;
};

type ListSummary = { id: string; title: string };

export function SearchResultsPanel({ results, onSelect, onClose, onItemAdded }: Props) {
  const [minimized, setMinimized] = useState(false);
  const [lists, setLists] = useState<ListSummary[]>([]);
  // Per-result UI: which result index has its list-picker open / which is saving / done.
  const [pickerOpen, setPickerOpen] = useState<number | null>(null);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [savedIdx, setSavedIdx] = useState<Record<number, string>>({});

  useEffect(() => {
    (async () => {
      try {
        const clientId = getClientId();
        const res = await fetch(`/api/lists?client_id=${encodeURIComponent(clientId)}`);
        const data = (await res.json()) as { lists?: ListSummary[] };
        setLists(data.lists ?? []);
      } catch { /* ignore */ }
    })();
  }, []);

  async function addToList(idx: number, listId: string, r: SearchResult) {
    setSavingIdx(idx);
    try {
      const res = await fetch("/api/list-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          list_id: listId,
          client_id: getClientId(),
          lat: r.lat,
          lon: r.lon,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const list = lists.find((l) => l.id === listId);
      setSavedIdx((s) => ({ ...s, [idx]: list?.title ?? "list" }));
      setPickerOpen(null);
      onItemAdded?.(listId);
    } catch { /* surface a small inline error */ }
    finally { setSavingIdx(null); }
  }

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
              <li key={`${r.lat}-${r.lon}-${i}`} className="px-3 py-2 hover:bg-muted/50">
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => onSelect(r)}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  >
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--score-good,#22c55e)]" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium tabular-nums">{r.lat.toFixed(3)}°, {r.lon.toFixed(3)}°</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                        gas {r.gas_km} km · power {r.power_km} km
                        {r.school_km !== null && <> · school {r.school_km} km</>}
                      </div>
                    </div>
                  </button>
                  {savedIdx[i] ? (
                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-[color:var(--score-good,#22c55e)]">
                      <Check className="h-3 w-3" /> {savedIdx[i]}
                    </span>
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      title="Add to list"
                      disabled={savingIdx === i}
                      onClick={() => setPickerOpen(pickerOpen === i ? null : i)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                {pickerOpen === i && (
                  <div className="mt-1.5 rounded-md border border-border bg-background p-1.5">
                    {lists.length === 0 ? (
                      <p className="px-1 py-1 text-[11px] text-muted-foreground">No lists yet — create one in the Places List Analyzer.</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {lists.map((l) => (
                          <li key={l.id}>
                            <button
                              type="button"
                              disabled={savingIdx === i}
                              onClick={() => addToList(i, l.id, r)}
                              className="w-full truncate rounded px-2 py-1 text-left text-[11px] hover:bg-muted"
                            >
                              {l.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
