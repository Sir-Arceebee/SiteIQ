import { useState } from "react";
import { ChevronDown, ChevronRight, MapPin, Search, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

export type OptimalFilters = {
  region: "all" | "northeast" | "southeast" | "midwest" | "southwest" | "west";
  pipe_class: "interstate" | "intrastate" | "both";
  max_gas_km: number;
  max_power_km: number;
  max_school_km: number;
};

type Props = {
  // Place settings
  latInput: string;
  lonInput: string;
  setLatInput: (v: string) => void;
  setLonInput: (v: string) => void;
  onAnalyzeCoords: () => void;
  radiusKm: number;
  setRadiusKm: (v: number) => void;
  showGas: boolean;
  setShowGas: (v: boolean) => void;
  gasLoading: boolean;
  showPower: boolean;
  setShowPower: (v: boolean) => void;
  powerLoading: boolean;
  loading: boolean;

  // Optimal places
  filters: OptimalFilters;
  setFilters: (f: OptimalFilters) => void;
  onSearchOptimal: () => void;
  optimalLoading: boolean;
  optimalCount: number | null;
  onClearOptimal: () => void;
};

type ToolKey = "place" | "optimal" | null;

export function ToolsSidebar(props: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [openTool, setOpenTool] = useState<ToolKey>("place");

  if (collapsed) {
    return (
      <div className="absolute right-4 top-4 z-[1000]">
        <Button size="icon" variant="secondary" onClick={() => setCollapsed(false)} aria-label="Open tools">
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="absolute right-4 top-4 z-[1000] w-80 rounded-md border border-border bg-card/95 text-sm shadow-lg backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="font-semibold">Tools</div>
        <Button size="icon" variant="ghost" onClick={() => setCollapsed(true)} aria-label="Collapse tools">
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      {/* Tool: Place Settings */}
      <ToolHeader
        icon={<MapPin className="h-4 w-4" />}
        label="Place Settings"
        open={openTool === "place"}
        onClick={() => setOpenTool(openTool === "place" ? null : "place")}
      />
      {openTool === "place" && (
        <div className="space-y-4 px-3 pb-3 pt-1">
          <div>
            <div className="mb-1 font-medium">Go to coordinates</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="lat-input" className="text-xs text-muted-foreground">Latitude</Label>
                <Input id="lat-input" value={props.latInput} onChange={(e) => props.setLatInput(e.target.value)}
                  placeholder="39.50" inputMode="decimal" className="h-8" />
              </div>
              <div>
                <Label htmlFor="lon-input" className="text-xs text-muted-foreground">Longitude</Label>
                <Input id="lon-input" value={props.lonInput} onChange={(e) => props.setLonInput(e.target.value)}
                  placeholder="-98.35" inputMode="decimal" className="h-8" />
              </div>
            </div>
            <Button size="sm" className="mt-2 w-full" onClick={props.onAnalyzeCoords} disabled={props.loading}>
              Analyze location
            </Button>
          </div>

          <div className="h-px bg-border" />

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label className="font-medium">Search radius</Label>
              <span className="tabular-nums text-muted-foreground">{props.radiusKm} km</span>
            </div>
            <Slider min={10} max={300} step={5} value={[props.radiusKm]}
              onValueChange={(v) => props.setRadiusKm(v[0])} />
            <p className="mt-1 text-[11px] text-muted-foreground">Re-analyze to apply.</p>
          </div>

          <div className="h-px bg-border" />

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="show-gas" className="font-medium">Show gas pipelines</Label>
              <p className="text-[11px] text-muted-foreground">
                {props.gasLoading ? "Loading…" : "Visible area only"}
              </p>
            </div>
            <Switch id="show-gas" checked={props.showGas} onCheckedChange={props.setShowGas} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="show-power" className="font-medium">Show electrical grid pipelines</Label>
              <p className="text-[11px] text-muted-foreground">
                {props.powerLoading ? "Loading…" : "Visible area only"}
              </p>
            </div>
            <Switch id="show-power" checked={props.showPower} onCheckedChange={props.setShowPower} />
          </div>
        </div>
      )}

      {/* Tool: Search optimal places */}
      <ToolHeader
        icon={<Search className="h-4 w-4" />}
        label="Search for optimal places"
        open={openTool === "optimal"}
        onClick={() => setOpenTool(openTool === "optimal" ? null : "optimal")}
      />
      {openTool === "optimal" && (
        <div className="space-y-3 px-3 pb-3 pt-1">
          <div>
            <Label className="text-xs text-muted-foreground">Region</Label>
            <select
              className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={props.filters.region}
              onChange={(e) => props.setFilters({ ...props.filters, region: e.target.value as OptimalFilters["region"] })}
            >
              <option value="all">All US</option>
              <option value="northeast">Northeast</option>
              <option value="southeast">Southeast</option>
              <option value="midwest">Midwest</option>
              <option value="southwest">Southwest</option>
              <option value="west">West</option>
            </select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Pipeline class</Label>
            <select
              className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={props.filters.pipe_class}
              onChange={(e) => props.setFilters({ ...props.filters, pipe_class: e.target.value as OptimalFilters["pipe_class"] })}
            >
              <option value="both">Both interstate &amp; intrastate</option>
              <option value="interstate">Interstate only</option>
              <option value="intrastate">Intrastate only</option>
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Max distance from gas line</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{props.filters.max_gas_km} km</span>
            </div>
            <Slider min={0} max={50} step={0.1} value={[props.filters.max_gas_km]}
              onValueChange={(v) => props.setFilters({ ...props.filters, max_gas_km: v[0] })} />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Max distance from power line</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{props.filters.max_power_km} km</span>
            </div>
            <Slider min={0} max={50} step={0.1} value={[props.filters.max_power_km]}
              onValueChange={(v) => props.setFilters({ ...props.filters, max_power_km: v[0] })} />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Min distance from school</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{props.filters.max_school_km} km</span>
            </div>
            <Slider min={0} max={50} step={0.1} value={[props.filters.max_school_km]}
              onValueChange={(v) => props.setFilters({ ...props.filters, max_school_km: v[0] })} />
            <p className="mt-1 text-[11px] text-muted-foreground">Sites with a school closer than this are excluded.</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={props.onSearchOptimal} disabled={props.optimalLoading}>
              {props.optimalLoading ? "Searching…" : "Search"}
            </Button>
            {props.optimalCount !== null && (
              <Button size="sm" variant="ghost" onClick={props.onClearOptimal}>Clear</Button>
            )}
          </div>
          {props.optimalCount !== null && (
            <p className="text-[11px] text-muted-foreground">
              {props.optimalCount} matching site{props.optimalCount === 1 ? "" : "s"} pinned in green.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Place type (urban/suburban/rural) is detected on click via OpenStreetMap.
          </p>
        </div>
      )}
    </div>
  );
}

function ToolHeader({ icon, label, open, onClick }: { icon: React.ReactNode; label: string; open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left font-medium hover:bg-muted/50"
    >
      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      {icon}
      <span className="flex-1">{label}</span>
    </button>
  );
}
