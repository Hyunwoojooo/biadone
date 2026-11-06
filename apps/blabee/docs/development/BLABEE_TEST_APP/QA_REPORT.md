# Blabee Test.app M1 검증 기록

기준일: 2026-10-19 KST. **M1 소스·자동 회귀·내부 bundle 검증 완료, 실제 창 조작과 공존 수용은 대기**다.
M2·M3·실제 OAuth·공증 배포본 검증은 이번 결과에 포함하지 않는다.

## 산출물

- 앱: [Blabee Test.app](../../../build/test-app/m1-20261019-02/Blabee%20Test.app).
- 빌드 ID: `m1-20261019-02`.
- bundle ID: `com.biadone.blabee.test`; profile: `blabee-test`; mode: `simulation`; milestone: `M1`.
- 로컬 개발용 ad-hoc 서명이며 Apple 공증·Developer ID 배포 서명은 하지 않았다.
- 실행 파일 SHA-256: `76d178aca31ce9ca84fdc25e66921959ed513232b29603834234b3bd5b7217f8`.

앱을 열고 시나리오를 선택한 뒤 **New Test / 새 테스트 시작**을 누른다. 기본 run 저장소는
사용자 Application Support의 `Blabee Test`다. 제품 앱의 설치 경로로 복사할 필요가 없다.
테스트 전역 단축키는 등록하지 않으므로 카드의 단축키 표식은 `Unavailable / 사용 불가`일 수 있다.
선택과 건너뛰기는 마우스로 검사한다.

## 자동 검사 결과

| 검사 | 결과 | 증거 범위 |
|---|---|---|
| Test builder·profile Node 회귀 | 9개 통과 | 반대 profile 거절, 경로·symlink·출력 충돌, 자원 목록, 서명 명령 조립 |
| Test Swift 회귀 | 51개 / 4 suites 통과 | profile, run store, 모의 계정·연결·카드, 전환·취소·늦은 응답, 닫기 callback |
| 제품 profile Swift 회귀 | 70개 / 8 suites 통과 | 기존 식별자, 언어·설정, 모의 업데이트 동작의 회귀 |
| 화면 렌더 | 6장 생성·시각 검토 | 처음 설치·Codex 미설치·연결 카드의 영어 밝은 화면/한국어 어두운 화면 |
| Test 앱 실제 조립 | 통과 | Test flag로 별도 scratch에서 debug 실행 파일 생성·bundle 조립 |
| `codesign --verify --strict` / `plutil -lint` | 통과 | ad-hoc 서명과 Info.plist 형식 |
| bundle 내용·stateless probe | 통과 | Test 식별자, simulation marker, 제품 `service` 명령 exit 1 |
| product/Test 심볼 분리 | 통과 | 제품 실행 파일의 `BlabeeTest` 심볼 0개, Test 실행 파일 76개 |

Swift 테스트 수는 실행기가 출력한 test 수이며 parameter case 수와 별도로 센 숫자가 아니다.
모든 Swift 실행은 공통 lock을 사용해 직렬로 수행했다. 실제 인증정보·native CLI·Keychain opt-in 검사는
활성화하지 않았으며 Test 검사에는 임시 파일 root와 모의 의존성만 사용했다.

주요 명령:

```sh
node --test Tests/AppPackaging/test-app-profile.test.mjs
BLABEE_TEST_APP_RENDERS=1 npm run test:swift:test-app
npm run test:swift -- --jobs 1 --disable-keychain --disable-netrc --filter 'UnifiedProductProfileTests|PetLocalizationTests|PetFirstRunPreferencesTests|AppUpdateTransactionTests'
npm run build:test-app -- --build-id m1-20261019-02
codesign --verify --strict "build/test-app/m1-20261019-02/Blabee Test.app"
```

제품 회귀를 실행할 때도 전용 Test 명령과 같은 7개 live/Keychain/benchmark 환경 opt-in을 제거했다.
실제 제품 앱을 실행하거나 업데이트한 검사가 아니다.

## 실행 근거

- Test Swift: `/private/tmp/blabee-test-app-m1-swift-7.log`.
- 제품 회귀: `/private/tmp/blabee-test-app-production-regression.log`.
- 앱 빌드: `/private/tmp/blabee-test-app-m1-build-20261019-02.log`.
- bundle 검사: `/private/tmp/blabee-test-app-bundle-check-20261019.json`.
- 화면: `/private/tmp/blabee-test-app-ui-e94dc194-43dc-4309-b40d-50d630b01e71/`.

위 경로는 이번 Mac의 임시 근거이며 장기 보관이나 다른 Mac에서의 재실행 결과가 아니다.
온보딩·연결 화면은 460×550pt, 카드는 560×780pt의 Test workspace 전체 크기로 렌더했다.
작은 온보딩 창은 공통 화면의 내부 스크롤을 사용하며 주요 진행·건너뛰기 버튼은 보인다.
모의 카드 본문은 snapshot을 만든 언어를 유지할 수 있으므로 앱 chrome의 즉시 언어 전환과 구분한다.

## 수정 파일과 책임

| 파일 | 변경 |
|---|---|
| `dev/test-app/swift/BlabeeTestRunStore.swift`, `BlabeeTestScenarios.swift` | 소유권 검증·run·lease·snapshot·결과 저장, 9개 시나리오 |
| `dev/test-app/swift/BlabeeTestComposition.swift`, `BlabeeTestApplication.swift` | 모의 의존성 조립, Test workspace·페이지·수명·window |
| `scripts/build-test-app.mjs`, `Package.swift`, `package.json` | 기존 target의 별도 compile profile·출력·전용 검사 명령 |
| `app/entrypoints/main.swift`, `app/service/product-support/BlabeeProductProfile.swift` | 제품 초기화 전 Test 실행 분기와 고정 식별자 |
| `app/ui/PetLocalization.swift`, `app/ui/settings/ClaudeAutoConnectSettingsView.swift`, `app/update/AppUpdateTransaction.swift` | Test 전용 언어 저장소와 외부 탐색·업데이트 차단 |
| `Tests/AppPackaging/test-app-profile.test.mjs` | builder·반대 profile·출력 경계 검사 |
| `Tests/swift/BlabeePetTests/BlabeeTest{Profile,RunStore,Composition,Workspace}Tests.swift`, `UnifiedProductProfileTests.swift` | Test 회귀와 제품 identity 분기 회귀 |
| `docs/development/BLABEE_TEST_APP/` | 현재 구현·명령·수용 상태와 후속 계획 구분 |

기존 dirty checkout의 다른 제품·bridge·Engine 변경은 이번 작업으로 되돌리거나 stage하지 않았다.

## 구현 중 발견해 수정한 문제

- 첫 실행에서 아직 없는 Test root를 손상된 기존 저장소와 구분했다.
- 부분 생성 run은 보존·진단하면서 유효 run의 이어보기와 새 테스트를 허용했다.
- reset·페이지 전환·온보딩 재생 이후 오래된 응답, callback, store 참조가 새 UI·진행 상태를 바꾸지 못하게 했다.
- 이전 run의 테마 변경, 업데이트·URL·설치된 터미널 검색 등 공통 UI의 외부 경로를 차단했다.
- 모의 접근 권한의 generation 학습 이후 갱신이 멈추던 문제를 공통 controller의 메모리 transport polling으로 고쳤다.
- 샘플 카드의 고정 날짜를 run 생성 시각과 10분 만료로 바꾸고 재조회에 의한 연장을 막았다.
- Cards의 X 버튼을 Test 창 숨기기에 연결하고 이전 페이지·run의 callback을 거절했다.
- 지연 응답 테스트 자체가 응답 해제 전에 `activate()` 완료를 기다리던 순서 오류를 고쳤다.

처음 전체 테스트가 대기한 원인은 마지막 항목이었다. 테스트 실행기 시작 실패나 운영 Blabee의 지연으로
확정하지 않는다. 수정 후 전체 51개 검사가 통과했다.

## 실패·미실행과 한계

- 최초 빌드 `m1-20261019`는 `sandbox-exec: sandbox_apply: Operation not permitted`로 중단됐다.
  실패 폴더를 덮어쓰지 않고 새 ID에서 sandbox 밖으로 다시 실행해 빌드·서명을 마쳤다.
- SwiftPM은 기존 `ui-demos` 관련 unhandled input과 기존 테스트의 deprecated/redundant macro 경고를 출력했다.
  선택한 검사의 compile/test 실패는 남지 않았다.
- native 자동 조작을 시도했지만 `orca skills get computer-use`가 `zsh: command not found: orca`로 실패했다.
  다른 실행 파일로 대체하지 않았다. 실제 Test 창의 클릭·메뉴바 재열기·제품 앱과의 동시 실행은 미실행이다.
- Keychain·네트워크 접근 0이라는 판단은 조기 실행 분기와 의존성 주입·차단 경로 검토에 근거한다.
  OS 차원의 sandbox, 네트워크 패킷 계측, 시스템 API 전체 추적을 수행했다는 뜻은 아니다.
- 실제 Engine의 MAC·freshness·journal·claim 검증은 M2, 실제 Codex/Claude 연결은 M3로 남는다.
- 운영 앱·사용자 세션·운영 DB·Keychain·인증정보를 변경하지 않았고 commit·push는 하지 않았다.

## 남은 수동 수용

1. Test 앱을 열고 처음 설치 시나리오의 사용법 → 모의 로그인 → 더미 약관 → 모의 설정을 진행한다.
2. Plugin 준비·늦은 응답 시나리오에서 대기 중 새 테스트 시작·응답 해제·취소를 확인한다.
3. 연결 카드에서 선택·건너뛰기·X를 누르고 `Blabee TEST` 메뉴바로 같은 run을 다시 연다.
4. 앱 재실행 후 저장 run을 직접 이어보고, 온보딩 재생과 새 run의 차이를 확인한다.
5. 기존 제품 Blabee·Codex·Claude를 그대로 둔 채 Test 앱만 종료·재실행할 수 있는지 확인한다.

이 수용을 마친 뒤 T-006을 최종 완료로 전환한다. 현재 앱은 M1 UI 반복 검사용으로 사용할 수 있다.
