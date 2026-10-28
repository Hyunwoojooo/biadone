# Blabee Test.app 작업 분담

문서 기준일: 2026-10-19. 상태는 **M2 T-007 구현·자동 회귀·실제 child 수용 완료 / 수동 UI·공존 수용 대기**다.
T-001~005는 구현·자동 검증 완료다. T-006은 자동·조립 완료, 실제 창·공존 수용 대기를 유지한다.
사용자가 M2 진행을 직접 승인해 T-007을 완료했으며 T-008 이후는 미구현이다. M2 실제 창 수용은 별도로 남아 있다.
설계의 근거와 고정 경로는 [CODEMAP](CODEMAP.md), 격리 계약은 [TECH_SPEC](TECH_SPEC.md), 실행 순서는 [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md)을 따른다.

## 공통 작업 규칙

- M1(T-001~006)은 네트워크·모델 호출·실제 CLI 실행 없이 온보딩과 오류 화면을 반복하는 권장 MVP다.
- M2(T-007)는 실제 Engine과 테스트 전용 authority 검증, M3(T-008·009·011)는 실제 도구 연결 격리다.
- T-010은 실제 OAuth가 필요할 때 진행하는 선택 후속이며, T-012는 향후 배포 검증의 별도 관문이다.
- 운영 기본 bundle ID·DB·서비스·Keychain·계약은 바꾸지 않는다. Test 구성만 격리하며 freshness Keychain service는 기존 고정값을 보존한다.
- M1은 Keychain 호출 0이다. M2는 `KeychainFreshnessAnchorStore.defaultService`와 정확한 `test-<소문자 runUUID>` account를 사용하며 운영 `primary`·운영 계정 항목 접근을 금지한다. Test factory의 삭제 허용값은 false다.
- Swift 파일은 정확히 한 target에만 등록한다. 기존 target을 별도 compile profile·scratch로 빌드하며 모듈 분리·중복 sources 등록을 섞지 않는다.
- 작업자는 다른 변경을 보존한다. 각 작업 착수 시 실제 파일 소유권을 확정하고 동일 파일의 동시 편집을 피한다.
- `.live()`의 조기 생성, 운영 경로 fallback, 기존 세션 탐색을 격리 수단으로 사용하지 않는다.
- 개발 검증은 Test 산출물·소유 run·격리 대역과 M2 test freshness 항목에 한정한다. 운영 앱·설정·DB·Keychain·세션·Git 이력은 변경하지 않는다.

## 작업 목록

### T-001 테스트 구성과 격리 계약
- 담당/범위: 앱 통합·프로필·run 담당; 컴파일 모드, namespace, 소유권 계약과 조기 조립 진입점.
- 선행/관문: 없음 / M1. `BlabeeProductProfile`·launch policy·run manifest 구현·자동 검증을 완료했다.
- 완료 조건: UI 시뮬레이션·실제 Engine·실제 연결의 권한과 허용 자원을 구분하고, 미지정 경로를 거절한다.
- 검증: 경로·서비스·기본값·인증·네트워크 의존성 표를 소스와 대조하고 QA가 누락을 검토한다.
- 위험: HOME 변경만 믿으면 고정 Application Support·authority·freshness 경로를 통해 운영 자원에 접근할 수 있다.

### T-002 컴파일 profile과 패키징 차단
- 담당/범위: 패키징 담당; `BlabeeProductProfile.swift`·`Package.swift`·`package.json`·Test builder·profile 검사 단독 소유.
- 선행/관문: T-001 / M1. 구현·자동 검증·내부 bundle 조립을 완료했고 운영 제품 식별자는 유지했다.
- 완료 조건: Test 이름·아이콘·ID가 구분되고, 운영 빌드에는 시나리오·가짜 인증·테스트 우회가 포함되지 않는다. Test의 자동 업데이트·로그인 시 실행·전역 단축키·운영 telemetry는 차단한다.
- 검증: Node 패키징·Swift profile 검사와 별도 bundle 조립을 나눠 확인하며 최신 결과는 QA 기록을 따른다.
- 위험: 런타임 환경변수 하나로 운영 앱에 테스트 모드를 열거나 Test updater가 운영 앱을 교체할 수 있다.

### T-003 시뮬레이션 조립과 run 저장
- 담당/범위: 앱 통합 담당의 `BlabeeTestComposition.swift`, run 담당의 `BlabeeTestRunStore.swift`와 해당 회귀.
- 선행/관문: T-001, T-002 / M1. 구현·자동 검증 완료이며 실제 Engine authority와 CLI는 생성하지 않는다.
- 완료 조건: 매 run이 빈 독립 저장소를 가지며 가짜 로그인·합성 카드·가짜 연결만 사용한다.
- 검증: 예상 밖 네트워크·프로세스·운영 저장소 factory 호출이 실패하는 격리 테스트를 작성한다.
- 위험: 기본 인자·singleton·초기화 부수 효과로 `.live()`가 먼저 생성되거나 운영 telemetry가 연결될 수 있다.

### T-004 시나리오와 반복 UI
- 담당/범위: 앱 통합 담당의 `BlabeeTestApplication.swift`·공통 UI DI seam, run 담당의 `BlabeeTestScenarios.swift`.
- 선행/관문: T-003 / M1. 9개 preset·공통 화면의 구현·자동 검증·렌더 검토 완료; 실제 클릭은 T-006 대기다.
- 완료 조건: 첫 실행·로그인 실패·도구 미설치·Hook 대기/완료·연결 실패·지연을 재로그인 없이 재현한다. 시나리오 변경은 T-005의 초기화 절차로 새 run을 만든다.
- 검증: 영어·한국어, 좁은 창, 키보드 경로에서 현재 시나리오와 다음 행동이 구분되는지 확인한다.
- 위험: 합성 성공을 실제 신뢰·전달·실행 성공처럼 표시하면 잘못된 수용 판단을 유도한다.

### T-005 reset 수명과 원자적 공개
- 담당/범위: 앱 통합 담당의 workspace 전환·generation, run 담당의 manifest·파일 lease·snapshot 검증.
- 선행/관문: T-003, T-004 / M1. 구현·자동 검증 완료이며 새 run은 기존 파일을 삭제하지 않는다.
- 완료 조건: 새 run 준비 후 한 번에 전환하고, 이전 callback·작업·소켓이 새 run을 덮어쓰지 않는다. M2에서는 DB·key·account·lease scope를 함께 회전한다.
- 검증: reset 연타·진행 중 취소·준비 실패·지연 응답·삭제 경계·symlink 이탈 거절을 검사한다.
- 위험: 전역 이름 검색·PID 추정·과도한 폴더 삭제가 운영 프로세스나 저장소에 영향을 줄 수 있다.

### T-006 M1 격리 회귀와 내부 bundle 수용
- 담당/범위: qa_reviewer + debugger; 격리 회귀, 내부 Test bundle, 수동 수용 기록.
- 선행/관문: T-001~005 / M1 종료. 자동·조립 검증 완료; 실제 창·메뉴바 재열기·제품 공존 수용은 대기다.
- 완료 조건: 운영 접근·외부 요청 0, reset 반복, 운영 앱 공존, 시나리오 표시를 확인하고 한계를 기록한다.
- 검증: 정적 검토 → 격리 회귀 → Test bundle 실행을 나누고 허용 자원 접근 기록을 남긴다.
- 위험: 기존 UI 테스트 통과나 임시 DB 지정만으로 Test.app의 격리와 실제 설치를 입증했다고 판단할 수 있다.

### T-007 실제 Engine과 run authority
- 담당/범위: implementer(Engine/서비스 조립); run별 journal·authority·freshness·lock·socket.
- 선행/관문: 원래 T-006 / M2. 사용자의 직접 진행 승인으로 착수했다. T-006 실제 창·공존 수용과 M1 최종 수용은 대기다.
- 현재 상태: `engineIsolation`·공통 Engine·owned child·자원 registry의 구현·자동 회귀·실제 child 수용 완료. Node 9개, Swift 98 tests / 7 suites, 제품 identity/profile 2 tests / 1 suite, M2 bundle·ad-hoc strict 서명·plist·profile·실제 Keychain/UDS CLI PASS. 조건부 render 1개 skip, 수동 UI·공존은 대기다.
- 완료 조건: 공통 `SQLiteJournal`·routing·operational actor가 전용 DB·storage/continuation/selector key·anchor·lease로 동작한다. freshness는 `defaultService`와 해당 run의 정확한 `test-<소문자 runUUID>` account이며 삭제를 허용하지 않는다.
- 격리 조건: `settings/engine-resources-v1.json`으로 manifest v1을 보존한다. authority는 전용 root와 `includesPrimaryNamespace=false`, UDS는 profile/store/run/launch·selector를 검증한다. 운영 `primary`·계정·authority fallback을 허용하지 않는다.
- 수명 조건: 직접 생성한 `Process`만 종료하고 drain 실패 시 child·lease·run을 보존한다. seed·claim은 명시적으로만 실행하며 동일 delivery turn 재시도는 claim을 늘리지 않아야 한다. 재시작은 durable 이력만 열고 메모리 queue를 0으로 시작한다.
- 검증: MAC·freshness·만료·외부 writer·stale revision·다른 run/turn/session·재시작·소유권 회귀를 통과했다. M2 bundle의 `test-engine-check --store-root /private/tmp/blabee-test-m2-check-<소문자 UUID>`도 새 root에서 실제 Keychain·owned child·UDS로 PASS(exit 0)했다. queue 1·claim 1·같은 턴 추가 이벤트 0·재시작 queue 0/claim 1·integrity ok·child 종료·provider 실행 0을 확인했고 test freshness 항목·파일은 보존했다.
- 제외: 계정·OAuth·provider 설정·실행은 계속 모의 동작이며 M3는 미구현이다. fixture queue·claim을 실제 provider 작업 완료로 표시하지 않는다.
- 위험: DB만 임시 경로로 바꿔도 primary freshness·Keychain·writer lock을 공유할 수 있다.

### T-008 Codex 독립 연결
- 담당/범위: implementer(Codex bridge); config·plugin·Hook·launcher와 테스트 프로젝트 경계.
- 선행/관문: T-007 / M3. CODEMAP의 native runner 환경 필터와 고정 경로를 먼저 해결한다.
- 완료 조건: Test가 직접 시작한 Codex 프로필·새 세션만 연결하고 운영 plugin 설정·기존 대화를 건드리지 않는다.
- 검증: launch 환경·config 접근·Hook ancestry·세션 바인딩을 확인하고 실제 연결 비용을 별도 기록한다.
- 위험: CODEX_HOME 전달 누락·전역 CLI fallback·공유 인증·기존 세션 resume가 격리를 무너뜨릴 수 있다.

### T-009 Claude 독립 연결
- 담당/범위: implementer(Claude bridge); config·plugin·Hook·프로젝트·launcher와 소유 프로세스.
- 선행/관문: T-007 / M3. CODEMAP의 shell 설정 변경 경로와 자동 연결을 검토한다.
- 완료 조건: Test 전용 설정·임시 프로젝트만 사용하고 사용자 zshrc·전역 설정·기존 Claude 세션을 변경하지 않는다.
- 검증: 설치·실행·종료가 테스트 자원에만 적용되는지 확인하고 실제 MCP/Hook 증거를 남긴다.
- 위험: shell 보조 설정·프로젝트 자동 탐색·공유 로그인 저장소가 운영 환경에 영향을 줄 수 있다.

### T-010 테스트 OAuth와 telemetry
- 담당/범위: implementer(계정/원격 연결); 가짜 계정 기본값, 선택적 개발 OAuth·진단 endpoint.
- 선행/관문: T-006 및 실제 OAuth 필요성 확정 / 선택 후속. M1·M2·M3의 기본 요구가 아니다.
- 완료 조건: 외부 연결은 별도 원격 구성·callback·테스트 계정으로 제한하고 운영 telemetry 전송은 차단한다.
- 검증: 브라우저 세션 재사용·토큰 저장·로그아웃·취소·리다이렉트와 endpoint 누락 시 거절을 검사한다.
- 위험: 테스트 전용 Keychain 항목만으로 브라우저 쿠키·원격 계정·운영 사용자 제한과 통계까지 분리되지는 않는다.

### T-011 실제 연결의 혼선과 회귀
- 담당/범위: qa_reviewer + debugger; provider별 전달·claim·만료·재시도·reset 교차 검사.
- 선행/관문: T-007 및 해당 provider의 T-008/T-009 / M3. 통합 수용은 두 provider를 모두 확인한다.
- 완료 조건: 같은 턴 재시도만 복구하고 다른 run·턴·세션 재사용을 거절하며 자동 재전송·실행을 하지 않는다.
- 검증: 운영 앱과 공존, 늦은 응답, 만료, 단일 claim, 연결 중 reset을 단계별 증거로 확인한다.
- 위험: 카드 도착·queue 전달·durable claim·실제 작업 완료를 같은 성공으로 합칠 수 있다.

### T-012 배포본과 VM 별도 수용
- 담당/범위: qa_reviewer + git_steward; 향후 배포 검사, 한계·정리 절차·사용 안내.
- 선행/관문: 해당 기능의 M1/M2/M3 수용 / 향후 release 관문. 공개 배포는 별도 요청이 필요하다.
- 완료 조건: Test.app 증거와 DMG·서명·공증·Gatekeeper·OS·업데이트 검사를 구분하고 남은 항목을 표시한다.
- 검증: 깨끗한 VM/Mac의 최소 설치·업데이트 검사와 테스트 자원만 정리하는 절차를 확인한다.
- 위험: Test.app 통과를 새 Mac 설치나 권한 요청·공증·구버전 업데이트의 대체 증거로 사용할 수 있다.

## 완료 보고

각 담당자는 변경 경로, 정적 검사, 실행한 회귀, 실행하지 않은 검사, 운영 접근 여부를 구분한다.
구현·수용 상태는 [TASK_STATUS](TASK_STATUS.md), 검사·bundle·미실행 수동 항목은 [QA 기록](QA_REPORT.md)에서 관리한다.
M2 결과는 [M2 QA 기록](M2_QA_REPORT.md)에 구분한다. M1 51개/4 suites·제품 profile 70개/8 suites는 과거 검증이며 M2 통과 수가 아니다.
