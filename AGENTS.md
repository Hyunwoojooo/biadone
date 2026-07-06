# Project AGENTS.md

## Stack

- Framework: Static HTML/CSS/JavaScript for the current website; future apps may define their own stack.
- Language: HTML, CSS, JavaScript, Markdown.
- Package manager: None at the repository root.
- Database: None at the repository root.
- Test framework: None configured yet.

## Commands

- Install: Not configured at the repository root.
- Dev: Use the relevant subproject command, usually from `sites/biadone.com/` or `apps/tiv/`.
- Build: Not configured at the repository root.
- Typecheck: Not configured at the repository root.
- Lint: Not configured at the repository root.
- Unit test: Not configured at the repository root.
- E2E test: Not configured at the repository root.
- Deploy website: `cd sites/biadone.com && ./scripts/deploy-cloudflare.sh`

## Project Structure

- `sites/biadone.com/` contains the public website deployed to `biadone.com`.
- `apps/tiv/` is reserved for the T.I.V product application.
- `docs/` contains brand, product, decision, and research documents.
- `packages/` is reserved for shared libraries, UI, or config packages.
- `ops/` contains deployment, infrastructure, DNS, and operational notes.
- `experiments/` contains prototypes and exploratory work.
- `archive/` contains old work kept for reference.

## Project Rules

- Prefer minimal, reversible changes that solve the requested task.
- Keep unrelated files untouched.
- Do not change public API contracts without updating tests and docs.
- Do not add new dependencies without explaining why they are needed.
- Follow existing naming, folder, and testing conventions inside each subproject.
- Do not modify secrets, credentials, tokens, private keys, or production environment files.
- Do not commit, push, merge, rebase, delete branches, or rewrite Git history without explicit human approval.
- When modifying behavior, add or update relevant tests when practical.
- When tests cannot be run, explain why and describe what should be verified manually.

## Done Means

- Relevant tests or manual checks pass.
- Typecheck passes when applicable.
- Lint passes when applicable.
- Changed behavior is covered by tests or documented when practical.
- The final report includes what changed, files changed, checks run, risks, and remaining follow-up tasks when the work is substantial.

