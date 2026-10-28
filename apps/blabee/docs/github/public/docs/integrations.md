# Integration guide

Blabee keeps the native agent session as the owner of a task. A card is a
proposal; selecting a card, delivering it, claiming its context and completing
the task are separate events.

## Codex

[`bridges/codex/plugin`](../bridges/codex/plugin) contains the plugin manifest,
decision skill, four Hook registrations and launcher. The launcher delegates
to the compatible native coordinator supplied with Blabee. A plugin checkout
does not include that executable.

For normal use, install the macOS app, open **Settings → Connection**, select
**Codex**, then **Connect** with the project guidance shown in the app. Keep Codex's own sign-in and trust
decisions in Codex. This repository does not install a replacement Codex CLI.

`Tests/CoordinatorOperational/plugin-package.test.mjs` creates temporary fake
executables and verifies missing-runtime handling, path checks, output bounds
and timeout behavior. It does not verify a real model or native permission
approval. No real queued reference is replayed by these tests.

## Claude Code

The current JavaScript entrypoints are `auto-connect-hook.mjs` and
`auto-connect-mcp.mjs`. The app's launcher creates a private bootstrap and a
real native SessionStart enrolls the session. Each role receives only its own
live grant. The clients then use `session-v2-*` helpers on the
`blabee.claude-session.v3` wire.

The MCP connection exposes ordinary tools. A real Stop Hook waits for a
selection, and its bounded notification can resume the same native session.
Work becomes available only after the service verifies the exact native
continuation and MCP claim. The notification is not execution authority.

The public clients cannot create a valid production grant by themselves. Do
not copy an existing session's credentials into a sample or check them into
Git. Open **Settings → Connection**, select **Claude**, then **Connect**, and follow the app's instructions
for a new terminal/session.

`product-context.mjs`, `product-core-client.mjs`, `product-tools.mjs` and
`native-session-client.mjs` are shared dependencies of the current client.
The legacy `product-hook.mjs` / `product-mcp.mjs` entrypoints and standalone
development launchers are intentionally outside this repository's scope.

## Contracts and compatibility

[`Contracts/v1/manifest.json`](../Contracts/v1/manifest.json) identifies the
frozen JSON schema files. Schema validation checks shape and formats. The
reference contract tests separately check semantic constraints such as
matching bindings and claim uniqueness. Neither replaces the app's authority,
MAC, freshness, expiry or durable state validation.

The v1 schemas and Claude session wire are distinct interfaces. The v1 native
request is notification-only; it is not a public API for granting permission.
Do not synthesize a Hook payload or a continuation token to bypass the native
session lifecycle.

## Run the isolated checks

```sh
npm ci --ignore-scripts
npm run check
npm run example
npm run test:contracts
npm run test:codex
npm run test:claude
```

The full set targets macOS and Node 22+. It uses synthetic JSON, in-memory
streams and temporary sockets/directories. There is no app build, installed
product launch, account login or production DB/Keychain operation.

To modify published code, follow [CONTRIBUTING.md](../CONTRIBUTING.md) and review
the inventory update. Test results qualify this source snapshot; checking a
real installed app, a new CLI version or another Mac is a separate task.
