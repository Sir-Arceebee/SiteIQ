-- 1. Fast optimal-sites search
CREATE OR REPLACE FUNCTION public.find_optimal_sites(
  min_lat double precision,
  min_lon double precision,
  max_lat double precision,
  max_lon double precision,
  step_deg double precision DEFAULT 1.0,
  max_gas_m double precision DEFAULT 50000,
  max_power_m double precision DEFAULT 50000,
  min_school_m double precision DEFAULT 0,
  pipe_class text DEFAULT 'both',
  max_results integer DEFAULT 500
)
RETURNS TABLE (
  lat double precision,
  lon double precision,
  gas_m double precision,
  power_m double precision,
  school_m double precision,
  pipe_type text
)
LANGUAGE sql
STABLE
AS $$
  WITH lat_steps AS (
    SELECT min_lat + i * step_deg AS lat
    FROM generate_series(0, FLOOR((max_lat - min_lat) / step_deg)::int) AS i
  ),
  lon_steps AS (
    SELECT min_lon + i * step_deg AS lon
    FROM generate_series(0, FLOOR((max_lon - min_lon) / step_deg)::int) AS i
  ),
  grid AS (
    SELECT
      la.lat,
      lo.lon,
      ST_SetSRID(ST_MakePoint(lo.lon, la.lat), 4326)::geography AS geog
    FROM lat_steps la CROSS JOIN lon_steps lo
  ),
  with_gas AS (
    SELECT g.lat, g.lon, g.geog, gp.dist_m AS gas_m, gp.pipe_type
    FROM grid g
    LEFT JOIN LATERAL (
      SELECT ST_Distance(p.geom::geography, g.geog) AS dist_m, p.pipe_type
      FROM public.pipelines p
      WHERE ST_DWithin(p.geom::geography, g.geog, max_gas_m)
        AND (pipe_class = 'both' OR LOWER(COALESCE(p.pipe_type,'')) LIKE '%' || pipe_class || '%')
      ORDER BY p.geom::geography <-> g.geog
      LIMIT 1
    ) gp ON true
    WHERE gp.dist_m IS NOT NULL
  ),
  with_power AS (
    SELECT wg.*, tp.dist_m AS power_m
    FROM with_gas wg
    LEFT JOIN LATERAL (
      SELECT ST_Distance(t.geom::geography, wg.geog) AS dist_m
      FROM public.transmission_lines t
      WHERE ST_DWithin(t.geom::geography, wg.geog, max_power_m)
      ORDER BY t.geom::geography <-> wg.geog
      LIMIT 1
    ) tp ON true
    WHERE tp.dist_m IS NOT NULL
  ),
  with_school AS (
    SELECT wp.*, sc.dist_m AS school_m
    FROM with_power wp
    LEFT JOIN LATERAL (
      SELECT ST_Distance(s.geom::geography, wp.geog) AS dist_m
      FROM public.schools s
      ORDER BY s.geom::geography <-> wp.geog
      LIMIT 1
    ) sc ON true
  )
  SELECT lat, lon, gas_m, power_m, school_m, pipe_type
  FROM with_school
  WHERE (school_m IS NULL OR school_m >= min_school_m)
  ORDER BY (gas_m + power_m) ASC
  LIMIT max_results;
$$;

-- 2. Places lists tables
CREATE TABLE IF NOT EXISTS public.places_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_places_lists_client ON public.places_lists(client_id);

CREATE TABLE IF NOT EXISTS public.places_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES public.places_lists(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  label TEXT,
  gas_m DOUBLE PRECISION,
  power_m DOUBLE PRECISION,
  school_m DOUBLE PRECISION,
  pipe_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_places_items_list ON public.places_list_items(list_id);
CREATE INDEX IF NOT EXISTS idx_places_items_client ON public.places_list_items(client_id);

ALTER TABLE public.places_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.places_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lists_public_read" ON public.places_lists FOR SELECT USING (true);
CREATE POLICY "lists_public_insert" ON public.places_lists FOR INSERT WITH CHECK (true);
CREATE POLICY "lists_public_update" ON public.places_lists FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "lists_public_delete" ON public.places_lists FOR DELETE USING (true);

CREATE POLICY "items_public_read" ON public.places_list_items FOR SELECT USING (true);
CREATE POLICY "items_public_insert" ON public.places_list_items FOR INSERT WITH CHECK (true);
CREATE POLICY "items_public_update" ON public.places_list_items FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "items_public_delete" ON public.places_list_items FOR DELETE USING (true);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_places_lists_touch ON public.places_lists;
CREATE TRIGGER trg_places_lists_touch
BEFORE UPDATE ON public.places_lists
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();