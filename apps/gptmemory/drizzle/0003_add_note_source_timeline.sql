-- The application-owned runtime migration in db/index.ts is the sole D1
-- schema mutation authority for this local MVP. This no-op entry advances the
-- Drizzle snapshot so a later journal replay cannot attempt the same ALTER or
-- index creation after the runtime has already added the timeline metadata.
SELECT 1;
