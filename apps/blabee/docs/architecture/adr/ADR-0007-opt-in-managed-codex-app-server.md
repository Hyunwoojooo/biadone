# ADR-0007: App Server 권한 중계를 명시적 opt-in 관리형 실험으로 격리

- Status: Accepted (Retrospective)
- Recorded: 2026-09-05
- Revalidated: 2026-09-07 · committed HEAD `a352baa773e11a9be96c9d5b5aafca19aa5fb543` · 미커밋 변경 제외
- Original decision date: Unknown
- Scope: `blabee-codex`가 시작한 Codex App Server/TUI bridge와 command approval 중계
- Evidence maturity: adapter·broker·trust 경계 소스 및 자동 자격 진행; 설치본에서 실제 App Server 명령 완료까지의 live gate는 미완료

## Context

Hook PermissionRequest는 기본적으로 Codex UI의 승인 권위를 유지한다. 2026-09-09 확장에서는 서명된 지원 Codex 런타임의 live ancestry가 검증되고 같은 요청의 세션·턴·명령·세션 위치 바인딩이 일치할 때만, 해당 Hook 요청에 한해 `allow`를 반환한다. Hook의 cwd는 세션 위치이며 실제 명령 workdir/environment 검증이 아니다. App Server는 정확한 JSON-RPC request ID에 묶인 일회성 `accept`/`decline`을 중계할 수 있지만, 이 경로는 프로세스·신뢰·버전·중복 실행 관리가 더 복잡하고 기본 Codex 사용 의미를 바꿀 위험이 있다.

## Decision drivers

- 기본 Hook-first 경로와 고권한 App Server 경로를 격리한다.
- 사용자가 명시적으로 시작한 세션만 관리한다.
- 지원하지 않는 JSON-RPC와 일반 사용자 질문은 원래 TUI가 소유한다.
- command approval request/response를 exact ID와 연결한다.
- bridge 실패 시 승인으로 승격하거나 동일 작업을 자동 재실행하지 않는다.
- private runtime bundle의 trust·version 자격을 첫 자식 전에 확인한다.

## Considered options

원래 옵션 토론은 완전하게 보존돼 있지 않다. 아래는 현재 설계에서 재구성했다.

1. `blabee-codex` 명시 실행에만 App Server broker를 사용한다.
2. 모든 기본 `codex` 실행을 자동으로 App Server 경로로 전환한다.
3. 이미 실행 중인 임의 TUI에 attach한다.
4. App Server 권한 중계를 제공하지 않고 Hook native defer만 유지한다.

## Decision

- App Server 관리형 경로는 사용자가 `blabee-codex`를 명시적으로 실행한 경우에만 활성화한다.
- wrapper가 새로 시작하거나 resume한 세션만 관리하며, 이미 실행 중인 임의 TUI에는 붙지 않는다.
- 현재 가로채기 범위는 command approval이다. 지원하지 않는 요청과 일반 `requestUserInput`은 원래 TUI로 전달한다.
- Pet 선택은 exact JSON-RPC/request binding에 대해 `accept_once`, `decline`, `decide_in_codex` 중 하나로 해석한다. `acceptForSession`은 제공하지 않는다.
- broker/Coordinator 오류나 parse 불가 시 원본 request bytes를 TUI로 돌려보내며 자동 재시도하지 않는다.
- Pet 선택 receipt, App Server response write, App Server의 응답 소비, 실제 명령 실행·완료는 별도 증거다.
- trust/allowlist 실패는 fail-closed하며, 첫 자식 시작 전 준비 실패의 제한된 fallback만 ADR-0005 규칙을 따른다.

## 2026-09-07 구현 재검증

`a352baa`에서도 opt-in 범위와 일회성 command approval 결정은 유지된다. 변경된 broker 종료 경로는 exact TUI/App Server 자식만 제한된 시간으로 정리한다. TUI의 종료 상태를 끝내 관측하지 못하면 합성 signal 종료 상태를 반환하고, App Server 상태만 관측하지 못하면 TUI의 실제 종료 결과를 보존한다. 무기한 종료 대기를 제거한 것이며, child 시작 뒤 native 재실행을 허용한 변경은 아니다.

Pet 설정의 Plugin CLI 연결·이전 설치 마이그레이션은 별도의 실행 파일 신뢰와 호환성 경계다. 그 설정이 성공하거나 설치된 Doctor의 일반 Plugin CLI 항목이 통과해도 관리형 App Server 자격으로 승격하지 않는다. 이번 작업은 커밋 소스와 기록의 재검증이며 설치본 관리형 승인을 다시 실행하지 않았다.

## Consequences

### 2026-09-09 Hook 요청 단위 허용 근거

이 추가 기록은 위 `a352baa` 재검증과 별개인 미커밋 r18 후보 소스에 해당한다.
Codex `rust-v0.153.4`의 [approvals.rs](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/core/src/tools/approvals.rs)는
Hook Allow를 `ReviewDecision::Approved`로 직접 반환한다.
[sandboxing.rs](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/core/src/tools/sandboxing.rs)는
`ApprovedForSession`만 캐시에 저장한다. 이 소스 근거와 Blabee 회귀 테스트는
해당 요청 단위 허용을 지지하지만 설치된 Pet 클릭과 실제 명령 실행을 대신하지 않는다.
서명된 0.153.4 arm64 고정 CDHash·현재 ancestry를 입력/출력 시 재검증하고, 미검증
연결에서는 허용 버튼을 제공하지 않는다. 입력 자격 표식을 신뢰하거나 세션 허용 정책을
출력하지 않는다. 다른 버전·아키텍처로 이 자격을 자동 확장하지 않는다.
launcher는 coordinator stdout을 종료까지 버퍼링하므로 delivery ACK는 adapter 출력
접수일 뿐 native Codex 소비·실행 성공의 증거가 아니다.


긍정적 결과:

- 기본 Codex 경로와 실험적 고권한 경로의 blast radius를 분리한다.
- 한 request에 대한 일회성 승인만 전달해 세션 전체 승인을 피한다.
- bridge 실패가 암묵적 승인이나 중복 실행으로 바뀌지 않는다.

비용과 제약:

- App Server, TUI, WebSocket/JSONL bridge, private runtime bundle의 수명 주기를 추가로 관리해야 한다.
- broker와 자식 상태는 durable journal에 저장하거나 daemon 재시작 뒤 재생하지 않는다.
- source/unit/integration 통과만으로 설치본 Pet↔App Server↔실제 명령 결과를 증명하지 않는다.
- 현재 경로는 opt-in experimental이며 공개 기본 경로로 간주하지 않는다.

## Evidence

아래 링크는 모두 재검증한 커밋에 고정한다. 문서의 과거 자동 시험·설치 기록은 원 실행 날짜의 증거다.

- 결정 계약: [Hook-first와 native/managed 경계](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L26-L45), [명시적 관리형 mode와 command approval 범위](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L635-L687), [receipt/write/실행 완료 및 global FIFO의 증거 분리](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L689-L710).
- 구현/소스: [parse/Coordinator 실패 시 원본 요청을 TUI로 돌리는 router](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/ManagedCodexApprovalRuntime.swift#L325-L413), [제한된 child cleanup과 종료 결과](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/ManagedCodexLauncher.swift#L245-L285), [private bundle·pre-child fallback 계약](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/docs/MANAGED_CODEX_TRUST.md#L53-L84).
- 별도 Plugin 설정 경계: [명시적 migration confirmation과 ownership 재검증](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/CodexPluginSetup.swift#L1331-L1362), [작업 중 고정한 trust 증거와 남은 same-UID 경계](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/CodexPluginSetup.swift#L711-L742).
- 자동 자격과 live gate: [Doctor의 production/live 구분 계약](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/docs/MANAGED_CODEX_TRUST.md#L105-L124), [r8 기록의 Plugin CLI/관리형 자격 분리와 미실행 항목](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/T012_APP_BUNDLE_REPORT.md#L155-L175).

## Supersedes / Superseded by

- Supersedes: None known; Hook-first 기본 경로를 대체하지 않는 별도 실험이다.
- Superseded by: None known.

## Related views

- [C4 시스템 컨텍스트](../c4/system-context.html)
- [C4 컨테이너](../c4/container.html)
- [관리형 승인 시퀀스](../runtime/managed-approval.html)
