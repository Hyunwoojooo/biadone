# Contributing

Contributions to the published integration components are welcome. Please open
an issue before a larger protocol or compatibility change.

## Local checks

Use macOS with Node.js 22 or newer:

```sh
npm ci --ignore-scripts
npm test
```

The full suite includes macOS shell tools and temporary Unix sockets. Contract
checks can also run separately with `npm run test:contracts`. No model account,
Blabee login, Keychain access, native app build or production DB is needed.

## Changes

- Keep a change focused and add a relevant regression test.
- Preserve frozen v1 schemas and session/turn binding, expiry and single-claim
  checks. New wire behavior requires an explicit compatibility decision.
- Never use a real user's transcript, token, session profile or database as a
  fixture. Use synthetic data and temporary directories.
- Changes to copied integration files are proposed here; maintaining parity
  with the app's runtime is a separate release step.
- After intentional edits, run `node scripts/update-source-inventory.mjs`
  to refresh the file hashes, inspect that diff, then rerun `npm test`.

See [the public scope](PUBLIC_SCOPE.md) for excluded components and test limits.
Submitting a change does not grant access to private app or backend source.
