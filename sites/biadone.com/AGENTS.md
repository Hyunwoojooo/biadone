# biadone.com AGENTS.md

## Stack

- Framework: Static website.
- Language: HTML, CSS, JavaScript.
- Package manager: None for the site source.
- Database: None.
- Test framework: None configured.
- Deployment: Cloudflare Pages via Wrangler.

## Commands

- Install: No install step required for local static editing.
- Dev: `python3 -m http.server 8000`
- Build: Not required.
- Typecheck: Not configured.
- Lint: Not configured.
- Unit test: Not configured.
- E2E test: Not configured.
- Deploy: `./scripts/deploy-cloudflare.sh`

## Project Structure

- `index.html` is the main `biadone.com` landing page.
- `tiv/` contains the T.I.V subpage.
- `css/` contains site styles.
- `js/` contains site interactions.
- `reference/` contains source briefs and internal reference material that should not be publicly deployed.
- `scripts/` contains site-level operational scripts.

## Project Rules

- Keep this site static unless the user explicitly asks for a framework migration.
- Do not publish `README.md`, `reference/`, `.wrangler/`, local caches, or environment files.
- Keep public copy in English unless the user asks for a Korean or multilingual version.
- Do not add unsupported claims, fake testimonials, fake metrics, or unverified integration availability.
- Preserve the positioning: BiaDone is a Personal Context OS, and T.I.V is the first proof product.
- Important actions should be described as prepared first and confirmed by the user.

## Done Means

- The page can be opened locally without broken core assets.
- Links, anchors, and forms changed by the task are manually checked.
- Responsive behavior is checked when layout changes.
- Deployment is only run after explicit user approval.

