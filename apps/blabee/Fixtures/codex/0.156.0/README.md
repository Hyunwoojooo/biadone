# Official voice runtime metadata fixture

`voice-runtime.json` is the unmodified `codex-resources/voice/runtime.json` from
the official [Codex 0.156.0 arm64 package](https://github.com/openai/codex/releases/tag/rust-v0.156.0).

- Archive: `codex-package-aarch64-apple-darwin.tar.gz`.
- Archive SHA-256: `6f7bdad25693f464a146ad6f24d477ad6fbffe07b62556f829ee5d3b04f48f8b`.
- Fixture SHA-256: `f37bcefac13b318e008e3e06e19025798cc612e136f3c2d9c518866c7b5a3214`.

The official archive sets mode 0755 on this JSON data. The repository stores it
as 0644; the custody regression creates a test source at 0755 and verifies its
private data copy is sealed as 0400. No native binary or voice library is included.
