# Blabee Test.app 연구 및 결정 기록

기준일: 2026-10-19. 상태: 초기 설계 근거와 M1·M2 소스 관찰.
M2 T-007의 구현·자동 회귀·실제 child 수용을 완료했다. 사용자가 M2 진행을 직접 승인해 M1과 별도로 진행했다.
M1 최종 수용과 M2 수동 UI·제품 공존 수용은 대기다.
이 문서에서 **현재 사실**, **설계 결정**, **미검증 항목**을 구분한다.

## 요약

- Test.app의 목적은 같은 Mac에서 온보딩과 연결 UI를 초기 상태부터 반복 확인하는 것이다.
- MVP(M1)는 실제 화면과 제어 흐름을 사용하되 외부 작업은 시뮬레이션한다.
- M1의 네트워크·실제 인증·모델 호출·시스템 Keychain 접근은 모두 0이어야 한다.
- M2는 실제 공통 Swift Engine·SQLite·키·authority와 해당 run의 정확한 freshness Keychain account를 조립한다. 로그인·provider는 모의이며 M3는 미구현이다.
- 별도 앱 이름이나 Bundle ID만으로 격리가 완성되지는 않는다.
- VM, 새 macOS 사용자, 실제 Plugin 연결, 공증 검증을 대체하는 도구로 취급하지 않는다.

## 현재 소스에서 확인한 사실

| 확인 대상 | 현재 사실 | Test.app에 주는 의미 |
| --- | --- | --- |
| `PetViewModel` | transport·설정 관리자·계정·진단 등의 의존성을 생성자에서 주입할 수 있다. | 기존 UI를 복제하지 않고 테스트용 조립을 추가할 수 있다. |
| `PetConnectionSetupController` | inspect·prepare·configure 클로저와 selection store를 주입받는다. | 설치·Hook 검토·실패·재시도를 외부 CLI 없이 표현할 수 있다. |
| 계정 계층 | service·session store·browser가 프로토콜로 분리되어 있다. | 실제 OAuth와 Keychain을 생성하지 않는 모의 계정을 조립할 수 있다. |
| 실제 계정 조립 | `PetAccountController.live()`는 Supabase service, 시스템 Keychain store, 인증 브라우저를 생성한다. | MVP 조립에서 이 경로를 호출하면 안 된다. |
| 인증 브라우저 | `prefersEphemeralWebBrowserSession`은 현재 `false`다. | 현재 제품 로그인은 테스트용 임시 브라우저 세션으로 분리되어 있지 않다. |
| 인증 callback | `com.biadone.blabee://auth/callback`이 계정 설정에 고정되어 있다. | 실제 OAuth를 추가하려면 테스트 callback을 별도 설정할 수 있어야 한다. |
| 계정 Keychain | service 이름은 제품 prefix와 Supabase host로 구성된다. | Bundle ID 변경만으로 현재 조회·저장 범위가 바뀌지 않는다. |
| Engine freshness Keychain | 생성자는 기존 고정 service만 허용하고 account 기본값은 `primary`다. | M2 factory는 `defaultService`와 정확한 `test-<소문자 runUUID>` account만 넘기며 삭제를 허용하지 않는다. |
| `Package.swift` | 제품 executable target은 `BlabeeCoordinator`이며 명시적인 sources 목록을 사용한다. | 파일을 두 target에 중복 포함하는 분리를 피한다. |

기존 계정 테스트에는 service·store·browser 대역이 있고, 연결 화면 테스트에도 모의 transport와 설정 상태가 있다.
이는 주입 방식의 근거다. 현재 M1은 아래의 별도 실행 조립으로 구현했으며 기존 테스트 결과만으로 격리를 증명하지 않는다.
테스트 모듈에 있는 private fixture를 제품 실행 파일의 의존성으로 그대로 사용하지 않는다.

## M1 구현과 과거 검증에서 확인한 내용

- `BLABEE_TEST_APP`을 사용한 기존 target의 별도 컴파일이며 `AppExecutionProfile` 신규 타입은 만들지 않았다.
- M1의 Application·Composition·RunStore·Scenarios 4개 파일은 조건부 컴파일된다. 현재 M2는 EngineCore·EngineService 2개를 더해 6개다.
- M1은 공통 온보딩·연결·카드·설정 화면을 사용하고 계정·서비스·Plugin·Hook·transport를 모의한다.
- `BlabeeTestRunStore`의 기본 root는 사용자 Application Support의 `Blabee Test`다.
- 새 테스트는 새 run을 만들고 기존 파일을 보존한다. 이어보기는 직접 선택한 snapshot만 복원한다.
- 온보딩 재생은 같은 run의 화면 진행만 되돌린다. 실제 credential·브라우저·작업은 복원하지 않는다.
- 모의 타이머와 polling은 사용하되 실제 서비스·네트워크·Engine·Keychain·native provider는 만들지 않는다.
- builder는 `npm run build:test-app -- --build-id <ID>`, 출력은 `build/test-app/<ID>/Blabee Test.app`이다.
- 과거 M1 Node 9개, 렌더 포함 Test Swift 51개/4 suites, 제품 profile 회귀 70개/8 suites를 통과했고 PNG 6장을 직접 시각 검토했다. 이는 현재 M2 통과 결과가 아니다.
- 과거 [M1 Blabee Test.app](../../../build/test-app/m1-20261019-02/Blabee%20Test.app)의 실제 조립·ad-hoc strict 서명·plist·profile·심볼 분리를 확인했다. 이 bundle에는 M2가 없다.
- 실제 창 클릭·메뉴바 재열기·제품 앱과의 동시 실행은 native 조작 도구 부재로 미실행이다.

API·파일 위치는 [코드맵](CODEMAP.md), 검증 근거는 [QA 기록](QA_REPORT.md)에서 구분한다.

## 현재 M2 소스에서 확인한 내용

- `BlabeeTestScenario.engineIsolation`만 실제 Engine을 선택한다. 나머지 9개 시나리오는 M1 모의를 유지한다.
- `BlabeeTestEngineCore`는 공통 `SQLiteJournal`·`CoordinatorRoutingApplication`·`CoordinatorOperationalApplication`을 조립한다. Node 참조 구현을 실제 Engine으로 대체하지 않는다.
- `settings/engine-resources-v1.json`과 Engine·socket marker가 DB·키·authority·project·짧은 UDS·freshness의 store/run 범위를 기록·검증한다. M1 manifest v1의 schema와 소유 경로 목록은 유지한다.
- `BlabeeTestEngineSession`이 현재 bundle의 `test-engine-service`를 직접 child로 만들고, child는 정규 argv 좌표·직접 부모·UID·실행 파일과 등록 자원을 다시 검증한다.
- authority는 run 전용 root와 `includesPrimaryNamespace=false`를 사용한다. UDS runtime identity와 모든 요청은 profile/store/run/launch·selector에 묶이며 이전 launch의 응답도 거절한다.
- 중지는 직접 만든 `Process` 객체에만 적용한다. drain 실패 시 child 참조·lease·run 근거를 보존하고 새 run 전환을 중단한다.
- seed는 빈 journal에서 사용자 제어로만 실행한다. 공통 UI의 선택은 Test child 내부 fixture queue에 기록하고, claim은 같은 delivery turn을 재사용한다. 재시작은 durable 이력만 보존하고 queue는 0으로 시작한다.
- `BlabeeTestEngineReport`는 journal·integrity·sidecar·queue·claim을 보고하며 provider queue 제출·실행은 0이다. queue와 claim을 실제 작업 완료로 해석하지 않는다.
- M1 계정·OAuth·provider·설정·원격 telemetry 대역을 유지한다. M2 실제 Keychain 사용은 freshness에만 한정하며 파일 backend로 자동 대체하지 않는다.
- builder는 `M2`, `isolated-development`, `BlabeeTestSimulationOnly=false`, `BlabeeTestEngineEnabled=true` metadata와 `run_scoped_freshness_only` bundle 정책을 만든다. Test는 ad-hoc 서명만 사용한다.
- Test 전용 `test-engine-check --store-root /private/tmp/blabee-test-m2-check-<소문자 UUID>`는 정확한 새 root 아래 `test-store`의 새 run에서 실제 freshness Keychain·owned child/UDS를 검사한다. 실제 수용은 PASS(exit 0)했고 queue 1·claim 1·같은 턴 추가 이벤트 0·재시작 queue 0/claim 1·integrity ok·child 종료·provider 실행 0을 확인했다.
- 기존 root 재사용은 exit 1로 거절했다. 테스트 freshness 항목·파일은 보존했으며 기존 service·운영 `primary`·계정 항목은 변경하지 않았다. 실패 정리 중 child 종료 전에는 lease를 유지하며 spawn 실패 재시도는 새 launch/log를 사용한다.
- M2 Node 패키징 9개, Test Swift 98 tests / 7 suites와 제품 identity/profile 2 tests / 1 suite를 통과했다. 조건부 render 1개는 `BLABEE_TEST_APP_RENDERS=0`으로 skip했다.
- [M2 Blabee Test.app](../../../build/test-app/m2-20261019/Blabee%20Test.app)의 조립·ad-hoc strict 서명·plist·Test profile을 확인했다. 제품 `service` 명령은 exit 1로 거절했고 `nm`의 `BlabeeTest` 검색 결과는 Test 82행·제품 0행이었다. 실제 product profile probe는 `blabee` / `com.biadone.blabee`다.

조립 경계는 코드 읽기로 확인했고 자동·bundle·실제 child 결과는 별도 실행 근거다.
현재 결과와 한계는 [M2 QA 기록](M2_QA_REPORT.md)에 구분한다.

## 선택지와 결정

1. 별도 macOS 사용자는 계정별 초기 설정에 유용하지만 반복 초기화가 번거롭고 OS와 설치 앱을 공유한다.
2. VM은 OS·설치 환경을 되돌리는 데 적합하지만 다운로드·디스크·메모리 비용이 있다.
3. 기존 앱을 복사하고 이름만 바꾸는 방식은 고정된 경로·서비스·인증 설정 때문에 격리를 보장하지 못한다.
4. 기존 target을 별도 compile profile로 조립하는 Test.app을 반복 UI 확인용으로 선택한다.

기존 target을 제품용과 테스트용 profile로 각각 빌드하고 scratch·결과물 경로를 분리하는 설계다.
Swift 모듈 재설계나 같은 소스의 두 target 중복 포함은 이번 목적에 필요하지 않다.
MVP에는 새 production 의존성을 추가하지 않고 기존 프로토콜과 DI를 활용한다.
이 결정은 현재 M1·M2 소스에 반영했다. 이 연구 문서 갱신은 소스 읽기로 수행하며 별도 실행 결과는 각 단계의 QA 기록을 따른다.

## MVP 격리 원칙

- 제품과 구분되는 앱 이름·아이콘 표시·Bundle ID를 사용하고 화면에 시뮬레이션임을 표시한다.
- UserDefaults, 파일 저장소, 로그, 시나리오 기록은 테스트 전용 범위로 제한한다.
- 앱 시작 전에 테스트 profile의 필수 의존성을 완성하고 누락 시 시작을 중단한다.
- 누락된 대역을 제품 기본값, `.live()`, 실제 socket, 실제 사용자 홈 경로로 보충하지 않는다.
- 계정 service·browser·store는 모두 대역을 사용하고 시스템 Keychain API를 호출하지 않는다.
- Codex·Claude 탐색, 설치, Hook 수정, launch agent 등록, 터미널 실행을 하지 않는다.
- 업데이트 다운로드·교체·재시작, 브라우저 열기, 원격 피드백·통계 업로드도 대역으로 대체한다.
- 모의 계정·카드·권한 상태는 운영 엔진의 인증·MAC·단일 claim 검증을 우회하는 수단으로 사용하지 않는다.
- 테스트용 compile profile의 진입은 production 실행 인자 하나로 활성화되는 우회 기능이 되어서는 안 된다.

## 초기화와 재현 시나리오

현재 새 테스트는 소유 run의 모의 작업을 정리하고 새로운 저장 공간과 조립을 만든다. 기존 run 파일은 보존한다.
진행 중 작업을 취소하고 generation을 바꿔 이전 응답이 새 시나리오를 덮어쓰지 않게 한다.
실제 브라우저 쿠키, 기존 Blabee 인증정보, `~/.codex`, 사용자 프로젝트는 초기화 대상이 아니다.
심볼릭 링크나 제품 경로로 해석되는 대상은 제거하지 않으며 범위 확인 실패 시 중단한다.

반복 시나리오는 첫 실행, Codex 미설치, 로그인 취소·실패, Plugin 설정 실패, Hook 검토 대기, 설정 완료를 우선한다.
같은 실제 UI에서 영어·한국어, 작은 창, 밝고 어두운 화면, 중복 클릭, 취소 후 늦은 응답을 확인한다.
시뮬레이션의 ‘설정 완료’와 ‘카드 전달 성공’은 실제 Codex/Claude 검증 결과로 표시하지 않는다.
모의 지연 시간은 상태 전환 확인용이며 실제 제품 처리 시간이나 성능 개선 수치가 아니다.

## 인증 브라우저 격리의 공식 근거

Apple은 `prefersEphemeralWebBrowserSession = true`를 일반 브라우저와 쿠키·데이터를 공유하지 않는 인증 요청으로 설명한다. [R1]
Safari는 이 요청을 준수하지만 macOS의 다른 기본 브라우저는 준수하지 않을 수 있다고 명시한다.
따라서 ‘모든 브라우저에서 매번 완전히 새로운 Google 로그인’을 보장한다고 표현할 수 없다.
이 옵션은 기존 브라우저 쿠키를 삭제하는 기능이나 OS 사용자 전체를 격리하는 기능이 아니다.
MVP는 브라우저 자체를 실행하지 않으며, 모의 로그인 성공은 실제 Google/GitHub 인증의 증거가 아니다.

## Keychain 격리의 공식 근거

Apple TN3137에 따르면 macOS의 SecItem API는 기본적으로 file-based Keychain을 사용한다. [R2]
file-based Keychain은 ACL, data-protection Keychain은 entitlement 기반 access group으로 접근을 제어한다.
현재 계정 store도 file-based Keychain 사용을 명시하므로 Bundle ID만 바꾸면 자동 분리된다는 설명은 부정확하다.
실제 인증 저장소를 후속 도입한다면 테스트 전용 service·account 조회 범위와 접근 정책을 함께 설계해야 한다.
MVP에서는 Keychain을 사용하지 않는 store를 주입하므로 이 후속 구성을 미리 운영 환경에 적용하지 않는다.

### 현재 M2의 Engine freshness 항목

Engine 통합 검사가 필요한 M2는 M1 시뮬레이션 및 실제 OAuth 검사와 구분한다.
현재 `BlabeeTestEngineFreshnessFactory.make`는 `KeychainFreshnessAnchorStore.defaultService`를 보존하고
정확히 `"test-" + run.runID.uuidString.lowercased()`인 account를 주입한다.
core는 해당 account와 `storageSlot`이 모두 일치해야 조립한다. 접두어만 맞는 다른 run이나 `primary`를 거절하며
기존 Engine의 service·단일 claim·freshness guard를 확장하거나 약화하지 않는다.
M2의 운영 `primary`·계정 인증정보 항목 접근은 0이고, 전용 테스트 freshness 항목만 사용할 수 있다.
factory는 `allowsTestDeletion=false`로 생성한다. 새 run은 새 slot을 사용하며 reset·종료에서 기존 항목을 삭제하지 않는다.
`deleteForTesting()`의 기존 제한은 유지한다. 실제 factory·child를 함께 사용하는 CLI 수용도 통과했으며
해당 run의 test freshness 항목을 보존했다. 이 검사는 OS 전체 Keychain API 추적을 수행했다는 뜻은 아니다.
이 account slot은 Google/GitHub 계정이나 OAuth 토큰 namespace가 아니며 서로 공유하지 않는다.

## 실제 OAuth는 후속 구성

실제 인증 검사는 테스트 Supabase 프로젝트와 전용 테스트 계정을 준비하는 별도 단계로 둔다.
테스트 앱 callback과 해당 프로젝트의 redirect allowlist를 맞추고 제품 callback·credential namespace와 분리한다.
원격 계정 상태·이용 권한·진단 데이터도 분리하며 운영 Supabase 설정이나 기존 credential을 이번에 변경하지 않는다.
이 항목들은 후속 외부 구성 조건이며 문서 작성이나 오프라인 MVP에 대한 추가 승인 절차를 뜻하지 않는다.
임시 인증 브라우저의 한계는 그대로 안내하고 브라우저 쿠키 격리가 확인되지 않으면 격리 성공으로 기록하지 않는다.
테스트 초기화를 계정 전체 로그아웃, 운영 세션 폐기 또는 다른 브라우저 데이터 삭제로 구현하지 않는다.

## 미검증 항목과 검증 경계

- M1 소스·자동 회귀·내부 bundle 검증은 완료했다. 이는 OS sandbox·네트워크 패킷·전체 시스템 API 계측의 증거가 아니다.
- M1 최종 수동 수용과 M2 실제 창·운영 앱 공존 수용은 아직 남아 있다. M2 실제 Engine의 자동 회귀·CLI 수용을 마쳤으며 M3 provider 연결은 미구현이다.
- M2 in-process 회귀는 메모리 freshness·fake child를 명시적으로 주입한다. 실제 Keychain·프로세스·UDS CLI 수용은 별도로 통과했으며 이를 수동 UI 조작·운영 제품 실사용 증거와 합치지 않는다.
- OS 권한, Gatekeeper·quarantine, Developer ID 서명·공증, 실제 설치·업데이트는 별도 검사가 필요하다.
- 실제 Codex/Claude Plugin 설치·신뢰 승인·카드 수신·claim·작업 실행은 시뮬레이션으로 증명하지 않는다.
- 실 OAuth의 브라우저별 동작과 callback 라우팅도 후속 실제 환경 검증 대상이다.
- 초기 연구는 소스·공식 문서 읽기였고, 현재 개발 검증은 별도 QA 기록으로 관리한다. 이 문서 편집은 앱·인증·운영 DB/Keychain 접근을 하지 않는다.

## 참고 자료

- [R1: Apple — prefersEphemeralWebBrowserSession](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession/prefersephemeralwebbrowsersession). 공식 본문을 직접 확인했다.
- [R2: Apple TN3137 — On Mac keychain APIs and implementations](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains). 공식 본문을 직접 확인했다.
- [PetViewModel.swift](../../../app/coordination/PetViewModel.swift), [PetConnectionSetup.swift](../../../app/coordination/PetConnectionSetup.swift): 조립·연결 상태 주입 지점.
- [PetAccountController.swift](../../../app/account/PetAccountController.swift), [PetAccountAuth.swift](../../../app/account/PetAccountAuth.swift): 계정 의존성·callback 설정.
- [PetAccountBrowser.swift](../../../app/account/PetAccountBrowser.swift), [PetAccountKeychain.swift](../../../app/account/PetAccountKeychain.swift): 현재 브라우저·인증 저장소 동작.
- [PetAccountControllerTests.swift](../../../Tests/swift/BlabeePetTests/PetAccountControllerTests.swift), [PetConnectionSetupViewTests.swift](../../../Tests/swift/BlabeePetTests/PetConnectionSetupViewTests.swift): 기존 대역 패턴.
- [PetTransport.swift](../../../app/service/PetTransport.swift), [Package.swift](../../../Package.swift): transport 경계와 target 구성.
- [KeychainFreshnessAnchorStore.swift](../../../engine/persistence/KeychainFreshnessAnchorStore.swift): 고정 service·account slot·테스트 삭제 제한.
