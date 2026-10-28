# Biadone brand guide deployment

Target: `https://brand.biadone.com`.

The user authorized publication to Cloudflare Pages on 2026-10-27. Publish only the generated `site/public/` directory to the dedicated `biadone-brand` Pages project, production branch `main`. The main `biadone` and `biadone-edu` projects are independent.

## Prepare

From `/Users/joo/BiaDone/brand`:

```sh
node site/build.mjs
```

Review the allowlisted output, all links, font rendering, Edu pagination and the downloadable ZIP. `site/_headers` is the header source copied by the builder. Internal briefs, concept explorations, operational notes, credentials and repository metadata are outside the upload directory.

## Publish

Use the existing Wrangler installation, version 4.151.1:

```sh
npx wrangler@4.151.1 pages deploy site/public --project-name biadone-brand --branch main --commit-dirty=true --commit-message "Biadone brand guide v0.1 (direct upload)"
```

Do not use the main website's deployment script. This publication does not require a Git commit or push.

Associate `brand.biadone.com` with this Pages project before creating the matching proxied CNAME to `biadone-brand.pages.dev`. Check for a conflicting record before changing DNS.

## Verify

Verify the custom domain's active state, authoritative and public DNS, HTTPS, HTML/assets against the generated hashes, documentation and downloads, desktop/mobile rendering, SUITE heading and Pretendard body/logo, Edu source preservation and pagination, and missing/private paths returning 404. A successful Pages upload alone does not prove the custom hostname works.

Release details and verification results are recorded in `deployment.json` after publication. QA screenshots and temporary verification scripts remain outside the source tree.

## Published v0.1 — 2026-10-27

- Live guide: https://brand.biadone.com
- Immutable deployment: https://92adc52b.biadone-brand.pages.dev
- Deployment ID: `92adc52b-6994-46fc-af2e-21e00c1b686a`; production status `success`; custom domain `active`.
- Uploaded only `site/public/`: 39 files, including the Pages `_headers` control file. The downloadable source ZIP contains 35 entries.
- Live Chromium checks passed for 33 page/viewport cases, 37 served asset hashes, 27 guide links, real ZIP download, and 9 private/missing paths returning 404. HTTPS and response headers passed. Actual SUITE headings, Pretendard body/wordmark, and all 7 Edu slides were verified without source loss or overflow.
- Desktop/mobile guide and Edu cover screenshots were visually reviewed. Authoritative DNS and public DNS over HTTPS resolve the hostname; the direct UDP query to `1.1.1.1` timed out in this environment.
- The release targeted only `biadone-brand`. The main website deployment stayed at its baseline; the Edu project's latest deployment changed during the release window and is recorded as an observation, not attributed to this release.
- Future updates use the same build and dedicated Pages project. This guide and `deployment.json` are operational records outside the public output; changing them does not require another upload.
