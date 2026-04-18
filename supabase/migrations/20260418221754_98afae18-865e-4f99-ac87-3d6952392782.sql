-- Enable PostGIS for spatial queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- Pipelines: line geometries with material/vintage for risk model
CREATE TABLE public.pipelines (
  id BIGSERIAL PRIMARY KEY,
  name TEXT,
  operator TEXT,
  pipe_type TEXT CHECK (pipe_type IN ('interstate', 'intrastate')),
  material TEXT,
  vintage_year INT,
  diameter_in NUMERIC,
  geom GEOGRAPHY(LINESTRING, 4326) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX pipelines_geom_idx ON public.pipelines USING GIST (geom);
CREATE INDEX pipelines_type_idx ON public.pipelines (pipe_type);

CREATE TABLE public.water_bodies (
  id BIGSERIAL PRIMARY KEY,
  name TEXT,
  kind TEXT,
  geom GEOGRAPHY(GEOMETRY, 4326) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX water_geom_idx ON public.water_bodies USING GIST (geom);

CREATE TABLE public.schools (
  id BIGSERIAL PRIMARY KEY,
  name TEXT,
  geom GEOGRAPHY(POINT, 4326) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX schools_geom_idx ON public.schools USING GIST (geom);

CREATE TABLE public.grid_cost_points (
  id BIGSERIAL PRIMARY KEY,
  region TEXT,
  cost_per_mwh NUMERIC NOT NULL,
  geom GEOGRAPHY(POINT, 4326) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX grid_geom_idx ON public.grid_cost_points USING GIST (geom);

ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_bodies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grid_cost_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read pipelines" ON public.pipelines FOR SELECT USING (true);
CREATE POLICY "public read water"     ON public.water_bodies FOR SELECT USING (true);
CREATE POLICY "public read schools"   ON public.schools FOR SELECT USING (true);
CREATE POLICY "public read grid"      ON public.grid_cost_points FOR SELECT USING (true);

-- RPC: nearest pipelines within radius_m, returns features needed by analyzer
CREATE OR REPLACE FUNCTION public.nearby_pipelines(lat double precision, lon double precision, radius_m double precision DEFAULT 50000)
RETURNS TABLE (
  id bigint,
  name text,
  operator text,
  pipe_type text,
  material text,
  vintage_year int,
  diameter_in numeric,
  distance_m double precision
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT p.id, p.name, p.operator, p.pipe_type, p.material, p.vintage_year, p.diameter_in,
         ST_Distance(p.geom, ST_MakePoint(lon, lat)::geography) AS distance_m
  FROM public.pipelines p
  WHERE ST_DWithin(p.geom, ST_MakePoint(lon, lat)::geography, radius_m)
  ORDER BY distance_m ASC
  LIMIT 200;
$$;

CREATE OR REPLACE FUNCTION public.nearest_water(lat double precision, lon double precision, radius_m double precision DEFAULT 100000)
RETURNS TABLE (id bigint, name text, kind text, distance_m double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT w.id, w.name, w.kind,
         ST_Distance(w.geom, ST_MakePoint(lon, lat)::geography) AS distance_m
  FROM public.water_bodies w
  ORDER BY w.geom <-> ST_MakePoint(lon, lat)::geography
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.nearest_school(lat double precision, lon double precision)
RETURNS TABLE (id bigint, name text, distance_m double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT s.id, s.name,
         ST_Distance(s.geom, ST_MakePoint(lon, lat)::geography) AS distance_m
  FROM public.schools s
  ORDER BY s.geom <-> ST_MakePoint(lon, lat)::geography
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.nearest_grid_cost(lat double precision, lon double precision)
RETURNS TABLE (id bigint, region text, cost_per_mwh numeric, distance_m double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT g.id, g.region, g.cost_per_mwh,
         ST_Distance(g.geom, ST_MakePoint(lon, lat)::geography) AS distance_m
  FROM public.grid_cost_points g
  ORDER BY g.geom <-> ST_MakePoint(lon, lat)::geography
  LIMIT 1;
$$;