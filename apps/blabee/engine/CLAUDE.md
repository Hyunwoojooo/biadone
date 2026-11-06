# Engine 영역 안내

SwiftPM 타깃 `CoordinatorSwift`의 핵심이다. Codex·Claude Hook/MCP에서 들어온 v1 JSON을 strict 검증하고,
결정 상태 전이를 event-sourced 방식으로 append-only SQLite journal에 원자적으로 기록한다.
AppKit·SwiftUI·브릿지 모듈을 import하지 않는다. `Tests/support/reference-engine`의 Node 구현은 계약 검증용 참조이며 권위 엔진은 Swift다.

## 개념

- turn → **episode**(`episode_id`, root prompt, baseline checkpoint) → 여러 **decision boundary**(`decision_boundary_id`, `boundary_sequence`).
  모든 이벤트는 project/session/turn/prompt/episode/boundary 전체 binding(`CoordinatorBinding`)을 가진다.
- 모델 **proposal**(next_actions 2~4개) → boundary 열림 → `ranked_next_actions` **packet**으로 봉인(`revision`).
  Pet **selection**은 식별자와 revision만 보내고, 코디네이터가 봉인된 패킷에서 action을 다시 읽는다.
- 선택 수락 → **continuation envelope**(`dispatch_mode: "queued_next_turn"`). 원문 token은 저장하지 않고 fingerprint(`sha256:`/`hmac-sha256:`)만 남긴다.
  큐 메시지가 UserPromptSubmit으로 돌아오면 `queued_action_context_claimed`(claim protocol v1).
- 전송 종결 관측은 `continuation_transport_completed` / `continuation_transport_timed_out_unknown` / `continuation_transport_not_submitted` 중 하나.
  작업 결과는 별도 `work_outcome_recorded`로만 기록한다. `automatic_retry`는 항상 false.
- 무결성: **ContractPin**(계약 파일 집합과 SHA-256), **freshness anchor**(Keychain의 generation/sequence/head MAC, rollback·삭제 fail-closed), HMAC chain journal.

## 파일 지도

| 경로 | 역할 |
| --- | --- |
| `validation/V1IngressValidator.swift` | runtimeEvent/decisionPacket/selectionRequest/continuationEnvelope strict 검증. 이벤트 카테고리 표 포함 |
| `validation/ContractPin.swift` | `Contracts/v1` manifest + schema 10개의 SHA-256 고정. 데몬 시작과 `contractPin()` 테스트에서 검증 |
| `validation/StrictJSON.swift`, `RFC3339Instant.swift`, `RuntimeSecretCorpus.swift`, `IdentifierNormalization.swift`, `ExactJSONInteger.swift` | 중복 키·깊이·정수 범위 차단, ns 시각, secret 누출 방지, NFC 정규화 |
| `semantic/CoordinatorSemanticApplication.swift` | command → event 결정(`CoordinatorSemanticDecision.decide`), CAS append 재시도, transport completion/not-submitted/queued delivery |
| `semantic/CoordinatorSemanticState.swift` | replay로만 상태를 만드는 reducer(`CoordinatorSemanticReplay.applying`), `CoordinatorTransportStatus` |
| `semantic/BlabeeSuggestionMode.swift` | 제안 모드 |
| `routing/CoordinatorRoutingApplication.swift` | 락, in-flight/deadline/clock, `routeSelection`, `routeConsumePetAction`, `routeQueuedActionContextClaim`, `completeTransportAndCloseBoundary`, `failTransportBeforeSubmission`, 재시작 복구 quarantine |
| `routing/CoordinatorNextTurnDispatcher.swift` | dispatcher 포트와 실패 증거(`commandInvocationAttempted`). 실제 구현 `CodexQueueNextTurnDispatcher`는 Codex 브릿지에서 `app/entrypoints/main.swift`가 주입 |
| `routing/CoordinatorBinding.swift`, `routing/ContinuationToken.swift` | binding 키, token 생성·fingerprint |
| `persistence/SQLiteJournal.swift` | WAL/FULL, `BEGIN IMMEDIATE`, CAS append, HMAC chain, `schemaVersion = 1`, 테이블 4개 정확 일치 검사. append 시 event·packet을 validator로 재검증 |
| `persistence/FreshnessAnchor.swift`, `KeychainFreshnessAnchorStore.swift`, `StorageKey.swift`, `StorageProcessLock.swift`, `MissingStorageRecovery.swift` | freshness anchor, 32-byte 외부 키, flock, 저장소 유실 복구 |
| `../app/coordination/CoordinatorOperationalApplication.swift` | 같은 타깃. Hook/Pet 요청 어댑터(`handle(type:payload:)`, `emitDecision`, `select`, `userPromptSubmit`, `complete`). 승인·managed approval 로직도 섞여 있어 Codex Bridge와 경계를 공유한다 |
| `../app/coordination/PetEventArrivalLedger.swift` | 같은 타깃(`Package.swift`의 `coordinatorSwiftSources`). Pet 이벤트 도착 장부. 테스트는 `Tests/swift/CoordinatorSwiftTests/PetEventArrivalLedgerTests.swift` |
| `../bridges/codex/swift/core/*` | 같은 타깃(`HookPermissionPolicy`, `QueuedPromptEnvelope` 등). 소유는 Codex Bridge 세션 |

호출 순서: `handle(type:payload:)` → `reconcilePendingOperationalWork` + `routing.processTime` → `routing.executeCommand`
→ `semantic.execute` → `decide` → `replay` → `SQLiteJournal.append`. `ClaudeCoreAdapter`(`bridges/claude/swift/adapter`)는 같은 routing API를 직접 호출한다.

## Contracts/v1을 바꿀 때

하나라도 빠지면 데몬이 `contract_pin_mismatch` 또는 `unsupported_contract_update`로 시작하지 않는다.

1. schema 또는 `manifest.json`을 고친다. 파일 집합은 `ContractPin.schemaSHA256`의 키 + `manifest.json`과 정확히 같아야 하므로 파일을 추가·삭제하면 그 표도 바꾼다.
2. `ContractPin.schemaSHA256`(필요하면 `manifestSHA256`)을 새 값으로 갱신한다: `shasum -a 256 Contracts/v1/*.json`.
3. `V1IngressValidator`의 카테고리 표·payload 검증, `CoordinatorSemanticApplication`의 decide와 `CoordinatorSemanticState`의 replay, 두 군데 `SemanticJSON` 카테고리 표.
4. `Tests/support/reference-engine/{decide,state}.mjs`, `Tests/Contracts/semantic-trace.mjs`, `Tests/Contracts/v1-contracts.test.mjs`.
5. 필요하면 `Fixtures/v1/event-traces/*`와 `Fixtures/v1/manifest.json`의 `cases`.
6. `Contracts/v1/README.md`에 의미와 다운그레이드 불가 경고. 이전 버전 reader는 새 이벤트가 든 journal을 읽지 못한다.
7. 사용자 영향이 있으면 `docs/github/public/CHANGELOG.md`·`CHANGELOG.ko.md`.

## 바꾸면 안 되는 것

- `SQLiteJournal.schemaVersion = 1`, 테이블 4개(`coordinator_metadata`, `runtime_events`, `packet_documents`, `verification_records`), v1 메시지 `schema_version: "1.0"`.
- HMAC 도메인 문자열(`StorageKey.swift`, `FreshnessAnchor.swift`): `blabee.runtime-event.v1`, `blabee.packet-document.v1`, `blabee.verification-record.v1`,
  `blabee.storage-key-verifier.v1`, `blabee.freshness-batch.v1` 등. 바꾸면 기존 DB 전체가 인증에 실패한다.
- Keychain service `com.biadone.blabee.coordinator.freshness.v1`, account `primary`.
- 원문 token을 durable 저장소에 남기지 않는다. 새 식별자는 NFC 정규화, 기존 식별자는 UTF-8 바이트 정확 비교.
- 이미 종결 관측이 기록된 boundary를 실패로 덮어쓰지 않는다. 종결 뒤의 work outcome·queued claim은 거부한다.
- `same_turn_stop`은 과거 journal 읽기용으로만 남긴다.

## 테스트

| 명령 | 범위 |
| --- | --- |
| `npm run test:contracts` | `Tests/Contracts` (계약·semantic trace) |
| `npm run test:t007a` / `npm run test:t007b-a` / `npm run test:t011` | `Tests/CoordinatorCore` / `Tests/CoordinatorPersistence` / `Tests/CoordinatorOperational` |
| `npm run test:swift -- --filter CoordinatorSwiftTests` | 이 영역 Swift 전체. Swift Testing `@Test`가 대부분이고 XCTest는 `SemanticReplayTests` 하나 |
| `npm run test:swift -- --filter 'SemanticApplicationTests\|RoutingApplicationTests\|OperationalApplicationTests'` | suite 단위 |

Swift 테스트는 루트 `CLAUDE.md`의 잠금·scratch 규칙을 따른다. 계약을 바꿨으면 Node 계약 테스트와 Swift `contractPin` 테스트를 둘 다 돌린다.

## 참고 문서

`docs/architecture/CODEMAP.md`, `Contracts/v1/README.md`, `docs/features/QUEUED_HOOK_ORDERING.md`, `docs/features/PROMPT_BINDING_RESTART_V2.md`,
`docs/features/STORAGE_RECOVERY_AND_HOOK_READINESS.md`, `docs/features/ENGINE_DEBUG_20261003.md`, `docs/features/ENGINE_DEBUG_20261011.md`.
