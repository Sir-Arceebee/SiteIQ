CREATE OR REPLACE FUNCTION public.nearby_pipelines_geojson(
  lat double precision,
  lon double precision,
  radius_m double precision DEFAULT 80000
)
RETURNS TABLE (
  id bigint,
  name text,
  operator text,
  pipe_type text,
  material text,
  vintage_year integer,
  diameter_in numeric,
  distance_m double precision,
  geom_geojson text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.name,
    p.operator,
    p.pipe_type,
    p.material,
    p.vintage_year,
    p.diameter_in,
    ST_Distance(p.geom::geography, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) AS distance_m,
    ST_AsGeoJSON(p.geom) AS geom_geojson
  FROM public.pipelines p
  WHERE ST_DWithin(
    p.geom::geography,
    ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography,
    radius_m
  )
  ORDER BY p.geom <-> ST_SetSRID(ST_MakePoint(lon, lat), 4326)
  LIMIT 500;
$$;

GRANT EXECUTE ON FUNCTION public.nearby_pipelines_geojson(double precision, double precision, double precision) TO anon, authenticated;
