CREATE OR REPLACE FUNCTION public.transmission_in_bbox(
  min_lat double precision,
  min_lon double precision,
  max_lat double precision,
  max_lon double precision,
  max_rows integer DEFAULT 5000
)
RETURNS TABLE (
  id bigint,
  voltage_class text,
  voltage numeric,
  geom_geojson text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.voltage_class,
    t.voltage,
    ST_AsGeoJSON(t.geom)::text AS geom_geojson
  FROM public.transmission_lines t
  WHERE t.geom && ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
  LIMIT max_rows
$$;

GRANT EXECUTE ON FUNCTION public.transmission_in_bbox(double precision, double precision, double precision, double precision, integer) TO anon, authenticated;