import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown, ChevronRight, ChevronUp, MousePointerClick, Plus, Trash2, X, BarChart3, Pencil, Check } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { getClientId } from "@/lib/clientId";

export type PlacesList = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type PlacesItem = {
  id: string;
  list_id: string;
  lat: number;
  lon: number;
  label: string | null;
  gas_m: number | null;
  power_m: number | null;
  school_m: number | null;
};

type Props = {
  addByClick: boolean;
  setAddByClick: (v: boolean) => void;
  activeListId: string | null;
  setActiveListId: (id: string | null) => void;
  // notify SiteMap when items change (so it can refresh markers / add-button state)
  onItemsChanged?: () => void;
};

export function PlacesListTool({ addByClick, setAddByClick, activeListId, setActiveListId, onItemsChanged }: Props) {
  const [open, setOpen] = useState(true);
  const [lists, setLists] = useState<PlacesList[]>([]);
  const [items, setItems] = useState<PlacesItem[]>([]);
  const [latInput, setLatInput] = useState("");
  const [lonInput, setLonInput] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientId = typeof window === "undefined" ? "" : getClientId();
  const activeList = lists.find((l) => l.id === activeListId) ?? null;

  async function loadLists() {
    if (!clientId) return;
    try {
      const res = await fetch(`/api/lists?client_id=${encodeURIComponent(clientId)}`);
      const data = await safeJson(res);
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setLists(data.lists ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load lists");
    }
  }

  async function loadItems(listId: string) {
    try {
      const res = await fetch(`/api/list-items?list_id=${encodeURIComponent(listId)}`);
      const data = await safeJson(res);
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setItems(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load items");
    }
  }

  useEffect(() => { void loadLists(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    if (activeListId) void loadItems(activeListId);
    else setItems([]);
  }, [activeListId]);

  async function createList() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, title: "Untitled" }),
      });
      const data = await safeJson(res);
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      await loadLists();
      setActiveListId(data.list.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally { setBusy(false); }
  }

  async function renameList(newTitle: string) {
    if (!activeListId) return;
    try {
      await fetch("/api/lists", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: activeListId, title: newTitle || "Untitled" }),
      });
      await loadLists();
    } catch (e) { setError(e instanceof Error ? e.message : "Rename failed"); }
  }

  async function deleteList(id: string) {
    if (!confirm("Delete this list?")) return;
    try {
      await fetch(`/api/lists?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (activeListId === id) setActiveListId(null);
      await loadLists();
    } catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
  }

  async function addByCoords() {
    if (!activeListId) return;
    const lat = parseFloat(latInput); const lon = parseFloat(lonInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { setError("Invalid coords"); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/list-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ list_id: activeListId, client_id: clientId, lat, lon }),
      });
      const data = await safeJson(res);
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setLatInput(""); setLonInput("");
      await loadItems(activeListId);
      onItemsChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Add failed"); }
    finally { setBusy(false); }
  }

  async function deleteItem(id: string) {
    try {
      await fetch(`/api/list-items?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (activeListId) await loadItems(activeListId);
      onItemsChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left font-medium hover:bg-muted/50"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <BarChart3 className="h-4 w-4" />
        <span className="flex-1">Places List Analyzer</span>
      </button>

      {open && (
        <div className="space-y-3 px-3 pb-3 pt-1 text-sm">
          {/* List picker */}
          <div className="flex items-center gap-2">
            <select
              className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
              value={activeListId ?? ""}
              onChange={(e) => setActiveListId(e.target.value || null)}
            >
              <option value="">— Select a list —</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>{l.title}</option>
              ))}
            </select>
            <Button size="sm" variant="secondary" onClick={createList} disabled={busy} title="Create new list">
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {activeList && (
            <>
              {/* Title edit + delete */}
              <div className="flex items-center gap-2">
                {editingTitle ? (
                  <>
                    <Input
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      className="h-8"
                      autoFocus
                    />
                    <Button size="icon" variant="ghost" onClick={async () => { await renameList(titleDraft); setEditingTitle(false); }}>
                      <Check className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="flex-1 truncate font-medium">{activeList.title}</div>
                    <Button size="icon" variant="ghost" onClick={() => { setTitleDraft(activeList.title); setEditingTitle(true); }} title="Rename">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </>
                )}
                <Button size="icon" variant="ghost" onClick={() => deleteList(activeList.id)} title="Delete list">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {/* Add by coordinates */}
              <div className="rounded-md border border-border p-2">
                <Label className="text-xs text-muted-foreground">Add by coordinates</Label>
                <div className="mt-1 grid grid-cols-2 gap-1">
                  <Input value={latInput} onChange={(e) => setLatInput(e.target.value)} placeholder="lat" className="h-8" inputMode="decimal" />
                  <Input value={lonInput} onChange={(e) => setLonInput(e.target.value)} placeholder="lon" className="h-8" inputMode="decimal" />
                </div>
                <Button size="sm" className="mt-2 w-full" onClick={addByCoords} disabled={busy}>Add</Button>
              </div>

              {/* Add by click toggle */}
              <button
                type="button"
                onClick={() => setAddByClick(!addByClick)}
                className={`flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left ${
                  addByClick ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted/50"
                }`}
              >
                <MousePointerClick className="h-4 w-4" />
                <span className="flex-1 font-medium">Add by click {addByClick && "(active)"}</span>
              </button>
              {addByClick && (
                <p className="text-[11px] text-muted-foreground">
                  Click the map. An "Add to list" button will appear under the analysis popup.
                </p>
              )}

              {/* Items list */}
              <div className="rounded-md border border-border">
                <div className="border-b border-border px-2 py-1.5 text-xs font-medium">
                  Points <span className="text-muted-foreground">({items.length})</span>
                </div>
                <ScrollArea className="h-40">
                  <ul className="divide-y divide-border">
                    {items.length === 0 && (
                      <li className="px-2 py-3 text-[11px] text-muted-foreground">No points yet.</li>
                    )}
                    {items.map((it) => (
                      <li key={it.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                        <div className="min-w-0 flex-1">
                          <div className="tabular-nums">{it.lat.toFixed(3)}°, {it.lon.toFixed(3)}°</div>
                          <div className="text-[10px] text-muted-foreground tabular-nums">
                            gas {fmtKm(it.gas_m)} · pwr {fmtKm(it.power_m)} · school {fmtKm(it.school_m)}
                          </div>
                        </div>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => deleteItem(it.id)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>

              {/* View Data */}
              <Button asChild size="sm" className="w-full" disabled={items.length === 0}>
                {items.length > 0 ? (
                  <Link to="/analyze/$listId" params={{ listId: activeList.id }}>
                    <BarChart3 className="mr-2 h-4 w-4" /> View Data
                  </Link>
                ) : (
                  <span className="opacity-50">View Data</span>
                )}
              </Button>
            </>
          )}

          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>
      )}
    </>
  );
}

async function safeJson(res: Response) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: text.slice(0, 200) || `HTTP ${res.status}` }; }
}

function fmtKm(m: number | null) {
  if (m == null || !Number.isFinite(m)) return "—";
  return (m / 1000).toFixed(1);
}
