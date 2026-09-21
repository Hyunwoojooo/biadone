# Claude 브릿지 개발 버전 검증

최신 결과를 위에 기록한다. 아래의 이전 절은 각 구현 단계 당시의 검증 범위다.

## 2026-09-18 — 실제 Claude A 실행 성공과 이후 세션 권한 만료

같은 `shared-pet-live` 실제 Claude 세션의 기록과 테스트 파일을 확인했다. 시각은 한국 시간이다.

| 관측 | 결과 |
| --- | --- |
| 20:37:23 연결 ACK | `ready:true` |
| 20:37:51 제안 저장 | `claude_packet_dddbc581-ef1c-4bf5-8dbc-0268b610c4c0`, revision 1 |
| 20:38:02 선택 claim | 성공, selection `442d6064-ee41-4cd8-9f31-2912cd4775c0` |
| 20:38:13 완료 보고 | `complete_selection_v1`, `recorded:true` |
| 실제 파일 확인 | `build/shared-pet-live/project/pet-a.txt`가 `BLABEE_SHARED_PET_A_OK`와 일치. `pet-b.txt`는 없음 |
| 21:23:59 연결 재확인 | `claude_session_unauthorized` |
| 21:24:03 Stop Hook | 같은 권한 오류 1건 |

따라서 **실제 Claude 모델의 연결·제안·A claim·파일 생성·완료 보고는 통과**했다. 앞선 harness 결과와 구분한다. 이번 확인에서 실제 창의 완료 표시를 새로 촬영·검증한 것은 아니다.

이후 오류는 별도의 **세션 접속 권한 만료**다. `native-session.used`의 생성 시각은 20:19:55이며 launcher는 기본 `ttlMs=3_600_000`으로 grant를 만든다. 21:24 요청은 약 21:19경의 만료 이후다. 같은 host·launcher·MCP 프로세스는 계속 실행 중이지만, native handler는 만료된 grant를 operation 처리 전에 `claude_session_unauthorized`로 거절한다. 새 Hook boundary나 readiness 호출만으로 복구할 수 없다.

복구는 해당 Claude 테스트 세션에서 `/exit`한 뒤 `npm run claude:live`로 새 launcher 세션을 여는 것이다. 기존 권한을 연장하거나 우회하지 않는다. 실행 중인 세션·설치 앱·소스·바이너리는 변경하지 않았고, 문서만 갱신했다. 현재 5분 readiness와 1시간 grant는 서로 다른 검증용 수명이며, 장시간 세션 관리·명확한 만료 안내는 후속 제품 작업이다. A 파일이 이미 있으므로 같은 파일 생성 시험을 다시 성공 시험으로 사용할 때는 새 파일명을 명시해야 한다.

## 2026-09-18 — 실제 Claude A 버튼 비활성 원인

사용자가 실제 모델에서 readiness 확인 후 A/B 제안을 저장했으나 버튼이 비활성이라고 보고했다. 실행 중인 `shared-pet-live` 세션의 Claude transcript에서 필요한 도구 결과와 Stop 요약만 읽어 확인했다. 다음 시각은 한국 시간이다.

| 관측 | 기록 |
| --- | --- |
| probe 생성 응답 | 20:22:53, `awaiting_ack`, 만료 epoch ms `1789730873144` |
| 실제 모델 ACK | 20:23:00, `ready:true`, 같은 만료 시각 |
| 연결 확인 만료 | **20:27:53** |
| A/B 제안 저장 | **20:29:08**, `claude_packet_02e1e530-0249-4527-8e16-437672be3e93`, revision 1 |
| 응답 종료 Hook | 20:29:10, Stop hook 3개, 오류 0개, continuation 차단 없음 |

제안 저장 이전에 readiness의 5분 기한이 지난 것이 확인됐다. 제안 저장 성공만으로 선택 권한을 얻지 않으며, native `selection_enabled`는 현재 readiness를 요구한다. 이 사례에서 Stop payload 오류나 미등록 도구를 원인으로 단정하지 않는다.

[테스트 안내](../../../docs/bridges/claude/COMMON_PET.md#실제-claude에서-버튼-테스트)를 **연결 ACK 후 곧바로 A/B를 저장하는 단일 프롬프트**로 수정했다. 새 사용자 입력은 이전 카드를 무효화하므로 단순 재확인 뒤 이전 A를 누르도록 안내하지 않는다. 실행 중인 세션·권한·TTL·소스·제품 바이너리는 변경하지 않았다. 문서 검사만 수행했으며 새 코드 테스트나 실제 모델의 버튼 실행 통과를 추가로 주장하지 않는다.

## 2026-09-18 — 공통 Pet 연결과 사용자의 실제 A 클릭

기존 `PetRootView`·`PetViewModel`·`PetPanelController`를 같은 native host의 Claude 세션에 연결했다. `claude:shared --pet`으로 시작하며, 준비된 `npm run claude:live`는 새 `build/shared-pet-live/` 제품 빌드·프로젝트와 이 플래그를 사용한다. [구조와 구분된 테스트 프롬프트](../../../docs/bridges/claude/COMMON_PET.md)를 따른다.

### 변경 범위와 동작

- 공통 `ClaudePetTransport`, `PetProviderPresentation`, `ClaudePetApplication`과 기존 Pet 모델·화면·transport의 provider 연결. UI·엔진의 Claude 복사본은 만들지 않았다.
- `ClaudeNativeSession`, `ClaudeBridgeIngress`, `ClaudeCoreAdapter`의 selector 전용 `pet.snapshot`과 현재 카드 투영. 기존 `snapshot` 형식과 고정 `Contracts/v1`은 유지했다.
- launcher·CLI의 선택적 `--pet`, 제품 도구의 부수 효과 kind 검증, Swift transport/화면 테스트, native launcher 회귀, 격리 렌더·실제 창 검증 runner와 문서.
- 독립 readiness·heartbeat·현재 Stop과 전체 카드 identity가 일치해야 클릭할 수 있다. 선택 접수는 `channelPending`, claim 이후는 별도 pending report로 표시하며 모델의 완료를 추측하지 않는다.
- 성공 결과의 core 상태 `succeeded`는 `완료 보고`, 실패는 `실패 보고`로 표시한다. 과거 A 결과는 원래 selection 식별자에 붙고 현재 C/D를 완료시키지 않는다. Claude에 지원하지 않는 설정·skip·rollback·전역 단축키는 노출하지 않는다.

### 자동 검사

| 검사 | 결과 |
| --- | --- |
| 공통 Pet·선택 회귀 | **143개 테스트 실행, 기존 OCR 오인식 2건으로 전체 exit 1**. 새 Claude 13개 테스트와 다른 기능 검사는 통과. 최종 로그 (`claude/build/common-pet-20260918-final.log`; 이전 로컬 생성물) |
| 수정 전 화면 비교 | 같은 `PetAirViewTests/choiceGrid`의 3·4 선택지 dark-material에서 동일하게 `권장`을 `권창`으로 인식. 육안 배지·grid·제목은 정상. 원본 테스트·제품을 완화하거나 수정하지 않음. 원본 비교 로그 (`claude/build/pet-baseline-render/baseline-choice-grid.log`; 이전 로컬 생성물) |
| Hook·MCP·launcher | **28/28 통과**: JS 13, 실제 native Hook/MCP 6, launcher 9. 로그 (`claude/build/native-pet-20260918-final.log`; 이전 로컬 생성물) |
| 공통 core·SQLite | **Swift 31개 테스트, Node 12/12 통과**. 로그 (`claude/build/shared-engine-pet-20260918.log`; 이전 로컬 생성물) |
| 기존 인증 ingress | **10/10 통과**. 위에서 빌드한 같은 native fixture를 사용. 로그 (`claude/build/ingress-pet-20260918.log`; 이전 로컬 생성물) |
| JavaScript 구문 | **38개 파일 통과** |
| 제품 빌드·실행 명령 | 테스트 define 없이 별도 경로 빌드 통과, fixture 명령 4종이 바이너리에 없음. `claude:live` 인수·경로·실행 권한·`pet:true` 확인. 빌드 기록 (`claude/build/shared-pet-live/build-product.log`; 이전 로컬 생성물), SHA256·receipt (`claude/build/shared-pet-live/product-receipt.json`; 이전 로컬 생성물) |
| 독립 소스 검토 | 전체 scope·binding·응답 correlation, readiness/만료, pending report, kind 사전 검증, owned-host 수명 검토. 남은 확정 차단 문제 없음 |

새 Swift 검사는 selector-only 접근, ready/Stop 전 선택 차단, heartbeat·ACK·monotonic card 만료, 전체 identity 위조·이전 카드·중복 선택 거부, 불확실한 전송 자동 재시도 금지, claim 뒤 대기, 이전 결과와 새 카드 분리, 성공/실패 표시를 검사한다. versioned 도구와 Swift admission 모두 부수 효과 kind의 stable-code 규칙을 적용해 표시할 수 없는 제안이 저장되지 않게 했다. 완료 화면 (`claude/build/common-pet/artifacts/claude-completed-light.png`; 이전 로컬 생성물), 실패 화면 (`claude/build/common-pet/artifacts/claude-failed-dark.png`; 이전 로컬 생성물).

### 실제 창의 A 버튼

`pet-window-qualification.mjs`로 별도 native host와 공통 창을 띄웠고, **사용자가 직접 A를 눌렀다고 대화에서 확인했다**. 테스트는 selector API로 클릭을 대신하지 않았다. 그 입력에 대한 claim, `ui-a.txt`의 `BLABEE_SHARED_PET_A_OK`, 새 카드 생성 후 원래 A의 `succeeded` 보고, 새 카드 유지가 통과했다. 왕복 증거 (`claude/build/pu-rYIiED/evidence.json`; 이전 로컬 생성물), 사용자 클릭 확인 (`claude/build/pu-rYIiED/click-confirmation.json`; 이전 로컬 생성물). 검증한 자식 host는 정상 정리했다.

이 시험의 Hook·모델 역할, 파일 작성과 완료 보고는 **테스트 harness**가 수행했다. 실제 Claude 모델이 UI 선택을 실행한 것으로 기록하지 않는다. 자동 렌더 검사는 실제 창 클릭의 시각적 관측과도 구분한다.

앞서 사용자 로그에서 실제 Claude의 `check_connection_v1 → Channel → ack_readiness_probe_v1 → ready:true`와 `emit_decision_v1`의 `claude_packet_49ab6e99-24ac-436d-972b-740627c2bfca`, revision 1이 확인됐다. 이는 공통 경로의 실제 연결·제안 저장 증거다. 다음은 새 제품 빌드로 **실제 Claude + 공통 Pet A 클릭 → claim·파일 실행·완료**를 확인하는 단계다.

설치 앱·실행 중이던 세션·전역 설정·기존 자격 증명·Git 이력은 변경하지 않았다. 다른 작업의 미커밋 변경은 구현 직전 사본과 대조하고, 고정 v1 계약 12개 해시는 모두 동일하다. 새 production dependency는 없다. 한 설치 앱에 여러 provider 등록, native metadata 영속화·복구와 배포 패키징은 후속 범위다.

## 2026-09-18 — 새 launcher와 실제 Hook·MCP의 공통 엔진 연결

선택한 **실제 Claude Hook·MCP 연결**을 구현했다. launcher가 새로운 세션의 역할별 자격을 발급하고, command Hook과 stdio MCP가 `claude_session_v1`으로 실제 공통 Coordinator를 호출한다. [실행·인증·수명 주기 규격](../../../docs/bridges/claude/NATIVE_SESSION.md)에 사용법과 후속 범위를 기록했다. 기존 개발 버전의 실제 Claude 모델 통과를 새 연결의 모델 검증으로 계산하지 않는다.

### 변경 범위

- 공통 `ClaudeCoreAdapter/ClaudeNativeSession.swift`: 실제 native 관측과 내부 binding 분리, Hook/bridge/selector/control 권한, 독립 ACK·heartbeat·Stop 선택 조건, 일회용 Channel 참조와 원래 claim의 결과 보고.
- 공통 `BlabeeCoordinator/ClaudeNativeHost.swift`, `main.swift`, `UnixDomainSocketTransport.swift`: 새 세션 host 모드, private grant·owner lifetime 파이프, 새 요청 type. 기존 Codex handler·호출자 검사는 유지한다.
- `src/bridge/shared-launcher.mjs`, `scripts/claude-shared.mjs`: 새 세션·전용 runtime, 자격 없는 설정 파일, owner에게만 selector/control 유지, 정상·오류·강제 종료 정리.
- `src/bridge/native-session-client.mjs`, `product-hook.mjs`, `product-mcp.mjs`, `product-tools.mjs`, `product-context.mjs`: 실제 Hook/SDK 진입점과 버전 도구. `product-core-client.mjs`의 기존 전송을 code-defined profile로 재사용한다. 기존 개발용 Hook/MCP 도구는 바꾸지 않는다.
- `shared-engine/Tests/ClaudeCoreAdapterTests/NativeSessionTests.swift`, `tests/product-bridge.test.mjs`, `tests/shared-engine/{native-session,shared-launcher}.test.mjs`, 새 runner·package 명령·문서. 기존 Codex 제품 회귀 테스트에는 새 fixture 명령이 제품 바이너리에 없는지 확인하는 5줄만 추가했다.

### 검증 결과

| 검사 | 결과 |
| --- | --- |
| `npm run test:native-session` | **25/25 통과**: 제품 JS 12, 실제 common host·Hook·SDK MCP 6, launcher·프로세스 종료 7. 최종 로그 (`claude/build/native-session-20260918-final.log`; 이전 로컬 생성물) |
| `npm run test:shared-engine` | **Swift 31개 테스트 그룹 통과**: 새 native 12개 + 기존 19개. **Node 통신/SQLite 12/12 통과**. 실패·skip 없음. 최종 로그 (`claude/build/shared-engine-native-20260918-pass.log`; 이전 로컬 생성물) |
| `npm run test:product-ingress` | **10/10 통과**. 기존 사전 등록 ingress와 Node UDS client 유지. 로그 (`claude/build/product-ingress-native-20260918.log`; 이전 로컬 생성물) |
| Codex 집중 회귀·제품 빌드 | **4/4 통과**. 실제 기존 Hook/MCP/Pet/UDS/SQLite 왕복, schema·오류·소유권·allowlist. 테스트 define 없는 제품에 `claude-session-host-test`와 기존 fixture 모드가 없음. 로그 (`claude/build/codex-native-regression-20260918.log`; 이전 로컬 생성물) |
| JavaScript 구문 | `npm run check`: **36개 파일 통과** |
| 문서·변경 검사 | 변경 문서·새 소스의 공백, 상대 링크, Git 제외 생성물, 기존 진입점 diff 확인. 코드·계약·Git 이력에 무관한 변경을 되돌리지 않음 |
| 별도 소스 검토 | owner 종료·SIGINT 중복·잘못된 Hook 관측·prompt 한도 보완 후 재검토 통과. 미해결 확정 차단 문제 없음 |
| 기존 변경 보존 | 공통 본체·계약 기준점 246개 중 243개 동일. 이전 통합부터 변경된 3개는 `Package.swift`, `main.swift`, `UnixDomainSocketTransport.swift`. 이번 기존 본체 추가 변경은 뒤의 2개 진입점에만 있음. 별도 고정 `Contracts/v1` 12개 해시 동일 |

실제 Hook 입력 → 독립 probe Channel → 명시적 ACK → 제안·Stop → 사용자 selector → 선택 Channel → claim → 테스트 파일 표식 → 새로운 C/D → 원래 A 완료·C/D 유지가 통과했다. 실제 SDK transport를 사용하되 **모델 역할·선택·파일 작성은 테스트 프로세스**가 수행한다.

서로 다른 역할·provider·scope·session·cwd의 요청, 누락된 모델 결과 필드, 이전 prompt의 Stop, 세션 종료·만료와 runtime 재사용을 거부한다. 누락된 native prompt를 합성하지 않는다. 같은 scope의 필수 Hook 관측을 잃으면 현재 카드·readiness를 무효화하고 이미 claim한 원래 보고 권한은 유지한다. 다른 세션/cwd/subagent의 입력은 올바른 세션을 무효화하지 않는다.

launcher 시험은 실제 common host와 가짜 Claude 실행 파일을 사용한다. 설정·자식 출력·runtime 파일에서 발급 자격이 노출되지 않음, selector/control이 Claude에 전달되지 않음, spawn 전 실패, owner SIGKILL, startup SIGTERM, foreground SIGINT 한 번 전달, SIGTERM을 무시하는 Claude 자식의 제한 시간 내 종료가 통과했다. 기존 앱 프로세스를 조회해 종료하거나 교체하지 않는다.

### 발견한 문제와 수정

1. SIGTERM 전달만으로는 Claude 자식이 응답하지 않을 때 권한 회수가 지연될 수 있었다. owner lifetime 파이프와 즉시 권한 회수·병렬 bounded shutdown을 추가했다. 전경 프로세스 그룹의 SIGINT를 다시 전달하지 않는다.
2. 누락된 prompt ID/text를 Hook에서만 거부하거나 257번째 native prompt를 바로 거부하면 이전 Stop 카드가 선택 가능하게 남을 수 있었다. 인증된 같은 scope의 관측 실패는 native ID 없이 명시적으로 무효화한다. 실제 Hook 회귀와 Swift 한도 회귀를 추가했다.
3. 초기 native 빌드는 macOS `sandbox-exec` 제한으로 실패해 기록 (`claude/build/native-session-20260918-sandbox.log`; 이전 로컬 생성물)을 보존하고 필요한 권한으로 실행했다. launcher 테스트의 가짜 실행 파일을 CommonJS 확장자로 바로잡았다. Swift 테스트는 throwing macro 문법과 공개 summary/내부 감사 prefix를 각각 검증하도록 수정했다. 이 과정의 실패를 통과 수에 포함하지 않는다.

### 검증 경계와 후속 작업

설치된 앱·기존 Codex/Claude 세션·전역 설정·기존 자격·Git 이력은 변경하지 않았다. 새 production dependency도 없다. fixture는 메모리 freshness를 사용하므로 **제품 Keychain·실제 모델·native renderer 전체·공통 Pet 클릭·패키징 검증은 아니다**. stdout 전달이나 MCP 초기화를 모델 ACK로 기록하지 않고 완료는 계속 모델 보고로 표시한다.

공통 Pet에 selector 연결, 새 경로의 실제 Claude 모델 왕복, native metadata 영속화·복구, C-L02 오류/중단 관측, 최종 앱 패키징이 남아 있다. fresh runtime은 현재 연결·격리 검증 경계이며 공통 엔진 소스를 복제해 두 제품으로 유지한다는 뜻은 아니다.

## 2026-09-18 — 실제 공통 Coordinator의 인증된 Claude 접속 경로

선택한 작업인 **공통 앱의 Claude 접속 경로 연결**을 구현하고 자동 검증했다. 단일 Swift 어댑터를 실제 `blabee-coordinator`의 UDS에 연결했다. 사전 등록한 scope·session·역할별 capability와 만료 시각을 검사한 뒤에만 공통 엔진을 호출한다. 공개 runtime identity는 인증 자격으로 사용하지 않는다. [제품 ingress 규격](../../../docs/bridges/claude/PRODUCT_INGRESS.md)이 현재 계약이며, 실제 Hook/MCP·launcher·공통 Pet 전환은 별도다.

### 변경 범위

- `../src/coordinator-swift/Sources/ClaudeCoreAdapter/`: 기존 어댑터를 한 곳으로 이동하고 `ClaudeBridgeIngress.swift`의 인증·권한·안전한 응답 투영을 추가했다. 상위와 검증용 `Package.swift`가 같은 target을 참조한다.
- `../src/coordinator-swift/Sources/BlabeeCoordinator/ClaudeBridgeCoordinator.swift`: private 설정 읽기, scope별 DB/key/freshness account/authority, 기존 Codex handler와의 분리 조립. `main.swift`는 선택적 앱 설정과 명시적 daemon 옵션을 연결한다.
- `UnixDomainSocketTransport.swift`: 새 요청 type 하나와 요청별 `auth_token` 노출 방지 검사를 추가했다. 기존 같은 UID·runtime namespace·호환 요청·raw token·secret corpus 검사는 유지했다.
- `ClaudeBridgeRoundTripFixture.swift`, `shared-engine/Tests/ClaudeCoreAdapterTests/IngressTests.swift`, `src/bridge/product-core-client.mjs`, `tests/shared-engine/product-ingress.test.mjs`, `scripts/test-product-ingress.mjs`: 실제 공통 실행 파일과 UDS·SQLite 검증, 응답 유실 시 재전송 금지, 인증 실패·교차 권한 검증.
- `../Tests/CoordinatorOperational/operational-roundtrip.test.mjs`: 제품 바이너리에 Claude 테스트 전용 서버 명령이 포함되지 않는 검사 5줄을 추가했다.

### 최종 실행 결과

| 검사 | 결과 |
| --- | --- |
| `npm run test:shared-engine` | **Swift 19개 테스트 그룹 통과**, 기존 12개와 새 인증 7개. Node 통신·실제 core 왕복 **12/12 통과**. 로그 (`claude/build/shared-engine-ingress-20260918.log`; 이전 로컬 생성물) |
| `npm run test:product-ingress` | **10/10 통과**: 실제 제품 Coordinator UDS 6개, Node 전송 실패 4개. 로그 (`claude/build/product-ingress-20260918.log`; 이전 로컬 생성물) |
| 기존 Codex 집중 회귀 | **4/4 통과**: 실제 Hook/MCP/Pet/UDS/SQLite의 두 후속 작업 흐름, MCP schema·correlation 비노출, 안전한 오류, UDS 소유권·mode·allowlist. 로그 (`claude/build/codex-ingress-regression-20260918.log`; 이전 로컬 생성물) |
| 제품 빌드 | 위 Codex 회귀에서 테스트 define 없는 실행 파일 빌드 통과. 새 Claude fixture 및 기존 fixture 명령이 제품 바이너리에 없음을 확인 |
| `npm run check` | JavaScript **25개 파일 구문 검사 통과** |
| 문서·변경 검사 | 문서 7개·상대 링크 93개, 코드 블록·공백 및 변경 diff 검사 통과. 빌드·실행 기록은 Git 제외 확인 |
| 별도 코드 검토 | 선택적 Claude 설정 오류의 Codex 가용성 영향 수정 후 재검토 통과. 남은 확정된 차단 문제 없음 |
| 변경 보존 | 이전 본체·계약 기준점 246개 중 기존 파일 변경은 `Package.swift`, `main.swift`, `UnixDomainSocketTransport.swift` 3개뿐. 나머지 243개 해시 일치. 고정 `Contracts/v1` 변경 없음. 기존 미커밋 변경을 되돌리지 않음 |

실제 서버 왕복은 A의 선택·claim·파일 표식 생성·새 C/D 생성·원래 A 완료·C/D 재선택까지 검증했다. bridge의 사용자 선택 요청과 selector의 claim은 거부된다. 다른 provider/session/scope/token, 잘못된 버전과 공개 runtime identity만 가진 요청은 승인되지 않는다. 같은 native ID를 가진 두 scope의 DB와 선택 권한도 독립적이다.

capability가 제안·문자열 배열·결과 메모에 들어가면 저장 전에 거부한다. 추측한 인증값은 전역 secret corpus를 오염시키지 않는다. 응답에 원시 token·raw routing·Codex queue 표식이 없고, 완료 출처는 `model`로 유지된다. 클라이언트는 손상되거나 유실된 응답 이후 요청을 자동 재전송하지 않는다.

### 발견한 문제와 보완

- 선택적 앱 설정의 만료·손상이 Coordinator 전체 시작을 막을 수 있었다. 앱에서는 Claude만 `claude_bridge_unavailable`로 처리하고 기존 Codex `get_state`가 계속 성공하도록 수정·검증했다. 파일이 없으면 `claude_bridge_disabled`다. 명시적인 CLI 설정 오류는 계속 시작 실패로 알린다.
- 첫 빌드는 macOS sandbox의 `sandbox-exec` 제한으로 막혔다. 어댑터 기록 (`claude/build/shared-engine-ingress-20260918-sandbox.log`; 이전 로컬 생성물)과 제품 접속 기록 (`claude/build/product-ingress-20260918-sandbox.log`; 이전 로컬 생성물)을 보존하고 필요한 실행 권한으로 재실행해 통과했다. 테스트 실패나 승인 거부를 성공으로 계산하지 않았다.

설치된 앱·실행 중인 세션·전역 Claude/Codex 설정·기존 자격 증명은 변경하지 않았다. 테스트는 소유한 private runtime과 자식 프로세스만 사용한다. 실제 Coordinator fixture의 freshness는 메모리 저장소이므로 제품 Keychain·재설치·업데이트·rollback 보호 검증은 아니다. 모델 역할과 사용자 선택 역할도 테스트 클라이언트가 수행하므로 실제 Claude 모델·Hook·Channel·Pet의 통과 증거로 계산하지 않는다.

이 선택 작업의 세 완료 조건(인증된 버전 요청, 교차 권한 거부, 실제 Coordinator 왕복)은 충족했다. 남은 제품 연결은 신뢰한 launcher의 발급·전달·회수, 실제 Hook/MCP의 버전 있는 DTO와 출처·readiness, 공통 Pet, 영속 metadata·복구, 패키징이다.

## 2026-09-18 — 공통 Swift 엔진의 첫 연결 계층 검증

사용자는 C-L02/C-L03보다 공통 본체 연결을 먼저 진행하고, 다른 세션의 작업이 끝난 현재 코드를 기준으로 통합하도록 결정했다. 현재 본체와 고정 계약 246개 파일을 `build/shared-core-baseline-q6lsr39x/`에 해시와 함께 보존했다. 이번 구현은 `claude/` 안에 추가하며, 기존 엔진 라이브러리를 직접 참조한다. 설계·실행 방법·제품 통합에 남은 범위는 [첫 통합 계층](../../../docs/bridges/claude/SHARED_ENGINE_INTEGRATION.md)을 따른다.

### 구현과 검증

- `shared-engine/`: public `CoordinatorRoutingApplication`과 실제 `SQLiteJournal`을 호출하는 어댑터, JSONL 검증 실행 파일, Swift 회귀 테스트. 제안·선택·일회용 소비·결과 기록을 Node로 다시 구현하지 않는다.
- `src/bridge/shared-core-client.mjs`, `tests/shared-engine/`: Node–Swift 통신과 실제 SQLite 왕복. 원래 A의 결과 보고 뒤 새 C/D 카드 유지, 독립 컨텍스트의 동일 ID, 재시작 후 실행 권한 미복원, 필수 입력 누락 거절을 확인한다.
- `scripts/test-shared-engine.mjs`, `package.json`: `npm run test:shared-engine`으로 별도 빌드·캐시·fixture 아래에서 검증한다. 문서와 [작업 현황](../../../docs/bridges/claude/TASK_STATUS.md)에 첫 연결 계층과 공통 앱 전환을 구분한다.

| 최종 검사 | 결과 |
| --- | --- |
| `npm run test:shared-engine` | **Swift Testing 12개 테스트 그룹 통과**, parameterized 경우와 commit 전후 fault 포함. **Node 12/12 통과**: 통신 8개 + 실제 Swift/SQLite 왕복 4개. 실패·skip 없음. 최종 로그 (`claude/build/shared-engine-20260918.log`; 이전 로컬 생성물) |
| 공통 엔진·계약 보존 | 기준 사본의 246개 원본 파일 해시 일치. 기존 `Contracts/v1`과 Codex 본체 소스 변경 없음 |
| 별도 코드 검토 | 응답·snapshot 크기와 완료 저장 후 한도 회수 문제를 보완하고 재검토 통과. 마지막 stdin 수정도 별도 검토 통과 |

실제 core의 일회용 소비·전송 기록·결과·boundary 종료에 대해 저장 전 실패와 저장 후 응답 유실을 주입했다. 확인되지 않은 claim은 작업을 반환하거나 재전송하지 않는다. 결과가 이미 저장됐다면 원래 binding·selection·continuation을 대조해 보고 슬롯을 회수하며, 후속 보고가 최초 결과를 덮어쓰지 않는다. 새 카드의 binding·foreground도 보존한다.

큰 제안은 core 기록 전에 거절한다. 현재 카드·routing의 전체 크기도 저장 전에 검사하고, 표시할 과거 결과는 최근 순서와 바이트 한도로 제한하며 생략 건수를 반환한다. SQLite의 감사 이력을 삭제하는 것은 아니다.

### 발견한 문제와 수정

첫 실행은 `sandbox-exec` 제한으로 실패해 기록 (`claude/build/shared-engine-20260918-sandbox.log`; 이전 로컬 생성물)을 보존하고 필요한 실행 권한으로 재실행했다. 기본 Command Line Tools에는 Swift Testing macro plugin이 없어 빌드가 실패 (`claude/build/shared-engine-20260918-clt.log`; 이전 로컬 생성물)했다. 검증 스크립트는 명시적인 `DEVELOPER_DIR`가 없으면 설치된 Xcode를 해당 자식 실행에만 사용하며 전역 `xcode-select`는 바꾸지 않는다.

첫 실제 Node–Swift 왕복에서는 `FileHandle.read(upToCount:4096)`가 작은 입력의 처리를 늦춰 네 경우 모두 timeout이었다. 이때 Swift 내부 12개 그룹은 이미 통과했지만 프로세스 왕복은 통과하지 못했다. 수정 전 로그 (`claude/build/shared-engine-20260918-before-stdio-fix.log`; 이전 로컬 생성물)를 보존하고 POSIX `read`와 EINTR 처리로 수정했다. stdin을 열어 둔 채 작은 snapshot 응답부터 기다리는 회귀 검사를 추가한 최종 전체 명령은 위와 같이 통과했다.

### 완료로 계산하지 않는 범위

이 검증은 테스트가 binding을 공급하고 파일을 쓰는 **실제 공통 core/SQLite 자동 왕복**이다. 실제 Claude 모델·Hook·MCP Channel·Pet 클릭이나 Codex·Claude의 공통 앱 동시 사용을 검증한 것은 아니다. fixture freshness 저장소도 제품 Keychain·rollback 보호 검증을 대신하지 않는다.

기존 core의 `queued_next_turn`/queued-claim 표식을 실제 Claude 전송 증거로 사용하지 않는다. 제품용 인증 ingress, native 관측·cwd·모델 보고의 완전한 영속 metadata, 공통 Pet, launcher·패키징이 남아 있다. 기존 앱·서비스·세션을 교체하거나 종료하지 않았고, 이 연결 계층을 기존 실행 명령에 자동 활성화하지 않았다. 전체 공통화는 진행 중이며 full S-01과 S-02~S-08 완료로 계산하지 않는다.

## 2026-09-18 — C-L01 실제 Claude 테스트 통과

사용자가 대화형 Claude Code에서 A를 선택해 파일을 만든 뒤, 새 입력으로 C/D 카드를 제안하고 원래 A의 완료를 보고했다. 사용자가 전달한 도구 응답을 Coordinator journal과 실제 파일에 대조했다. 세션은 `124890e1-aa56-4410-b4da-209de9530771`, 작업 위치는 `build/cl01-live-DtrzTk/`다.

| 실제 기록 (KST) | 확인 결과 |
| --- | --- |
| 15:35:40.561 | 원래 A/B packet `ec4fc5ac-01c3-4694-b498-1758847d7a1d`에서 A 선택. selection `ade4f3c4-45d6-4af0-989d-7c53a1734ba0` |
| 15:35:40.592 → .663 | Channel 전달 뒤 UserPromptSubmit을 `selection_channel`로 처리해 선택 유지 |
| 15:35:54.163 | 원래 A의 claim 성공. 원래 작업·cwd·packet·prompt·boundary 증거 보존 |
| 15:35:59.147543 | `cl01-a.txt`의 수정 시각. 후속 직접 읽기에서 정확히 `BLABEE_CL01_A_OK\n`인 17바이트 파일 확인 |
| 15:36:17.012 | 새 사용자 입력으로 A를 최신 선택에서 분리하고 `selection.superseded` 기록 |
| 15:36:38.376 | 새 C/D packet `359d040b-550b-4ed6-bbc1-17c8e73c5126`, revision 2 생성 |
| 15:36:40.478 | 원래 A의 `completed` 결과 저장. `reported_by=model`이며 note에 파일명과 내용 기록. 결과 이벤트에도 원래 claim 증거 유지 |
| 15:38:01 확인 | 새 C/D packet·prompt·boundary가 유지되고 phase는 `ready`. 최신 selection은 비어 있으며 A의 완료가 새 카드에 덮어써지지 않음 |

유지된 카드 요약은 `C-L01 새 작업 카드`이며, 선택지는 C `cl01-a.txt 내용 확인`, D `현재 폴더 파일 목록 확인`이다. 확인 시점까지 이 세션에는 C/D의 선택·claim 기록이 없다. `cl01-a.txt`는 symlink가 아닌 일반 파일이며 `cl01-b.txt`는 존재하지 않는다. A 파일의 수정 시각은 새 입력보다 앞서지만, 이것만으로 모든 파일 쓰기 이력을 증명하는 것은 아니다.

이번에 **실제 A claim → 파일 생성 → 새 사용자 입력 → C/D 제안 → 원래 A 완료 보고 → C/D 카드 데이터 유지**를 확인했다. 개발 앱 `build/blabee-claude.app`의 번들 Coordinator도 현재 `src/coordinator/service.mjs`와 바이트 단위로 일치했다. 최종 Pet 화면의 시각적 표시는 별도로 검사하지 않았다.

이번 후속 확인은 journal·파일·번들을 읽고 이 문서를 갱신한 작업이다. 테스트·빌드·모델 호출을 추가 실행하거나 앱·서비스를 재시작하지 않았다. C-L01의 다른 실패 상황은 아래 자동 검증 결과를 따르며, 공통 Swift 엔진 통합·배포 패키지·모든 Claude 수명 주기 검증이 완료된 것은 아니다. 다음 독립 보완 후보는 C-L02의 오류·중단·background 관측이다.

## 2026-09-18 — C-L01: 새 입력 이후 이전 작업 결과 보존

개발용 Coordinator에서 이미 claim한 작업을 최신 선택과 별도로 보관하도록 수정했다. A를 claim한 뒤 B 지시가 와도 현재 세션·bridge 권한과 원래 A의 claim을 검증해 A의 완료·실패를 기록한다. A의 결과는 B의 카드·선택·prompt·boundary·phase·준비 상태를 바꾸지 않는다. 현재 작업의 완료 표시는 기존처럼 동작하며 모든 결과는 모델 보고로 표시한다.

### 변경 범위와 기록 방식

- `src/coordinator/service.mjs`: 세션별 미보고 claim 보관, 새 입력 때 `selection.superseded` 기록과 최신 화면 분리, 원래 작업의 결과 기록. 도구 요청·응답과 UI 목록의 형식은 유지했다.
- `src/bridge/context.mjs`, `src/bridge/tools.mjs`, `Plugin/skills/blabee-claude-workflow/SKILL.md`: 최신 지시를 따르면서 원래 `selection_id`로 결과만 보고하도록 안내한다. 과거 작업의 재실행 권한으로 해석하지 않는다.
- `tests/coordinator.test.mjs`, `tests/roundtrip.test.mjs`: 실제 UDS·Hook 자식·SDK 경로의 회귀 검증. README·구현 문서·공통화 계획과 이 보고서에 현재 동작을 반영했다.

claim/result 이벤트에는 원래 cwd·packet/option·native prompt·작업 경계·task·done_when을 함께 남긴다. 앞선 등록·claim 이벤트가 보관 범위를 벗어나도 결과 기록만으로 원래 프로젝트와 작업을 식별할 수 있다. 인증값·delivery token·nonce·Hook prompt 원문/해시는 추가 저장하지 않는다. 기존 최근 1,000개 이력 제한과 재시작 시 최근 900개 이력 복구 정책은 유지한다.

미보고 claim은 세션당 32개로 제한하며, 가득 차면 새 선택을 수락하기 전에 거절한다. 결과 저장에 성공하면 한 자리를 회수하고 중복 결과는 거절한다. 저장 실패 시 결과·미보고 claim·한도 모두 이전 상태로 복구한다. SessionEnd와 Coordinator 재시작은 이전 결과 작성 권한을 복원하지 않는다.

### 검증 결과

| 검증 | 결과 |
| --- | --- |
| 수정 전 실패 재현 | 새 입력 뒤 기존 claim의 완료가 실제 `invalid_completion`으로 거절됨 |
| Coordinator 집중 검증 | 67/67 통과. 추가한 한도 rollback·cwd 보존 검사도 각각 통과 |
| 최종 전체 테스트 | **119/119 통과**, 실패·취소·skip 없음. 실행 로그 (`claude/build/cl01-tests-20260918.log`; 이전 로컬 생성물). `BLABEE_CLAUDE_PET_BINARY`에 아래 격리 앱의 실행 파일을 지정해 `npm test` 실행 |
| `npm run check` | JavaScript 18개 파일 구문 검사 통과 |
| 격리 앱 빌드·서명 | `build/cl1-e59f/`의 소스 사본에서 기존 빌드 스크립트로 Swift 6 컴파일·ad-hoc 서명 통과. `codesign --verify --deep --strict` 통과 |
| 번들 일치 | 번들 Coordinator·공유 모듈 4개가 최종 소스와 바이트 단위 일치 |
| 별도 검토 | 원래 cwd 누락을 보완한 뒤 변경 파일 10개 최종 검토 통과. 미해결 주요 결함 없음 |
| 문서·변경 범위 | 문서 5개·상대 링크 62개·공백 검사 통과. 변경 파일 10개 모두 `claude/` 안이며 격리 앱·테스트 로그의 Git 제외 확인 |

테스트는 실제 임시 파일 변경 후 A의 completed/failed 기록, B가 ready/selected/delivered/claimed인 상태 보존, 여러 이전 작업의 순서가 바뀐 결과 보고를 확인했다. 다른 세션·미claim/알 수 없는 선택·옛 bridge·폐기된 인증·중복 보고는 거절한다. 저장 실패 뒤 정상 재시도, 32개 한도와 한 자리 회수, 이력 회전·재시작 뒤 원래 cwd를 포함한 감사 기록 보존, 비밀값 반사 거절도 확인했다.

실제 Hook 자식 프로세스와 MCP SDK 테스트에서는 선택 Channel → claim → 새 사용자 Hook → B 제안·Stop → A 결과 보고 순서를 검증했다. A 결과 전후 B의 UI snapshot은 완전히 같고, 다른 세션의 보고와 결과 덮어쓰기도 거절됐다. 기존 현재 작업의 정상 완료 시나리오도 함께 통과했다. 이 자동 검증에서는 모델 역할을 테스트 클라이언트가 수행했다. 이후 실제 Claude 모델·사용자 선택으로 확인한 C-L01 결과는 위 후속 기록을 따른다.

격리 빌드의 첫 시도는 sandbox의 프로세스 조회 제한으로 중단됐다. 필요한 권한으로 동일 명령을 다시 실행해 통과했다. 전체 테스트도 로컬 소켓·자식 프로세스를 사용할 수 있는 승인된 실행 환경에서 수행했다. 테스트가 만든 runtime·프로세스만 사용했고 실행 중인 앱을 덮어쓰거나 종료하지 않았다.

### 적용과 남은 범위

자동 검증 단계에서는 소스와 격리 빌드에 반영했으며 기존 실행 앱에는 자동 적용하지 않았다. 다른 개발 세션에 적용할 때는 [README의 재실행 순서](../../../docs/history/claude/README_PRE_LAYOUT.md)에 따라 Claude 테스트 세션과 개발 앱을 정상 종료한 뒤 다시 빌드·실행한다. 위 후속 테스트에서는 수정된 개발 번들과 실제 C-L01 동작을 확인했다. 과거 작업 결과 목록 UI는 추가하지 않았으며 늦은 결과는 journal 감사 기록에 남는다. 이력의 무제한 보관·재시작 후 미보고 claim 복구·claim 응답 유실 복구는 이번 범위가 아니다.

공통 Swift 본체·Codex 소스·기존 서비스·전역 설정·의존성·Git 이력은 변경하지 않았다. S-00과 full S-01은 여전히 미완료이며 C-L01을 공통 엔진 통합 성공으로 계산하지 않는다. 다음 독립 보완 후보는 C-L02의 오류·중단·background 관측이다.

## 2026-09-18 — S-01 준비: 연결 규칙과 실패 상황 테스트

수정 범위는 `SHARED_ENGINE_PLAN.md`, `IMPLEMENTATION_PLAN.md`, 이 보고서와 `tests/coordinator.test.mjs`다. 공통 Swift 엔진·Claude 앱 소스·의존성·실행 앱·전역 설정은 이 작업에서 변경하지 않았다. 공통 계약의 상세 기준과 실패 상황 F-01~F-22는 [공통화 계획](../../../docs/bridges/claude/SHARED_ENGINE_PLAN.md), 현재 개발 구현과의 차이는 [구현 문서](IMPLEMENTATION_PLAN.md)를 따른다.

현재 소스와 공식 Hook·Channels 문서를 대조해 식별자·인증·논리 연결·작업 경계·전달 증거·결과 기록을 구분했다. S-01 준비(P1–P5)는 완료했다. 이 조사는 변경 중인 checkout의 소스 확인이며 **S-00 통합 기준점 합의가 아니다. S-01 전체 구현·계약 확정도 아직 완료되지 않았다.**

### 추가한 실제 UDS 실패 테스트

[Coordinator 테스트](../../../Tests/bridges/claude/standalone/coordinator.test.mjs)에 응답 유실 3개와 Stop 상태 1개를 추가했다. 릴레이는 실제 Coordinator의 성공 응답을 받은 뒤 journal을 읽고, 호출자에게 응답 본문을 보내지 않은 채 연결을 닫는다. 따라서 처리·저장 완료 뒤 호출자가 응답을 받지 못하는 순서를 검증하며 상태를 흉내 낸 mock을 사용하지 않는다.

| 테스트 | 현재 구현에서 확인한 결과 | 해석 |
| --- | --- | --- |
| `lost bridge.poll response` | 전달 기록 1회, 다음 poll은 `null`, claim·완료 기록 없음 | 전달 기록만으로 모델 수신·실행을 추정하지 않는다. 자동 재전송도 없다. |
| `lost selection.claim response` | claim 기록 1회, 같은 ref 재시도는 `invalid_selection`, 재전달·완료 없음 | **현재 Claude 개발 구현의 복구 한계**를 확인한다. Codex의 멱등 재응답을 폐기할 목표 규칙이 아니다. |
| `lost selection.complete response` | 첫 outcome·note와 UI 결과 유지, 같은/다른 결과의 재시도 모두 `invalid_completion`, 추가 완료 기록 없음 | 결과 저장과 호출자의 성공 응답 수신은 다르며, 재시도로 기존 결과를 덮어쓰지 않는다. |
| `Stop after a claim` | `awaiting_completion` 유지, 명시적인 결과 보고 후에만 완료 상태 | Stop은 전경 응답 종료이며 작업 성공 증거가 아니다. |

### 이번 검증 결과

| 검증 | 결과 |
| --- | --- |
| 추가 테스트 집중 실행 | helper 수정 후 **4/4 통과** |
| 전체 `npm test` | 최종 **104/104 통과**, 실패·취소·skip 없음. 실행 로그 (`claude/build/bridge-contract-prep-tests-20260918.log`; 이전 로컬 생성물) |
| `npm run check` | 최종 JavaScript **18개 파일 구문 검사 통과** |
| 별도 QA | helper의 연결 전 실패 시 무기한 대기 가능성 수정 후 재검토 통과. 실제 UDS·저장 순서·assertion과 문서 3개의 일관성 검토에서 미해결 주요 결함·확정된 모순 없음 |
| 문서·생성물 | 상대 링크 51개, 실패표 F-01~F-22와 작업 ID, 코드 블록·공백 검사 통과. 실행 로그 2개의 Git 제외 확인 |

첫 전체 실행은 sandbox가 테스트용 로컬 소켓 생성을 `EPERM`으로 차단했다. 실패 로그 (`claude/build/bridge-contract-prep-tests-sandbox-denied-20260918.log`; 이전 로컬 생성물)를 보존하고, 필요한 실행 권한으로 동일 명령을 다시 실행했다. 기존 앱·서비스를 종료하거나 교체하지 않았고, 실제 Claude 모델 호출이나 앱 빌드도 이번 테스트 범위에 포함하지 않았다.

helper는 연결 콜백과 독립적인 전체 6초 제한을 갖고, 연결 전 요청 실패도 대기를 종료한다. 성공·실패 모두 테스트가 생성한 소켓·서버·임시 runtime만 정리한다. 이 보완 뒤 집중 테스트와 전체 테스트·구문 검사를 다시 통과했다.

### 확인된 차이와 다음 작업

- 당시 새 사용자 입력 후 기존 claimed 작업의 결과를 기록할 수 없는 한계를 **C-L01**로 분리했다. 후속 구현 결과는 위 기록을 따른다. 목표는 유효한 작성 권한과 원래 claim을 검증해 과거 작업의 결과를 보존하는 것이며, 최신 카드의 완료 처리나 이전 실행 권한 복원은 허용하지 않는다.
- Swift queued claim은 닫힌 boundary를 요구하고 기존 `record_work_outcome`은 열린 boundary만 받는다. Claude 완료 도구를 그 함수에 바로 연결할 수 없으므로 공통 결과 보고·감사 계약 결정이 필요하다. 기존 Codex 결함으로 판정한 것은 아니다.
- `SessionStart.source`·`StopFailure`·background·중단 관측은 **C-L02**, readiness Channel의 Hook 경계 처리는 **C-L03**에 남겼다. 새 테스트가 이 기능을 구현하거나 검증한 것은 아니다.
- 두 provider의 같은 native ID, durable 매핑의 유실·변조·복구, Codex claim 재응답, 공통 Pet·legacy v1 호환은 S-00 이후 공통 엔진 fixture로 검증해야 한다. 아래 실제 A 실행 성공도 이 항목들의 통과 증거가 아니다.

## 2026-09-18 — 실제 A 선택·파일 생성·완료 확인

사용자가 수정본을 다시 실행한 대화형 Claude Code 세션에서 Pet의 A 버튼을 눌렀다. 보고된 packet `270bb202-bdf1-4847-bf64-78345e922034`를 Coordinator journal과 대조하고 실제 생성 파일을 읽어 확인했다. 세션은 `796978ab-95da-4435-aff9-83d239f0939b`, 작업 위치는 `build/live-test/`다.

| 실제 기록 (KST) | 확인 결과 |
| --- | --- |
| 12:45:52.971 | 채널 수신 확인 ACK 성공 |
| 12:48:07.154 | Pet의 A 선택 저장 |
| 12:48:07.425 → .494 | Channel 전달 뒤 UserPromptSubmit이 `selection_channel`로 기록됨. 선택을 무효화하지 않음 |
| 12:48:13.518 | 같은 선택의 claim 성공 |
| 12:48:22.177 | `completed` 결과 보고 저장 |
| 후속 파일 확인 | `result-a.txt`에 `BLABEE_CLAUDE_A_OK` 기록됨. `result-b.txt`는 존재하지 않음 |

이번 대화형 세션에서는 **제안 → Pet 클릭 → Channel → native Hook → claim → 선택한 파일 생성 → 완료 보고**를 확인했다. 파일 생성 결과를 직접 확인했으므로 모델의 완료 보고만으로 통과 판정한 것은 아니다. 클릭은 사용자가 수행했고, 최종 Pet 화면의 시각적 표시는 별도로 검사하지 않았다.

이 결과는 개발용 Claude 브릿지의 위 시나리오에 한정한다. 아래 비대화형 검증의 채널 미수신 기록은 그대로 유지하며, 공통 Swift 엔진 통합·배포 패키지·다른 계정이나 Claude 버전 검증을 대신하지 않는다.

## 2026-09-18 — 선택 Channel의 UserPromptSubmit 처리

### 실제 실패와 원인

사용자의 Claude Code 2.1.276 세션에서 A 선택이 12:18:43.221 KST에 저장되고 .580에 전달됐으나, .652에 발생한 UserPromptSubmit이 `new_user_prompt`로 해당 선택을 무효화했다. 뒤이은 `claim_selection`은 `invalid_selection`으로 거절됐으며 테스트 파일 A/B는 생성되지 않았다. Channel 전달 자체와 실제 claim 성공은 다른 단계다.

기존 자동 왕복 테스트에는 Channel 수신 뒤의 UserPromptSubmit이 빠져 있었다. 그 Hook을 별도 프로세스로 삽입하자 수정 전 코드에서도 기존 boundary가 교체되어 실패했다. 같은 버전 설치 바이너리의 기본 경로를 읽어, 모델용 전체 channel wrapper가 Hook의 `prompt`에 전달되는 흐름도 확인했다. 이는 버전별 정적 근거이며 향후 버전의 공개 계약 보장은 아니다.

### 수정 내용

- Hook이 입력 전체의 SHA-256만 전달하고, Coordinator가 현재 발송된 선택의 세션·bridge·boundary·packet/revision·일회용 token까지 포함한 메시지와 정확히 대조한다. 일치하면 실제 새 native prompt ID를 기록하면서 선택을 유지한다. 일반 입력과 알 수 없는 형식은 이전 선택을 무효화한다.
- 동일 prompt ID·동일 메시지 형식의 미claim Hook 재시도만 멱등 처리한다. 다른 세션·이전 bridge·아직 발송하지 않은 선택·변조·다른 prompt ID 재생은 예외를 얻지 못한다. claim은 계속 한 번만 가능하다.
- 선택 메시지 생성 규칙은 `src/shared/channel.mjs`를 공유한다. 원문·해시·token은 UI나 journal에 추가 저장하지 않으며 history에는 `prompt_kind`만 기록한다. 이 대조는 출처 인증이나 실행 승인이 아니다.

### 검증 결과

| 검증 | 결과 |
| --- | --- |
| 수정 전 회귀 테스트 | Channel → UserPromptSubmit에서 boundary가 바뀌며 실패, 사용자 현상 재현 |
| 브릿지·Coordinator 집중 테스트 | 68/68 통과 |
| 전체 `npm test` | **100/100 통과**, 실패·취소·skip 없음. 실행 로그 (`claude/build/selection-hook-tests-20260918.log`; 이전 로컬 생성물) |
| `npm run check` | JavaScript 18개 파일 구문 검사 통과 |
| 격리 Swift 앱 빌드 | `build/hf1/`에 필요한 소스·빌드 스크립트를 복사해 기존 빌드 절차로 컴파일·ad-hoc 서명 통과 |
| `codesign --verify --deep --strict build/hf1/build/blabee-claude.app` | 통과. 번들 Coordinator·공유 모듈이 수정 소스와 바이트 단위로 일치 |
| 독립 코드 검토 | 지정 범위에서 수정이 필요한 확정 결함 없음 |

격리 빌드의 첫 실행은 sandbox의 프로세스 조회 제한으로 중단됐다. 필요한 권한을 받은 뒤 동일 빌드 명령으로 통과했다. 실행 중인 기존 개발 앱은 덮어쓰지 않았다. 적용하려면 기존 Claude 테스트 세션과 Blabee Claude 개발 앱을 정상 종료한 뒤 [README의 재실행 순서](../../../docs/history/claude/README_PRE_LAYOUT.md)를 따른다. 기존 Codex 앱·본체 소스는 이 수정 범위에 포함하지 않는다.

### 추가 실제 모델 확인의 한계

원래 앱과 분리된 임시 runtime에서 Claude Code 2.1.276을 비대화형으로 실행했다. 파일 도구는 비활성화하고, A/B 작업은 고정 표식 보고로 제한했다. 실제 모델은 `check_connection`을 호출했지만, Coordinator의 `readiness.delivered` 이후 채널 수신·ACK가 관측되지 않아 150초 제한 시간에 종료했다. A 선택이나 claim은 시작되지 않았다. 이 시도는 선택 수정의 실제 성공 증거가 아니며, 비대화형 세션에서 수신되지 않은 원인도 이번 기록만으로 확정하지 않는다. 검증 보고서 (`claude/build/lhc-PkHCRc/report.json`; 이전 로컬 생성물), 격리 검증 스크립트 (`claude/build/live-selection-hook-check.mjs`; 이전 로컬 생성물).

검증 스크립트의 첫 실행은 sandbox가 로컬 소켓 생성을 차단했고, 필요한 권한을 받은 뒤 실제 모델 시도를 진행했다. 생성한 자식과 임시 서비스만 정리했다. 기존 대화형 세션은 조작하지 않았다. 당시 남았던 대화형 Claude와 Pet의 A 선택 → 실제 파일 생성·완료는 위 후속 사용자 테스트에서 확인했다.

## 2026-09-18 — 독립 채널 수신 확인

수정 범위는 `claude/`의 MCP 브릿지, 검증용 Node Coordinator, 개발용 Pet의 선택 가능 조건, 해당 테스트와 문서다. 기존 Blabee 본체 소스·설치 앱·실행 서비스는 변경하지 않았다. 의존성 추가, 전역 Claude 설정 변경, commit·push·브랜치 전환은 없다.

### 변경과 확인한 동작

- 사용자 요청의 `check_connection` → 일회용 Channel 확인 메시지 → `ack_readiness_probe` 흐름을 추가했다. 초기화·heartbeat·notification 쓰기만으로는 선택을 허용하지 않는다. 이 확인은 작업·선택·claim·파일 변경을 생성하지 않는다.
- MCP마다 논리 `bridge_id`를 한 번 등록하고 세션과 함께 모든 모델 도구·poll에 주입한다. 짧은 UDS 요청마다 등록을 바꾸지 않는다. 이전 bridge의 응답·선택·늦은 종료가 새 등록에 적용되지 않는다.
- 다른 세션의 nonce, 중복 ACK, 만료된 확인, 연결 단절 뒤의 이전 확인을 거부한다. nonce·인증 정보는 UI나 journal에 저장하지 않으며 재시작 시 준비 권한을 복원하지 않는다. readiness는 한 번 관측한 전달 증거이며 native caller 신원 증명이나 다음 작업의 실행 보장이 아니다.
- 개발용 Pet은 수신 확인 전의 선택을 비활성화한다. 브릿지 교체로 아직 실행되지 않은 선택이 무효화되면, 정확한 session·packet·selection 응답을 확인한 뒤 같은 카드를 다시 선택할 수 있다. 이미 claim한 작업은 교체만으로 취소됐다고 표시하지 않는다.
- SDK 초기화 중 종료, 늦은 등록 응답, 진행 중 poll의 종료, 인자 없는 연결 확인, 잘못된 응답·추가 필드, 오류 코드에 담긴 인증값 노출을 검증했다. 자동 ACK와 자동 재전송은 없다.

### 검증 결과

| 검증 | 결과 |
| --- | --- |
| 수정 전 `npm test` | 48/48 통과 |
| 최종 `npm test` | **80/80 통과**, 실패·취소·skip 없음. 실행 로그 (`claude/build/bridge-readiness-tests-20260918.log`; 이전 로컬 생성물) |
| `npm run check` | JavaScript 17개 파일 구문 검사 통과 |
| `npm run build` | 최종 Pet 수정 후 Swift 6/macOS 13 target 컴파일·개발 앱 생성·ad-hoc 서명 통과 |
| `codesign --verify --deep --strict build/blabee-claude.app` | 최종 앱 통과 |
| 별도 코드 검토 | 인자 없는 MCP 호출과 재연결 후 카드 재선택 문제 수정. 지정 범위에서 미해결 주요 문제 없음 |

전체 테스트는 두 세션의 실제 MCP SDK stdio·별도 Hook 프로세스·UDS와 Swift transport를 사용한다. 확인 메시지만 받은 상태에서는 선택을 거부하고, 다른 세션 ACK를 거부한 뒤 올바른 ACK → 선택 → claim → 결과 보고를 검증한다. 이때 Claude 모델의 역할은 테스트 클라이언트가 수행한다. Pet 검증은 네이티브 transport·상태 판단과 실행 잠금 검사이며 실제 화면을 클릭한 검증은 아니다.

첫 로그 저장 실행은 sandbox가 UDS 생성을 `EPERM`으로 차단해 실패했다. 코드를 변경해 우회하지 않고, 필요한 실행 권한을 요청한 뒤 같은 전체 명령을 재실행해 80/80 통과했다. 실패 기록은 sandbox 제한 로그 (`claude/build/bridge-readiness-tests-sandbox-denied-20260918.log`; 이전 로컬 생성물)에 보존한다. 생성물·테스트 runtime·검토용 기준 사본은 `claude/build/` 안에 둔다.

### 실제 Claude Code 연결 확인

Claude Code 2.1.276의 `live-test` 세션에서 실제 모델의 `check_connection` → Channel 메시지 수신 → `ack_readiness_probe` → `ready: true` 응답을 두 번 확인했다. 해당 Claude 대화 기록과 Coordinator의 `readiness.acknowledged` 기록을 대조했다. 확인 완료 시각은 2026-09-18 **11:58:34, 11:59:16 KST**다. 인증 정보와 확인 nonce는 이 문서에 복사하지 않았다.

두 번째 응답의 수신 확인 만료 시각은 **12:04:16 KST**다. 사용자가 제공한 화면 파일은 **12:06:39 KST**에 저장됐으므로, 그 시점의 “Claude 연결 확인 필요”는 이미 만료된 확인으로 설명된다. 현재 화면은 미확인과 만료를 같은 문구로 표시한다. heartbeat 공백에 의한 해제는 journal에 기록하지 않으므로 상태가 처음 해제된 시각까지 복원한 것은 아니다. “아직 제안된 선택이 없어요”는 이 세션에서 연결 확인만 요청하고 제안을 생성하지 않은 상태와 일치한다.

이 당시 결과는 실제 모델의 채널 수신과 응답 확인에 한정했다. 선택 클릭 이후 실제 파일 생성·완료는 위 후속 사용자 테스트에서 별도로 확인했다.

### 남은 확인과 범위

- **실제 Claude Code의 Channel 수신·모델 ACK와 후속 대화형 A 선택 → 같은 세션의 파일 생성·완료 보고를 확인했다.** 이번 성공을 다른 계정·조직 정책이나 모든 프로토콜 조합의 지원으로 확대하지 않는다. 전송 성공만으로 수신을 보장하지 않는다는 근거는 [공식 Channels 규약](https://code.claude.com/docs/en/channels-reference)을 따른다.
- 공통 Swift 엔진과의 연결, durable session 매핑, 공통 화면·설치 패키지 통합은 아직 구현 전이다. 이번 Node 구현은 브릿지의 상대 동작을 검증하는 개발용 런타임이다.
- `SessionStart.source`, `StopFailure`, background 작업 관측과 claim 후 새 사용자 입력의 결과 기록은 후속 보완 범위다. 이번 수신 확인이 그 수명 주기 문제를 해결했다고 보고하지 않는다.
- 기존 개발 앱이 실행 중이면 정상 종료하고 다시 빌드해야 한다. 새 MCP 브릿지와 구형 서비스 조합은 지원하지 않는다. 검증한 앱은 여전히 checkout·로컬 Node 경로에 의존하며 배포용 설치 파일이 아니다.

## 2026-09-12 — 초기 개발 앱 검증 기록

확인일: 2026-09-12. 수정 범위는 `apps/blabee/claude/`다. 기존 Codex 소스·설치 앱·서비스 설정은 수정하지 않았다. commit·push·checkout 전환은 하지 않았다.

### 자동 검증

| 검증 | 결과 |
| --- | --- |
| `npm test` | 48/48 통과, 실패·skip 없음 |
| `npm run check` | JavaScript 17개 파일 구문 검사 통과 |
| `npm run build` | Swift 6, macOS 13 target으로 앱 생성·ad-hoc 서명 통과 |
| `codesign --verify --deep --strict build/blabee-claude.app` | 통과 |
| 앱 `--diagnose` | Claude 전용 Bundle ID·runtime·socket·Pet 잠금 확인, read-only |

테스트는 실제 Unix socket, 별도 Hook 프로세스, 공식 MCP SDK stdio 서버와 Swift transport를 사용한다. 두 세션에서 제안 → Stop → 선택 → 채널 ref → claim → 완료를 검증하며, 다른 세션의 claim과 중복 claim은 거부한다. 실제 Claude 모델 호출을 대신하는 protocol fixture다.

추가로 최신 작업 경계·카드 revision, 새 사용자 입력 이후 무효화, bridge 연결 조건, 재시작 후 자동 재실행 차단, 토큰 미저장, 권한 없는 socket·symlink·기존 Codex 경로 거부, 응답 크기·timeout을 검증했다. Pet 잠금은 같은 runtime의 중복 실행을 거부하고 서로 다른 runtime은 함께 동작했다. Coordinator 부모 종료 테스트는 테스트가 생성한 부모만 종료하여 자식 종료와 자기 socket·잠금 정리를 확인했다.

독립 코드 검토에서 발견한 등록 직후 실패의 세션 정리, runtime 인수 전달, 반복 SessionStart의 compaction 처리, 빈 heartbeat의 불필요한 journal 쓰기, payload에 되비친 인증 token 문제를 수정하고 회귀 검증했다. 이 검토는 launcher·Coordinator·bridge의 지정된 범위이며 전체 제품 보안 감사를 뜻하지 않는다.

### 실제 실행 증거

- GPT computer use로 `build/blabee-claude.app`을 열고 **Blabee Claude** 패널의 접근성 트리와 화면을 확인했다.
- 첫 화면은 Coordinator 준비 전 socket 연결 대기 상태였다. 이후 `doctor`에서 `reachable: true`, `provider: claude`, `protocol: blabee-claude.v1`을 확인했다.
- 후속 GPT computer use 화면 조회는 `timeoutReached (-10005)`로 실패했다. 선택 패널의 클릭·종료·재시작을 실제 화면에서 통과했다고 보고하지 않는다.
- Pet의 읽기 전용 2초 stack sample에서는 main thread가 대부분 정상 AppKit 이벤트 대기 중이었다. 이 sample은 실패한 화면 조회와 동시에 수집하지 않았으므로 간헐적 정지는 배제하지 못한다. 소스와 sample만으로 시간 초과 원인을 특정하지 않아 추측으로 UI 코드를 수정하지 않았다.
- `/Applications/Blabee.app`의 기존 실행 프로세스를 변경하거나 종료하지 않았다. 개발 앱은 별도 경로와 자식 서비스를 사용한다.
- `/Applications` 설치, LaunchAgent 등록, 전역 Claude 설정이나 인증 정보 변경은 하지 않았다.

### 당시 남은 최종 확인

1. 실제 Claude 대화형 세션에서 개발 Channels 사용 확인을 거쳐 Hook·MCP가 연결되는지 확인한다. 계정·조직의 Channels 정책이 허용해야 한다.
2. Claude가 제안한 두 선택이 Pet에 표시되고 사용자가 클릭한 선택만 같은 Claude 세션에서 실행되는지 확인한다. 일반 도구 승인은 Claude 화면에서 처리한다.
3. 실제 Pet 종료·재시작과 두 제품 동시 표시를 확인하고, Claude 종료가 Codex 작업에 영향을 주지 않는지 확인한다.
4. 배포 단계에서 checkout과 로컬 Node 절대 경로 의존성을 제거하고 설치·업데이트·제거를 별도로 검증한다. 현재 `Plugin/`은 설치 패키지가 아니다.

실행 방법은 [README.md](../../../docs/history/claude/README_PRE_LAYOUT.md)를 따른다. 완료 결과는 모델 보고로 기록하며 성공적인 이벤트 전달 자체를 작업 완료로 간주하지 않는다.

### 당시 조사와 환경의 한계

그래프 조회·coverage 도구가 `Transport closed`로 실패하여 관련 소스를 직접 읽고 검증했다. 그래프 generation이나 전체 코드 coverage가 확인된 것은 아니다. Unix socket·프로세스 검사가 sandbox에서 제한되어 승인된 환경에서 해당 테스트와 빌드를 수행했다.

Claude Code 2.1.269, Node.js 22.23.2, Swift 6.4, MCP SDK 1.30.0을 확인했다. Hook과 Channels는 [공식 Hooks 문서](https://code.claude.com/docs/en/hooks), [Channels 개발 규약](https://code.claude.com/docs/en/channels-reference), [CLI 문서](https://code.claude.com/docs/en/cli-reference)를 기준으로 연결했다. 실제 계정 정책과 모델의 도구 사용은 자동 테스트로 확인되지 않는다.
