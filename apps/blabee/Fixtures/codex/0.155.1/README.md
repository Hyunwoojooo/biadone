# Official voice runtime metadata fixture

`voice-runtime.json` is the unmodified `codex-resources/voice/runtime.json` from
the official [Codex 0.155.1 arm64 package](https://github.com/openai/codex/releases/tag/rust-v0.155.1).

- Archive: `codex-package-aarch64-apple-darwin.tar.gz`.
- Archive SHA-256: `e6e08717da9e35b72332eff753527fe79a9ae876081033c5c6820a8e5f58b943`.
- Fixture SHA-256: `27db27d294d7c76fadb0c7dfd6d6e9130f4c2fd2448ec633517067ad1542ca00`.

The official archive sets mode 0755 on this JSON data. The repository stores it
as 0644; the custody regression explicitly creates a private source at 0755 and
checks that its sealed data copy is 0400. No native binary or voice library is
included in this fixture.
