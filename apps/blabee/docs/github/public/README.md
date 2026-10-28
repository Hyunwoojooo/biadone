<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/github/blabee-hero-dark.svg">
  <img src="docs/github/blabee-hero-light.svg" alt="Blabee — Your agents. One place to decide. An illustrated macOS panel with two next-step cards." width="1280">
</picture>

# Blabee

**Keep your agents within reach.**

Next steps from Codex and Claude Code, together in your Mac’s menu bar.<br>Review a card, choose what happens next, and continue in the original session.

[![macOS 13+](https://img.shields.io/badge/macOS-13%2B-253746?style=flat-square)](#requirements) [![Apple Silicon](https://img.shields.io/badge/Apple_Silicon-arm64-456779?style=flat-square)](#requirements) [![Release r88](https://img.shields.io/badge/release-r88-C4A64C?style=flat-square)](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.88)

**[Download for macOS](https://github.com/Hyunwoojooo/biadone/releases/download/blabee-v0.1.0%2Bbuild.88/Blabee-0.1.0-arm64-r88.dmg)** · [Get started](#get-started) · [Changelog](CHANGELOG.md) · [Website](https://biadone.com/blabee/) · [한국어](README.ko.md)

</div>

<p align="center"><sub>An illustrated preview of the Blabee decision panel.</sub></p>

> **App download: r88.** This repository publishes selected integration components under the MIT license. The full macOS application and Swift Engine are not included. See [source scope](PUBLIC_SCOPE.md).

Read the [r88 Codex 0.164.0 compatibility update](CHANGELOG.md#r88) in the release notes. Released on 2026-10-26.

## A small place for the next decision

Your agent finishes a step. There’s a choice to make. Blabee brings that choice into a compact macOS panel, so you can review it without searching through multiple conversations.

| What you need | What Blabee does |
| --- | --- |
| See what needs your attention | Shows incoming Codex and Claude Code cards in one inbox, in arrival order. |
| Choose the next step | Sends your selection back to its original agent and session. |
| Review a Codex permission request | Offers supported, verified requests in the panel, with a route back to Codex when needed. |
| Keep the panel out of the way | Opens from the menu bar or a shortcut, with a layout that adapts to its content. |
| Make it feel at home | Supports English and Korean UI, plus System, Light, and Dark appearance. |

## Get started

### Requirements

- **An Apple Silicon Mac running macOS 13 or later.** The current download is `arm64`; an Intel download is not provided.
- **Codex or Claude Code**, installed and signed in separately. You can connect either one or both. Blabee checks compatibility during connection.
- **A Google or GitHub account** for Blabee sign-in, and an internet connection for account access checks.

Your Codex and Claude Code accounts and any usage charges remain with those services.

### 1. Install Blabee

Download **[Blabee 0.1.0 r88](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.88)** and open the DMG. Install **Blabee.app** in **Applications**, then launch it from there.

The r88 app and DMG are Developer ID signed and Apple notarized. The release includes a SHA-256 checksum and build provenance.

### 2. Finish the first-run guide

Follow the tutorial, sign in with Google or GitHub, review the onboarding choices, and continue to setup. Once completed, the tutorial stays completed across app restarts.

### 3. Connect your coding agents

Choose **Codex**, **Claude**, or both, then select **Connect**. If a tool is missing, follow the official installation link shown by Blabee.

| Agent | After connection setup |
| --- | --- |
| Codex | Follow the app’s project-folder guidance and start a new connected session. Complete any Codex sign-in or Hook trust prompts. |
| Claude Code | Open a new zsh terminal and run `claude` as guided by the app. Complete Claude’s own sign-in, project trust, and MCP prompts. |

### 4. Make your first choice

When a connected agent sends next steps, open Blabee and select a card. The choice returns to the session that created it. **Skip Choices** dismisses that set of suggestions.

## A choice stays connected to its context

| 1 · Receive | 2 · Decide | 3 · Continue |
| --- | --- | --- |
| A connected agent offers next steps for a task. | You review the summary and select an option in Blabee. | Blabee validates the choice and delivers it to the original session. |

Selections remain bound to their session and validity window. Failed or uncertain work is not automatically resent. A next-step selection does not replace the agent’s separate permission checks.

Codex permission cards are a distinct feature: **Allow Once**, **Deny**, and **Decide in Codex** depend on the current request and connection. An unavailable approval button means Blabee cannot offer that action for the current request; use the original Codex screen. Claude Code does not have the same approval controls.

## Keyboard shortcuts

| Action | Default |
| --- | --- |
| Open or close the panel | `⌥ Space` |
| Choose a next-step card | `⌥ 1` through `⌥ 4` |
| Allow a supported Codex request once | `⌘ 1` |
| Deny a Codex request | `⌘ 2` |
| Decide on the original Codex screen | `⌘ 3` |

Panel and next-step shortcuts can be changed in Settings. Approval shortcuts apply only while the corresponding action is available.

## Questions and troubleshooting

<details>
<summary><strong>Can I use Blabee with only one agent?</strong></summary>

Yes. Connect Codex, Claude Code, or both. You do not need the other tool installed to use the one you selected.

</details>

<details>
<summary><strong>Why don’t cards appear in an existing terminal?</strong></summary>

Connection setup may need a new agent session or terminal. Check the provider’s connection status in Blabee Settings and follow the app’s next step. A saved configuration alone does not prove that an existing session is connected.

</details>

<details>
<summary><strong>Can I switch the app to Korean?</strong></summary>

Yes. Choose Korean in Settings. The default is English. This changes Blabee’s interface; agent-written messages, commands, and your input keep their original language.

</details>

<details>
<summary><strong>Does Blabee work without an account or entirely offline?</strong></summary>

Blabee requires Google or GitHub sign-in and server-confirmed access for new cards, selections, approvals, and delivery. The local coordinator stores its task journal on your Mac. Optional connection-error diagnostics are off by default and require consent.

</details>

<details>
<summary><strong>What should I include in a bug report?</strong></summary>

Use the app’s feedback window or [open an issue](https://github.com/Biadone/blabee/issues/new). Include the Blabee build, macOS version, agent and version, what you expected, and the connection-check error code or diagnostic ID if available. Remove private commands, project paths, account details, and tokens before sharing logs or screenshots.

</details>

## Explore the integrations

| Directory | Published contents |
| --- | --- |
| [`Contracts/v1`](Contracts/v1) | Frozen JSON schemas and their manifest |
| [`bridges/codex/plugin`](bridges/codex/plugin) | Codex plugin, decision skill, Hooks and launcher |
| [`bridges/claude/src`](bridges/claude/src) | Current Claude MCP/Hook clients and required helpers |
| [`Tests`](Tests), [`Fixtures/v1`](Fixtures/v1) | Isolated regression checks and synthetic data |
| [`examples`](examples) | Offline proposal-validation example |

The runtime integration requires an installed, compatible Blabee app. Cloning this repository does not build the macOS app or provide a standalone coordinator.

On **macOS with Node.js 22+**:

```sh
npm ci --ignore-scripts
npm test
```

These checks use fake peers, temporary sockets and synthetic data. They do not launch the installed app, Codex or Claude, use a model account, or access production Keychain/DB state.

Read the [integration guide](docs/integrations.md), [public source scope](PUBLIC_SCOPE.md), and [contributing guide](CONTRIBUTING.md). `PUBLIC_SOURCES.json` records the exact file inventory and hashes. The public integration source snapshot remains r85; r88 updates the app download and release documentation without replacing that source snapshot.

## License and feedback

The **published integration source** is [MIT licensed](LICENSE). The separately distributed Blabee macOS app is outside this source license. See [NOTICE](NOTICE) for product marks and dependency notices.

Use [Issues](https://github.com/Biadone/blabee/issues/new/choose) for bugs and feature requests. For suspected security issues, follow [SECURITY.md](SECURITY.md) before sharing details.

**More:** [Website](https://biadone.com/blabee/) · [Changelog](CHANGELOG.md) · [Download r88](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.88) · [한국어](README.ko.md)
