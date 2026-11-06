// Optional isolated PostgreSQL QA. Install PGlite outside the site and point
// PGLITE_MODULE at its dist/index.js; this adds no production dependency.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("migrations preserve legacy signup, isolate data, and enforce attribution contracts", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    for (const file of [
      "supabase/migrations/202609240001_blabee_beta_requests.sql",
      "supabase/migrations/202610170001_blabee_landing_attribution.sql",
      "supabase/tests/beta_requests.sql",
      "supabase/tests/landing_attribution.sql",
    ]) await db.exec(await read(file));
    const { rows } = await db.query("select count(*)::int as count from blabee_marketing.beta_requests");
    assert.equal(rows[0].count, 0);

    // Run the actual owner report under a non-UTC session timezone. Rows exactly
    // at the inclusive start / exclusive end prove date filtering, not just SQL syntax.
    await db.exec(`
      set timezone = 'Pacific/Honolulu';
      insert into blabee_marketing.landing_daily_views (day, attribution, views)
      select (now() at time zone 'UTC')::date + offset_days,
        blabee_marketing.normalize_attribution('{"utm_source":"x","utm_medium":"social","utm_campaign":"boundary"}'), n
      from (values (-30, 99), (-29, 7), (1, 99)) fixture(offset_days, n);
      insert into blabee_marketing.beta_requests (email, created_at, attribution)
      select email, instant, blabee_marketing.normalize_attribution('{"utm_source":"x","utm_medium":"social","utm_campaign":"boundary"}')
      from (values
        ('before@example.invalid', (((now() at time zone 'UTC')::date - 29)::timestamp at time zone 'UTC') - interval '1 microsecond'),
        ('start@example.invalid', (((now() at time zone 'UTC')::date - 29)::timestamp at time zone 'UTC')),
        ('last@example.invalid', (((now() at time zone 'UTC')::date + 1)::timestamp at time zone 'UTC') - interval '1 microsecond'),
        ('after@example.invalid', (((now() at time zone 'UTC')::date + 1)::timestamp at time zone 'UTC'))
      ) fixture(email, instant);
      insert into blabee_marketing.beta_requests (email) values ('legacy@example.invalid');
    `);
    const report = await db.query(await read("supabase/reports/landing-sources.sql"));
    assert.equal(report.rows.length, 2);
    const measured = report.rows.find(row => row.source === "x");
    assert.equal(Number(measured.page_views), 7);
    assert.equal(Number(measured.new_beta_requests), 2);
    const unmeasured = report.rows.find(row => row.source === "unmeasured");
    assert.equal(Number(unmeasured.page_views), 0);
    assert.equal(Number(unmeasured.new_beta_requests), 1);
  } finally {
    await db.close();
  }
});
