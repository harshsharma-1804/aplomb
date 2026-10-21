-- Organization-level appearance defaults (theme + palette).
-- Stored as JSON: {"theme":"light"|"dark"|"system","palette":"current"|"coastal"|"monochrome"|"orchid"}
-- Applied by the dashboard on load so appearance persists across browsers
-- and deployments, not just per-browser localStorage.
ALTER TABLE organization ADD COLUMN appearance text NOT NULL DEFAULT '{}';
