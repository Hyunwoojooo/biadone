<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/github/blabee-hero-dark.svg">
  <img src="docs/github/blabee-hero-light.svg" alt="Blabee — 코딩 에이전트의 다음 선택을 한곳에서 확인하는 macOS 패널 일러스트" width="1280">
</picture>

# Blabee

**코딩 에이전트의 다음 선택을, 더 가까이.**

Codex와 Claude Code의 다음 작업을 Mac 메뉴바에서 확인하세요.<br>카드를 살펴보고 선택하면, 원래 대화에서 작업을 이어갑니다.

[![macOS 13+](https://img.shields.io/badge/macOS-13%2B-253746?style=flat-square)](#사용-조건) [![Apple Silicon](https://img.shields.io/badge/Apple_Silicon-arm64-456779?style=flat-square)](#사용-조건) [![Release r85](https://img.shields.io/badge/release-r85-C4A64C?style=flat-square)](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.85)

**[macOS용 다운로드](https://github.com/Hyunwoojooo/biadone/releases/download/blabee-v0.1.0%2Bbuild.85/Blabee-0.1.0-arm64-r85.dmg)** · [시작하기](#시작하기) · [웹사이트](https://biadone.com/blabee/) · [English](README.md)

</div>

<p align="center"><sub>Blabee의 선택 패널을 표현한 제품 일러스트입니다.</sub></p>

## 다음 결정을 위한 작은 공간

에이전트가 한 단계를 마치면 다음 선택이 필요합니다. Blabee는 여러 대화를 찾아다니지 않아도 그 선택을 검토할 수 있도록, 작은 macOS 패널에 카드를 모아 줍니다.

| 필요한 순간 | Blabee가 하는 일 |
| --- | --- |
| 무엇을 확인해야 할지 보고 싶을 때 | Codex·Claude Code의 카드를 도착한 순서대로 한곳에 보여 줍니다. |
| 다음 작업을 정할 때 | 선택한 내용을 카드를 만든 에이전트의 원래 세션으로 전달합니다. |
| Codex 실행 권한을 검토할 때 | 지원·검증된 요청을 패널에서 확인하고, 필요하면 원래 Codex 화면에서 결정합니다. |
| 작업 공간을 넓게 쓰고 싶을 때 | 메뉴바나 단축키로 열고, 내용에 맞게 크기가 조정되는 패널을 사용합니다. |
| 익숙한 화면으로 쓰고 싶을 때 | 영어·한국어 UI와 시스템·밝은·어두운 화면 모드를 지원합니다. |

## 시작하기

### 사용 조건

- **macOS 13 이상을 사용하는 Apple Silicon Mac.** 현재 배포본은 `arm64`이며 Intel용 다운로드는 제공하지 않습니다.
- **별도로 설치·로그인한 Codex 또는 Claude Code.** 하나만 연결하거나 둘 다 연결할 수 있습니다. 연결 과정에서 호환성을 확인합니다.
- **Blabee 로그인에 사용할 Google 또는 GitHub 계정**과 계정 사용 권한을 확인할 인터넷 연결.

Codex·Claude Code의 계정과 사용 요금은 각 서비스에 따릅니다.

### 1. Blabee 설치

[**Blabee 0.1.0 r85**](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.85)를 다운로드하고 DMG를 엽니다. **Blabee.app**을 **응용 프로그램**에 설치한 뒤 그 위치에서 실행하세요.

r85 앱과 DMG는 Developer ID 서명과 Apple 공증을 완료했습니다. 릴리스에서 SHA-256 체크섬과 빌드 출처도 확인할 수 있습니다.

### 2. 첫 실행 안내 완료

튜토리얼을 보고 Google 또는 GitHub로 로그인한 뒤 온보딩의 선택 항목을 확인하고 설정으로 진행하세요. 완료한 튜토리얼은 앱을 다시 실행해도 반복하지 않습니다.

### 3. 코딩 에이전트 연결

**Codex**, **Claude** 또는 둘 다 선택하고 **연결**을 누르세요. 도구가 없다면 앱이 제공하는 공식 설치 안내를 따릅니다.

| 에이전트 | 연결 설정 이후 |
| --- | --- |
| Codex | 앱의 작업 폴더 안내에 따라 연결된 새 세션을 시작합니다. Codex 로그인이나 Hook 신뢰 확인이 나오면 해당 도구에서 진행합니다. |
| Claude Code | 앱 안내에 따라 새 zsh 터미널을 열고 `claude`를 실행합니다. Claude 로그인·프로젝트 신뢰·MCP 승인은 Claude에서 확인합니다. |

### 4. 첫 카드 선택

연결된 에이전트가 다음 작업을 보내면 Blabee를 열고 카드를 선택하세요. 선택한 내용은 그 카드를 만든 세션으로 전달됩니다. **선택 건너뛰기**는 현재 제안 묶음을 닫습니다.

## 선택은 원래 작업과 연결됩니다

| 1 · 수신 | 2 · 선택 | 3 · 이어가기 |
| --- | --- | --- |
| 연결된 에이전트가 작업의 다음 선택지를 보냅니다. | Blabee에서 요약을 검토하고 옵션을 고릅니다. | 선택을 검증한 뒤 원래 세션으로 전달합니다. |

선택은 해당 세션과 유효기간에 묶입니다. 실패했거나 결과가 불확실한 작업은 자동으로 재전송하지 않습니다. 다음 작업을 선택해도 에이전트 자체의 별도 권한 검사는 유지됩니다.

Codex 권한 카드는 별도 기능입니다. **이번만 허용**, **거절**, **Codex에서 결정**은 현재 요청과 연결 상태에 따라 제공됩니다. 승인 버튼이 비활성화됐다면 해당 요청의 동작을 Blabee에서 제공할 수 없는 상태이므로 원래 Codex 화면에서 결정하세요. Claude Code에는 동일한 승인 컨트롤을 제공하지 않습니다.

## 기본 단축키

| 동작 | 기본값 |
| --- | --- |
| 패널 열기·닫기 | `⌥ Space` |
| 다음 작업 카드 선택 | `⌥ 1` ~ `⌥ 4` |
| 지원되는 Codex 요청 이번만 허용 | `⌘ 1` |
| Codex 요청 거절 | `⌘ 2` |
| 원래 Codex 화면에서 결정 | `⌘ 3` |

패널·카드 선택 단축키는 설정에서 바꿀 수 있습니다. 승인 단축키는 해당 동작이 가능한 동안에만 적용됩니다.

## 자주 묻는 질문

<details>
<summary><strong>Codex나 Claude Code 하나만 써도 되나요?</strong></summary>

네. Codex, Claude Code 또는 둘 다 연결할 수 있습니다. 선택하지 않은 도구를 설치할 필요는 없습니다.

</details>

<details>
<summary><strong>이미 열어 둔 터미널에서는 카드가 오지 않아요.</strong></summary>

연결 설정 뒤 새 세션이나 새 터미널이 필요할 수 있습니다. Blabee 설정에서 해당 도구의 연결 상태를 확인하고 다음 단계 안내를 따르세요. 설정 저장만으로 기존 세션의 연결까지 확인된 것은 아닙니다.

</details>

<details>
<summary><strong>앱을 한국어로 바꿀 수 있나요?</strong></summary>

네. 기본은 영어이며 설정에서 한국어를 선택할 수 있습니다. Blabee의 UI 문구가 바뀌고, 에이전트가 작성한 메시지·명령·사용자 입력은 원래 언어를 유지합니다.

</details>

<details>
<summary><strong>로그인 없이 또는 완전히 오프라인으로 사용할 수 있나요?</strong></summary>

새 카드·선택·승인·전달에는 Google 또는 GitHub 로그인과 서버의 사용 권한 확인이 필요합니다. 로컬 조정 서비스의 작업 이력은 Mac에 저장합니다. 선택적인 연결 오류 진단 전송은 기본으로 꺼져 있으며 동의가 필요합니다.

</details>

<details>
<summary><strong>버그를 제보할 때 어떤 정보를 보내면 되나요?</strong></summary>

앱의 피드백 창이나 [GitHub 이슈](https://github.com/Hyunwoojooo/biadone/issues/new)를 이용하세요. Blabee 빌드·macOS 버전·에이전트와 버전·예상 동작·연결 검사 오류 코드 또는 진단 ID를 포함하면 도움이 됩니다. 로그·화면을 공유하기 전에 비공개 명령, 프로젝트 경로, 계정 정보, 토큰을 제거하세요.

</details>

## 개발자 안내

제품의 공통 Swift 엔진과 UI는 한 벌이며, 도구별 Hook·MCP·전달·연결 수명 코드는 브릿지로 구분합니다.

| 위치 | 책임 |
| --- | --- |
| [`engine/`](engine/) | 공통 의미·상태·라우팅·SQLite·검증 |
| [`bridges/codex/`](bridges/codex/) | Codex Hook·MCP·전달·관리형 세션·Plugin 소스 |
| [`bridges/claude/`](bridges/claude/) | Claude 공통 엔진 adapter·host·JavaScript bridge |
| [`app/`](app/) | 공통 UI·조정·서비스·계정·진단·업데이트 |
| [`Tests/`](Tests/), [`Fixtures/`](Fixtures/) | Swift·Node 회귀, 참조 코어, 공통 fixture |
| [`Contracts/`](Contracts/) | 공통 및 버전별 bridge 계약 |
| [`Packaging/`](Packaging/), [`scripts/`](scripts/) | 앱 조립·서명·검증·배포 |
| [`dev/`](dev/) | 독립 앱·UI 시안·촬영 예제·실험 |
| [`account-web/`](account-web/), [`supabase/`](supabase/) | 계정 웹, DB migration·보고 SQL |

### 로컬 빌드·검증

현재 소스는 BiaDone 통합 저장소의 `apps/blabee`에 있습니다. 해당 폴더에서 Node.js 22 이상을 사용하며, Swift 명령에는 Xcode가 필요합니다.

```sh
npm ci --ignore-scripts
npm test
npm run test:swift
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift build --product blabee-coordinator
```

`test:swift`는 공용 직렬 잠금과 별도 scratch 경로를 유지합니다. `Package.swift`의 명시적 sources가 Swift 모듈 소속을 정하므로 물리 폴더 이름과 구분하세요.

<details>
<summary><strong>Claude 브릿지와 독립 개발 앱</strong></summary>

```sh
npm --prefix bridges/claude ci --ignore-scripts
npm --prefix bridges/claude run check
npm --prefix bridges/claude test
npm --prefix dev/claude-standalone ci --ignore-scripts
npm --prefix dev/claude-standalone run build
npm --prefix dev/claude-standalone test
```

독립 앱은 테스트 전에 빌드가 필요합니다. 실제 실행 조건은 [Claude 브릿지](bridges/claude/README.md)와 [독립 개발 앱](dev/claude-standalone/README.md) 안내를 따르세요.

</details>

앱 조립은 `build:macos-app`, `build:internal-dmg`, `build:release-dmg`, `notarize:dmg` 명령을 사용합니다. 필요한 인자와 입력은 [배포 안내](docs/development/RELEASE_DMG_PACKAGING.md)를 확인하세요. `build/`는 생성물입니다. 테스트·패키징·공증·실제 사용자 세션 검증은 별도 단계입니다.

r85 소스를 재구성하려면 릴리스의 출처·소스 패치 안내를 따르세요. 태그에서 자동 생성되는 소스 압축 파일에는 해당 빌드에 사용한 변경이 모두 들어 있지 않습니다.

**더 보기:** [문서 색인](docs/README.md) · [아키텍처](docs/architecture/README.md) · [디렉터리 구성](docs/development/DIRECTORY_MIGRATION.md) · [전용 저장소 분리 검토](docs/development/GITHUB_REPOSITORY.md)
