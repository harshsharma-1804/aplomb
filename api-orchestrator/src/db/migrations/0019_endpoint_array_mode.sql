-- Add output_array_mode flag to endpoints.
-- When true, the orchestrator applies field mappings per-item over the array
-- returned by the upstream (instead of treating the root as a plain object).
ALTER TABLE endpoints ADD COLUMN output_array_mode integer NOT NULL DEFAULT 0;
