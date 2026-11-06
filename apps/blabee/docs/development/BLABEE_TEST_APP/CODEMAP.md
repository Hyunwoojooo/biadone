# Blabee Test 앱 코드 지도

- 조사 기준: 2026-10-19 작업 중인 체크아웃.
- 상태: M2 T-007 구현·자동 회귀·실제 child 수용 완료. M1 최종 수용과 M2 수동 UI·공존 수용은 대기이며 M3·실제 OAuth는 미구현이다.
- 기존 설치 앱·사용자 세션·운영 DB·Keychain 내용을 읽거나 변경하지 않았다.
- M1은 UI 대역, M2는 격리된 실제 Engine, M3는 실제 Codex·Claude 연결 검사다.
- 파일 이름과 줄 번호보다 아래 심볼 및 현재 소스의 실행 경로를 기준으로 구현한다.

## 빌드와 책임 경계

[Package.swift](../../../Package.swift)는 target별 명시 sources 배열을 사용한다.
기존 `CoordinatorSwift`, `BlabeeProductSupport`, `BlabeeCoordinator` 모듈을 유지한다.
같은 Swift 소스를 두 target에 넣거나 모듈 분리와 테스트 프로필 도입을 섞지 않는다.
현재 M1·M2는 기존 target을 독립 scratch 경로와 `BLABEE_TEST_APP` 컴파일 프로필로 빌드한다.
운영 산출물에는 환경변수나 실행 인자로 테스트 권한을 켜는 경로를 만들지 않는다.
`dev/test-app/swift`의 6개 파일을 기존 `BlabeeCoordinator` target에만 등록하며 조건부 컴파일한다.
M2는 Test 전용 child·authority 조립을 추가했으며 실제 provider 프로필 연결은 아직 구현하지 않았다.

## 현재 M1·M2 실행 경로

[main.swift](../../../app/entrypoints/main.swift)는 `distribution-profile` 처리 직후 Test 분기로 들어간다.
제품 runtime admission·runtime-use lease·설치·provider 명령·기존 Pet singleton에 도달하지 않는다.
GUI의 `BlabeeTestLaunchPolicy`는 `M2`·`isolated-development`·simulation false·Engine true metadata와 인자 없는 실행을 허용한다.
`main.swift`는 `test-engine-service`·`test-engine-check`도 Test 전용 진입점으로 분기한다.

| 구현 파일 | 현재 책임 |
| --- | --- |
| [BlabeeTestApplication.swift](../../../dev/test-app/swift/BlabeeTestApplication.swift) | launch 검증, 별도 창·메뉴바, workspace, 새 run·이어보기·재생·결과 저장, M2 제어와 `runBlabeeTestEngineCheck` |
| [BlabeeTestComposition.swift](../../../dev/test-app/swift/BlabeeTestComposition.swift) | 공통 UI·ViewModel, 모의 계정·provider·설정, 명시적 M2 run의 Engine session·drain |
| [BlabeeTestRunStore.swift](../../../dev/test-app/swift/BlabeeTestRunStore.swift) | store/run marker·manifest·lease·snapshot·report·inventory, M2 경로와 resource registry 검증 |
| [BlabeeTestScenarios.swift](../../../dev/test-app/swift/BlabeeTestScenarios.swift) | 9개 M1 UI preset과 `engineIsolation`, `usesRealEngine` |
| [BlabeeTestEngineCore.swift](../../../dev/test-app/swift/BlabeeTestEngineCore.swift) | 공통 실제 journal·routing·operational actor 조립, scope 검사, 명시적 seed·claim·report, 내부 fixture queue |
| [BlabeeTestEngineService.swift](../../../dev/test-app/swift/BlabeeTestEngineService.swift) | bundle·직접 부모·freshness guard, owned `Process`, UDS·runtime binding, session 요청·재시작·drain |

기본 root는 사용자 Application Support의 `Blabee Test`, run은 `runs/<runUUID>`다.
`inventory()`는 유효하지 않은 개별 기록을 보존하고 이슈로 표시하며 자동 복원·삭제하지 않는다.
`BlabeeTestWorkspaceController.transition`은 이전 객체를 무효화하고 정리 후 새 쌍을 한 번에 publish한다.
이어보기는 snapshot의 모의 설정을 복원하되 계정·응답 객체를 다시 조립하며 과거 실제 작업을 보내지 않는다.
M1은 모의 transport polling을 사용하며 실제 Engine·Keychain·native CLI를 생성하지 않는다.
M2는 `BlabeeTestSimulationEnvironment.request`에서 `product_access_v1`만 계속 모의하고 나머지 Engine 요청을
소유 session으로 전달한다. 계정·OAuth·Plugin·Hook·shell 설정과 provider 실행은 두 모드 모두 모의다.

### M2 조립·저장·수명 심볼

1. `BlabeeTestRunStore.prepareEngineStorage(for:)`는 `settings/engine-resources-v1.json`과
   `settings/engine-v1/.blabee-test-engine-v1.json`에 경로·store/run·freshness scope를 기록한다.
   M1 `manifest-v1.json` schema는 유지한다. `loadEngineStorage(for:)`는 기존 등록 자원만 다시 열고
   `validateEngineStorage(for:paths:)`는 위치를 재계산해 호출자가 넣은 경로를 검증한다.
2. `BlabeeTestEnginePaths`의 DB는 `settings/engine-v1/storage/coordinator.sqlite`다.
   같은 storage에 `storage.key`, `continuation.key`, `selector.key`를 두고 `authority/`와 `project/`는 Engine root에 둔다.
   `BlabeeTestEngineKeyMaterial.loadOrCreate`는 기존 `ExternalStorageKeyStore`로 생성·검증하고 소유한 32-byte 0600 파일만 읽는다.
3. socket은 `/private/tmp/blabee-test-<uid>/<소문자 runUUID>/svc.sock`이다.
   `.blabee-test-sockets-v1.json`과 `.blabee-test-socket-run-v1.json`으로 짧은 root의 소유권도 검증한다.
4. `BlabeeTestEngineSession.start()`는 현재 bundle의 `test-engine-service` child를 직접 시작한다.
   `runBlabeeTestEngineService`는 strict 인자·직접 부모를 확인하고 run 자원, 별도 authority lease,
   UDS server, freshness factory, 공통 Engine core 순으로 조립한다.
5. `BlabeeTestEngineRuntimeBinding.identity`는 store/run/launch·selector key를 hash한다.
   `BlabeeTestEngineRequest.authenticatedPayload()`와 core의 `scopedObject`가 profile/store/run/launch·selector를 양쪽에서 묶는다.
   session은 재시작 후 이전 launch 응답도 거절한다.
6. core의 `doctorStatus(payload:)`는 기존 route에서 `blabee_test_engine.operation`의 `report`·`seed`·`claim`을 처리한다.
   seed는 빈 journal에서만 허용한다. 선택 후 `BlabeeTestEngineFixtureQueue`에만 쌓고 claim은 같은 delivery turn을 재사용한다.
   queue 접수·durable claim과 provider 작업 완료는 별개다. 재시작은 queue 0으로 시작하고 자동 seed·claim·재전송을 하지 않는다.
7. `BlabeeTestOwnedEngineChild.stop()`은 직접 생성한 `Process`만 terminate하고 종료를 기다린다.
   `BlabeeTestEngineSession.drain()` 실패 시 child 참조를 유지하며 workspace는 이전 lease와 run 근거를 보존한다.
   raw child 출력 대신 bounded ready/error frame의 고정 코드만 `logs/engine-service-<launchUUID>.log`에 남긴다.
8. `runBlabeeTestEngineCheck`는 Test bundle에서만 `test-engine-check --store-root
   /private/tmp/blabee-test-m2-check-<소문자 UUID>`를 받는다. 정확한 새 root 아래 `test-store`에 새 run을 만들고
   실제 freshness Keychain·owned child·UDS·동일 턴 claim 재시도·재시작 queue 0·drain을 확인하도록 구현했다.
   실제 CLI 수용은 PASS(exit 0)했다. queue 1·claim 1·같은 턴 추가 이벤트 0·재시작 queue 0/claim 1·
   integrity ok·child 종료·provider 실행 0을 확인했다. 기존 root 재사용도 exit 1로 거절했고 검증 파일·Keychain 항목은 보존했다.
   `drainBlabeeTestEngineCheck`는 오류 정리 중 child가 종료되지 않으면 `cleanup_pending`을 보고하고 lease를 유지한다.
   spawn 실패 이후 재시도도 새 launch/log 경로를 사용한다.

## 1. 제품 identity와 패키징

[BlabeeProductProfile.swift](../../../app/service/product-support/BlabeeProductProfile.swift)의
`BlabeeProductProfile.current`는 제품에서 `.blabee`, Test 컴파일에서 `.blabeeTest`로 고정된다.
bundle ID, 앱 이름, 설치 위치, 지원 폴더, freshness account, service label을 여기서 정한다.
[distribution-profiles.mjs](../../../scripts/distribution-profiles.mjs)의 제품 조립 검사는 Test profile을 받지 않는다.
[build-macos-app.mjs](../../../scripts/build-macos-app.mjs)는 Info.plist와 LaunchAgent 값을 검증한다.
분리 요구: 컴파일된 테스트 identity와 패키징 identity가 서로 일치해야 한다.
앱 이름만 바꾸거나 패키징 스크립트 변수 하나만 변경해서는 격리되지 않는다.
[build-test-app.mjs](../../../scripts/build-test-app.mjs)는 별도 profile probe와 bundle metadata를 사용한다.
`npm run build:test-app -- --build-id <ID>` → `build/test-app/<ID>/Blabee Test.app`이며 기존 출력은 덮어쓰지 않는다.
로컬 ad-hoc 서명까지만 수행하고 제품 설치·LaunchAgent·Plugin·공급자 runtime 조립은 하지 않는다.
현재 builder는 M2 `isolated-development`, `BlabeeTestSimulationOnly=false`, `BlabeeTestEngineEnabled=true`를 기록한다.
bundle manifest는 `run_scoped_freshness_only` Keychain 정책을 표시한다.
[M2 Blabee Test.app](../../../build/test-app/m2-20261019/Blabee%20Test.app)의 실제 조립·ad-hoc strict 서명·plist·profile과
제품 `service` 명령 거절(exit 1)을 확인했다. stateless product profile도 `blabee` / `com.biadone.blabee`다.
`nm`의 `BlabeeTest` 검색 결과는 Test 82행·제품 0행이며 설치 제품의 실사용 결과와 구분한다.

## 2. 서비스 데이터와 socket

[ProductServiceConfiguration.swift](../../../app/service/product-support/ProductServiceConfiguration.swift)의
`ProductServiceEnvironment.live()`는 FileManager의 user-domain Application Support를 사용한다.
`ProductServiceBootstrap.resolvePaths`는 bundle 구조를 검증하고 storage/runtime/config를 조립한다.
ambient `HOME`이 바뀌어도 이 경로 전체가 따라 바뀌지는 않는다.
분리 요구: DB, MAC key, socket, service config, 프로젝트 목록을 같은 검증된 run scope로 묶는다.
M1은 이 live factory를 호출하지 않고 transport·설정 저장소 대역만 사용해야 한다.
M2는 위 Test 전용 자원 조립으로 실제 journal을 생성하며 제품 bootstrap을 사용하지 않는다.
socket은 긴 Application Support 경로를 그대로 쓰지 않고 짧은 테스트 전용 root에 둔다.

## 3. 저장소 authority와 runtime identity

[UnixDomainSocketTransport.swift](../../../app/service/UnixDomainSocketTransport.swift)의
`CoordinatorAuthorityLease.defaultAuthorityRootURL`은 HOME을 의도적으로 무시한다.
기본 lease는 OS 사용자 홈의 authority root와 `freshness-primary.lock`도 사용한다.
`OperationalRuntimeIdentity`는 패키지 앱의 서명과 봉인된 assembly manifest에 묶인다.
분리 요구: run별 authority root·socket과 테스트 앱의 runtime identity를 함께 연결한다.
임시 DB만 지정하면 운영 freshness namespace와 충돌할 수 있다.
테스트 전용 root를 허용하는 기존 내부 seam을 운영 우회 경로로 넓히지 않는다.
현재 M2 child는 `CoordinatorAuthorityLease(databaseURL:authorityRootURL:includesPrimaryNamespace:)`에
등록된 run authority와 `false`를 전달한다. 운영 authority root와 primary namespace lock을 사용하지 않는다.

## 4. freshness와 초기화 단위

[KeychainFreshnessAnchorStore.swift](../../../engine/persistence/KeychainFreshnessAnchorStore.swift)는
정해진 service 이름만 허용하며 기본 account는 `primary`다.
`deleteForTesting()`은 명시적 허용과 `test-*` account 조건을 요구한다.
[main.swift](../../../app/entrypoints/main.swift)의 제품 서비스 구성은 freshness 환경을 비운다.
기존 테스트 환경변수는 GUI 제품 전체의 격리를 보장하는 스위치가 아니다.
M2 `BlabeeTestEngineFreshnessFactory.make`는 `KeychainFreshnessAnchorStore.defaultService`와
정확히 `"test-" + run.runID.uuidString.lowercased()`인 account를 전달하고 `allowsTestDeletion=false`를 사용한다.
core는 freshness `storageSlot`과 경로의 account도 이 값과 같은지 확인한다. `test-*` 접두어만으로 허용하지 않는다.
Test 프로필에서 `primary`는 거절하며 DB·key·freshness·lease의 수명을 함께 관리한다.
DB만 삭제하거나 이전 freshness anchor를 재사용하는 초기화는 금지한다.
M1은 실제 Keychain과 실제 freshness store에 접근하지 않는다.

## 5. 첫 실행과 사용자 설정

[PetFirstRun.swift](../../../app/ui/onboarding/PetFirstRun.swift)의 `PetFirstRunFileStore.live()`는
실제 사용자 홈의 `Blabee/onboarding/state-v1.json`을 사용한다.
[PetFirstRunPreferences.swift](../../../app/ui/onboarding/PetFirstRunPreferences.swift)는
UserDefaults와 `PetLoginItemManaging`을 주입할 수 있지만 기본값은 제품 live 객체다.
[PetConnectionSetup.swift](../../../app/coordination/PetConnectionSetup.swift)에는 memory selection store가 있다.
분리 요구: onboarding 파일과 언어·테마·단축키·선택 도구·서비스 설정을 run별 suite에 묶는다.
M1은 실제 login item을 등록하지 않으며 초기화가 제품 등록을 해제해서도 안 된다.
현재 M1은 `BlabeeTestComposition`의 저장소·login item 대역과 run 전용 defaults suite를 사용한다.
[PetLocalization.swift](../../../app/ui/PetLocalization.swift)의 `bindTestRunDefaults`도 Test 조건에서만 연결된다.

## 6. 계정과 OAuth

[PetAccountController.swift](../../../app/account/PetAccountController.swift)의 `live()`는
운영 Supabase service, Keychain session store, ASWebAuthenticationSession browser를 조립한다.
[PetAccountAuth.swift](../../../app/account/PetAccountAuth.swift)의 callback과
[PetAccountKeychain.swift](../../../app/account/PetAccountKeychain.swift)의 service도 제품 값에 묶여 있다.
분리 요구: M1·M2는 browser/service/session store 대역으로 로그인 화면만 검사한다.
실제 로그인 검사는 별도 callback·session slot·서버 redirect 허용 구성을 확인한 뒤 수행한다.
테스트 초기화가 실제 계정의 전역 세션을 로그아웃하거나 토큰을 폐기해서는 안 된다.

## 7. Codex Plugin 설치와 검사

[CodexPluginSetup.swift](../../../bridges/codex/swift/setup/CodexPluginSetup.swift)의
`CodexPluginSetupProcessRunner.sanitizedEnvironment`에는 CODEX_HOME이 없다.
live mutation lock은 실제 OS 사용자 홈의 `Blabee/runtime/codex-plugin-setup.lock`에 있다.
`bundledConfiguration()`은 표준 설치 앱의 marketplace 경로를 검증한다.
분리 요구: 설치·검사·실행이 같은 검증된 테스트 CODEX_HOME과 앱 resources를 사용해야 한다.
환경변수 하나를 추가 전달하는 것만으로 lock·bundle·Hook 경계가 함께 바뀌지는 않는다.

## 8. Codex Hook과 launcher

[PetHookReadiness.swift](../../../bridges/codex/swift/hooks/PetHookReadiness.swift)의 live 검사도
Plugin setup과 같은 sanitized 환경을 사용한다.
[blabee-launcher](../../../bridges/codex/plugin/scripts/blabee-launcher)의 기본 coordinator는 운영 앱 경로다.
분리 요구: 테스트 Plugin launcher는 테스트 coordinator와 socket에 바인딩해야 한다.
Hook 검사만 운영 CODEX_HOME을 보면 테스트 연결 완료를 잘못 판정할 수 있다.
MAC·단일 claim·만료·세션 바인딩 검증과 사용자 Hook 신뢰 승인은 유지한다.

## 9. Claude shell과 설정

[ClaudeAutoConnectSetup.swift](../../../bridges/claude/swift/service/ClaudeAutoConnectSetup.swift)는
실제 사용자 home의 `.zshrc`와 `Blabee/shell/claude-v1` shim을 관리한다.
[ClaudeInstalledLaunchConfiguration.swift](../../../bridges/claude/swift/service/ClaudeInstalledLaunchConfiguration.swift)의
`cleanEnvironment`는 BLABEE_*를 제거하며 MCP 충돌 검사는 사용자·프로젝트·시스템 설정을 읽는다.
분리 요구: M1/M2에서 실제 shell 수정을 막고 M3는 테스트 launcher·프로젝트·설정 경로를 쓴다.
CLAUDE_CONFIG_DIR만 지정해도 시스템 설정과 상위 프로젝트 파일의 영향은 남을 수 있다.
Claude CLI 자체의 macOS Keychain 인증 격리는 별도 확인 사항이다.

## 10. 통계·오류·피드백

[PetUsageAnalytics.swift](../../../app/telemetry/PetUsageAnalytics.swift)는 `BlabeeUsage`,
[PetErrorDiagnostics.swift](../../../app/telemetry/PetErrorDiagnostics.swift)는 `BlabeeDiagnostics`에 outbox를 둔다.
두 폴더는 메인 Blabee 데이터 폴더 밖에 있으며 live sender는 운영 서비스를 사용한다.
분리 요구: run별 outbox와 대역 sender를 주입하고 운영 업로드는 기본 차단한다.
M1의 가짜 오류·선택·완료 기록이 실제 사용자 통계에 들어가서는 안 된다.

## 11. 설치·업데이트

[AppInstallation.swift](../../../app/update/AppInstallation.swift)의 production destination은 운영 앱이다.
destination 주입 seam도 현재 마지막 폴더 이름을 `Blabee.app`으로 요구한다.
[AppUpdateRuntimeCopy.swift](../../../app/update/AppUpdateRuntimeCopy.swift)도 helper 앱 이름을 고정한다.
분리 요구: 초기 Test.app에서는 운영 설치·자동 업데이트 경로를 비활성화한다.
업데이트 검사를 지원하려면 나중에 목적지·helper·rollback·채널을 함께 분리해야 한다.
현재 [AppUpdateTransaction.swift](../../../app/update/AppUpdateTransaction.swift)는 Test compile에서 실제 transaction을 거절한다.
M1 조립도 downloader·runner·helper 등 외부 의존성을 실패 대역으로 주입한다.

## 12. 재사용 가능한 조립 seam

[PetViewModel.swift](../../../app/coordination/PetViewModel.swift)의 생성자는 transport, adapter,
Plugin·Hook manager, service, chooser, account, access, analytics, update 객체를 주입받는다.
M1은 이 seam으로 실제 Engine·저장소·Keychain·native 프로세스를 만들지 않아야 한다.
M2는 공통 Engine을 그대로 사용하고 Test child·저장소·권한 namespace를 독립시킨다.
M3에서만 실제 bridge를 연결하며 연결 완료와 실제 선택 실행 증거를 구별한다.

## 관련 회귀 검사와 남은 검증

현재 M1 전용 검사는 [BlabeeTestProfileTests.swift](../../../Tests/swift/BlabeePetTests/BlabeeTestProfileTests.swift),
[BlabeeTestRunStoreTests.swift](../../../Tests/swift/BlabeePetTests/BlabeeTestRunStoreTests.swift),
[BlabeeTestCompositionTests.swift](../../../Tests/swift/BlabeePetTests/BlabeeTestCompositionTests.swift),
[BlabeeTestWorkspaceTests.swift](../../../Tests/swift/BlabeePetTests/BlabeeTestWorkspaceTests.swift)다.
Node 검사는 [test-app-profile.test.mjs](../../../Tests/AppPackaging/test-app-profile.test.mjs)다.
M2 소스 검사는 [BlabeeTestEngineTests.swift](../../../Tests/swift/BlabeePetTests/BlabeeTestEngineTests.swift)와
[BlabeeTestEngineServiceTests.swift](../../../Tests/swift/BlabeePetTests/BlabeeTestEngineServiceTests.swift)에 추가했다.
저장소·workspace 관련 검사는 기존 파일에도 이어지며 전체 Test compile·회귀를 통과했다.
`npm run test:swift:test-app`은 전용 compile profile·scratch·필터와 기존 Swift 직렬 잠금을 사용한다.
현재 M2 결과는 Node 패키징 9개, Test Swift 98 tests / 7 suites, 제품 identity/profile 2 tests / 1 suite PASS다.
조건부 화면 render 1개는 `BLABEE_TEST_APP_RENDERS=0`으로 skip했다.
실제 Keychain·owned child/UDS CLI 수용과 M2 bundle 검증도 통과했다. 저장된 보고서는 event/sequence 8/8,
integrity·quick check ok, sidecar 2개, 재시작 queue 0·durable queued 0·claim 1·provider 실행 0이다.
과거 M1은 렌더 포함 Test Swift 51개/4 suites, 제품 profile 회귀 70개/8 suites를 통과했다.
과거 M1 산출물 [Blabee Test.app](../../../build/test-app/m1-20261019-02/Blabee%20Test.app)의 조립·ad-hoc strict 서명·plist 검사를 마쳤다.
Test profile probe와 Test 바이너리의 `service` 명령 거절(exit 1), product/Test의 `BlabeeTest` 심볼 0/76개도 확인했다.
PNG 6장은 직접 시각 검토했지만 실제 창 클릭·메뉴바 재열기·제품 앱 동시 실행은 미실행이다.

[PetConnectionSetupIntegrationTests.swift](../../../Tests/swift/BlabeePetTests/PetConnectionSetupIntegrationTests.swift)는
설정·폴더·서비스·launcher 대역을 조립하는 기존 예시다.
[PetFirstRunTests.swift](../../../Tests/swift/BlabeePetTests/PetFirstRunTests.swift),
[PetAccountKeychainTests.swift](../../../Tests/swift/BlabeePetTests/PetAccountKeychainTests.swift),
[PetHookReadinessTests.swift](../../../Tests/swift/BlabeePetTests/PetHookReadinessTests.swift)를 갱신 대상으로 검토한다.
[UnifiedProductProfileTests.swift](../../../Tests/swift/BlabeePetTests/UnifiedProductProfileTests.swift)와
[OperationalRuntimeIdentityTests.swift](../../../Tests/swift/BlabeePetTests/OperationalRuntimeIdentityTests.swift)는 identity 경계를 다룬다.
[SQLiteQueuedActionClaimTests.swift](../../../Tests/swift/CoordinatorSwiftTests/SQLiteQueuedActionClaimTests.swift)는 선택 권한 회귀 범위다.
추가 조건: 두 앱 동시 실행, run 교차 요청 거절, 제품 경로 접근 차단, 취소·초기화 중 늦은 응답 거절.
초기화는 해당 run child·lease가 종료된 뒤 등록된 run 자원만 정리해야 한다.
실제 공급자 로그인·OS 권한·서명·설치·업데이트는 소스 및 대역 검사와 별도로 검증한다.
이 코드맵 갱신은 소스 읽기로 수행했다. 과거 근거는 [M1 QA 기록](QA_REPORT.md)에 있으며
M2 실행 결과는 [M2 QA 기록](M2_QA_REPORT.md)에 구분한다. M1 최종 수용·M2 수동 UI·제품 공존은 대기다.

설계 결정과 구현 순서는 [기술 설계](TECH_SPEC.md), [구현 계획](IMPLEMENTATION_PLAN.md)을 따른다.
