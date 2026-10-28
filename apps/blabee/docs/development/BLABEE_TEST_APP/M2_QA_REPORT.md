# Blabee Test.app M2 검증 기록

기준일: 2026-10-19 KST. T-007 구현·자동 회귀·내부 bundle·실제 child/UDS/Keychain 수용을 통과했다.
M1 실제 창·제품 공존 수용은 계속 대기다. M3 실제 Codex·Claude 연결, 실제 OAuth, 공개 배포본 수용은 포함하지 않는다.

## 구현 범위

- `BlabeeTestEngineCore`가 제품과 같은 `SQLiteJournal`·`CoordinatorRoutingApplication`·`CoordinatorOperationalApplication`을 조립한다.
- `engineIsolation` run의 DB·storage/continuation/selector key·authority·project를 `settings/engine-v1` 아래에 둔다.
  자원 registry는 `settings/engine-resources-v1.json`이며 M1 manifest v1 계약은 유지한다.
- freshness는 기존 고정 service와 해당 run의 정확한 `test-<소문자 runUUID>` account만 사용한다.
  `primary`·다른 run·계정 Keychain 항목을 사용하지 않으며 Test factory는 삭제를 허용하지 않는다.
- Test가 직접 생성한 보조 프로세스만 소유하고 전용 UDS의 runtime identity·selector·profile/store/run/launch를 검증한다.
  프로세스 이름·소켓·저장 PID를 이용해 기존 프로세스를 찾아 종료하지 않는다.
- seed·claim은 명시적으로 실행한다. 선택은 child 메모리 fixture queue에 기록하며 실제 provider dispatcher를 호출하지 않는다.
  같은 delivery turn 재시도는 claim을 늘리지 않고 재시작은 durable 이력만 보존한다. 과거 action을 자동 복원·전송·실행하지 않는다.
- 계정·OAuth·Codex·Claude·업데이트·운영 통계는 계속 M1 대역·차단 구성을 사용한다.

## 자동 검사

| 검사 | 결과 | 증거 범위 |
|---|---|---|
| Node builder/profile 검사 | 9개 통과 | 반대 profile 거절·자원 목록·경로·symlink·metadata·단일 target |
| Test Swift 회귀 | 98 tests / 7 suites 통과 | M1 회귀, 실제 SQLite·메모리 freshness, 서비스 소유권·run storage·UI 선택 |
| 조건부 화면 렌더 | 1개 미실행 | `BLABEE_TEST_APP_RENDERS=0`; M1 과거 PNG를 M2 화면 검증으로 간주하지 않음 |
| M2 bundle·strict 서명·plist | 통과 | 별도 Test scratch·출력, 로컬 ad-hoc 서명 |
| 실제 child/UDS/Keychain | 통과 | 새 test run의 선택·단일 claim·정확한 재시도·재시작·종료 |
| bundle 실행 경계 | 통과 | 제품 service 명령·기존 check root 거절, 저장 보고서 보존 |
| 제품 profile 회귀 | 2 tests / 1 suite 통과 | 기존 제품 identity·bundle admission 유지 |
| 제품/Test 심볼 분리 | 제품 0 / Test 82개 | 각 실행 파일의 `BlabeeTest` 포함 symbol line 수 |

Swift 수치는 실행기 출력이다. parameter case 수를 별도로 더하지 않았다. 공통 lock과 별도 scratch에서 직렬로 실행했고,
7개 live/Keychain/benchmark opt-in을 제거했다. Swift 테스트는 실제 Keychain factory나 제품 바이너리를 실행하지 않으며
각 fixture의 메모리 freshness를 명시적으로 주입한다. SwiftPM의 `--disable-keychain`만으로 격리를 주장하지 않는다.

검사 명령:

```sh
node --test Tests/AppPackaging/test-app-profile.test.mjs
BLABEE_TEST_APP_RENDERS=0 npm run test:swift:test-app
npm run test:swift -- --jobs 1 --disable-keychain --disable-netrc --filter UnifiedProductProfileTests
```

제품 profile 명령도 동일 7개 opt-in을 제거하고 실행했다. 현재 제품 실행 파일의 stateless `distribution-profile`은
`blabee`·`com.biadone.blabee`, Test 실행 파일은 `blabee-test`·`com.biadone.blabee.test`를 반환했다.
로그: `/private/tmp/blabee-test-app-m2-swift-5.log`, `/private/tmp/blabee-test-app-m2-production-profile.log`.
Test compile 127.08초, runtime 2.359초·제품 profile runtime 0.003초는 이번 Mac의 관측치이며 성능 기준이 아니다.
운영 Engine 성능 개선이나 토큰 사용량을 측정한 결과도 아니다.

## 주요 회귀 조건

- MAC·journal sequence·무결성·freshness CAS·missing anchor·rollback·외부 writer·키 변조·만료·stale revision 검출.
- 정확한 턴 재시도만 복구하며 다른 세션·다른 run·편집된 메시지·다른 전달 턴의 claim 거절.
- 새 child incarnation의 identity·응답 경계, 직접 소유 child 종료 확인, 종료 지연 동안 lease 보존.
- 잘못된 profile/store/run/UID·registry·marker, symlink·hard link·권한·부분 자원 채택 거절.
- snapshot과 실제 selector 인증을 사용하는 Test UI 선택, 새 run 이후 늦은 report 실패 응답 차단.
- 재시작 이후 메모리 queue 0, durable claim 유지, 자동 seed·claim·provider 실행 없음.

## 구현 중 발견해 수정한 문제

1. M1 모의 계정 transport의 고정 selector가 M2 child의 생성된 selector와 일치하지 않아 UI 권한이 비활성화됐다.
   현재 소유 child의 credential과 상수 시간 비교하고 실제 Engine을 통과하는 UI 선택 회귀를 추가했다.
2. Foundation의 `standardizedFileURL`이 존재하는 `/private/tmp`를 `/tmp`로 바꿔 정상 fixture를 거절했다.
   원문 POSIX 구성요소와 literal 경로를 검증하고 `O_NOFOLLOW` descriptor 순회로 symlink alias 거절을 유지했다.
3. 같은 run의 보조 프로세스 재시작과 로그 생성 뒤 spawn 실패가 이전 launch/log 경로를 재사용했다.
   spawn 시도마다 incarnation을 소비하며 성공한 child·identity만 공개하고 실패 로그는 보존한다.
4. 이전 run의 report 실패가 새 화면에 오류를 표시할 수 있었다. 성공·실패 모두 generation/composition 경계를 검사한다.
5. 수용 CLI의 오류 경로가 drain 실패를 무시하고 lease를 해제할 수 있었다.
   `cleanup_pending`과 `child_stopped:false`를 한 번 보고한 뒤 종료 확인 전에는 session·lease·event loop를 유지한다.
   실제 drain 성공 이후에만 lease를 해제하고 최종 실패 결과를 기록한다.

최초 검사 실패와 수정 후 통과를 구분한다. run 2·3의 테스트/수용 CLI compile 오류와 run 4의 10 issues는 수정됐다.
run 4의 실패는 경로 정규화에 따른 서비스 8 issues와 연관 UI 2 issues였다. 제품 운영 실패를 재현한 결과는 아니다.
정적 재검토에서 추가 high/medium은 확인되지 않았으며 실행 결과와 구분한다.

## 산출물·실제 자원 수용

- 앱: [M2 Blabee Test.app](../../../build/test-app/m2-20261019/Blabee%20Test.app).
- 빌드 ID: `m2-20261019`; bundle ID: `com.biadone.blabee.test`; profile: `blabee-test`.
- mode: `isolated-development`; milestone: `M2`; simulation-only: false; Engine-enabled: true.
- 실행 파일 SHA-256: `432bf864920681115077fc2d2f67c310f24901653d389eeca3ec1e3ddef2d238`.
- `codesign --verify --strict`·`plutil -lint` 통과. Developer ID·Apple 공증은 수행하지 않은 내부 개발용 앱이다.

앱을 열고 `M2 · Real Engine / M2 · 실제 Engine` → `New Test / 새 테스트 시작` →
`Create Test Card / 테스트 카드 만들기` → 카드 선택 → `Verify Claim / Retry / Claim 검증·재시도` 순서로 검사한다.
`Save Report / 결과 저장`으로 해당 run의 `results/m2-report.json`에 기록한다.

Test-only `test-engine-check`는 새 `/private/tmp/blabee-test-m2-check-<소문자 UUID>`만 만들며 기존 root/run을 채택하지 않는다.
실제 검사에서 다음 결과를 확인했다.

| 관측 | 결과 |
|---|---|
| 새 run | `8293d06a-10da-4364-8988-14f8c38fe03f` |
| freshness | 실제 Keychain의 `test-8293d06a-10da-4364-8988-14f8c38fe03f` account |
| SQLite 무결성 | `ok` |
| 재시작 후 검증된 저장 이력 | event/sequence 8, quick check `ok`, sidecar 2개 검증 |
| 선택 후 fixture queue | 1건 |
| durable claim | 1건 |
| 같은 delivery turn 재시도 | 추가 이벤트 0건 |
| 다른 child incarnation으로 재시작 | durable claim 1건 유지, 메모리 queue 0건 |
| 재시작 후 과거 선택의 claim 명령 | `blabee_test_engine_no_queued_action` 거절 |
| 소유 child 종료 | `child_stopped=true`, drain 성공 후 lease 해제 |
| provider 실행 | 0건; 실제 provider를 조립하지 않는 M2 구성 |

실제 bundle 검사 명령:

```sh
/usr/bin/lockf -t 0 -k -w /tmp/blabee-coordinator-swift-tests.lock npm run build:test-app -- --build-id m2-20261019
"build/test-app/m2-20261019/Blabee Test.app/Contents/MacOS/blabee-coordinator" test-engine-check --store-root /private/tmp/blabee-test-m2-check-90b5bd92-df2b-4cf0-b5cb-973fb6027007
```

`results/m2-report.json`은 store/run binding envelope 안에 base64 report payload를 저장한다.
`loadResult(for:)`가 envelope를 검증하고 원본 JSON payload를 반환한다. 위 root는 이미 사용한 검사 근거다.
재실행하려면 새 소문자 UUID로 바꾼다. 실제로 같은 root 재사용이 exit 1로 거절되고
저장 보고서 hash가 보존됨을 확인했다. Test bundle에서 제품 `service` 명령도 exit 1로 거절됐다.
검사 run의 실제 freshness 항목과 파일은 삭제하지 않고 보존했다. 운영 primary·로그인 Keychain 항목은 검사하지 않았다.

근거:

- 빌드: `/private/tmp/blabee-test-app-m2-build-20261019.log`.
- live check: `/private/tmp/blabee-test-app-m2-live-check-1.log` (exit 0).
- bundle 경계: `/private/tmp/blabee-test-app-m2-bundle-check.json`.
- run root: `/private/tmp/blabee-test-m2-check-90b5bd92-df2b-4cf0-b5cb-973fb6027007/test-store/runs/8293d06a-10da-4364-8988-14f8c38fe03f`.
- 위 run의 `results/m2-report.json`·두 `logs/engine-service-<launchUUID>.log`는 재시작 전후 근거다.

macOS 27.0.1 (26A434)의 이번 Mac에서 수행한 검사이며 임시 경로는 장기 보관을 보장하지 않는다.
M2 source/test 14개 파일의 trailing whitespace·merge marker 검사와 변경된 tracked manifest/entrypoint의
`git diff --check`도 통과했다. 최종 개발 문서 9개의 로컬 링크 128개와 trailing whitespace 검사도 오류 없이 통과했다.

## 수정 파일

| 경로 | 책임 |
|---|---|
| `dev/test-app/swift/BlabeeTestEngineCore.swift` | 실제 공통 Engine·fixture queue·명시적 seed/claim·무결성 보고서 |
| `dev/test-app/swift/BlabeeTestEngineService.swift` | 전용 child·UDS·인증·test freshness·authority·프로세스 수명 |
| `dev/test-app/swift/BlabeeTestRunStore.swift`, `BlabeeTestScenarios.swift` | 자원 registry·권한·run 경계·M2 시나리오 |
| `dev/test-app/swift/BlabeeTestComposition.swift`, `BlabeeTestApplication.swift` | 공통 UI 조립·M2 controls·결과·수용 CLI·drain |
| `Package.swift`, `package.json`, `scripts/build-test-app.mjs`, `app/entrypoints/main.swift` | Test 전용 sources·검사·metadata·조기 분기 |
| `Tests/swift/BlabeePetTests/BlabeeTest{Engine,EngineService,RunStore,Workspace}Tests.swift` | Engine·서비스·저장·UI·실패 회귀 |
| `Tests/AppPackaging/test-app-profile.test.mjs`, `docs/development/BLABEE_TEST_APP/` | 패키징 검사·구현/수용 경계 기록 |

제품 `engine/`·`bridges/`의 구현이나 기존 계약·저장 schema·운영 식별자는 M2를 위해 수정하지 않았다.
다른 세션의 기존 dirty 변경을 보존했으며 commit·push·제품 설치·운영 앱 재시작을 하지 않았다.

## 남은 수용과 한계

- 실제 창의 M2 카드 클릭·언어·작은 창·메뉴바 재열기·제품 앱 공존은 별도 수동 수용으로 남는다.
- 새 Mac/VM·Developer ID·공증·Gatekeeper·DMG 설치·업데이트는 개발용 ad-hoc Test.app 검사의 범위가 아니다.
- 격리는 조립·경로 검증·factory 주입·실행 근거에 기반한다. VM/OS sandbox나 네트워크·Keychain 전체 API 추적은 아니다.
- `providerExecutionCount=0`은 provider dispatcher를 조립하지 않는 소스와 fixture의 관측이다.
  queue 접수·durable claim을 실제 작업 완료와 같은 지표로 해석하지 않는다.
- 실제 Codex·Claude의 테스트 전용 config·Hook·MCP·인증 격리는 후속 T-008·009·011(M3)이다.
