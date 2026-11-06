# blabee-claude

> 이동 전 구현·검증 기록을 보존한 문서입니다. 현재 코드 위치와 명령은 루트 README.md 및 docs/development/DIRECTORY_MIGRATION.md를 확인하세요.

공통 Blabee에 연결할 Claude Code 브릿지의 개발 공간이다. 기존 Blabee 개발과 겹치지 않게 Swift/AppKit 패널과 Node Coordinator를 별도 검증용 런타임으로 유지한다. 최종 제품은 [공통 Swift 엔진과 브릿지 전환안](../../bridges/claude/SHARED_ENGINE_PLAN.md)을 따른다. 개발 버전에서 Hook·MCP Channels 연결과 세션 launcher, 작업 선택과 분리된 채널 수신 확인을 구현했다. 이 개발 버전은 실제 대화형 Claude Code에서 채널 수신 확인 → Pet의 A 선택 → 선택한 파일만 생성 → 완료 보고까지 검증했다. 공통 앱으로의 전환과 배포 준비는 남아 있다. 검증 결과와 실행 범위는 [QA_REPORT.md](../../../dev/claude-standalone/docs/QA_REPORT.md)에 기록한다.

공통 엔진 연결의 첫 단계로 기존 `CoordinatorSwift`를 직접 참조하는 어댑터와 별도 통합 테스트를 추가했다. 이어서 실제 공통 Coordinator에 [Claude 인증 접속 경로](../../bridges/claude/PRODUCT_INGRESS.md), [새 세션 launcher·실제 Hook/MCP 연결](../../bridges/claude/NATIVE_SESSION.md), [기존 공통 Pet 화면과 버튼 연결](../../bridges/claude/COMMON_PET.md)을 추가했다. 어댑터와 UI는 상위 Swift package에서 한 번만 관리한다. `claude:shared --pet`은 새 Claude 세션과 같은 host에서 기존 Pet를 연다. 제품 공통 서비스에는 [CP-02 private 세션 등록·격리 저장소](../../bridges/claude/product-connection/SESSION_REGISTRATION.md), [CP-03 같은 권한의 native/inner 연결·owner 갱신](../../bridges/claude/product-connection/SESSION_LIFETIME.md)을 구현했다. [CP-04 수명 관측·장기 상태 처리](../../bridges/claude/product-connection/SESSION_LIFECYCLE.md)도 구현하고 관련 격리 자동 검증을 마쳤다. 설치 launcher·Hook/MCP v2 client·공통 앱 UI와 배포는 후속이다. 아래 `app`/`claude` 명령은 계속 기존 독립 개발 버전이다. 경로별 검증 결과는 [QA](../../../dev/claude-standalone/docs/QA_REPORT.md)와 [제품 작업 상태](../../bridges/claude/product-connection/TASK_STATUS.md)를 따른다.

2026-09-19 [제품 연결 설계](../../bridges/claude/product-connection/TECH_SPEC.md)를 확정했다. 목표는 공통 앱의 **Claude에서 시작** 버튼, owner가 갱신하는 세션 권한, 별도 5분 수신 확인, 한 Pet의 다중 세션이다. [세션 권한 상태와 테스트](../../bridges/claude/product-connection/SESSION_AUTHORITY.md), [제품 통신 계약과 codec](../../bridges/claude/product-connection/PRODUCT_WIRE.md)을 추가했다. **서비스의 owner 갱신과 timer controller는 구현했으며, 설치 launcher 연결은 아직 남아 있다.** 현재 개발 실행 경로의 1시간 grant와 아래 명령은 그대로다. 후속 범위는 [단계·수용 기준](../../bridges/claude/product-connection/IMPLEMENTATION_PLAN.md)과 [작업 상태](../../bridges/claude/product-connection/TASK_STATUS.md)를 따른다.

## 공통 엔진 연결 테스트 — 현재 작업

`claude/tests/` 등 특정 폴더에서 일반 `claude`를 실행하거나 이 문서를 읽는 것만으로는 Blabee가 등록되지 않는다. Hook·MCP는 **전용 launcher가 여는 새 Claude 세션에만** 연결된다.

| 확인할 경로 | 실행 명령 | 연결 확인 도구 |
| --- | --- | --- |
| 현재 공통 Swift 엔진·Pet | `npm run claude:live` 또는 `claude:shared`에 `--pet` 지정 | `check_connection_v1`, `ack_readiness_probe_v1` |
| 기존 독립 개발 앱 | `npm run app` 이후 `npm run claude -- --cwd …` | `check_connection`, `ack_readiness_probe` |

현재 공통 엔진 테스트에는 `claude:shared`를 사용한다. 이 launcher가 전용 Coordinator를 시작하므로 개발용 `app`/`doctor`를 먼저 실행할 필요가 없다. `--pet`을 붙이면 공통 Pet 창이 함께 열린다. 플래그를 생략하면 기존처럼 화면 없이 연결한다.

이 컴퓨터에 준비한 `build/shared-pet-live/` 제품 빌드와 테스트 폴더를 사용하는 명령:

```sh
cd /Users/joo/BiaDone/apps/blabee/claude
npm run claude:live
```

`claude:live`는 준비된 제품 빌드·테스트 폴더 경로와 `--pet`을 `claude:shared` launcher에 미리 전달하는 단축 명령이다. 긴 경로를 직접 복사하다 따옴표 안에 줄바꿈이 들어가는 실수를 피할 수 있다. 시작 안내에서 `common engine · UI on`을 확인한다. 기존 `build/shared-live/` 바이너리는 덮어쓰지 않는다.

터미널의 새 탭에서 실행하고 **그 명령으로 열린 Claude 세션**에 아래 프롬프트를 입력한다. 기존 세션을 종료하거나 설정을 바꾸지 않는다. 다른 환경에서는 `claude:shared -- --coordinator-bin … --cwd …` 형식으로 현재 소스의 테스트 define 없는 제품 빌드와 프로젝트를 지정한다. `build/` 산출물은 Git에 포함되지 않는다.

**[프롬프트 시작 — 연결 확인]**

```text
Blabee 연결만 확인해 줘.
check_connection_v1을 호출하고,
연결 확인 Channel 메시지가 오면 ack_readiness_probe_v1으로 응답해 줘.
파일 변경이나 다른 작업은 하지 마.
```

**[프롬프트 끝]**

성공 기준은 실제 ACK 응답의 `ready: true`다. MCP 등록만으로 수신 확인을 완료했다고 판단하지 않는다. 도구가 없으면 실제 등록된 이름을 먼저 확인한다. `_v1`이 없는 도구는 독립 개발 버전이므로 대신 호출하지 않는다. 연결 확인 후 [공통 Pet의 A/B 클릭 테스트](../../bridges/claude/COMMON_PET.md#실제-claude에서-버튼-테스트)를 진행한다. 상세 계약과 검증 경계는 [NATIVE_SESSION.md](../../bridges/claude/NATIVE_SESSION.md)를 따른다.

## 기존 독립 개발 앱 실행

요구 사항: macOS 13 이상, Swift 6 컴파일러, Node.js 22 이상, Claude Code 2.1.248 이상. 현재 빌드는 이 checkout과 빌드할 때 사용한 로컬 Node 경로에 의존한다. 다른 컴퓨터로 복사해 설치하는 배포용 패키지는 아니다.

```sh
cd /Users/joo/BiaDone/apps/blabee/claude
npm ci --ignore-scripts --cache ./build/npm-cache
npm run build
npm run app
npm run doctor
npm run claude -- --cwd /path/to/project
```

`doctor`의 `coordinator.reachable`이 `true`이면 개발용 서비스에 접속할 수 있다는 뜻이다. Claude의 채널 수신 확인은 별도로 필요하다. 앱을 처음 연 직후에는 서비스 준비에 잠깐 시간이 걸릴 수 있다. 다시 빌드하기 전에는 메뉴 막대의 **Blabee Claude 종료**로 앱을 종료한다. 빌드 스크립트는 실행 중인 앱을 덮어쓰지 않는다.

launcher는 새 Claude 세션을 만들고 해당 세션에만 Hook·MCP 설정을 전달한다. 처음에는 Claude의 개발용 Channels 확인 화면이 표시될 수 있으며, 계정·조직 정책에서 Channels를 허용해야 한다. 도구 실행 권한은 Claude의 기존 승인 화면에서 확인한다. [공식 Channels 안내](https://code.claude.com/docs/en/channels), [개발 서버 연결 규약](https://code.claude.com/docs/en/channels-reference).

세션을 연 뒤 Claude Code에 **“Blabee 연결을 확인해 줘”**라고 요청한다. `check_connection`이 만든 일회성 확인 메시지를 Claude가 채널로 받고 `ack_readiness_probe`로 응답해야 패널에 **선택 연결 확인됨**이 표시된다. 확인은 작업 선택·실행이나 권한 승인을 만들지 않는다. 도구의 원래 승인 절차는 그대로 따른다. 메시지를 쓰는 데 성공했거나 MCP가 연결된 것만으로 확인을 완료하지 않는다.

Claude에서 작업을 요청하면 Hook이 현재 세션과 작업 경계를 전달하고, 모델의 `emit_decision` 제안을 패널에 표시한다. 응답이 멈추고 채널 수신 확인이 유효한 동안 선택할 수 있다. 클릭한 선택의 ref가 같은 Claude 세션에 전달되고, `claim_selection`으로 작업을 한 번 가져온 뒤 `complete_selection`으로 결과를 보고한다. 완료 표시는 모델의 보고이며 별도 테스트 결과를 대신하지 않는다.

이미 claim한 작업은 새 사용자 입력이 와도 원래 `selection_id`로 결과를 보고할 수 있다. 현재 세션과 브릿지의 권한이 유효해야 하며, 이전 결과는 원래 작업의 journal 감사 기록에만 남고 새 카드나 작업 상태를 바꾸지 않는다. 현재 패널에는 과거 작업 목록을 추가하지 않았다. 이 기능은 과거 작업의 재실행 허가가 아니며, 아직 claim하지 않은 선택은 새 입력에 의해 무효화된다. 세션 종료·Coordinator 재시작 후에는 이전 보고 권한을 복원하지 않는다.

개발용 기본값은 확인 메시지 기한 30초, 수신 확인 유효 기간 5분이다. 확인이 만료되거나 브릿지가 재연결되면 다시 연결 확인을 요청한다. 현재 패널은 미확인과 만료를 모두 “Claude 연결 확인 필요”로 표시한다. 연결 확인만 요청하면 선택지는 생성되지 않는다. 선택 실행을 테스트하려면 확인 완료 후 5분 안에 별도로 작업 선택지를 요청하고 패널에서 선택한다. 수신되지 않은 메시지와 실패한 선택을 자동 재전송하지 않는다. 이번 IPC 변경 전의 개발 앱이 실행 중이면 정상 종료 후 다시 빌드해야 한다. 이전 서비스와 새 MCP 브릿지를 섞어 쓰는 조합은 지원하지 않는다.

기존 Claude 세션에 연결하거나 `resume`, `continue`, 비대화형 `--print`로 실행하는 기능은 이 버전에 포함하지 않는다. `Plugin/`은 workflow 참고 파일이며 설치 가능한 플러그인 패키지가 아니다.

개발 runtime을 따로 지정하려면 앱과 launcher에 같은 절대 경로를 전달한다.

```sh
npm run app -- --runtime /absolute/path/to/claude/build/isolated-runtime
npm run claude -- --runtime /absolute/path/to/claude/build/isolated-runtime --cwd /path/to/project
```

runtime은 소유자 전용 디렉터리여야 하고 전체 socket 경로는 103바이트 이하여야 한다. 알 수 없는 기존 socket이나 잠금을 자동 삭제하지 않는다. 충돌이 있으면 사용 중인 Claude 앱을 정상 종료하거나 별도 개발 runtime을 사용한다.

## 개발용 수정본 적용

Claude Code 2.1.276에서는 선택 Channel을 받을 때도 UserPromptSubmit Hook이 발생한다. 이 메시지를 새 사용자 지시로 취급해 `invalid_selection`이 발생하던 경로를 수정했다. 지금 전송한 선택 메시지와 정확히 일치할 때만 기존 선택을 유지하고, 일반 사용자 입력은 아직 claim하지 않은 이전 선택을 무효화한다. 추가로 C-L01에서는 이미 claim한 작업의 늦은 결과 보고를 최신 작업과 분리했다. 기존 A 선택의 실제 성공과 C-L01의 자동 검증 범위는 [QA_REPORT.md](../../../dev/claude-standalone/docs/QA_REPORT.md)에 구분한다.

소스 수정은 이미 실행 중인 Coordinator나 MCP 프로세스에 자동 반영되지 않는다. 기존 Claude 테스트 세션에서 `/exit`를 입력하고 **Blabee Claude** 앱을 정상 종료한 뒤 아래 순서로 새로 실행한다.

```sh
cd /Users/joo/BiaDone/apps/blabee/claude
npm run build
npm run app
npm run claude -- --cwd "$PWD/build/live-test"
```

새 세션에서 연결 확인 → A/B 제안 → A 클릭을 다시 진행한다. 이전에 실패한 선택 참조는 재사용하지 않는다. 자세한 검증 범위는 [QA_REPORT.md](../../../dev/claude-standalone/docs/QA_REPORT.md)를 따른다.

## 독립 검증용 런타임

설치된 `Blabee.app`은 그대로 유지한다. 검증용 앱은 `build/blabee-claude.app`이며 Bundle ID는 `com.biadone.blabee.claude`다. 앱·서비스·socket·journal·Pet 잠금을 분리한다. 이름과 경로, 동시 실행 검증 기준은 [APP_SEPARATION.md](../../../dev/claude-standalone/docs/APP_SEPARATION.md)를 따른다. 이 분리는 개발 중 충돌을 줄이기 위한 것으로, 최종 배포 제품을 두 엔진으로 유지한다는 뜻은 아니다.

개발 버전의 기본 runtime은 `build/runtime/blabee-claude/`다. 앱이 Coordinator를 자식 프로세스로 실행하고 자기 자식만 종료한다. LaunchAgent 등록, `/Applications` 설치, 전역 Claude 설정 변경은 하지 않는다. 이 개발 버전의 소스는 `claude/` 안에 두며, 사용자가 선택한 공통 연결 계층은 상위 Swift package에 한 번만 구현한다.

## 조사 결과

[RESEARCH.md](../../bridges/claude/RESEARCH.md)는 구현 전 조사 기록이다. 실제 구현 계약은 [IMPLEMENTATION_PLAN.md](../../../dev/claude-standalone/docs/IMPLEMENTATION_PLAN.md), 현재 검증 결과와 남은 확인은 [QA_REPORT.md](../../../dev/claude-standalone/docs/QA_REPORT.md)를 따른다. 선택 왕복은 실제 Hook 자식 프로세스·MCP SDK·UDS를 사용하는 자동 테스트에서 통과했다. 실제 Claude 모델을 호출한 결과와는 구분한다.

## 폴더 구성

```text
claude/
├── AGENTS.md       # 이 폴더의 작업 범위와 규칙
├── CLAUDE.md       # Claude Code용 작업 안내
├── README.md
├── APP_SEPARATION.md # 독립 제품의 식별자·경로·동시 실행 기준
├── RESEARCH.md     # 공식 문서와 기존 코드에 근거한 호환성 조사
├── NATIVE_SESSION.md # 공통 실행 파일의 새 세션·Hook·MCP 연결 규격
├── COMMON_PET.md   # 기존 공통 UI 연결과 실제 버튼 테스트
├── .gitignore
├── IMPLEMENTATION_PLAN.md # 구현 범위와 IPC 계약
├── QA_REPORT.md    # 검증 결과와 남은 확인
├── package.json
├── Plugin/         # workflow 참고 파일
├── scripts/        # 빌드·앱 실행·Claude launcher
├── src/
│   ├── pet/        # Swift/AppKit 선택 패널
│   ├── coordinator/ # Node 서비스와 JSON journal
│   ├── bridge/     # Claude Hooks·MCP Channels
│   └── shared/     # 제품 식별자·UDS client
├── tests/          # 테스트와 픽스처
└── build/          # 빌드 결과와 임시 실행 데이터
```

빈 폴더는 `.gitkeep`으로 보존한다. `build/`의 생성물은 Git에서 제외한다.

## 작업 경계

독립 브릿지 개발은 이 폴더 안에서 진행한다. 사용자가 선택한 공통 Coordinator 접속 작업에서는 어댑터를 `../src/coordinator-swift/Sources/ClaudeCoreAdapter/`로 이동하고 패키지·daemon 조립·UDS 접수에 필요한 부분을 수정했다. `Contracts/v1`, 기존 Codex Hook/MCP 진입점과 설치된 실행 환경은 유지한다. 상세 변경 범위는 [접속 경로 문서](../../bridges/claude/PRODUCT_INGRESS.md)를 따른다.

이 README의 개발 실행 명령은 기존 Blabee의 앱·서비스·소켓·데이터를 사용하거나 교체하지 않는다. Claude 연결 실패 시 Codex로 fallback하지 않는다. 개발 launcher의 세션 설정은 `build/sessions/`에 생성하며 인증 토큰은 파일에 쓰지 않는다. 새 공통 Coordinator 접속 경로의 별도 private 설정 규격은 [PRODUCT_INGRESS.md](../../bridges/claude/PRODUCT_INGRESS.md)를 따른다.

## Git과 실행 상태

- 일반 하위 폴더이므로 부모 checkout의 Git 브랜치를 공유한다.
- GitHub에 만든 `claudecode` 브랜치로 자동 전환되거나 연결되지 않는다.
- 다른 세션을 보호하기 위해 현재 checkout에서 브랜치를 전환하지 않는다. 독립적인 브랜치 작업에는 별도 worktree를 사용한다.
- 이 폴더에서 `npm run check`로 JavaScript 구문, `npm test`로 Node·Swift transport·세션 왕복 테스트를 실행한다. `npm run build`가 Swift 컴파일과 앱 서명을 수행한다. 앱에 의존하는 테스트 전 빌드가 필요하다. 상위 프로젝트의 명령을 대신 실행하지 않는다.

작업을 시작하기 전에 [AGENTS.md](../../../bridges/claude/AGENTS.md)를 읽는다.
