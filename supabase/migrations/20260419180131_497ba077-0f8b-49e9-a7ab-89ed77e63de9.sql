
-- Add geography expression indexes so KNN + DWithin use the index for all 3 layers.
CREATE INDEX IF NOT EXISTS pipelines_geog_idx ON public.pipelines USING gist ((geom::geography));
CREATE INDEX IF NOT EXISTS transmission_lines_geog_idx ON public.transmission_lines USING gist ((geom::geography));
CREATE INDEX IF NOT EXISTS schools_geog_idx ON public.schools USING gist ((geom::geography));

-- Rewrite the search function. Key changes:
--   * Skips the schools join entirely when min_school_m = 0 (huge speedup).
--   * Uses (geom::geography) consistently so the new GIST expression indexes
--     are picked instead of seq-scanning transmission_lines.
--   * pipe_class filter is normalized once.
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
RETURNS TABLE(
  lat double precision,
  lon double precision,
  gas_m double precision,
  power_m double precision,
  school_m double precision,
  pipe_type text
)
LANGUAGE sql
STABLE
AS $function$
  WITH grid AS (
    SELECT
      la.lat AS lat,
      lo.lon AS lon,
      (ST_SetSRID(ST_MakePoint(lo.lon, la.lat), 4326))::geography AS geog
    FROM generate_series(0, FLOOR((max_lat - min_lat) / step_deg)::int) AS i
    CROSS JOIN LATERAL (SELECT min_lat + i * step_deg AS lat) la
    CROSS JOIN generate_series(0, FLOOR((max_lon - min_lon) / step_deg)::int) AS j
    CROSS JOIN LATERAL (SELECT min_lon + j * step_deg AS lon) lo
  ),
  with_gas AS (
    SELECT g.lat, g.lon, g.geog, gp.dist_m AS gas_m, gp.pipe_type
    FROM grid g
    CROSS JOIN LATERAL (
      SELECT ST_Distance((p.geom)::geography, g.geog) AS dist_m, p.pipe_type
      FROM public.pipelines p
      WHERE ST_DWithin((p.geom)::geography, g.geog, max_gas_m)
        AND (pipe_class = 'both' OR LOWER(COALESCE(p.pipe_type, '')) LIKE '%' || pipe_class || '%')
      ORDER BY (p.geom)::geography <-> g.geog
      LIMIT 1
    ) gp
  ),
  with_power AS (
    SELECT wg.*, tp.dist_m AS power_m
    FROM with_gas wg
    CROSS JOIN LATERAL (
      SELECT ST_Distance((t.geom)::geography, wg.geog) AS dist_m
      FROM public.transmission_lines t
      WHERE ST_DWithin((t.geom)::geography, wg.geog, max_power_m)
      ORDER BY (t.geom)::geography <-> wg.geog
      LIMIT 1
    ) tp
  ),
  with_school AS (
    SELECT
      wp.lat, wp.lon, wp.gas_m, wp.power_m, wp.pipe_type,
      CASE
        WHEN min_school_m <= 0 THEN NULL
        ELSE (
          SELECT ST_Distance((s.geom)::geography, wp.geog)
          FROM public.schools s
          ORDER BY (s.geom)::geography <-> wp.geog
          LIMIT 1
        )
      END AS school_m
    FROM with_power wp
  )
  SELECT lat, lon, gas_m, power_m, school_m, pipe_type
  FROM with_school
  WHERE (min_school_m <= 0 OR school_m IS NULL OR school_m >= min_school_m)
  ORDER BY (gas_m + power_m) ASC
  LIMIT max_results;
$function$;
