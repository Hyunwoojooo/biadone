# 0001 - Workspace Structure

## Decision

Use `~/BiaDone` as a single Git-backed workspace for BiaDone, `biadone.com`, T.I.V, shared docs, and future products.

## Structure

- Public websites live under `sites/`.
- Product applications live under `apps/`.
- Shared libraries live under `packages/` only when they are actually needed.
- Operational material lives under `ops/`.
- Disposable prototypes live under `experiments/`.
- Old reference material lives under `archive/`.

## Rationale

This keeps Codex CLI usage simple: start from `~/BiaDone` for broad work, or use `codex --cd <subdir>` for focused work. The root `AGENTS.md` provides global project rules, while nested `AGENTS.md` files can define service-specific commands and constraints.

