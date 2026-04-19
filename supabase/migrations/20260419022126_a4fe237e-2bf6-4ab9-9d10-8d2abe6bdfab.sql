-- 1) Transmission lines table
CREATE TABLE IF NOT EXISTS public.transmission_lines (
  id BIGSERIAL PRIMARY KEY,
  owner TEXT,
  voltage NUMERIC,
  voltage_class TEXT,
  geom geometry(Geometry, 4326) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transmission_lines_geom
  ON public.transmission_lines USING GIST (geom);

ALTER TABLE public.transmission_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read transmission" ON public.transmission_lines
  FOR SELECT USING (true);

-- 2) Pipelines bbox RPC for viewport-based loading
CREATE OR REPLACE FUNCTION public.pipelines_in_bbox(
  min_lat double precision,
  min_lon double precision,
  max_lat double precision,
  max_lon double precision,
  max_rows int DEFAULT 5000
)
RETURNS TABLE (
  id bigint,
  pipe_type text,
  geom_geojson text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.pipe_type, ST_AsGeoJSON(p.geom)
  FROM public.pipelines p
  WHERE p.geom && ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
  LIMIT max_rows;
$$;

GRANT EXECUTE ON FUNCTION public.pipelines_in_bbox(double precision,double precision,double precision,double precision,int) TO anon, authenticated;

-- 3) Nearest school RPC
CREATE OR REPLACE FUNCTION public.nearest_school_v2(
  lat double precision,
  lon double precision
)
RETURNS TABLE (
  id bigint,
  name text,
  distance_m double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.name,
    ST_Distance(s.geom::geography, ST_SetSRID(ST_MakePoint(lon, lat),4326)::geography) AS distance_m
  FROM public.schools s
  ORDER BY s.geom <-> ST_SetSRID(ST_MakePoint(lon, lat),4326)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.nearest_school_v2(double precision,double precision) TO anon, authenticated;

-- 4) Nearest transmission line RPC
CREATE OR REPLACE FUNCTION public.nearest_transmission(
  lat double precision,
  lon double precision,
  radius_m double precision DEFAULT 200000
)
RETURNS TABLE (
  id bigint,
  owner text,
  voltage numeric,
  distance_m double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.owner, t.voltage,
    ST_Distance(t.geom::geography, ST_SetSRID(ST_MakePoint(lon, lat),4326)::geography) AS distance_m
  FROM public.transmission_lines t
  WHERE ST_DWithin(t.geom::geography, ST_SetSRID(ST_MakePoint(lon, lat),4326)::geography, radius_m)
  ORDER BY t.geom <-> ST_SetSRID(ST_MakePoint(lon, lat),4326)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.nearest_transmission(double precision,double precision,double precision) TO anon, authenticated;