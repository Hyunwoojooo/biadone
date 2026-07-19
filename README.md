# BiaDone Workspace

This repository is the working space for BiaDone, the `biadone.com` website, and related products such as blabase.

## Structure

- `sites/biadone.com/` - production source for the public `biadone.com` website.
- `sites/blabase.com/` - production source for the public `blabase.com` landing page.
- `apps/blabase/` - active blabase product application.
- `docs/` - brand notes, product plans, decisions, and research.
- `packages/` - shared code or design-system packages when needed.
- `ops/` - deployment, infrastructure, DNS, and operational notes.
- `experiments/` - prototypes and disposable explorations.
- `archive/` - old work kept for reference.

## Codex CLI

Use the repository root for cross-project work:

```bash
cd ~/BiaDone
codex
```

Use a narrower working directory for focused work:

```bash
codex --cd sites/biadone.com
codex --cd apps/blabase
```

Codex reads the root `AGENTS.md` first, then any nested `AGENTS.md` files under the active working directory.

## Current Websites

The public website sources live in `sites/biadone.com/` and
`sites/blabase.com/`.

Deploy each site from its own directory:

```bash
cd sites/biadone.com
./scripts/deploy-cloudflare.sh

cd ../blabase.com
./scripts/deploy-cloudflare.sh
```
