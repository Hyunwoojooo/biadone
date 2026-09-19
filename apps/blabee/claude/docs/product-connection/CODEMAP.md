# 제품 연결 파일 지도

2026-09-19 현재 working tree 기준이다. CP-02 private 등록·registry·metadata에 이어 CP-03의 같은 authority 주입·owner 갱신·commit fence와 CP-04 수명 관측·재생 기록·시간 처리를 추가했다. 설치 launcher와 v2 Hook/MCP client는 CP-05다. 경로가 링크인 것은 현재 파일이고, 코드로만 적은 신규 제안 경로는 후속 구현 대상이다. `Sources/`와 `Tests/`는 `src/coordinator-swift/` 기준이다.

## 기존 연결 지점과 수정 책임

| 기존 파일/심볼 | 현재 역할 | 계획한 최소 변경 / 담당 작업 |
| --- | --- | --- |
| [main.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/main.swift) / `ClaudeProductServiceCoordinator` 조립 | 앱 소유 서비스에 private endpoint·registry 추가. 일반 daemon은 등록 미지원 | CP-02 적용. v2 작업 인증/dispatch는 CP-03 |
| [ClaudeBridgeCoordinator.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/ClaudeBridgeCoordinator.swift) / `handle` | 명시적으로 설정한 개발 `claude_bridge_v1` 경로 유지 | 제품 등록의 scope를 static ingress에 넣지 않음. 기존 파일 변경 없음 / CP-02 |
| [ClaudeNativeHost.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/ClaudeNativeHost.swift) | FD grant를 받아 한 host 생성; 설치 runtime 경로 거절 | 격리 host는 개발 회귀용으로 보존. 제품 native 조립은 CP-03 |
| [ClaudeNativeSession.swift](../../../src/coordinator-swift/Sources/ClaudeCoreAdapter/ClaudeNativeSession.swift) | native 관측·경계·readiness·role auth | registry authority 주입, 제품 v2·lifecycle source·compact·quota 처리. 개발 v1 혼동 금지 / CP-01,03,04 |
| [ClaudeBridgeIngress.swift](../../../src/coordinator-swift/Sources/ClaudeCoreAdapter/ClaudeBridgeIngress.swift) | scope/role/고정 expiry 재검사 | NativeSession과 같은 authority record를 판정. 한쪽만 갱신하지 않음 / CP-03 |
| [ClaudeCoreAdapter.swift](../../../src/coordinator-swift/Sources/ClaudeCoreAdapter/ClaudeCoreAdapter.swift) | 공통 routing/journal, 메모리 offer/claim + 결과 재생 | provider metadata/binding 검증. snapshot의 due 쓰기와 순수 이력 replay 분리 / CP-02,04 |
| [UnixDomainSocketTransport.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/UnixDomainSocketTransport.swift) | framing·UID·runtime identity·known-secret 검사, writer lease | CP-03의 `claude_session_v2` type·입력 capability 검사 추가. 자격 발급은 별도 private endpoint만 허용 |
| [PetAppService.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/PetAppService.swift), [AppOwnedServiceProcess.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/AppOwnedServiceProcess.swift) | 설치 앱이 자기 서명 서비스 소유 | provider 시작/종료 상태 연결. 한 Claude 종료로 서비스 종료 금지 / CP-02,06 |
| [shared-launcher.mjs](../../src/bridge/shared-launcher.mjs) / `startSharedRuntime` | private host·1시간 grant 발급·자식 종료 | 개발 회귀 경로로 보존. 제품은 native owner가 등록·갱신 담당 / CP-05 |
| [product-context.mjs](../../src/bridge/product-context.mjs), [native-session-client.mjs](../../src/bridge/native-session-client.mjs) | scoped v1 요청/응답 검사 | 협상한 제품 v2, service incarnation/fencing 검사; 실패 시 Codex fallback 금지 / CP-05 |
| [product-hook.mjs](../../src/bridge/product-hook.mjs), [product-mcp.mjs](../../src/bridge/product-mcp.mjs), [product-tools.mjs](../../src/bridge/product-tools.mjs) | Hook 파싱·SDK Channels·도구·poll FIFO | 기존 v1은 보존. CP-04의 새 v2 helper를 실제 client에 연결 / CP-05 |
| [ClaudePetTransport.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/ClaudePetTransport.swift), [ClaudePetApplication.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/ClaudePetApplication.swift) | 격리 host 안의 closure selector, 공통 UI | DTO/표시 변환 재사용. standalone test window를 설치 앱으로 오인하지 않음 / CP-06 |
| [PetApplication.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/PetApplication.swift), [PetTransport.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/PetTransport.swift), [PetModels.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/PetModels.swift), [PetViewModel.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/PetViewModel.swift), [PetView.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/PetView.swift) | 설치 Pet의 기존 UDS/선택/화면 | 새 provider envelope·세션 집계·시작/재확인/해제 UI. legacy Codex-only v1 유지 / CP-06 |
| [AppRuntimeUseLease.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/AppRuntimeUseLease.swift), [PetAppUpdates.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/PetAppUpdates.swift), [AppInstallation.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/AppInstallation.swift) | 앱 파일 사용·교체 보호 | 불변 bridge payload·활성 Claude 업데이트 보류/종료 안내를 기존 guard에 결합 / CP-07 |
| [build-macos-app.mjs](../../../scripts/build-macos-app.mjs), [prepare-local-dogfood.mjs](../../../scripts/prepare-local-dogfood.mjs), [Package.swift](../../../src/coordinator-swift/Package.swift) | 앱 조립·manifest·native entrypoint·target | bridge/지원 runtime/계약/버전/digest 포함. 기존 `blabee-codex` 의미 보존 / CP-05,07 |

`CoordinatorAuthorityLease`는 DB writer process lock이다. 세션 credential의 TTL이나 readiness를 갱신하는 API가 아니다.

## 추가한 파일과 신규 제안

| 경로 | 책임 |
| --- | --- |
| [Contracts/bridge/](../../../Contracts/bridge/)의 `claude-owner.v1.json`, `claude-session.v2.json`, `pet-provider.v1.json`, `common.v1.json` | CP-01B 제품 envelope·공통 값 schema. `Contracts/v1/` 밖에 배치. [계약과 신뢰 경계](PRODUCT_WIRE.md) |
| [Sources/ClaudeCoreAdapter/ClaudeProductWireCodec.swift](../../../src/coordinator-swift/Sources/ClaudeCoreAdapter/ClaudeProductWireCodec.swift) | CP-01B 구조·응답 correlation·secret 검사. 실제 인증/dispatch가 없는 독립 codec |
| [Sources/BlabeeCoordinator/ClaudeSessionEnrollment.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/ClaudeSessionEnrollment.swift) | CP-02 private owner endpoint, peer 서명/빌드/수명 검증·challenge·SCM_RIGHTS·grant pipe. EOF는 해당 등록만 회수 |
| [Sources/BlabeeCoordinator/ClaudeSessionRegistry.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/ClaudeSessionRegistry.swift) | CP-02 scope/역할 자격 생성, 별도 core·metadata, 회수·읽기 전용 이력, scope별 오류 격리 |
| [Sources/BlabeeCoordinator/ClaudeProductServiceCoordinator.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/ClaudeProductServiceCoordinator.swift) | CP-02 공통 서비스 wrapper와 CP-03 v2 dispatch. Codex 전달 보존, 일반 UDS의 owner 요청 거부 |
| [Sources/ClaudeCoreAdapter/ClaudeSessionAuthority.swift](../../../src/coordinator-swift/Sources/ClaudeCoreAdapter/ClaudeSessionAuthority.swift) | CP-01A 단일 lease·renewal/revoke·mutation fence. CP-02 registry가 scope별로 소유. 실제 native/inner ingress·owner 갱신 연결은 CP-03 |
| [Sources/BlabeeCoordinator/ClaudeSessionMetadataStore.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/ClaudeSessionMetadataStore.swift) | CP-02 별도 SQLite, 매핑/HMAC/독립 freshness/prepare-finalize/이력 검증. CP-04 metadata v2 replay tombstone·streaming 검증·파생 lookup, v1 history-only |
| [Sources/BlabeeCoordinator/ClaudeOwnerRenewalController.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/ClaudeOwnerRenewalController.swift) | CP-03 인증된 private exchange를 주입받는 owner timer·renew/end·응답 검증. Terminal/자식 시작은 CP-05 |
| [Sources/ClaudeCoreAdapter/ClaudeProductAuthorityJournal.swift](../../../src/coordinator-swift/Sources/ClaudeCoreAdapter/ClaudeProductAuthorityJournal.swift) | CP-03 journal 입구의 같은 authority 검사. 실제 COMMIT fence는 root가 `SQLiteJournal.appendCommitGate`에 주입 |
| [Sources/ClaudeCoreAdapter/ClaudeNativeReplayPort.swift](../../../src/coordinator-swift/Sources/ClaudeCoreAdapter/ClaudeNativeReplayPort.swift) | CP-04 scope별 prompt/proposal/selection/Hook 재생 기록 포트 |
| [session-v2-lifecycle.mjs](../../src/bridge/session-v2-lifecycle.mjs), [session-v2-channel-poller.mjs](../../src/bridge/session-v2-channel-poller.mjs) | CP-04 순수 Hook 정규화와 일정한 메모리의 Channel cursor/poller. 실제 MCP 연결은 CP-05 |
| `Sources/BlabeeCoordinator/ClaudeInstalledLauncher.swift` | 앱/설치 CLI 공통 native owner, 실제 자식 소유·renewal·역할 환경·Terminal 시작 |
| `Sources/BlabeeCoordinator/ClaudeRuntimePayload.swift` | digest별 불변 payload 검증·원자적 준비·활성/비정상 종료 보호 |
| `Sources/BlabeeCoordinator/PetProviderTransport.swift` | Codex/Claude DTO를 새 UI envelope로 집계, selector를 provider/scope에만 전달 |
| `claude/Plugin/.claude-plugin/plugin.json`, `hooks/hooks.json`, `.mcp.json` | 승인 경로가 준비된 Claude plugin manifest/entrypoint. 기존 workflow 참고 폴더를 배포 완료로 취급하지 않음 |

코드 표기로 남긴 launcher·payload·provider UI·plugin은 후속 구현 대상이다. CP-02는 별도 wrapper로 공통 서비스를 조립해 기존 Codex dispatcher의 분해를 피했다. `StorageKey.swift`의 `SidecarAuthenticator`와 `StorageProcessLock.swift`는 기존 구현을 재사용하도록 필요한 선언만 `package` 접근으로 바꿨으며 동작은 그대로다. 별도 제품 폴더 전면 이동/기존 독립 엔진 삭제는 CP-08 이후 작업이다.

## 보존 대상

- [CoordinatorBinding.swift](../../../src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorBinding.swift), [ContractPin.swift](../../../src/coordinator-swift/Sources/CoordinatorSwift/ContractPin.swift), [SQLiteJournal.swift](../../../src/coordinator-swift/Sources/CoordinatorSwift/SQLiteJournal.swift): 기존 9필드 binding, v1 12개 파일 hash, exact schema object 검사를 유지한다. provider 테이블은 core DB에 넣지 않는다.
- CP-03의 `SQLiteJournal.appendCommitGate`는 기본 `nil`인 opt-in seam이다. 실제 첫 append COMMIT만 감싸며 기존 Codex/v1 경로는 그대로다. schema·계약 변경이 아니다.
- [ProductServiceConfiguration.swift](../../../src/coordinator-swift/Sources/BlabeeProductSupport/ProductServiceConfiguration.swift): 기존 Codex DB/key/Keychain `primary` 및 authority 경로 유지.
- [OperationalCLI.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/OperationalCLI.swift), [CoordinatorOperationalApplication.swift](../../../src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorOperationalApplication.swift), [CodexQueueNextTurnDispatcher.swift](../../../src/coordinator-swift/Sources/BlabeeCoordinator/CodexQueueNextTurnDispatcher.swift), [Codex Plugin](../../../Plugin/blabee/): native/effective ID, Hook·MCP, durable claim, native approval 의미 보존. 제품 연결을 위해 먼저 대규모 Codex 분해를 요구하지 않는다.

## 테스트 연결

| 테스트 자산 | 검증 범위 / 후속 |
| --- | --- |
| [SessionAuthorityTests.swift](../../shared-engine/Tests/ClaudeCoreAdapterTests/SessionAuthorityTests.swift) | CP-01A 신규: 24시간 갱신, 만료 경계, sequence 중복, identity·객체 격리, 시계 오류, 회수·commit 경합. 실제 owner/IPC 연결은 후속 |
| [ProductWireCodecTests.swift](../../shared-engine/Tests/ClaudeCoreAdapterTests/ProductWireCodecTests.swift), [product-wire-schema.test.mjs](../../tests/shared-engine/product-wire-schema.test.mjs) | CP-01B 신규: [공유 fixture](../../tests/fixtures/product-wire/cases.json), role·버전·숫자·raw JSON·correlation·secret 검사. 실제 peer/auth/liveness·inner DTO·UI projection은 후속 |
| [NativeSessionTests.swift](../../shared-engine/Tests/ClaudeCoreAdapterTests/NativeSessionTests.swift) | lease·readiness·card 독립 시계, role/generation, compact·권한 회수 |
| [ClaudeSessionEnrollmentTests.swift](../../../src/coordinator-swift/Tests/BlabeePetTests/ClaudeSessionEnrollmentTests.swift), [ClaudeSessionRegistryTests.swift](../../../src/coordinator-swift/Tests/BlabeePetTests/ClaudeSessionRegistryTests.swift), [ClaudeSessionMetadataStoreTests.swift](../../../src/coordinator-swift/Tests/BlabeePetTests/ClaudeSessionMetadataStoreTests.swift) | CP-02 실제 private socket/FD·오류 정리, 여러 scope·Codex 격리, 중간 실패·변조·rollback·이력 조회 경합 |
| [ClaudeOwnerRenewalControllerTests.swift](../../../src/coordinator-swift/Tests/BlabeePetTests/ClaudeOwnerRenewalControllerTests.swift), [ProductAuthorityIntegrationTests.swift](../../shared-engine/Tests/ClaudeCoreAdapterTests/ProductAuthorityIntegrationTests.swift) | CP-03 owner timer·24시간 fake clock·응답/종료 경합, 실제 native/ingress·commit fence·readiness 분리 |
| [test-product-registration.mjs](../../scripts/test-product-registration.mjs) | 등록·registry·metadata·owner·Pet transport Swift suite와 기존 product ingress/native session Node 회귀. `test:product-lifecycle`은 shared-engine와 새 v2 helper 테스트까지 실행 |
| [ProductLifecycleTests.swift](../../shared-engine/Tests/ClaudeCoreAdapterTests/ProductLifecycleTests.swift), [session-v2-lifecycle.test.mjs](../../tests/session-v2-lifecycle.test.mjs), [session-v2-channel-poller.test.mjs](../../tests/session-v2-channel-poller.test.mjs) | CP-04 compact/StopFailure·background·장기 반복·과거 ID 재생·rate window·Channel cursor. 실제 설치 모델 검증과 구분 |
| [product-ingress.test.mjs](../../tests/shared-engine/product-ingress.test.mjs) | 기존 명시적 사전 등록 ingress의 인증·scope·Codex 회귀. 제품 동적 등록 증거와 구분 |
| [native-session.test.mjs](../../tests/shared-engine/native-session.test.mjs), [shared-launcher.test.mjs](../../tests/shared-engine/shared-launcher.test.mjs) | 실제 UDS/Hook/MCP child, 복수 세션, private grant·owner EOF, 실제 서비스 유지 |
| [product-bridge.test.mjs](../../tests/product-bridge.test.mjs) | long-run Channel/재생/무응답, 일반 사용자 입력과 정확한 probe 구분 |
| [ClaudePetTransportTests.swift](../../../src/coordinator-swift/Tests/BlabeePetTests/ClaudePetTransportTests.swift), [ClaudePetPresentationTests.swift](../../../src/coordinator-swift/Tests/BlabeePetTests/ClaudePetPresentationTests.swift) | provider/session 전환, stale generation, 재확인 UI·원본 결과 표시 |
| [PetAppServiceTests.swift](../../../src/coordinator-swift/Tests/BlabeePetTests/PetAppServiceTests.swift), [AppOwnedServiceProcessTests.swift](../../../src/coordinator-swift/Tests/BlabeePetTests/AppOwnedServiceProcessTests.swift), [StorageRecoveryAuthorityTests.swift](../../../src/coordinator-swift/Tests/BlabeePetTests/StorageRecoveryAuthorityTests.swift) | 서비스 재시작·writer lock·Codex 영향 격리 |
| [AppRuntimeUseLeaseTests.swift](../../../src/coordinator-swift/Tests/BlabeePetTests/AppRuntimeUseLeaseTests.swift), [AppInstallationTests.swift](../../../src/coordinator-swift/Tests/BlabeePetTests/AppInstallationTests.swift) | wrapper kill 뒤 살아 있는 Node payload·설치/업데이트 보류 |

후속 테스트 파일 제안: `BlabeePetTests/ClaudeInstalledLauncherTests.swift`, `claude/tests/shared-engine/installed-session.test.mjs`. 테스트 대상은 [수용 기준](IMPLEMENTATION_PLAN.md)의 정책과 실제 경합이며 구현 줄을 그대로 복사한 검사는 피한다.
