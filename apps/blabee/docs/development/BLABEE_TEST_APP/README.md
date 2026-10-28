# Blabee Test 앱 개발 안내

기준일: 2026-10-19 · 상태: **M2 T-007 구현·자동 회귀·실제 child 수용 완료 / 수동 UI·공존 수용 대기**.

현재 사용 중인 Blabee와 Codex·Claude 대화를 유지하면서 온보딩·연결 안내·오류 상태를
반복 검사할 수 있는 개발용 `Blabee Test.app`의 M1을 구현했다. 같은 제품 화면을 사용하고,
테스트 구성과 실행별 저장 공간을 분리한다. M1 UI 시뮬레이션에 더해 `M2 · 실제 Engine`
시나리오에서 공통 Swift Engine과 독립 SQLite·키·authority·freshness를 조립하는 소스를 추가했다.
Codex·Claude 연결과 소셜 로그인은 계속 모의 동작이며 M3는 미구현이다.

## 먼저 읽을 문서

| 문서 | 용도 |
| --- | --- |
| [기술 설계](TECH_SPEC.md) | 프로필·조립·저장 공간·시나리오·초기화 계약 |
| [구현 계획](IMPLEMENTATION_PLAN.md) | 단계별 구현 순서와 검증 조건 |
| [작업 목록](AGENT_TASKS.md) | T-001부터 T-012까지 담당 범위·의존성·완료 조건 |
| [작업 상태](TASK_STATUS.md) | 문서 준비와 실제 구현·검증 상태의 구분 |
| [코드 지도](CODEMAP.md) | 현재 실행 경로·고정 경로·재사용 가능한 인터페이스 |
| [조사와 결정](RESEARCH.md) | 기존 코드와 공식 문서에서 확인한 제약 |
| [M1 QA 기록](QA_REPORT.md) | 기존 M1 자동 검사·내부 bundle 결과와 남은 수동 수용 |
| [M2 QA 기록](M2_QA_REPORT.md) | Swift·bundle·실제 Keychain·owned child 수용 결과와 한계 |

개발자는 기술 설계 → 코드 지도 → 구현 계획 → 작업 목록 순서로 읽는다.
현재 **M2, T-007의 구현·자동 회귀·실제 child 수용을 완료**했다. 사용자가 M2 진행을 직접 승인해
M1 수동 수용과 별도로 진행했다. M1 최종 수용과 M2 실제 창 조작·제품 공존 수용은 계속 대기다.
실제 Keychain·child CLI 수용을 실제 UI 클릭이나 Codex·Claude 연결 성공으로 해석하지 않는다.

## 빌드와 실행

현재 검증 앱은 [M2 Blabee Test.app](../../../build/test-app/m2-20261019/Blabee%20Test.app)이다.
M1 UI 시뮬레이션과 M2 실제 Engine 시나리오를 제공한다. 저장소 루트에서 연다.

```sh
open "build/test-app/m2-20261019/Blabee Test.app"
```

새 빌드는 `npm run build:test-app -- --build-id <ID>`로 만든다. `<ID>`는 새로운 짧은 식별자로 바꾼다.
산출물은 `build/test-app/<ID>/Blabee Test.app`이다. 기존 ID의 출력 폴더를 덮어쓰지 않으므로
다시 빌드할 때는 다른 ID를 쓴다. `/Applications/Blabee.app`에 복사하거나 운영 앱을 종료할 필요가 없다.
macOS와 Xcode가 필요하며, builder는 전용 scratch에서 컴파일한 뒤 로컬 개발용 ad-hoc 서명을 한다.
M2 builder는 `M2`·`isolated-development`·`BlabeeTestSimulationOnly=false`·
`BlabeeTestEngineEnabled=true` metadata를 만든다. `m2-20261019`의 실제 조립·ad-hoc strict 서명·plist 검증과
`blabee-test` / `com.biadone.blabee.test` profile 확인을 통과했다.
Test 빌드는 로컬 ad-hoc 서명만 사용하며 공증 DMG나 일반 사용자 배포본은 아니다.

Test Swift 회귀 명령은 `npm run test:swift:test-app`이다. 공통 직렬 실행 잠금과 전용 scratch를 유지하며
기존 M1 검사와 Engine·EngineService·EngineStorage 이름의 검사를 필터에 포함한다.
M2 Swift 실행기는 98 tests / 7 suites PASS를 보고했다. 이번에는 `BLABEE_TEST_APP_RENDERS=0`으로
조건부 화면 render 1개를 건너뛰었다. M1 당시의 렌더 결과를 M2 화면 검증으로 재사용하지 않는다.

M2의 실제 freshness Keychain과 직접 소유 child 수용용 Test 전용 CLI도 PASS(exit 0)했다.
다음 명령으로 새 임시 root에서 다시 확인할 수 있다.

```sh
"build/test-app/m2-20261019/Blabee Test.app/Contents/MacOS/blabee-coordinator" test-engine-check --store-root "/private/tmp/blabee-test-m2-check-<lowercase-UUID>"
```

`<lowercase-UUID>`는 매번 새 소문자 UUID로 바꾼다. 이 CLI는 정확한
`/private/tmp/blabee-test-m2-check-<소문자 UUID>`의 새 root만 허용하고 기존 root를 채택하지 않는다.
그 아래 `test-store`에서 run을 만들며 운영 경로·기존 run·운영 Keychain 항목은 검사 대상이 아니다.
테스트 freshness 항목과 검증 파일은 보존하며 자동 삭제하지 않는다.
검증에서는 queue 1 → claim 1, 같은 턴 재시도의 추가 이벤트 0, 재시작 queue 0·claim 1,
integrity `ok`, child 종료, provider 실행 0을 확인했다. 실패 시 child 종료를 확인하기 전에는 lease를
풀지 않으며 `cleanup_pending`을 보고하고 소유권을 유지한다.

## 사용자가 반복 검사하는 흐름

1. 제품 앱과 구분되는 이름·아이콘·`Blabee TEST` 메뉴바 표시의 `Blabee Test.app`을 연다.
2. `처음 설치`, `Codex 미설치`, `Hook 승인 대기`, `연결 실패` 등의 시나리오를 고른다.
3. **`새 테스트 시작`**을 누른 뒤 제품과 같은 화면에서 선택·안내·재시도·완료 조건을 확인한다.
4. 온보딩·연결·카드·설정 탭을 선택한다. 지연 시나리오에서는 `지연 응답 보내기`로 응답을 풀 수 있다.
5. `결과 저장`으로 현재 run의 `results/m1-report.json`에 로컬 시뮬레이션 기록을 남긴다.

M2 시나리오를 선택해 새 run을 만들면 `TEST · 실제 Engine`을 표시한다. `테스트 카드 만들기`로
빈 journal에 명시적으로 seed한 뒤 공통 카드 UI에서 선택한다. 선택은 Test child 내부 fixture queue에만
기록된다. `Claim 검증·재시도`는 실제 공통 claim 경로와 같은 delivery turn 재시도를 호출한다.
`Engine 확인`과 `결과 저장`은 각각 현재 보고서를 조회하고 `results/m2-report.json`에 저장한다.
queue 접수·durable claim은 Codex·Claude 작업 실행이나 실제 완료의 증거가 아니다.

Test 전역 단축키는 등록하지 않는다. 카드 표식이 `Unavailable / 사용 불가`로 나올 수 있으며,
카드 선택과 건너뛰기는 마우스로 검사한다.

`새 테스트 시작`은 선택한 시나리오로 새 run을 만든다. picker 변경만으로 현재 run을 바꾸지 않는다.
기존 run 파일은 보존하며, 재실행 시 저장된 실행을 직접 고른 뒤 `선택한 테스트 이어보기`를 누른다.
이어보기는 저장된 모의 온보딩·프로젝트·Plugin 설정을 복원하고 계정·응답 객체는 시나리오로 재구성한다.
실제 인증정보나 과거 작업을 복원·재전송하지 않는다. M2 이어보기는 실제 journal을 다시 열지만
초기화·재시작 때 seed·claim을 호출하거나 메모리 fixture queue를 복원하지 않는다.

`온보딩 다시 보기`는 같은 run의 화면 진행만 되돌리고 현재 모의 계정·연결 객체를 유지한다.
모의 로그인 취소·실패를 처음부터 재현하려면 새 테스트를 만든다. 실제 OAuth·브라우저·운영 인증정보는
이 기능의 대상이 아니며 T-010에서 별도로 검사한다.

기본 데이터 root는 `~/Library/Application Support/Blabee Test`이고 각 실행은 `runs/<runUUID>`에 저장된다.
운영 Blabee 데이터 폴더와 분리되며, 현재 UI는 기존 run의 일괄 삭제 기능을 제공하지 않는다.

## 단계와 증거 수준

| 단계 | 제공하는 검사 | 이 결과가 증명하지 않는 것 |
| --- | --- | --- |
| M1 화면 시뮬레이션 | 공통 UI에 모의 계정·연결 상태·카드·지연을 주입 | 실제 로그인, Plugin 설치, Engine 무결성, 도구의 작업 실행 |
| M2 격리 Engine | 실제 공통 Engine과 실행별 DB·키·권한 저장소의 검증 | 실제 제공자 로그인·Plugin·Hook·MCP 동작 |
| M3 실제 제공자 연결 | 테스트 전용 설정·작업 폴더·launcher로 Codex·Claude 왕복 검사 | 새 OS, 모든 설치 방식, 공개 배포본의 설치·업데이트 |
| 배포본 수용 | 실제 서명된 DMG·권한·설치·업데이트 확인 | 다른 환경 전체의 호환성 |

실제 소셜 로그인 검사는 T-010의 후속 범위다. M1은 운영 Supabase, Keychain,
실제 Engine 서비스, native Codex·Claude 프로세스를 만들지 않는다. M2는 명시적으로 선택한
run의 실제 Engine child와 freshness Keychain 항목만 사용한다. M3는 해당
제공자의 실제 인증 저장소 분리를 확인한 뒤에만 실행할 수 있다.

## 구현 원칙

- **공통 소스 유지:** 기존 Swift 모듈과 UI·Engine을 사용한다. 같은 파일을 두 target에
  중복 등록하지 않고, 기존 target을 별도 컴파일 프로필·scratch·출력으로 빌드한다.
- **빌드 때 프로필 고정:** 제품 앱의 환경변수나 실행 인자로 가짜 로그인·테스트 권한을
  켤 수 없게 한다. 제품 식별자와 계약·저장 schema의 기본값은 유지한다.
- **구성부터 분리:** 프로필·run 검증을 마치기 전에 `.live()` 계정·서비스·저장소를
  생성하지 않는다. 설정이 부족하면 중단하며 운영 경로로 대체하지 않는다.
- **실행별 상태:** 시나리오 선택과 초기화는 새로운 run identity와 수명 토큰을 사용한다.
  이전 run의 응답·타이머·선택 권한을 새 화면으로 옮기지 않는다.
- **초기화 소유권 확인:** 해당 run의 task·child·lease만 종료·정리한다. 시간 내에 정리하지
  못하면 새 실행을 활성화하지 않고 기존 자원과 진단을 남긴다.
- **권한 검증 유지:** M2의 MAC·freshness·단일 claim·만료·정확한 세션 바인딩을 유지한다.
  freshness service는 `KeychainFreshnessAnchorStore.defaultService`를 유지하고 account는 정확히
  `test-<runUUID의 소문자 표기>`를 사용한다. `allowsTestDeletion=false`이며
  운영 `primary`·제품 로그인 항목으로 대체하지 않는다. M1은 Keychain 호출 자체가 없다.
- **제품 외부 동작 차단:** M1/M2의 실제 셸 수정, 운영 업데이트, 로그인 항목 등록,
  전역 단축키 등록, 운영 통계·오류·피드백 전송은 기본 차단한다.

테스트 앱은 같은 macOS 사용자 아래에서 동작하는 개발 도구다. 별도 앱 이름과 데이터
경로는 VM 수준의 OS 격리를 제공하지 않는다. 브라우저 로그인 상태와 OS 권한도 별도다.

## 현재 소스의 M1과 M2

M1은 테스트 전용 프로필과 조립, 시나리오 선택기, 공통 온보딩·연결·카드·설정 화면,
새 run·이어보기·화면 재진입과 로컬 결과 기록을 제공한다. 성공·실패·지연·취소·늦은 응답을 재현한다.
연결 완료처럼 보이는 화면에도 **시뮬레이션** 표시를 유지한다.
모의 transport와 상태 확인 타이머는 사용하며, 실제 서비스·네트워크 polling은 하지 않는다.

M2는 `BlabeeTestEngineCore`에서 `SQLiteJournal`·`CoordinatorRoutingApplication`·
`CoordinatorOperationalApplication`을 그대로 조립한다. Test가 직접 시작한 child와 UDS만 사용하며
profile/store/run/launch와 selector credential이 일치해야 요청을 전달한다. authority는 run 전용 root와
`includesPrimaryNamespace=false`를 사용한다. drain 실패 시 child·lease·run 근거를 보존하고 전환을 중단한다.
DB·키·authority 경로는 `settings/engine-resources-v1.json`에 등록해 M1 manifest v1을 유지한다.

추가 production 의존성, Engine 복제, 실제 제공자 설치 자동화, 운영 DB 마이그레이션,
실제 계정 중지·복원, Test.app 자동 업데이트 채널은 M1에 포함하지 않는다.

## 현재 코드에서 조심할 지점

`HOME`이나 임시 DB 경로만 바꾸면 FileManager의 사용자 경로, authority root,
freshness lock까지 분리되지 않는다. Codex 실행 환경 필터·Plugin launcher,
Claude 셸 설정, 메인 폴더 밖의 통계·진단 outbox, 설치·업데이트 목적지도 제품에
연결되어 있다. 개별 위치와 구현 시 확인할 심볼은 [코드 지도](CODEMAP.md)를 따른다.

## 작업과 검증 기록

문서·소스·검증 진행 상태는 [작업 상태](TASK_STATUS.md)를 따른다.
과거 M1 결과는 [M1 QA 기록](QA_REPORT.md), 현재 결과는 [M2 QA 기록](M2_QA_REPORT.md)에 있다.
문서 검사, 자동 회귀, Test.app 빌드, 서명, 설치, 실제 세션 왕복은 각각 별도 결과다.
기존 연결 UI의 자동 검사 통과 기록은 Test.app의 구현·격리 증거로 재사용하지 않는다.
현재 M2는 Node 패키징 9개, Swift 98 tests / 7 suites, 실제 bundle 조립·strict 서명·plist·profile,
실제 freshness Keychain·owned child/UDS CLI 수용을 통과했다. 제품 identity/profile 회귀도 2 tests / 1 suite PASS다.
조건부 render 1개는 skip했으며 실제 사용자가 M2 화면을 조작한 결과는 아직 없다.
제품 `service` 명령과 기존 수용 root 재사용은 exit 1로 거절했다. 제품의 stateless profile은
`blabee` / `com.biadone.blabee`이며 Test 심볼 검색 결과는 Test 82행·제품 0행이다.
과거 M1은 렌더 포함 Test Swift 51개/4 suites, 제품 profile 회귀 70개/8 suites를 통과했다.
M1 내부 앱 조립·strict 서명·plist·profile·심볼 분리와 PNG 6장 시각 검토 기록도 과거 근거다.
과거 [M1 bundle](../../../build/test-app/m1-20261019-02/Blabee%20Test.app)에는 M2가 없다.
실제 창 클릭·메뉴바 재열기·제품 앱과의 동시 실행은 미실행이며 M1·M2 수동 수용은 계속 대기다.
이는 설치 제품·운영 계정·운영 DB/Keychain의 실사용 검사나 OS 수준 격리·네트워크 계측 결과가 아니다.

관련 지침: [프로젝트 AGENTS](../../../AGENTS.md),
[디렉터리 책임과 target 보존](../DIRECTORY_MIGRATION.md),
[첫 실행 온보딩](../../features/FIRST_RUN_ONBOARDING.md),
[CI와 배포 검증 단계](../CI_CD_DESIGN.md).
