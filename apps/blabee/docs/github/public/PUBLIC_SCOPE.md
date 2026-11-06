# Public source scope

This repository publishes the integration surface of Blabee. The macOS app is
distributed separately. Cloning this repository does not build that app.

## Included

| Area | Contents |
| --- | --- |
| `Contracts/v1` | Frozen JSON contracts and manifest, copied without schema changes. |
| `bridges/codex/plugin` | Plugin metadata, decision skill, Hook registrations and native coordinator launcher. |
| `bridges/claude/src` | Current auto-connect and session client dependencies for ordinary MCP and Hook integration. |
| `Tests/Contracts`, `Fixtures/v1` | Synthetic fixtures and executable schema/contract assertions, including reference semantic checks. These are not the product Swift Engine. |
| `Tests/CoordinatorOperational/plugin-package.test.mjs` | Plugin checks using temporary fake coordinators. |
| `Tests/bridges/claude` | Client, cancellation, lifecycle, framing, heartbeat and diagnostics tests with temporary or in-memory peers. |
| `examples` | Offline proposal validation; no submission or execution. |

`PUBLIC_SOURCES.json` records the SHA-256 and file mode of every published file
except the manifest itself. `npm run verify:sources` checks this inventory and
rejects missing, altered, unexpected or disallowed files. It does not audit the
entire application or prove that every possible secret pattern is absent.

## Not included

- The Swift `engine/`, macOS `app/`, and Swift provider adapters.
- Account, entitlement, administrative backend and production telemetry code.
- Product packaging, code-signing and notarization automation or credentials.
- User databases, account tokens, private profiles, live session logs or caches.
- Legacy Claude Channels entrypoints, standalone apps and development launchers.

Some helpers still have historical `product-*` or `session-v2-*` names. They are
required by the current JavaScript import graph. The session wire version is
`blabee.claude-session.v3`; filenames are not wire version declarations.

The product contracts and this public integration snapshot are different
layers. The frozen v1 `native-request` schema is notification-only. Publishing
it does not expose a supported external permission-grant API.

## Runtime boundary

Real Codex Hook/MCP operation requires the coordinator supplied with an
installed, compatible Blabee app. The exported launcher is not a standalone
engine. Claude clients require a live app-issued session grant and matching
private local service; credentials must not be invented or copied from a user.
Use the app's connection settings for normal setup.

The offline tests do not launch the installed Blabee app, Codex, Claude,
Keychain tools, or a production service. Passing them is not evidence of
clean-Mac setup, native model execution, app update success or a complete
security audit.

## Repository history

The public integration repository starts with a reviewed file inventory. Prior
private application history is preserved separately and is not part of this
repository's history. Previously published files elsewhere remain subject to
their original availability and license terms; this export does not retract
them or apply its MIT license retroactively.
