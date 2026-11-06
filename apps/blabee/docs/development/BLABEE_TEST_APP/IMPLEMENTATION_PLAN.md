# Blabee Test.app 실행 계획

기준일: 2026-10-19. T-001~005 구현·자동 검증 완료. T-006 자동·조립 검증 완료, 실제 창·공존 수용 대기.
T-007(M2)은 사용자 직접 진행 승인으로 진행해 구현·자동 회귀·실제 child 수용을 완료했다.
M1 최종 수용과 M2 수동 UI·제품 공존 수용은 대기 상태를 유지한다.
M3·실제 OAuth·공개 배포는 후속 미구현 범위다.
기술 기준은 [기술 설계](TECH_SPEC.md), 근거는 [조사](RESEARCH.md)와 [코드맵](CODEMAP.md)을 따른다.
세부 담당·진행 상태는 [작업표](AGENT_TASKS.md)와 [상태표](TASK_STATUS.md)에서 관리한다.

## 목표와 전제

실제 계정·CLI 없이 반복하는 M1 UI 테스트 앱에 승인된 M2 실제 Engine 조립과 별도 CLI 수용을 추가했다.
세 단계는 독립된 검증 등급이다. UI 성공을 실제 설치·권한·실행 성공으로 해석하지 않는다.
기존 Swift target과 소스를 유지하며 컴파일 시 고정한 production/test 프로필을 사용한다.
같은 파일의 복수 target 등록, 소스 전체 복사, 제품 앱의 테스트 환경변수 스위치는 사용하지 않는다.
설치 제품·사용자 세션·운영 DB·Keychain·기존 CLI 설정은 변경하지 않는다.
M2는 해당 run의 test freshness Keychain account만 사용할 수 있다.

## 단계와 의존 관계

```text
T-001 → T-002 → T-003 → T-004 → T-005 → T-006 [M1 게이트]
T-006 → T-007 [M2 게이트]
T-007 → T-008 [Codex] ─┐
      └→ T-009 [Claude] ┴→ T-011 [M3 게이트]
T-006 → T-010 [OAuth·telemetry, 선택 후속]
T-006 / T-007 / T-011 → T-012 [향후 배포 검증]
```

기존 의존 관계에서 T-006의 수동 수용은 아직 남아 있다. 사용자가 M2 착수를 직접 승인했으므로
T-007은 별도로 진행하되 T-006 완료나 M1 최종 수용을 소급해 표시하지 않는다.
M1이 사용 가능해지면 M2·M3를 기다리지 않고 온보딩·연결 UI 검사를 반복한다.
역할·파일 소유권은 작업표에서 나누며, 이 계획은 단계와 완료 조건만 정의한다.

## M1: 부수 효과 없는 UI 반복

### T-001: 테스트 구성과 격리 계약

구현·자동 검증 완료: `BLABEE_TEST_APP`과 `BlabeeProductProfile.current`로 프로필을 고정한다.
`main.swift`의 조기 분기와 `BlabeeTestLaunchPolicy`가 제품 명령·운영 초기화를 막는다.
기존 target을 프로필별로 컴파일하고 앱·helper의 프로필 불일치를 거절하도록 설계한다.
검증: 알 수 없는 프로필·제품 경로의 test 지정·런타임 전환·혼합 helper는 초기화 실패.

### T-002: 컴파일 프로필과 패키징 차단

구현·자동 검증 완료: `scripts/build-test-app.mjs`, `Package.swift`, `package.json`을 연결했다.
동일 target을 Test compile profile, 별도 scratch/output, 별도 bundle ID로 조립한다.
제품 release에는 test 메타데이터·대역·시나리오가 섞이면 실패하도록 검사한다.
자동 업데이트·로그인 항목·전역 단축키·운영 telemetry를 기본 비활성으로 고정한다.
검증: 프로필별 manifest·출력·설정 경계와 제품 덮어쓰기 방지. 실제 설치는 후속 범위.

### T-003: 시뮬레이션 조립과 run 저장

구현·자동 검증 완료: `BlabeeTestComposition`과 `BlabeeTestRunStore`로 공통 UI에 모의 의존성을 주입한다.
제품 초기화 전에 분기하고 실제 Engine·네트워크·Keychain port를 생성하지 않는다.
기본 root는 사용자 Application Support의 `Blabee Test`이며 `runs/<runUUID>`에 상태를 저장한다.
M1은 socket을 열지 않는다. 103-byte 예산을 검사하는 경로 계산 함수만 후속 용도로 제공한다.
검증: 금지 port 호출, traversal·symlink·marker 불일치·긴 경로·run 충돌 시 실패.

### T-004: 시나리오와 반복 UI

구현·자동 검증 완료: `BlabeeTestScenario`의 9개 preset과 `BlabeeTestWorkspaceView`를 구현했다.
첫 설치, 미설치, Plugin 준비, Hook 대기, 실패·복구, 완료, 늦은 응답, 로그인 취소·실패를 제공한다.
실제 설치 상태가 fixture를 덮어쓰지 않게 하고 `TEST`와 검증 등급을 계속 표시한다.
시나리오 변경은 T-005의 초기화 경로로 새 run을 만들며 기존 run의 fixture만 바꾸지 않는다.
검증: 같은 preset에서 동일 결과·버튼 흐름을 재현하고 영어·한국어 작은 창을 확인.

### T-005: reset 수명과 원자적 공개

구현·자동 검증 완료: `BlabeeTestWorkspaceController`가 run·composition·파일 lease·generation을 관리한다.
`온보딩 다시 보기`와 새 run을 만드는 `새 테스트 시작`을 분리한다.
generation 무효화 → 소유 task 취소 → 소유 child/lease drain → 새 run publish 순서를 지킨다.
drain timeout이면 기존 run과 근거를 보존하고 이전 generation을 재활성화하지 않는다.
현재 M1은 모의 작업을 정리하며 기존·부분 생성 run 파일을 보존한다.
M2는 실제 Engine session까지 drain하며 timeout 때 child 참조·run lease를 보존하고 전환을 중단한다.
재실행 시 Resume/Create New를 명시적으로 고르며 이전 action은 자동 전송하지 않는다.
검증: 늦은 응답·중복 클릭·종료 실패·PID 재사용·부분 생성·앱 재실행 회귀 검사.

### T-006: M1 격리 회귀와 내부 bundle 수용

자동 검사·build·서명 검증은 완료했다. 실제 창 조작·메뉴바 재열기·제품 공존 수용은 대기이며 M1 최종 완료로 표시하지 않는다.
제품 앱을 건드리지 않고 preset 선택·온보딩 재진입·새 run을 반복할 수 있어야 한다.
금지 port 호출 0, 제품 경로 변경 0, 이전 run 응답의 새 화면 반영 0을 근거로 남긴다.
460×550, 좁은 창, 영어·한국어, 밝은·어두운 화면에서 현재 행동과 버튼을 확인한다.
정적 manifest → 격리 회귀 → 내부 Test bundle 조립·probe → 실제 창 조작을 나누어 수용한다.
이 단계의 완료 보고에는 실제 Plugin·Engine·OAuth 미검증을 명시한다.

## M2: 실제 Engine 검증 — 구현·자동 회귀·실제 child 수용 완료

### T-007: 실제 Engine과 run authority

착수 근거: 사용자 직접 M2 진행 승인. T-006 수동 수용은 독립적으로 대기한다.
현재 소스는 다음 순서로 조립한다. 각 단계의 자동 회귀와 실제 child CLI 수용을 완료했고 수동 UI는 별도로 남긴다.

1. **run 자원 등록:** `engineIsolation`에서 `prepareEngineStorage(for:)`로 DB·storage/continuation/selector key,
   authority·project·짧은 socket 디렉터리를 등록한다. `settings/engine-resources-v1.json`과 marker를 사용해
   M1 `manifest-v1.json`을 유지한다. 검증: symlink·권한·다른 store/run·변조 registry를 거절한다.
2. **실제 공통 Engine:** `BlabeeTestEngineCore`에서 `SQLiteJournal`·routing·operational actor를 연결한다.
   freshness는 `KeychainFreshnessAnchorStore.defaultService`와 정확한 `test-<소문자 runUUID>` account만 허용하고
   삭제를 허용하지 않는다. 검증: MAC·sequence·freshness·rollback·만료·stale revision·다른 writer·단일 claim.
3. **직접 소유 서비스:** `BlabeeTestEngineSession`과 `test-engine-service`로 owned child·UDS를 연결한다.
   authority는 전용 root와 `includesPrimaryNamespace=false`를 사용한다. 요청의 profile/store/run/launch·selector,
   직접 부모와 executable을 확인한다. 검증: 혼합 profile·다른 run·이전 launch·지연 응답·부모 소실을 거절한다.
4. **명시적 수명:** seed·claim은 사용자 제어로만 호출한다. 선택은 child 내부 fixture queue에 기록하며 같은 턴
   claim 재시도는 중복 이벤트를 만들지 않아야 한다. 재시작은 durable 이력만 보존하고 메모리 queue를 0으로 시작한다.
   검증: 다른 ref·턴·세션을 거절하고 자동 seed·claim·재전송·provider 실행을 하지 않는다.
5. **실제 자원 수용:** 새 M2 bundle의 `test-engine-check --store-root /private/tmp/blabee-test-m2-check-<소문자 UUID>`로
   새 root에서만 실제 freshness Keychain·owned child·UDS·claim·동일 턴 재시도·재시작 queue 0·drain을 확인한다.
   실제 CLI는 PASS(exit 0)했다. queue 1·claim 1·동일 턴 추가 이벤트 0·재시작 queue 0/claim 1·integrity ok·
   child 종료·provider 실행 0을 확인했다. 실패 시 운영 경로로 대체하지 않고, 종료 확인 전에는 lease를 유지한다.

M2는 Node 패키징 9개, Swift 98 tests / 7 suites, M2 bundle 조립·strict 서명·plist·profile,
실제 Keychain·owned child/UDS CLI 수용을 통과했다. 제품 identity/profile 회귀도 2 tests / 1 suite PASS다.
조건부 render 1개는 skip했으며 제품 `service` 명령·기존 root 재사용은 exit 1로 거절했다.
M1·M2 수동 UI·공존 수용은 남아 있다. 계정·OAuth·provider·shell 설정 대역은 유지하며 M3는 미구현이다.

## M3: 실제 도구 연결 — 후속 미구현

### T-008: Codex 독립 연결

Codex의 설치·검사·Hook·launcher가 같은 run의 설정 root를 사용하게 한다.
자식 환경 whitelist와 CODEX_HOME 전달을 검토하고 Plugin의 제품 경로 fallback을 차단한다.
검증: 기존 CLI 설정·Plugin·세션이 보존되고 잘못된 run/helper 연결은 거절.

### T-009: Claude 독립 연결

Claude의 설정·Plugin·Hook·임시 프로젝트·launcher를 같은 run에 바인딩한다.
공유 로그인 저장소와 자동 연결 경로를 검토하고 Test 소유 child만 관리한다.
검증: 사용자 `.zshrc`·전역 설정·기존 세션 보존, 실제 MCP/Hook의 경로·소유권 확인.

### T-010: 테스트 OAuth와 telemetry — 선택 후속

기본 모의 계정을 유지하고 실제 OAuth가 필요할 때만 전용 staging·callback을 구성한다.
계정 인증 Keychain의 전용 service·run slot은 Engine freshness account와 구별한다.
검증: 운영 endpoint 전송 0, 잘못된 callback 거절, 토큰 저장·취소·로그아웃 경계.
브라우저 로그인·외부 CLI 인증 namespace의 실제 분리는 후속 검사로 입증한다.

### T-011: 실제 연결의 혼선과 회귀

새 테스트 프로필에서 사용자가 도구 로그인을 진행하고 새 카드·ref로 검증한다.
카드 수신·선택 저장·전달·claim·실제 실행 완료의 근거를 각각 구분한다.
검증: 정상·실패·취소·만료·reset 경쟁 조건. 과거 사건의 ref 재전송과 자동 실행은 금지.
통합 수용은 두 provider를 확인한다. Blabee 실제 OAuth는 필수 선행이 아니다.

### T-012: 배포본과 VM 별도 수용

완료 단계와 별개로 DMG·서명·공증·Gatekeeper·OS 권한·업데이트를 후속 배포 관문으로 둔다.
깨끗한 VM/Mac의 검사와 실행하지 않은 항목을 구분해 기록한다.
초기화 실패 복구와 소유 run 정리 방법을 안내하되 이름/PID 기반 일괄 종료는 제공하지 않는다.
검증: M1을 실제 연결 검증으로, 개발용 Test.app을 공증 배포본으로 소개하지 않는지 검토.

## 현재 파일 소유권과 실행 경계

| 담당 | 단독 소유 경계 |
| --- | --- |
| root | `main.swift` Test 분기, `BlabeeTestApplication.swift`·`BlabeeTestComposition.swift`, 통합·검증 기록 |
| Engine·서비스 담당 | `BlabeeTestEngineCore.swift`·`BlabeeTestEngineService.swift`, 해당 Engine·서비스 회귀 |
| 프로필·패키징 담당 | `BlabeeProductProfile.swift`, `Package.swift`, `package.json`, `scripts/build-test-app.mjs`, 패키징·profile 검사 |
| run 담당 | `BlabeeTestRunStore.swift`·`BlabeeTestScenarios.swift`, store 회귀 |

M1·M2의 전용 소스 6개는 [dev/test-app/swift](../../../dev/test-app/swift)에 있고 각 파일은 Test compile 조건으로 감싼다.
`npm run build:test-app -- --build-id <ID>`의 산출물은 `build/test-app/<ID>/Blabee Test.app`이다.
이미 사용한 ID는 덮어쓰지 않는다. 앱은 산출물을 직접 열어 실행하고 reset·resume·replay는 UI에서 선택한다.
`npm run test:swift:test-app`은 [package.json](../../../package.json)의 공통 직렬 잠금과 전용 scratch를 사용하며
M1 및 Engine·EngineService·EngineStorage 이름의 필터를 포함한다.
builder는 M2 `isolated-development` metadata, `BlabeeTestSimulationOnly=false`, `BlabeeTestEngineEnabled=true`를 만들며
Test 전용 ad-hoc 서명만 수행한다. 현재 [M2 Blabee Test.app](../../../build/test-app/m2-20261019/Blabee%20Test.app)의
실제 조립·strict 서명·plist·profile 검증을 통과했다.
과거 검증 산출물은 [M1 Blabee Test.app](../../../build/test-app/m1-20261019-02/Blabee%20Test.app)이다.
M1 조립·ad-hoc strict 서명·plist와 렌더 포함 Test Swift 51개/4 suites, 제품 profile 회귀 70개/8 suites는 과거 근거다.
M1 화면 PNG 6장 시각 검토와 profile·명령 거절·product/Test 심볼 분리도 M2 결과로 재사용하지 않는다.
실제 창 조작은 native 도구 부재로 미실행이다. 시나리오 → `새 테스트 시작` 이후 마우스로 카드 선택·건너뛰기를 수용한다.
운영 앱 빌드·설치·재시작·공증·Git 쓰기·운영 자원 변경은 M1 수용에 포함하지 않는다.
M1 결과와 미실행 수동 검사는 [M1 QA 기록](QA_REPORT.md)에 있다.
M2 자동·실제 child 수용 결과는 [M2 QA 기록](M2_QA_REPORT.md)을 따른다.

## 위험과 미결정 사항

공통 코드의 제품 singleton과 hard-coded 경로를 빠뜨리는 것이 주 위험이다.
현재 M2 자동·실제 child 수용과 M1 최종 수용은 별개다. 남은 M1·M2 수동 UI·공존을 수용하고,
외부 CLI 인증 namespace는 M3에서 별도로 입증해야 한다.
M3 도구별 분리 가능 범위, 실제 OAuth와 Test.app 외부 배포 여부는 별도 확정한다.
