# Official voice runtime metadata fixture

`voice-runtime.json` is the unmodified `codex-resources/voice/runtime.json` from
the official [Codex 0.156.1 arm64 package](https://github.com/openai/codex/releases/tag/rust-v0.156.1).

- Archive: `codex-package-aarch64-apple-darwin.tar.gz`.
- Archive SHA-256: `fea42f9625091f011e38f059da974d52e57ba31831648bb1c7f0b1a385fde547`.
- Fixture SHA-256: `9d7dfeb74cf2073c8cb5c36e67e10b131ac1db091324f59fcfbaa33a79404566`.

The official archive sets mode 0755 on this JSON data. The repository stores it
as 0644; the custody regression creates a test source at 0755 and verifies its
private data copy is sealed as 0400. No native binary or voice library is included.
