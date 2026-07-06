# BiaDone Workspace

This repository is the working space for BiaDone, the `biadone.com` website, and related products such as T.I.V.

## Structure

- `sites/biadone.com/` - production source for the public `biadone.com` website.
- `apps/tiv/` - future T.I.V product application code.
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
codex --cd apps/tiv
```

Codex reads the root `AGENTS.md` first, then any nested `AGENTS.md` files under the active working directory.

## Current Website

The current public website source lives in `sites/biadone.com/`.

Deploy from that directory:

```bash
cd sites/biadone.com
./scripts/deploy-cloudflare.sh
```

