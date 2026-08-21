# Blabee 코드맵

상태: v0.1 설계 코드맵 + T-006 v1 계약 패키지 + disposable M0 스파이크. `Contracts/v1`은 규범 계약이고 `spikes/m0/`는 타당성 증거이며 공개 제품 런타임은 아니다.

## 현재 상태와 표기

기획 시작 당시 `/Users/joo/BiaDone/apps/blabee`에는 제품 소스가 없었다. 현재는 런타임 독립 v1 계약이 `Contracts/v1`, 실행 가능한 계약 자료가 `Fixtures/v1`, 오프라인 검증기가 `Tests/Contracts`에 구현되어 있다. Hook/MCP, fake coordinator, Git 체크포인트, 런타임 벤치마크와 실제 Codex harness는 `spikes/m0/`의 타당성 증거다. macOS Pet, installer, 운영 ledger와 production coordinator는 아직 구현되지 않았다.

- **제품 계약**: v0.1에서 지켜야 하는 의미와 안전 불변식이다.
- **재사용 증거**: 인접한 `apps/blabase/suggestion` 구현에서 직접 확인한 패턴이다.
- **구현 후보/스파이크**: 계약 검증과 측정 전에는 production 구조로 간주하지 않는다.

특히 TypeScript/Node는 Hook·MCP 왕복을 빠르게 확인하기 위한 스파이크 후보이고, Swift helper와 소형 독립형 시스템 바이너리는 배포 특성을 비교할 후보일 뿐이다. 공개 코디네이터의 구현 언어와 프로세스 토폴로지는 아직 확정하지 않는다. 네이티브 macOS Pet UI는 SwiftUI/AppKit 제품 경계로 유지한다.

## v0.1 도메인 경계

| 경계 | 소유 책임 | 소유하지 않는 책임 |
|---|---|---|
| Codex Plugin | `SessionStart`, `UserPromptSubmit`, 도구 수명 주기, `PermissionRequest`, `Stop` Hook과 로컬 MCP 제안 채널 | 카드 검증, 로컬 근거 판정, Git 복원, 네이티브 권한 승인 |
| Local MCP proposal bridge | Codex가 만든 구조화된 결정 제안을 현재 세션·턴·프롬프트에 연결 | 결정 패킷 봉인, 슬롯 활성화, 자동 실행 |
| Episode registry | 최신 `source_prompt_id`/`source_turn_id`와 `episode_id`, `episode_root_prompt_id`, `episode_baseline_checkpoint_id`의 수명 주기 및 연속 진행 연결 | 프롬프트 의미 분류, 파일 복원 |
| Decision coordinator | 제안 검증, 반고정 슬롯 조립, 위험 게이트, 세션별 활성 패킷, 전역 전면 카드, 대기열, 원자적 선점, timeout·stale 판정 | 모델 추론, Codex 네이티브 요청을 1~4 카드로 변환 |
| Checkpoint/Rollback | 프롬프트 제출 직전 기준선, 복원 적격성, 복구 스냅샷, episode 전체 복원과 검증 | Codex `thread/rollback`, 외부 시스템 보상 |
| Native request bridge | Codex 네이티브 요청을 별도 타입으로 보관하고 Pet 알림에서 원래 Codex UI를 여는 연결 | 공개 v0.1에서 허용·거부 또는 답변 중계 |
| macOS Pet | 활성 결정 카드, 고정 슬롯 위치, disabled 이유, 고위험 확인, timeout, 네이티브 요청 알림 표시 | 숫자만 Codex에 전송, 네이티브 승인 대행, 정책 우회, 파일 복원 |
| Local ledger | 이벤트, episode, 제안, 패킷, 선택 claim, 결과, 체크포인트와 재개 캡슐의 로컬 기록 | 원격 추론 또는 클라우드 동기화 |
| Installer/Doctor | Plugin 설치·신뢰·제거, Codex 버전 allowlist, 프로젝트 활성화 진단 | 사용자 `codex` 교체, 셸 설정의 무단 수정 |

## 핵심 도메인 모델

```text
PromptEpisode
├─ session_id
├─ episode_id
├─ episode_root_prompt_id        # 사람이 입력한 시작 프롬프트
├─ episode_baseline_checkpoint_id
├─ prompts[]
│  ├─ source_prompt_id + source_turn_id
│  └─ prompt_origin: human
├─ continuations[]                  # pet_action/format repair는 새 episode를 만들지 않음
└─ rollback_eligibility

DecisionProposal
└─ correlation_token + recommended action + optional alternative

DecisionPacket
├─ packet_id + revision + valid_after_event_sequence
├─ source_prompt_id + source_turn_id + episode_id
├─ episode_root_prompt_id + episode_baseline_checkpoint_id
├─ decision_boundary_id + boundary_sequence
└─ slots
   ├─ 1: recommended, dynamic, enabled
   ├─ 2: alternative, dynamic, optional/disabled + disabled_reason
   ├─ 3: pause, fixed meaning
   └─ 4: rollback, fixed meaning, eligibility-gated + disabled_reason

ContinuationEnvelope
├─ common: one-time token + session/episode/baseline + source turn/prompt + decision boundary
├─ pet_action: same_turn_stop + packet/revision/option/action + in-flight deadline
└─ internal_format_repair: submitted_envelope + repair request/kind/attempt, exactly once

RuntimeEvent
├─ pet_action: dispatched → consumed → transport completed/timeout → work outcome
└─ internal_format_repair: reserved → claimed
   └─ reserved가 boundary당 1회 예산의 durable 진실 원본, token 원문 대신 fingerprint만 저장

NativeCodexRequest
└─ native_request_id + session/turn correlation + original UI locator
```

반고정 슬롯의 위치 의미는 바뀌지 않는다.

1. 현재 패킷이 권장하는 구체적인 다음 작업이다.
2. 현재 패킷의 구체적인 대안 작업이다. 안전하고 의미 있는 대안이 없으면 disabled이며 다른 기능으로 재사용하지 않는다.
3. 현재 상태를 보류하고 재개 캡슐을 저장한다.
4. 이 카드를 만든 활성 prompt-bounded episode 하나를 `episode_baseline_checkpoint_id` 상태로 복원한다. 적격하지 않으면 disabled 이유를 표시한다.

Pet은 `"1"` 또는 `"2"`만 보내지 않는다. `interaction_id`, `packet_id`, `revision`, `option_id`를 제출하면 코디네이터가 봉인된 작업 목표·제약·완료 기준을 다시 조회한다. Codex 0.148 Hook 경로에서는 `same_turn_stop` 전용 지시로 대기 중인 `Stop`을 해제하므로 새 `source_turn_id`나 `UserPromptSubmit`을 만들지 않는다. 해당 지시와 후속 Stop 완료는 기존 `episode_id`, `episode_root_prompt_id`, `episode_baseline_checkpoint_id`에 귀속된다. 사람이 새 작업 프롬프트를 직접 입력할 때만 다음 episode가 시작된다.

### 실제 M0 스파이크 트리

```text
spikes/m0/
├── plugins/blabee-m0/       # Plugin manifest, Hook, local MCP
├── coordinator/             # disposable Node JSONL/UDS coordinator
├── checkpoint/              # temp Git fixture-only safety/rollback
├── integration/             # actual codex-cli contract harness
├── runtimes/                # Node/Swift/C health candidates
├── sentinel/                # isolated smoke parser, operational path 아님
├── scripts/                 # runtime benchmark
└── tests/                   # 53 passing tests
```

### 실제 T-006 계약 트리

```text
Contracts/v1/
├── manifest.json                  # 10개 Draft 2020-12 스키마의 오프라인 $id 목록
├── common.schema.json             # 공용 ID, 시간, 에피소드·결정 경계 binding
├── action.schema.json
├── prompt-episode.schema.json
├── decision-proposal.schema.json
├── decision-packet.schema.json
├── selection-request.schema.json
├── continuation-envelope.schema.json
├── runtime-event.schema.json
├── native-request.schema.json
└── resume-capsule.schema.json

Fixtures/v1/
├── manifest.json                  # 유효 15 + 무효 10 계약 사례
├── contracts/{valid,invalid}/
└── event-traces/                  # 7개: 경계 1→2, stale/binding/timeout, repair journal/restart

Tests/Contracts/
├── contract-harness.mjs           # strict/offline Ajv 컴파일과 오류 코드 매핑
├── rfc3339.mjs                    # 실재 달력 날짜를 확인하는 오프라인 date-time 형식
├── decision-packet-semantic.mjs   # 교차 슬롯 ID·체크포인트 의미 불변식
├── continuation-claim.mjs         # 테스트용 일회성·만료·exact-binding 의미 검증기
├── semantic-trace.mjs             # 경계·전송·결과 이벤트 의미 검증기
└── v1-contracts.test.mjs          # 102개 계약 검사
```

이 트리는 런타임 언어와 무관한 규범 계약이다. `continuation-claim.mjs`와 `semantic-trace.mjs`는 계약을 실행하는 테스트용 참조 검증기이며 운영 코디네이터가 아니다.

## 제안 소스 트리

```text
apps/blabee/
├── RESEARCH.md
├── TECH_SPEC.md
├── IMPLEMENTATION_PLAN.md
├── CODEMAP.md
├── AGENT_TASKS.md
├── TASK_STATUS.md
├── Contracts/v1/                   # 구현됨: 규범 스키마 10개 + manifest
├── Plugin/
│   ├── .codex-plugin/plugin.json
│   ├── hooks/hooks.json
│   ├── skills/blabee-decision/SKILL.md
│   └── mcp/                         # 운영 proposal transport; 구현 언어 미정
├── Coordinator/                     # 구현 언어·프로세스 토폴로지 미정
│   ├── Domain/
│   │   ├── Episodes/
│   │   ├── DecisionCards/
│   │   ├── NativeRequests/
│   │   └── Timeouts/
│   ├── Application/
│   │   ├── RegisterPromptBaseline/
│   │   ├── AssembleDecisionPacket/
│   │   ├── ClaimSelection/
│   │   ├── RouteForegroundInteraction/
│   │   ├── MaterializeEpisodeContinuation/
│   │   ├── BuildFormatRepair/
│   │   ├── PauseEpisode/
│   │   └── RestoreEpisode/
│   └── Ports/
│       ├── CodexHookPort/
│       ├── CheckpointPort/
│       ├── LedgerPort/
│       └── PetTransportPort/
├── Adapters/
│   ├── GitCheckpoint/
│   ├── LocalTransport/
│   ├── LocalLedger/
│   └── CodexPlugin/
├── MacOSApp/
│   ├── Pet/
│   ├── NativeRequestNotification/
│   ├── StatusItem/
│   ├── Onboarding/
│   └── Settings/
├── Packaging/
│   ├── PluginInstaller/
│   ├── Doctor/
│   ├── DMG/
│   └── Notarization/
├── Spikes/                           # production 의존성 아님
│   ├── HookStopRoundTrip/
│   ├── MCPProposalRoundTrip/
│   ├── CoordinatorRuntimeComparison/
│   └── AppServerManagedMode/
├── Tests/
│   ├── Contracts/                  # 구현됨: 오프라인 계약·의미 테스트
│   ├── Episodes/
│   ├── DecisionCards/
│   ├── Rollback/
│   ├── HookIntegration/
│   ├── NativeRequests/
│   └── MacOS/
└── Fixtures/
    ├── v1/                         # 구현됨: 계약 25개 + event trace 7개
    ├── hooks/
    ├── checkpoints/
    └── codex-versions/
```

## 의존성 방향

```text
Codex Plugin ───────────────┐
macOS Pet ──────────────────┼──> Coordinator Application ──> Domain
Installer / Doctor ─────────┘               │
                                            └──> Ports
                                                  ▲
                              Git / Ledger / Local IPC adapters
```

Domain은 AppKit, Hook 실행 형식, MCP 서버 구현 언어, Git 명령, SQLite 드라이버에 의존하지 않는다. Plugin은 제안을 제출하고 선택 결과를 전달할 뿐 로컬 근거·위험·롤백 가능성을 권위 있게 결정하지 않는다.

## 운영 런타임 흐름

### 프롬프트 기준선과 episode

```text
UserPromptSubmit
  ├─ 사람이 직접 입력한 새 작업 프롬프트
  │    → source_prompt_id / source_turn_id 확정
  │    → episode_id / episode_root_prompt_id 발급
  │    → Git clean-worktree 및 제외 경계 검사
  │    → episode_baseline_checkpoint_id 생성·봉인
  │    └─ Codex에 프롬프트 전달
  └─ 내부 형식 보정 submitted_envelope
       → 전체 봉투 + 일회성 token + dispatch_mode 검증
       → 기존 episode에 귀속
       └─ 동일 결정 경계에서 최대 한 번

Pet 1/2 선택
  → packet/revision/option 원자적 claim
  → held Stop에 same_turn_stop 전용 전체 작업 지시 반환
  → 같은 session/turn의 stop_hook_active 재진입으로 소비·완료 확인
  └─ UserPromptSubmit 경로 재사용 거부
```

Pet 1·2 연속 진행, 도구 호출, 하위 에이전트, 네트워크·Hook 전달의 기계적 retry는 모두 현재 episode에 귀속한다. 내부 형식 보정은 선택 봉투와 구분하고 같은 결정 경계에서 한 번만 허용한다. 사용자가 새 텍스트 프롬프트를 직접 제출할 때만 새 episode와 기준선을 만든다.

### 결정 카드와 선택

```text
Codex turn
  → 운영 로컬 MCP emit_decision
  → proposal/session/turn/prompt correlation 검증
  → Stop Hook
  → local evidence + rollback eligibility로 packet 봉인
  → Pet에 반고정 1/2/3/4 카드 표시
  → packet_id + revision + option_id 원자적 claim
     ├─ 1 recommended ─┐
     ├─ 2 alternative ─┴─> 전체 작업 의미를 같은 episode의 continuation으로 materialize
     ├─ 3 pause ──────────> resume capsule 저장 후 Stop 종료
     └─ 4 rollback ───────> 현재 episode 전체 복원·검증 후 결과 기록
```

운영 제안 채널은 Hook-first + 번들 로컬 MCP다. 일반 최종 답변의 자연어 파싱이나 sentinel은 공개 경로가 아니며, app-server도 v0.1 Hook 루프의 숨은 의존성이 아니다.

### Codex 네이티브 요청

```text
PermissionRequest / Codex native request
  → NativeCodexRequest로 별도 등록
  → 결정 패킷과 다른 Pet 알림
  → 원래 Codex UI 열기
  → 원래 Codex UI가 응답 소유
```

네이티브 요청은 슬롯 1~4로 변환하지 않는다. 공개 v0.1의 권한 요청은 notification-only이며 Pet이 허용·거부를 전송하지 않는다. 완전 중계는 app-server 관리형 모드의 별도 후속 경계다.

## Stop, timeout, stale 보호

- 코디네이터에 2초 안에 연결하지 못하면 Hook은 Codex 종료를 막지 않고 fail-open한다. 다만 Blabee 자동 동작은 실행하지 않는다.
- 유효한 제안이 없으면 `Stop`은 즉시 정상 종료한다.
- 유효한 카드가 있으면 60초에 한 번 다시 알리고, 120초에 패킷을 만료한다.
- 만료 시 어떤 슬롯도 자동 선택하지 않으며 재개 캡슐을 저장한다.
- 만료 후 입력, 이전 `packet_id`/`revision`, 더 오래된 event sequence, 예상 episode·상태가 다른 입력은 거부한다.
- 120초 만료는 선택 전 대기 패킷에 적용한다. T-006은 dispatch 뒤 `in_flight_deadline_at`과 timeout 결과 `unknown`·자동 재시도 금지, 형식 보정 예약·claim의 durable replay 계약을 고정했다. 실제 단조 시계, 원자적 journal append, 재시작 복구와 성공/실패 outcome 수집은 T-007 상태 머신이 소유한다.
- 세션마다 활성 Pet 상호작용은 하나이며, 선택 claim은 원자적으로 한 번만 성공한다.
- 시스템 전체의 전면 카드는 하나뿐이다. 추가 세션 카드는 대기열에 남고 새 카드가 전면 대상을 자동으로 빼앗지 않는다.
- 전역 단축키는 화면에서 명시적으로 선택된 전면 카드의 프로젝트·세션·에피소드·패킷 ID가 모두 맞을 때만 적용한다.
- 선택 처리 중 더 새로운 턴·프롬프트·패킷이 생기거나 기준 branch/HEAD가 바뀌면 실행 전에 stale로 중단한다.

## v0.1 체크포인트와 롤백 경계

결정 카드를 봉인할 때 카드의 최신 `source_prompt_id`, `source_turn_id`와 `episode_id`, `episode_root_prompt_id`, `episode_baseline_checkpoint_id`를 함께 고정한다. 슬롯 4는 사람이 입력한 시작 프롬프트부터 현재 카드까지 이 episode가 만든 변경 전체만 복원하며 이전 episode나 Blabee 도입 전 상태까지 넓히지 않는다.

v0.1에서 rollback은 사람이 episode를 시작하는 프롬프트를 입력하기 직전 Git 작업 트리가 깨끗하고 checkpoint가 완전하게 검증된 경우에만 활성화한다. 이미 변경이 있으면 1, 2, 3은 사용할 수 있지만 4는 disabled다. Pet 1·2 연속 진행은 같은 기준선을 사용하므로 clean-worktree gate를 다시 적용하지 않는다.

복원 순서:

1. 프로젝트·세션 잠금과 선택 claim을 검증한다.
2. 현재 상태가 카드 봉인 후 기대 상태와 같은지 검사하고 stale·동시 편집이면 중단한다.
3. 복원 직전 복구용 스냅샷을 만든다.
4. `episode_baseline_checkpoint_id`의 파일·모드·인덱스 상태로 episode 전체를 복원한다.
5. 해시와 범위를 재검증하고 ledger에 결과를 기록한다.

v0.1 복원 제외 경계:

- 무시 파일, 하위 모듈, Git LFS 객체
- 저장소 밖 파일과 외부 시스템 부수 효과
- 파일당 16 MiB, 체크포인트당 128 MiB, 프로젝트 보관량 1 GiB 한도 초과
- branch/HEAD 변경, 동시 편집, 불완전 checkpoint, 봉인 후 예상하지 못한 상태 변화
- `assume-unchanged`, `skip-worktree`/sparse index, `core.filemode=false`
- Git이 추적하지 않는 POSIX mode 변경과 위험 attestation의 `unknown`

episode가 제외 경계를 건드리거나 범위가 부분적이면 완전 롤백을 주장하지 않고 슬롯 4를 비활성화한다. Codex app-server의 `thread/rollback`은 대화 기록용이며 이 경계의 파일 복원 구현으로 사용하지 않는다.

프로젝트 보관량 정리는 종료된 episode의 오래된 체크포인트부터 수행하고 활성·보류 기준선, 대기 패킷 참조, 최신 복구 스냅샷은 보호한다. 보호 대상을 유지한 채 1 GiB 아래로 내릴 수 없으면 새 롤백만 비활성화한다. Git 저장소가 아니면 1·2·3은 유지하고 4는 `not_a_git_repository`로 비활성화한다.

Pet의 1·2는 작업 지시이지 Codex 네이티브 승인이 아니다. `high`·`critical` 위험 작업은 전역 숫자 단축키로 시작하지 않고 펼친 위험 확인을 요구하며, 이후 필요한 권한 승인은 원래 Codex UI가 계속 소유한다.

## 인접 Blabase 재사용 증거

| `apps/blabase/suggestion` 아래의 기존 경로 | 확인한 책임 | Blabee 재사용 경계 |
|---|---|---|
| `desktop/macos/Sources/BlabaseLauncher/GlobalHotKey.swift` | Carbon 등록·해제와 MainActor 콜백 | 단축키·signature·충돌 UX를 Blabee 계약으로 교체 |
| `desktop/macos/Sources/BlabaseLauncher/LauncherPanelController.swift` | borderless NSPanel 배치와 activation-safe presentation | 기존 `didResignActive → hide`와 transient 동작은 상시 Pet 요구와 충돌 |
| `desktop/macos/Sources/BlabaseLauncher/StatusItemController.swift` | 메뉴 막대 골격, 좌·우 클릭 라우팅, template icon fallback | Blabase 설정·대시보드·로그인 항목 제거 |
| `desktop/macos/Sources/BlabaseLauncher/LauncherAgentClient.swift` | child-process supervisor, request correlation, timeout/cancel, generation·retirement 보호 | attention/work-board projection, 로그 경로, bundle 설정에서 supervisor core만 분리 후보 |
| `desktop/macos/Sources/BlabaseLauncher/LauncherIPC.swift` | strict envelope, 64 KiB 제한, request ID, 안전한 오류 표시 | `blabase-launcher-ipc-v1` 및 제품 method는 재사용하지 않음 |
| `src/launcher/jsonl.ts` | CR/LF framing, split chunk, oversize recovery, abort, backpressure | 요청당 응답 하나인 계약은 Pet push event에 충분하지 않으므로 codec만 추출 후보 |
| `src/connectors/codex/appServerWebSocket.ts` | loopback app-server spawn, initialize, JSON-RPC correlation, ordered callback, cleanup | Hook-first v0.1 production 의존성이 아니라 관리형 모드 스파이크 근거 |
| `src/managedCodex/runtime.ts` | single-flight session, epoch, notification ordering, reconnect | Blabase ownership lease·store·managed-run 결합 제거; v0.1 주 경로로 복사하지 않음 |
| `src/resumption/companion/terminal.ts` | Terminal AppleScript로 `codex resume --remote` 실행 | 터미널 고정이므로 핵심 경로에서 재사용하지 않음 |
| `desktop/macos/scripts/` | Swift app, bundled helper, DMG, 검증, 서명·공증 단계 | 이름·bundle ID·Node/JIT·Apple Events 전제를 재검토한 packaging 패턴만 사용 |

관련 검증 자산은 `LauncherWindowPresentationTests.swift`, `LauncherModelSmoke.swift`, `tests/launcherJsonl.test.ts`, `tests/codexAppServerWebSocket.test.ts`, `tests/managedCodexRuntime.test.ts`다. 기존 코드 전체를 복사하면 Blabase decision/store/Terminal 계약이 함께 유입되므로 작은 창·단축키·프로세스·framing 원시 요소만 새 port/adapter 뒤에서 추출한다.

## 테스트 소유권

| 테스트 범위 | 고정해야 할 불변식 |
|---|---|
| Contracts | 슬롯 1/2 동적 의미, 2 disabled 사유, 3/4 고정 의미, 선택/형식 보정 봉투 구분, unknown field와 숫자-only 실행 거부 |
| Episodes | 사람이 입력한 프롬프트만 새 기준선을 만들고 Pet 1·2 same-turn 작업과 기계적 재시도는 같은 episode에 남음 |
| Hook integration | 운영 MCP proposal, proposal 없는 Stop 즉시 종료, same-turn Stop 전달 모드, 프로젝트 재바인딩 폐기, 2초 fail-open |
| Timeout/stale | 선택 전 60초 재알림·120초 만료·자동 선택 없음, 늦은 키·이전 리비전·중복 선점 거부, submitted-envelope의 교차 바인딩·만료·재사용 거부 |
| Rollback | clean-worktree 한 episode 복원, recovery snapshot, byte/mode/index 검증, 특수 index/filemode/unknown attestation과 비 Git·제외 경계에서 4 disabled, 1 GiB 보호 정리 |
| Native requests | 결정 카드와 분리, notification-only permission, 원래 Codex UI가 응답 소유 |
| macOS Pet | 항상 위 패널, 활성 카드 하나, disabled 상태, 고위험 단축키 차단, 단축키와 안정적 option ID 매핑 |
| Compatibility | 고정 alpha Codex fixture, 지원 allowlist, Plugin/Hook trust와 `blabee doctor` 진단 |

## v0.1 명시적 비범위

- Claude Code 및 다른 에이전트
- 일반 답변을 항상 1~4 형식으로 강제하는 AGENTS.md 설치
- 별도 Blabee LLM API 또는 클라우드 추론
- app-server 기반 완전 제어와 네이티브 권한·질문 응답 중계
- 임의 터미널 화면/OCR/PTY 감시, AppleScript 키 입력 주입
- dirty-worktree, 무시 파일, LFS, 하위 모듈, 저장소 밖 파일 또는 외부 효과의 완전 롤백
- 검증 전 TypeScript/Node coordinator 또는 Swift helper를 production 구현으로 확정하는 결정
- M0 fake coordinator의 한 턴 1회 결정 사이클을 반복 Pet workflow로 간주하는 것

## 코드 재사용 원칙

Blabase 모듈 전체를 복사하지 않는다. 재사용 후보는 작은 프로세스, JSONL framing, 창, 단축키, packaging 원시 요소로 제한하고 Blabee port/adapter 경계와 독립 테스트를 먼저 둔다. 인접 작업 트리의 변경을 되돌리거나 Blabase 제품 계약을 Blabee 계약으로 가장하지 않는다.
