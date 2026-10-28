# 제품 연결 파일 지도

2026-09-20 현재 working tree 기준이다. CP-02 private 등록·registry·metadata에 이어 CP-03의 같은 authority 주입·owner 갱신·commit fence, CP-04 수명 관측·재생 기록·시간 처리, CP-05 native launcher와 v2 Hook/MCP client, CP-06 공통 Pet의 앱 전용 selector와 세션 UI를 추가했다. 경로가 링크인 것은 현재 파일이고, 코드로만 적은 신규 제안 경로는 후속 구현 대상이다. 이전 `Sources/` 표기는 모듈 이름이며 실제 경로는 각 링크를 따른다.

## 기존 연결 지점과 수정 책임

| 기존 파일/심볼 | 현재 역할 | 계획한 최소 변경 / 담당 작업 |
| --- | --- | --- |
| [main.swift](../../../../app/entrypoints/main.swift) / `ClaudeProductServiceCoordinator` 조립 | 앱 소유 서비스에 private endpoint·registry 추가. 일반 daemon은 등록 미지원 | CP-02 적용. v2 작업 인증/dispatch는 CP-03 |
| [ClaudeBridgeCoordinator.swift](../../../../bridges/claude/swift/service/ClaudeBridgeCoordinator.swift) / `handle` | 명시적으로 설정한 개발 `claude_bridge_v1` 경로 유지 | 제품 등록의 scope를 static ingress에 넣지 않음. 기존 파일 변경 없음 / CP-02 |
| [ClaudeNativeHost.swift](../../../../bridges/claude/swift/service/ClaudeNativeHost.swift) | FD grant를 받아 한 host 생성; 설치 runtime 경로 거절 | 격리 host는 개발 회귀용으로 보존. 제품 native 조립은 CP-03 |
| [ClaudeNativeSession.swift](../../../../bridges/claude/swift/adapter/ClaudeNativeSession.swift) | native 관측·경계·readiness·role auth | registry authority 주입, 제품 v2·lifecycle source·compact·quota 처리. 개발 v1 혼동 금지 / CP-01,03,04 |
| [ClaudeBridgeIngress.swift](../../../../bridges/claude/swift/adapter/ClaudeBridgeIngress.swift) | scope/role/고정 expiry 재검사 | NativeSession과 같은 authority record를 판정. 한쪽만 갱신하지 않음 / CP-03 |
| [ClaudeCoreAdapter.swift](../../../../bridges/claude/swift/adapter/ClaudeCoreAdapter.swift) | 공통 routing/journal, 메모리 offer/claim + 결과 재생 | provider metadata/binding 검증. snapshot의 due 쓰기와 순수 이력 replay 분리 / CP-02,04 |
| [UnixDomainSocketTransport.swift](../../../../app/service/UnixDomainSocketTransport.swift) | framing·UID·runtime identity·known-secret 검사, writer lease | CP-03의 `claude_session_v2` type·입력 capability 검사 추가. 자격 발급은 별도 private endpoint만 허용 |
| [PetAppService.swift](../../../../app/service/PetAppService.swift), [AppOwnedServiceProcess.swift](../../../../app/service/AppOwnedServiceProcess.swift) | 설치 앱이 자기 서명 서비스 소유 | provider 시작/종료 상태 연결. 한 Claude 종료로 서비스 종료 금지 / CP-02,06 |
| [shared-launcher.mjs](../../../../bridges/claude/launchers/shared-launcher.mjs) / `startSharedRuntime` | private host·1시간 grant 발급·자식 종료 | 개발 회귀 경로로 보존. 제품은 native owner가 등록·갱신 담당 / CP-05 |
| [product-context.mjs](../../../../bridges/claude/src/product-context.mjs), [native-session-client.mjs](../../../../bridges/claude/src/native-session-client.mjs) | scoped v1 요청/응답 검사 | 협상한 제품 v2, service incarnation/fencing 검사; 실패 시 Codex fallback 금지 / CP-05 |
| [product-hook.mjs](../../../../bridges/claude/src/product-hook.mjs), [product-mcp.mjs](../../../../bridges/claude/src/product-mcp.mjs), [product-tools.mjs](../../../../bridges/claude/src/product-tools.mjs) | Hook 파싱·SDK Channels·도구·poll FIFO | 기존 v1은 보존. CP-04의 새 v2 helper를 실제 client에 연결 / CP-05 |
| [ClaudePetTransport.swift](../../../../bridges/claude/swift/presentation/ClaudePetTransport.swift), [ClaudePetApplication.swift](../../../../bridges/claude/swift/presentation/ClaudePetApplication.swift) | 격리 host 안의 closure selector, 공통 UI | DTO/표시 변환 재사용. standalone test window를 설치 앱으로 오인하지 않음 / CP-06 |
| [PetApplication.swift](../../../../app/ui/PetApplication.swift), [PetTransport.swift](../../../../app/service/PetTransport.swift), [PetModels.swift](../../../../app/ui/PetModels.swift), [PetViewModel.swift](../../../../app/coordination/PetViewModel.swift), [PetView.swift](../../../../app/ui/PetView.swift) | 설치 Pet의 기존 UDS/선택/화면 | 새 provider envelope·세션 집계·시작/재확인/해제 UI. legacy Codex-only v1 유지 / CP-06 |
| [AppRuntimeUseLease.swift](../../../../app/service/AppRuntimeUseLease.swift), [PetAppUpdates.swift](../../../../app/update/PetAppUpdates.swift), [AppInstallation.swift](../../../../app/update/AppInstallation.swift) | 앱 파일 사용·교체 보호 | 불변 bridge payload·활성 Claude 업데이트 보류/종료 안내를 기존 guard에 결합 / CP-07 |
| [build-macos-app.mjs](../../../../scripts/build-macos-app.mjs), [prepare-local-dogfood.mjs](../../../../scripts/prepare-local-dogfood.mjs), [Package.swift](../../../../Package.swift) | 앱 조립·manifest·native entrypoint·target | bridge/지원 runtime/계약/버전/digest 포함. 기존 `blabee-codex` 의미 보존 / CP-05,07 |

`CoordinatorAuthorityLease`는 DB writer process lock이다. 세션 credential의 TTL이나 readiness를 갱신하는 API가 아니다.

## 추가한 파일과 신규 제안

| 경로 | 책임 |
| --- | --- |
| [Contracts/bridge/](../../../../Contracts/bridge)의 `claude-owner.v1.json`, `claude-session.v2.json`, `pet-provider.v1.json`, `pet-directory.v1.json`, `common.v1.json` | CP-01B 제품 envelope·공통 값 schema. `Contracts/v1/` 밖에 배치. [계약과 신뢰 경계](PRODUCT_WIRE.md) |
| [Sources/ClaudeCoreAdapter/ClaudeProductWireCodec.swift](../../../../bridges/claude/swift/adapter/ClaudeProductWireCodec.swift) | CP-01B 구조·응답 correlation·secret 검사. 실제 인증/dispatch가 없는 독립 codec |
| [Sources/BlabeeCoordinator/ClaudeSessionEnrollment.swift](../../../../bridges/claude/swift/session/ClaudeSessionEnrollment.swift) | CP-02 private owner endpoint, peer 서명/빌드/수명 검증·challenge·SCM_RIGHTS·grant pipe. EOF는 해당 등록만 회수 |
| [Sources/BlabeeCoordinator/ClaudeSessionRegistry.swift](../../../../bridges/claude/swift/session/ClaudeSessionRegistry.swift) | CP-02 scope/역할 자격 생성, 별도 core·metadata, 회수·읽기 전용 이력, scope별 오류 격리 |
| [Sources/BlabeeCoordinator/ClaudeProductServiceCoordinator.swift](../../../../bridges/claude/swift/service/ClaudeProductServiceCoordinator.swift) | CP-02 공통 서비스 wrapper와 CP-03 v2 dispatch. Codex 전달 보존, 일반 UDS의 owner 요청 거부 |
| [Sources/ClaudeCoreAdapter/ClaudeSessionAuthority.swift](../../../../bridges/claude/swift/adapter/ClaudeSessionAuthority.swift) | CP-01A 단일 lease·renewal/revoke·mutation fence. CP-02 registry가 scope별로 소유. 실제 native/inner ingress·owner 갱신 연결은 CP-03 |
| [Sources/BlabeeCoordinator/ClaudeSessionMetadataStore.swift](../../../../bridges/claude/swift/session/ClaudeSessionMetadataStore.swift) | CP-02 별도 SQLite, 매핑/HMAC/독립 freshness/prepare-finalize/이력 검증. CP-04 metadata v2 replay tombstone·streaming 검증·파생 lookup, v1 history-only |
| [Sources/BlabeeCoordinator/ClaudeOwnerRenewalController.swift](../../../../bridges/claude/swift/service/ClaudeOwnerRenewalController.swift) | CP-03 인증된 private exchange를 주입받는 owner timer·renew/end·응답 검증. Terminal/자식 시작은 CP-05 |
| [Sources/ClaudeCoreAdapter/ClaudeProductAuthorityJournal.swift](../../../../bridges/claude/swift/adapter/ClaudeProductAuthorityJournal.swift) | CP-03 journal 입구의 같은 authority 검사. 실제 COMMIT fence는 root가 `SQLiteJournal.appendCommitGate`에 주입 |
| [Sources/ClaudeCoreAdapter/ClaudeNativeReplayPort.swift](../../../../bridges/claude/swift/adapter/ClaudeNativeReplayPort.swift) | CP-04 scope별 prompt/proposal/selection/Hook 재생 기록 포트 |
| [session-v2-lifecycle.mjs](../../../../bridges/claude/src/session-v2-lifecycle.mjs), [session-v2-channel-poller.mjs](../../../../bridges/claude/src/session-v2-channel-poller.mjs) | CP-04 순수 Hook 정규화와 일정한 메모리의 Channel cursor/poller. 실제 MCP 연결은 CP-05 |
| [ClaudeInstalledLauncher.swift](../../../../bridges/claude/swift/service/ClaudeInstalledLauncher.swift) | CP-05 private owner client·grant 검증·갱신·대화형 자식 소유·종료 관측 |
| [ClaudeInstalledLaunchConfiguration.swift](../../../../bridges/claude/swift/service/ClaudeInstalledLaunchConfiguration.swift), [ClaudeInstalledLauncherCLI.swift](../../../../bridges/claude/swift/service/ClaudeInstalledLauncherCLI.swift) | CP-05 환경·Hook/MCP 설정·충돌 진단·Terminal argv·엄격한 native CLI 진입점 |
| [session-v2-context.mjs](../../../../bridges/claude/src/session-v2-context.mjs), [session-v2-client.mjs](../../../../bridges/claude/src/session-v2-client.mjs) | CP-05 역할별 환경·인증된 v2 UDS·응답 authority/correlation 검증 |
| [session-v2-hook.mjs](../../../../bridges/claude/src/session-v2-hook.mjs), [session-v2-tools.mjs](../../../../bridges/claude/src/session-v2-tools.mjs), [session-v2-mcp.mjs](../../../../bridges/claude/src/session-v2-mcp.mjs) | CP-05 실제 lifecycle 입력·다섯 `_v1` 모델 도구·초기 연결·bounded Channel 전달과 종료 |
| `bridges/claude/swift/service/ClaudeRuntimePayload.swift` | digest별 불변 payload 검증·원자적 준비·활성/비정상 종료 보호 |
| `app/service/PetProviderTransport.swift` | Codex/Claude DTO를 새 UI envelope로 집계, selector를 provider/scope에만 전달 |
| `bridges/claude/plugin/.claude-plugin/plugin.json`, `hooks/hooks.json`, `.mcp.json` | 승인 경로가 준비된 Claude plugin manifest/entrypoint. 기존 workflow 참고 폴더를 배포 완료로 취급하지 않음 |

코드 표기로 남긴 payload·provider UI·plugin은 후속 구현 대상이다. CP-02는 별도 wrapper로 공통 서비스를 조립해 기존 Codex dispatcher의 분해를 피했다. `StorageKey.swift`의 `SidecarAuthenticator`와 `StorageProcessLock.swift`는 기존 구현을 재사용하도록 필요한 선언만 `package` 접근으로 바꿨으며 동작은 그대로다. 이전 폴더 정리는 완료했으며 현재 제품/개발 경로는 저장소 루트 AGENTS.md를 따른다.

## 보존 대상

- [CoordinatorBinding.swift](../../../../engine/routing/CoordinatorBinding.swift), [ContractPin.swift](../../../../engine/validation/ContractPin.swift), [SQLiteJournal.swift](../../../../engine/persistence/SQLiteJournal.swift): 기존 9필드 binding, v1 12개 파일 hash, exact schema object 검사를 유지한다. provider 테이블은 core DB에 넣지 않는다.
- CP-03의 `SQLiteJournal.appendCommitGate`는 기본 `nil`인 opt-in seam이다. 실제 첫 append COMMIT만 감싸며 기존 Codex/v1 경로는 그대로다. schema·계약 변경이 아니다.
- [ProductServiceConfiguration.swift](../../../../app/service/product-support/ProductServiceConfiguration.swift): 기존 Codex DB/key/Keychain `primary` 및 authority 경로 유지.
- [OperationalCLI.swift](../../../../bridges/codex/swift/hooks/OperationalCLI.swift), [CoordinatorOperationalApplication.swift](../../../../app/coordination/CoordinatorOperationalApplication.swift), [CodexQueueNextTurnDispatcher.swift](../../../../bridges/codex/swift/delivery/CodexQueueNextTurnDispatcher.swift), [Codex Plugin](../../../../bridges/codex/plugin): native/effective ID, Hook·MCP, durable claim, native approval 의미 보존. 제품 연결을 위해 먼저 대규모 Codex 분해를 요구하지 않는다.

## 테스트 연결

| 테스트 자산 | 검증 범위 / 후속 |
| --- | --- |
| [SessionAuthorityTests.swift](../../../../Tests/bridges/claude/shared-engine/Tests/ClaudeCoreAdapterTests/SessionAuthorityTests.swift) | CP-01A 신규: 24시간 갱신, 만료 경계, sequence 중복, identity·객체 격리, 시계 오류, 회수·commit 경합. 실제 owner/IPC 연결은 후속 |
| [ProductWireCodecTests.swift](../../../../Tests/bridges/claude/shared-engine/Tests/ClaudeCoreAdapterTests/ProductWireCodecTests.swift), [product-wire-schema.test.mjs](../../../../Tests/bridges/claude/integration/product-wire-schema.test.mjs) | CP-01B 신규: [공유 fixture](../../../../Tests/bridges/claude/fixtures/product-wire/cases.json), role·버전·숫자·raw JSON·correlation·secret 검사. 실제 peer/auth/liveness·inner DTO·UI projection은 후속 |
| [NativeSessionTests.swift](../../../../Tests/bridges/claude/shared-engine/Tests/ClaudeCoreAdapterTests/NativeSessionTests.swift) | lease·readiness·card 독립 시계, role/generation, compact·권한 회수 |
| [ClaudeSessionEnrollmentTests.swift](../../../../Tests/swift/BlabeePetTests/ClaudeSessionEnrollmentTests.swift), [ClaudeSessionRegistryTests.swift](../../../../Tests/swift/BlabeePetTests/ClaudeSessionRegistryTests.swift), [ClaudeSessionMetadataStoreTests.swift](../../../../Tests/swift/BlabeePetTests/ClaudeSessionMetadataStoreTests.swift) | CP-02 실제 private socket/FD·오류 정리, 여러 scope·Codex 격리, 중간 실패·변조·rollback·이력 조회 경합 |
| [ClaudeOwnerRenewalControllerTests.swift](../../../../Tests/swift/BlabeePetTests/ClaudeOwnerRenewalControllerTests.swift), [ProductAuthorityIntegrationTests.swift](../../../../Tests/bridges/claude/shared-engine/Tests/ClaudeCoreAdapterTests/ProductAuthorityIntegrationTests.swift) | CP-03 owner timer·24시간 fake clock·응답/종료 경합, 실제 native/ingress·commit fence·readiness 분리 |
| [test-product-registration.mjs](../../../../Tests/bridges/claude/scripts/test-product-registration.mjs) | 등록·registry·metadata·owner·Pet transport Swift suite와 기존 product ingress/native session Node 회귀. `test:product-lifecycle`은 shared-engine와 새 v2 helper 테스트까지 실행 |
| [ProductLifecycleTests.swift](../../../../Tests/bridges/claude/shared-engine/Tests/ClaudeCoreAdapterTests/ProductLifecycleTests.swift), [session-v2-lifecycle.test.mjs](../../../../Tests/bridges/claude/session-v2-lifecycle.test.mjs), [session-v2-channel-poller.test.mjs](../../../../Tests/bridges/claude/session-v2-channel-poller.test.mjs) | CP-04 compact/StopFailure·background·장기 반복·과거 ID 재생·rate window·Channel cursor. 실제 설치 모델 검증과 구분 |
| [product-ingress.test.mjs](../../../../Tests/bridges/claude/integration/product-ingress.test.mjs) | 기존 명시적 사전 등록 ingress의 인증·scope·Codex 회귀. 제품 동적 등록 증거와 구분 |
| [native-session.test.mjs](../../../../Tests/bridges/claude/integration/native-session.test.mjs), [shared-launcher.test.mjs](../../../../Tests/bridges/claude/integration/shared-launcher.test.mjs) | 실제 UDS/Hook/MCP child, 복수 세션, private grant·owner EOF, 실제 서비스 유지 |
| [product-bridge.test.mjs](../../../../Tests/bridges/claude/product-bridge.test.mjs) | long-run Channel/재생/무응답, 일반 사용자 입력과 정확한 probe 구분 |
| [ClaudePetTransportTests.swift](../../../../Tests/swift/BlabeePetTests/ClaudePetTransportTests.swift), [ClaudePetPresentationTests.swift](../../../../Tests/swift/BlabeePetTests/ClaudePetPresentationTests.swift) | provider/session 전환, stale generation, 재확인 UI·원본 결과 표시 |
| [PetAppServiceTests.swift](../../../../Tests/swift/BlabeePetTests/PetAppServiceTests.swift), [AppOwnedServiceProcessTests.swift](../../../../Tests/swift/BlabeePetTests/AppOwnedServiceProcessTests.swift), [StorageRecoveryAuthorityTests.swift](../../../../Tests/swift/BlabeePetTests/StorageRecoveryAuthorityTests.swift) | 서비스 재시작·writer lock·Codex 영향 격리 |
| [AppRuntimeUseLeaseTests.swift](../../../../Tests/swift/BlabeePetTests/AppRuntimeUseLeaseTests.swift), [AppInstallationTests.swift](../../../../Tests/swift/BlabeePetTests/AppInstallationTests.swift) | wrapper kill 뒤 살아 있는 Node payload·설치/업데이트 보류 |

CP-05 검증은 [test-installed-session.mjs](../../../../Tests/bridges/claude/scripts/test-installed-session.mjs)로 분리 실행한다.

- [ClaudeInstalledLauncherTests.swift](../../../../Tests/swift/BlabeePetTests/ClaudeInstalledLauncherTests.swift): 실제 등록·grant·FD·owner EOF, 환경·설정·경로·Terminal 인자와 충돌 진단.
- [ClaudeInstalledSessionIntegrationTests.swift](../../../../Tests/swift/BlabeePetTests/ClaudeInstalledSessionIntegrationTests.swift): 실제 private/common UDS와 command Hook·stdio MCP, PTY 자식·Ctrl-C·종료·터미널 복구.
- [session-v2-client.test.mjs](../../../../Tests/bridges/claude/session-v2-client.test.mjs), [session-v2-bridge.test.mjs](../../../../Tests/bridges/claude/session-v2-bridge.test.mjs): 역할·correlation·strict framing·초기화·Channel backpressure와 실제 자식 종료.
- [ProductChannelSourceTests.swift](../../../../Tests/bridges/claude/shared-engine/Tests/ClaudeCoreAdapterTests/ProductChannelSourceTests.swift): 제품의 정확한 wrapper/source·본문 바인딩과 기존 v1 호환 경계.

테스트 대상은 [수용 기준](IMPLEMENTATION_PLAN.md)의 정책과 실제 경합이며 모델·설치 수용을 대신하지 않는다.

## CP-06 공통 Pet 연결

- [PetProviderModels.swift](../../../../app/service/PetProviderModels.swift): 불변 public target와 별도 directory codec. [pet-directory.v1.json](../../../../Contracts/bridge/pet-directory.v1.json)은 목록/해제만 정의한다.
- [PetProviderService.swift](../../../../app/service/PetProviderService.swift): 앱 전용 capability 인증, registry 및 기존 Codex dispatcher 연결.
- [PetProviderTransport.swift](../../../../app/service/PetProviderTransport.swift): 세션 목록, 선택한 provider만 조회, service/selection/snapshot 세대 검사, 결과 receipt 검증과 명시적 Codex fallback.
- [AppOwnedServiceProcess.swift](../../../../app/service/AppOwnedServiceProcess.swift): 기존 lifetime pipe의 bounded bootstrap으로 앱 capability 전달. argv/env/ready frame에는 넣지 않는다.
- [PetClaudeLauncher.swift](../../../../app/service/PetClaudeLauncher.swift): 프로젝트 chooser와 CP-05 Terminal 실행기 연결. 설치 bundle 후보만 사용하며 CP-07 패키징 완료를 뜻하지 않는다.
- [ClaudePetSnapshotProjector.swift](../../../../bridges/claude/swift/presentation/ClaudePetSnapshotProjector.swift): 공통 DTO 검증·표시 변환. 기존 독립 Claude transport도 같은 projector를 사용한다.
- [test-product-pet.mjs](../../../../Tests/bridges/claude/scripts/test-product-pet.mjs): Swift 직렬 잠금, 격리 root, source/Pet/native/Node/일반 빌드 단계.

실제 구현·신뢰 경계·아직 남은 설치/모델 검증은 [PRODUCT_PET](PRODUCT_PET.md), 최종 검증 결과는 [TASK_STATUS](TASK_STATUS.md)에 기록한다.


## CP-07 런타임·설치 연결

CP-08은 [공통 앱 assembler](../../../../scripts/build-macos-app.mjs)의 내부 Claude 서명 옵션으로
제품 owner의 인증서 조건을 갖춘 통합 후보를 조립한다. 일반 release와 별도 자격이며
실제 설치·모델 수용은 [ACCEPTANCE](ACCEPTANCE.md)에 기록한다.

| 파일 | 책임 |
| --- | --- |
| [ClaudeRuntimePayload.swift](../../../../bridges/claude/swift/service/ClaudeRuntimePayload.swift) | descriptor·architecture·파일/권한/해시 검증, digest별 불변 사본 |
| [ClaudeRuntimePayloadUse.swift](../../../../bridges/claude/swift/service/ClaudeRuntimePayloadUse.swift) | private admission·durable 사용 기록·정상 종료·설치 guard |
| [ClaudeInstalledLauncher.swift](../../../../bridges/claude/swift/service/ClaudeInstalledLauncher.swift), [PetClaudeLauncher.swift](../../../../app/service/PetClaudeLauncher.swift) | 서명 assembly에 고정된 descriptor·사용 시작/종료·immutable Hook/MCP 경로 |
| [prepare-claude-runtime.mjs](../../../../scripts/prepare-claude-runtime.mjs), [sign-claude-runtime.mjs](../../../../scripts/sign-claude-runtime.mjs) | pinned dependency subset·Node/LICENSE·재봉인·preview 서명 |
| [AppInstallation.swift](../../../../app/update/AppInstallation.swift), [AppUpdateTransaction.swift](../../../../app/update/AppUpdateTransaction.swift) | legacy/v1 공통 Claude guard·Codex pause 전 재확인·publish/rollback 잠금 |
| [test-runtime-payload.mjs](../../../../Tests/bridges/claude/scripts/test-runtime-payload.mjs) | CP-07 격리 Swift/Node/실제 IPC·PTY/일반 빌드 |

상세 정책·명령·일반 Channels 배포 경계는 [RUNTIME_PAYLOAD](RUNTIME_PAYLOAD.md)를 따른다.

## 통합 Blabee 앱과 DMG

- [BlabeeProductProfile.swift](../../../../app/service/product-support/BlabeeProductProfile.swift): 기존 앱·서비스·데이터 identity 하나와 compiled descriptor.
- [distribution-profiles.mjs](../../../../scripts/distribution-profiles.mjs): 고정 Blabee identity와 native descriptor 검사.
- [build-fresh-internal-dmg.mjs](../../../../scripts/build-fresh-internal-dmg.mjs): 공통 소스 빌드·Claude runtime 고정·내부 DMG 진입점.
- [notarize-dmg.mjs](../../../../scripts/notarize-dmg.mjs): 읽기 전용 DMG 내용 검사 후 일반 배포 자격이 있는 후보만 공증 단계로 전달.
- [UnifiedProductProfileTests.swift](../../../../Tests/swift/BlabeePetTests/UnifiedProductProfileTests.swift): 단일 제품 identity·descriptor와 구식 Preview marker 거부.
- `PetApplication`과 `PetProviderTransport`는 공통 Pet·여러 provider 세션을 조립한다. `PetViewModel`은 Claude 시작에 필요한 앱 서비스 상태와 설정 안내를 제공한다.

세부 버전·설치·배포 조건은 [UNIFIED_DISTRIBUTION](UNIFIED_DISTRIBUTION.md)을 따른다.
