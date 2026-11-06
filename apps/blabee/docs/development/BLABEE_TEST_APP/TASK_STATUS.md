# Blabee Test.app 작업 상태

기준일: 2026-10-19. 전체 상태: **M2 T-007 구현·자동 회귀·실제 child 수용 완료 / 수동 UI·공존 수용 대기**.
문서 작성과 정적 확인은 실제 기능 구현·격리 검증·설치 수용과 별도로 기록한다.

## 현재 확인된 범위

- T-001~005의 구현·자동 검증과 T-006의 자동·조립 검증을 완료했다. M1 실제 창·공존 수용과 최종 수용은 대기다.
- 사용자 직접 M2 진행 승인으로 T-007을 진행해 구현·자동 회귀·실제 child 수용을 완료했다. M3·실제 OAuth는 미구현이다.
- `dev/test-app/swift`는 현재 6개 파일이다. M2 EngineCore·EngineService와 `engineIsolation` 시나리오를 추가하고 Test builder metadata·Swift 필터를 갱신했다.
- 기본 root는 사용자 Application Support의 `Blabee Test`이며 새 run·명시적 이어보기·화면 재생을 구분한다.
- M2는 실제 공통 Swift Engine·SQLite·키와 별도 authority를 조립하고 정확한 run freshness account를 사용한다. `settings/engine-resources-v1.json`으로 기존 manifest v1을 유지한다.
- Test owned child·UDS는 profile/store/run/launch·selector를 검증한다. 직접 child drain 실패 시 이전 자원·lease를 보존하며 자동 seed·claim·queue 재전송을 하지 않는다.
- 이전 연결 UI 회귀 검사 220개는 해당 UI 변경의 증거이며 Test.app의 구현·격리·실제 연결 증거가 아니다.
- 개발 검증과 운영 제품을 구분한다. M2는 실제 test freshness Keychain·owned child/UDS 수용 CLI를 통과했다. 기존 freshness service와 운영 `primary`·계정 항목은 변경하지 않았으며 테스트 항목·파일은 보존했다.
- M1 최종 수용과 M2 실제 창 조작·메뉴바·운영 앱 공존 수용은 대기다. 제품 identity/profile 회귀는 2 tests / 1 suite PASS다.

## 작업별 상태

| ID | 관문 | 구현 상태 | 착수 조건 / 다음 산출물 |
|---|---|---|---|
| T-001 | M1 | 구현·자동 검증 완료 | 조기 Test 분기·고정 profile·허용 자원 경계 확인 |
| T-002 | M1 | 구현·자동 검증 완료 | Node·profile·실제 Test bundle·심볼 분리 검사 통과 |
| T-003 | M1 | 구현·자동 검증 완료 | DI·run 저장소·snapshot 회귀 통과 |
| T-004 | M1 | 구현·자동 검증 완료 | 9개 preset·공통 화면 회귀·렌더 검토 완료; 클릭 수용은 T-006 |
| T-005 | M1 | 구현·자동 검증 완료 | 전환·취소·늦은 callback·이어보기·재생 회귀 통과 |
| T-006 | M1 | 자동·조립 검증 완료 / 수동 수용 대기 | 실제 창 클릭·메뉴바 재열기·제품 공존 후 최종 수용 |
| T-007 | M2 | 구현·자동 회귀·실제 child 수용 완료 | Node 9개·Swift 98/7·bundle·실제 Keychain/UDS CLI PASS; 수동 UI·공존 별도 대기 |
| T-008 | M3 | 미착수 | T-007 후 Codex 독립 config·Hook·launcher |
| T-009 | M3 | 미착수 | T-007 후 Claude 독립 config·Hook·launcher |
| T-010 | 선택 후속 | 미착수 | M1 수용·실제 OAuth 필요성 확정 후 외부 개발 구성 |
| T-011 | M3 | 미착수 | T-007과 해당 provider 연결 후 교차 회귀 |
| T-012 | 향후 release | 미착수 | 해당 기능 수용 후 VM/Mac 설치·배포 검증 |

담당 역할·소유 범위·의존 관계·완료 조건·검증·위험은 [AGENT_TASKS](AGENT_TASKS.md)를 따른다.
현재 파일 소유권은 실행 계획에 기록했다. 다른 작업자의 동일 파일을 중복 편집하지 않는다.

## 증거와 수용 상태

| 증거 종류 | 현재 상태 | 이를 통해 판단할 수 없는 항목 |
|---|---|---|
| 소스·문서 검토 | M1·M2 구현과 M3 계획의 구분 갱신 | 실행 시 운영 접근이 없다는 전체 보장 |
| M2 Node 패키징 검사 | 9개 통과 | 실제 앱 클릭·Swift compile·OS 전체 동작 |
| M2 Test Swift 통합 compile·회귀 | 98 tests / 7 suites PASS | 실제 창 조작·실제 Keychain/child 수용 자체 |
| M2 조건부 화면 render | 1개 skip; `BLABEE_TEST_APP_RENDERS=0` | M2 화면의 새 시각 검토 |
| M2 bundle 조립·strict 서명·plist·profile | `m2-20261019` PASS; `blabee-test` / `com.biadone.blabee.test` | 실제 창·공존·공증 배포 수용 |
| 현재 제품 identity/profile 회귀 | `UnifiedProductProfileTests` 2 tests / 1 suite PASS | 제품 전체 회귀·설치 앱 실사용 |
| 현재 stateless profile·명령 거절·심볼 분리 | 제품 `blabee` / `com.biadone.blabee`; Test의 service 명령·기존 root 재사용 exit 1; `nm` 검색 Test 82행·제품 0행 | 실제 창·운영 앱 세션·OS 전체 API 추적 |
| 과거 M1 Test Swift 회귀 | 51개 / 4 suites 통과; 렌더 포함 | 현재 M2 코드·실제 창·외부 연결 수용 |
| 과거 M1 제품 profile 회귀 | 70개 / 8 suites 통과 | 현재 M2 변경 회귀·설치 운영 앱 실사용 성공 |
| 과거 M1 PNG 화면 | 6장 생성·직접 시각 검토 | 현재 M2 화면·실제 창 클릭·메뉴바 수명 |
| 과거 M1 내부 Test.app 조립·strict 서명·plist | 통과 | M2 bundle·두 앱 공존·공증·최종 수동 수용 |
| 과거 M1 profile·명령 거절·심볼 분리 | Test probe·service 명령 exit 1·제품 심볼 0/Test 76 | M2 심볼 수·OS sandbox·전체 API 추적 |
| M1·M2 수동 화면·공존 수용 | 대기 | 실제 사용자가 화면을 확인했다는 근거 |
| M2 실제 freshness Keychain·owned child CLI 수용 | PASS(exit 0); queue 1·claim 1·동일 턴 추가 이벤트 0·재시작 queue 0/claim 1·integrity ok·child 종료 | 실제 provider 실행·OAuth·OS 전체 API 무접근 |
| 저장된 M2 report payload | eventCount/journalSequence 8/8; integrity·quick check ok; sidecar 2개; queue 0·durable queued 0·claim 1·provider 실행 0 | 실제 provider 작업 완료 |
| 실제 Codex/Claude 연결 | 미실행 | plugin·Hook·MCP·세션 전달 성공 |
| OAuth·원격 telemetry 검사 | 미실행; 기본 외부 연결 없음 | 브라우저·원격 계정까지의 분리 |
| 제품 DMG·공증·VM 설치 | 이번 범위 밖 | 새 Mac 설치·OS 권한·업데이트 성공 |

## 실행 명령과 기록

- 현재 산출물: [M2 Blabee Test.app](../../../build/test-app/m2-20261019/Blabee%20Test.app). 새 빌드는 `npm run build:test-app -- --build-id <ID>`로 만든다.
- M2 실행 파일 SHA-256: `432bf864920681115077fc2d2f67c310f24901653d389eeca3ec1e3ddef2d238`.
- 과거 [M1 산출물](../../../build/test-app/m1-20261019-02/Blabee%20Test.app)은 M2를 포함하지 않는다.
- Swift: `npm run test:swift:test-app`; 공통 직렬 잠금·전용 scratch와 M1·Engine 관련 필터를 사용한다. `BLABEE_TEST_APP_RENDERS=1` 렌더 통과 기록은 과거 M1 결과다.
- Node: `node --test Tests/AppPackaging/test-app-profile.test.mjs`.
- Test 전용 live check: M2 bundle의 `test-engine-check --store-root /private/tmp/blabee-test-m2-check-<소문자 UUID>` PASS. 정확한 새 root만 허용하며 내부 `test-store`·run을 생성한다. 재검사 때는 새로운 UUID가 필요하다.
- 실제 수용 root: `/private/tmp/blabee-test-m2-check-90b5bd92-df2b-4cf0-b5cb-973fb6027007`; run: `8293d06a-10da-4364-8988-14f8c38fe03f`; freshness account: `test-8293d06a-10da-4364-8988-14f8c38fe03f`. 테스트 Keychain 항목·파일은 보존했다.
- 실행 로그: Swift `/private/tmp/blabee-test-app-m2-swift-5.log`, 실제 수용 `/private/tmp/blabee-test-app-m2-live-check-1.log`.
- 제품 profile 로그: `/private/tmp/blabee-test-app-m2-production-profile.log`; bundle·거절·보존 근거: `/private/tmp/blabee-test-app-m2-bundle-check.json`.
- builder metadata: `M2`, `isolated-development`, `BlabeeTestSimulationOnly=false`, `BlabeeTestEngineEnabled=true`; 로컬 ad-hoc 서명만 사용한다.
- M1 native 조작은 `orca` 명령 부재로 미실행이다. 자동·조립 통과를 M1 최종 수용과 합치지 않으며 근거는 [M1 QA 기록](QA_REPORT.md)을 따른다.
- M2 결과와 검증 경계는 [M2 QA 기록](M2_QA_REPORT.md)을 따른다. 현재 자동·빌드·실제 child CLI 검증은 완료했다.

## 다음 진행 순서

1. 현재 M2 앱에서 카드 생성·선택·claim·언어·작은 창·메뉴바 재열기·제품 앱 공존을 수동 수용한다. 조건부 화면 render도 이번에는 미실행임을 유지한다.
2. 별도로 M1의 새 run·이어보기·재생·늦은 응답·온보딩 수동 수용을 마친 뒤 T-006 최종 완료 여부를 결정한다.
3. M3 실제 도구 연결과 실제 OAuth 필요성을 별도로 검토한다. T-007 완료만으로 실제 provider 검증을 완료했다고 표시하지 않는다.

## 계속 추적할 위험

- HOME·DB 경로만 바꾸는 격리는 부족하다. 고정 authority·freshness·서비스 경로와 runner 필터를 확인해야 한다.
- M1은 Keychain 호출 0, M2는 `defaultService`와 정확한 `test-<소문자 runUUID>` account만 허용하며 삭제를 허용하지 않는다. 운영 `primary`·계정 항목에 접근하지 않는다.
- reset은 Test가 소유한 run·작업만 대상으로 하며, 기존 운영 계정·프로세스·세션을 정리해서는 안 된다.
- 가짜 계정·합성 성공은 명시적으로 표시한다. 네트워크 0인 M1에 실제 OAuth나 모델 호출을 섞지 않는다.
- Test 자동 업데이트·로그인 시 실행·전역 단축키·운영 telemetry는 M1부터 차단한다. 공유 callback·shell 설정도 운영 앱과 분리한다.
- 계획 문서의 정적 링크·ID 확인과 이후 실제 컴파일·실행·설치 결과를 같은 통과로 기록하지 않는다.
