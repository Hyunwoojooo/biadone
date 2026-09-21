# 제품 연결 작업 상태

기준일: 2026-09-21. **CP-00~CP-06 완료, CP-07 runtime·업데이트 보호 검증 완료. CP-08 통합 앱/DMG에 일반 `claude`·`claude --resume` 자동 연결을 추가했다.** 앱과 DMG는 하나이며 브릿지 버전·세션을 내부에서 구분한다. 사용자가 r62 설치 완료를 보고했고, 현재 설치 build 62에는 자동 연결 기능이 없다. r63 자동 연결 구현·격리 회귀를 완료했으며 새 후보 설치·실제 모델·사람 클릭·장시간 수용과 일반 Channels 배포 자격은 별도로 남아 있다. 이번 작업에서 운영 앱·세션·사용자 셸 설정을 변경하지 않았다.

2026-09-20 기록 보관: 아래 `claude/build/` 로그·작업 기준점은
[새 보관 위치와 파일 색인](../../../history/claude/PRE_LAYOUT_ARTIFACTS.md)에서 확인할 수 있다.
옛 상대 경로를 그대로 유지해 보관했으며 당시 검증 결과와 실패 기록은 변경하지 않았다.

| 산출물 | 상태 |
| --- | --- |
| [RESEARCH](RESEARCH.md) | 현재 코드와 Claude 공식 Channels/Plugin/MCP/Hook 근거, 외부 배포 제약 정리 |
| [TECH_SPEC](TECH_SPEC.md) | 등록·60분 sliding lease/5분 owner renewal·독립 readiness·종료/compact/복구·공통 UI·payload 정책 결정 |
| [CODEMAP](CODEMAP.md) | 기존 연결 지점/신규 제안 파일/고정 계약/관련 테스트를 구분 |
| [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md) | CP-00~08, AC-01~16, 실제 모델/설치/일반 배포 G1~G5 분리 |
| [AGENT_TASKS](AGENT_TASKS.md) | 단계별 담당·소유 파일·인계·공유 파일 직렬 편집 규칙 |
| [RUNTIME_PAYLOAD](RUNTIME_PAYLOAD.md) | CP-07 Node/SDK 번들·서명 descriptor pin·불변 사본·사용 중 업데이트 guard |
| [ACCEPTANCE](ACCEPTANCE.md) | CP-08 설치 전 점검·실제 연결/선택 프롬프트·사용자 클릭·장시간/설치 gate |
| [UNIFIED_DISTRIBUTION](UNIFIED_DISTRIBUTION.md) | 하나의 앱/DMG·브릿지별 버전·공통 업데이트·내부/공개 배포 조건 |
| [AUTO_CONNECT](AUTO_CONNECT.md) | 일반 claude/resume 자동 연결·zsh 설정·실제 SessionStart 이후 등록·검증 범위 |
| [PREVIEW_ISOLATION](PREVIEW_ISOLATION.md) | 폐기된 별도 Preview 제품의 과거 기록 |
| [PRODUCT_PET](PRODUCT_PET.md) | CP-06 앱 전용 selector·provider 세션 목록·시작/확인/해제·최초 probe |
| [SESSION_AUTHORITY](SESSION_AUTHORITY.md) | CP-01A 실제 API·시간/회수/commit 계약·신뢰 경계·미연결 범위 |
| [PRODUCT_WIRE](PRODUCT_WIRE.md) | CP-01B 제품 wire 계약·codec·공유 fixture·인증/inner DTO 검증과의 구분 |
| [SESSION_REGISTRATION](SESSION_REGISTRATION.md) | CP-02 private peer·grant FD·scope 등록·별도 metadata·읽기 전용 이력·공통 서비스 조립 |
| [SESSION_LIFETIME](SESSION_LIFETIME.md) | CP-03 같은 authority의 native/inner 연결·private owner renew/end·5분 controller·실제 COMMIT fence |
| [SESSION_LIFECYCLE](SESSION_LIFECYCLE.md) | CP-04 compact/StopFailure·metadata v2 재생 기록·bounded state·조회 cache·공통 timer |
| [INSTALLED_SESSION](INSTALLED_SESSION.md) | CP-05 native owner·대화형 자식·Terminal 진입점·생성 설정·v2 Hook/MCP·정확한 Channel 출처 |

결정한 핵심:

- 한 앱·한 DMG·공통 엔진·한 Pet에서 provider/session을 구분한다. 통합 후보를 격리 검증하고 기존 앱 교체는 별도 진행한다.
- 앱의 `Claude 시작`과 선택적인 터미널 자동 연결이 사용자 npm 명령을 대체한다. 후자는 새 zsh의 `claude`·`claude --resume`을 지원한다. 세션별 Channels 활성화와 Claude 승인은 유지한다.
- 세션 authority는 살아 있는 owner가 갱신한다. 모델 수신 확인은 5분 nonce ACK로 별도 유지하고 카드 TTL도 독립적이다.
- 서비스 재시작·권한 만료·MCP 프로세스 교체는 첫 제품에서 새 Claude 시작으로 복구한다. 옛 작업을 자동 재전달하지 않는다.
- compact·누적 quota·인증된 metadata·불변 payload까지 장시간 사용 범위에 포함한다.

검토에서 보완한 항목: 내부 ingress의 이중 만료 검사, 수면 포함 시계, prompt/selection/proposal/probe/poll/Channel/Pet 누적 한도, nonce의 Claude transcript 노출 가능성, plugin Channel source, renewal sequence와 authority epoch 분리, compact의 실제 prompt 관측 조건, 조회 중 core 쓰기와 순수 replay 분리, MCP protocol qualification.

## CP-01A 구현과 검증

- [ClaudeSessionAuthority.swift](../../../../bridges/claude/swift/adapter/ClaudeSessionAuthority.swift): 서버 연속 시각 기준 60분 lease, 권장 갱신 간격 5분, 정확한 owner/sequence, 직전 중복의 동일 receipt, 최종 만료·회수, 고정 epoch, opaque ticket과 commit 직전 fence.
- [SessionAuthorityTests.swift](../../../../Tests/bridges/claude/shared-engine/Tests/ClaudeCoreAdapterTests/SessionAuthorityTests.swift): 24시간 가짜 시계, 만료 전/정각/후, 시계 역행·극값, 잠자기 전 남은 기한, identity·객체·scope 격리, 갱신·회수·commit 경합, callback 오류 후 잠금 해제.
- owner/IPC 인증, registry, 실제 타이머나 기존 native/inner ingress 변경은 포함하지 않는다. 회수 API가 Claude 작업 자체를 취소하지는 않는다.

| 검증 | 결과 | 증거 |
| --- | --- | --- |
| 신규 authority 단독 | `--filter SessionAuthorityTests --no-parallel`, 14개 테스트 / 파라미터 포함 27개 사례 통과 | 로그 (`claude/build/cp01-authority/authority-tests.log`; 이전 로컬 생성물) |
| `npm run test:shared-engine` | Swift 45개(신규 14개 포함), Node 12개 통과. 병렬 authority suite도 통과 | 로그 (`claude/build/cp01-authority/shared-engine-tests.log`; 이전 로컬 생성물) |
| 기존 공통 Coordinator 회귀 | 계약 pin·exact SQLite·fake commit·schema/replay binding·시간/권한/재시작 관련 12개 통과 | 로그 (`claude/build/cp01-core-regression/test.log`; 이전 로컬 생성물) |
| 독립 코드·테스트 검토 | 현재 범위의 결함·필수 누락 없음 | 시간 경계, 중복 sequence, instance 격리, 회수와 commit의 순서, lock 해제 검토 |

SwiftPM은 sandbox 안에서 `sandbox_apply: Operation not permitted`로 시작하지 못했다. 승인 후 격리 build/cache 경로를 사용하는 동일 테스트를 실행했다. 전체 Swift suite의 기존 SQLite 대용량 이력 테스트가 약 125초 걸렸고, 신규 authority suite는 병렬 실행에서 3.573초에 통과했다. 제품 Keychain·설치 앱·실제 모델은 사용하지 않았다. 로그와 build 결과는 Git에 포함하지 않는다.

기준점은 `claude/build/cp01-baseline-5x41kcl0/`의 919개 파일 hash와 Git 상태다. 기준점 대비 기존 문서 7개만 바뀌었고 기존 소스/테스트 변경·삭제는 없다. 새 Swift 파일 2개와 API 문서 1개를 추가했다. `Contracts/v1` 12개 hash도 동일하다. 기존 미커밋 변경을 이번 구현으로 합산하지 않는다. CP-00 때의 문서 검증(9개 문서·143개 링크, v1 12개 hash 동일)은 설계 완료 당시의 별도 기록이다.

이번 변경 10개 파일의 공백·마지막 개행, 문서 8개의 코드 블록과 로컬 링크 112개를 검사해 통과했다. `git diff --check`도 통과했다.

**실행 중인 Claude의 고정 1시간 grant는 아직 바뀌지 않았다.** 새 클래스의 24시간 fake-clock 통과를 실제 장시간 실행 성공이나 G1~G5 전체 통과로 보고하지 않는다. 기존 모델 A 왕복과 만료 오류는 [기존 QA](../../../../dev/claude-standalone/docs/QA_REPORT.md)를 따른다.

## CP-01B 제품 wire 계약

기존 v1과 별도로 owner·native session v2·Pet provider envelope와 공통 값 schema 4개를 추가했다. 순수 Swift codec은 엄격한 JSON, role/operation, 원 요청과 응답의 correlation, 등록한 비밀값의 반사를 검사한다. 실제 role 인증·현재 권한·private challenge/FD·registry·MCP/Hook/설치 앱 연결은 포함하지 않는다.

공유 fixture 136개를 Swift와 Node Ajv가 각각 읽으며, raw byte·응답 binding·알려진 secret 값은 Swift에서 별도로 검사한다. 기존 root Ajv 개발 의존성을 재사용했고 새 production dependency는 없다. `test:shared-engine` runner에 Node schema 검증을 포함했다.

| 검증 | 결과 | 증거 |
| --- | --- | --- |
| 새 `ProductWireCodecTests` 단독 | 15개 테스트 통과. 공유 fixture 136개·정상/오류 correlation·raw byte·비밀값·opaque/NFC 경계 포함 | 로그 (`claude/build/cp01b-contracts/narrow-tests.log`; 이전 로컬 생성물) |
| Node schema 단독 | 142개 통과. 공유 fixture와 UInt64/role/variant 별도 변조 | 로그 (`claude/build/cp01b-contracts/schema-tests.log`; 이전 로컬 생성물) |
| `npm run test:shared-engine` | Swift 60개·Node 154개 통과. 신규 suite와 기존 adapter/native/ingress/왕복 포함 | 로그 (`claude/build/cp01b-contracts/shared-engine-tests.log`; 이전 로컬 생성물) |
| 기존 v1 계약 | `npm run test:contracts` 129개 통과 | 로그 (`claude/build/cp01b-contracts/legacy-contracts.log`; 이전 로컬 생성물) |
| JS 문법 | `npm run check` 39개 파일 통과 | 로그 (`claude/build/cp01b-contracts/syntax.log`; 이전 로컬 생성물) |
| 독립 읽기 검토 | 지적 수정 후 필수 결함 없음 | 숫자형·예약 키 정렬, 일반 JSON fixture loader, 오류 응답 변조 테스트 확인 |

초기 Swift 테스트 helper의 매크로 컴파일 오류는 수정 후 재실행해 통과했다. schema와 codec의 opaque 소수/예약 키 처리 차이도 공유 fixture와 함께 정렬했다. 승인된 격리 SwiftPM 실행을 사용했고 설치 앱·Keychain·실제 모델을 사용하지 않았다.

작업 전 기준점은 `claude/build/cp01b-baseline-35vceoim/`의 907개 파일 hash와 Git 상태다. 신규 9개 파일(4 schema·codec·Swift test·fixture·Node test·API 문서), 기존 문서 8개와 테스트 runner 1개만 변경했다. 기존 소스/테스트 변경·삭제와 dependency 변경은 없고, `Contracts/v1` 12개 hash도 동일하다. CP-01A와 앞선 통합 코드의 미커밋 변경은 이번 변경으로 합산하지 않는다.

## CP-02 private 세션 등록

[등록 구현 문서](SESSION_REGISTRATION.md)에 transport·저장·복구 경계를 기록했다. 주요 변경은 다음과 같다.

- 별도 private owner socket에서 같은 UID·peer PID/시작 시각·허용된 코드 서명과 동일 실행 파일 빌드를 검사한다. 연결마다 새 challenge/참조를 발급하고 anonymous pipe FD 하나로 역할 자격을 한 번 전달한다. 공개 ID나 일반 JSON UDS는 등록 권한이 아니다.
- registry가 scope/core IDs·역할 자격·authority를 발급하고 core/metadata/key/freshness를 scope별로 분리한다. owner EOF는 해당 scope만 회수하고 공통 서비스와 다른 세션은 유지한다. 초기 상태는 `awaitingNativeStart`다.
- metadata prepare/finalize와 독립 freshness를 core 호출 전후에 검증한다. 중간 실패·변조·rollback은 격리한다. 재시작 이력 조회는 routing/timer를 실행하거나 옛 권한을 복구하지 않는다.
- `main.swift`의 앱 소유 공통 서비스에 작은 wrapper를 연결한다. 제품 등록 초기화 실패는 고정 진단으로 남기고 Codex를 유지한다. 일반 daemon·기존 개발 native host에 새 등록 권한을 추가하지 않는다.

| 검증 | 결과 | 증거 |
| --- | --- | --- |
| `npm run test:product-registration` 신규 Swift | 48개 테스트/3 suite 통과. 실제 private socket·SCM_RIGHTS, wrong peer/참조/FD, full pipe 제한 시간, EOF, 복수 scope·Codex, metadata 중간 실패/rollback/경합 | 최종 로그 (`claude/build/product-registration/validation.log`; 이전 로컬 생성물) |
| 같은 runner의 기존 연결 회귀 | Node product ingress/native session 16개 통과 | 최종 로그 (`claude/build/product-registration/validation.log`; 이전 로컬 생성물) |
| 일반 Coordinator 빌드 | `BLABEE_JOURNAL_TEST_HARNESS` 없이 별도 scratch의 `blabee-coordinator` 빌드 통과. CP-02 소스 경고 없음; 기존 소스의 경고는 유지 | 빌드 로그 (`claude/build/product-registration/production-build.log`; 이전 로컬 생성물) |
| 기존 v1 계약 | root `npm run test:contracts` 129개 통과 | 로그 (`claude/build/product-registration/legacy-contracts.log`; 이전 로컬 생성물) |
| JS 문법 | Claude `npm run check` 40개 파일 통과 | 로그 (`claude/build/product-registration/syntax.log`; 이전 로컬 생성물) |
| 독립 읽기 검토 | 발견한 잠금/EOF/FD/metadata 문제 수정 후 현재 범위의 필수 결함 없음 | transport, registry/service와 기존 Codex 전달, metadata prepare/freshness 경계 검토 |

초기 실패는 수정 후 재실행했다. 주요 수정은 metadata prepare의 실제 행·schema 재검증, 저장소 I/O와 registry 권한 잠금 분리, 이력 조회 직렬화, 사라진 활성 scope 탐지, 종료 서비스의 재등록 차단, 새 core SQLite 권한 0600, macOS `/var` 경로 정규화와 fixture anchor 정렬이다. Darwin의 잘린 ancillary 수신이 숨은 FD를 남길 수 있는 경로는 소비 전 `MSG_PEEK` 검사로 막았고, 128개 FD의 pipe EOF 회귀를 통과했다. 실패 로그도 격리 build 폴더에 남겼다.

작업 전 기준점은 `claude/build/cp02-baseline-n9ikphkp/`의 916개 파일 hash와 Git 상태다. 신규 9개 파일(서비스/등록/registry/metadata 4개·Swift 테스트 3개·runner·구현 문서), 기존 13개 파일(문서 9개·package script·main 조립·공용 helper 접근 선언 2개)을 변경했다. 삭제·새 의존성·`Contracts/v1` 12개 파일 변경은 없다. 기존 미커밋 작업을 이번 변경으로 합산하지 않는다. build 결과와 테스트 로그는 Git에 포함하지 않는다.

변경한 22개 파일의 공백·마지막 개행, 문서 10개의 코드 블록·로컬 링크 165개와 scoped `git diff --check`도 통과했다. 기준점 대비 파일 목록은 `claude/build/product-registration/scope-report.json`에 함께 남겼다.

fixture는 in-memory freshness와 테스트 빌드에서만 허용되는 peer 검증 주입을 사용한다. 실제 Keychain·서명된 launcher의 등록·설치 앱·모델 왕복·장시간 사용·UI·일반 배포는 이번 통과에 포함하지 않는다. scope 폴더 전체가 재시작 전에 삭제된 경우 사라진 이력을 열거하지 못하는 제한도 등록 문서에 적었다. 이 경우에도 권한은 복구하지 않는다.

CP-02 이후의 native/inner ingress 권한 주입과 owner 갱신·종료는 아래 CP-03에 연결했다. 현재 개발 launcher의 고정 1시간 grant는 아직 바뀌지 않았다. CP-05 설치 launcher와 최종 산출물의 실제 왕복 검증, 일반 배포의 Blabee Channel 승인/조직 정책도 남아 있다.

## CP-03 세션 권한 연결과 owner 갱신

[구현 문서](SESSION_LIFETIME.md)에 실제 인증·시간·저장 경계를 기록했다.

- registry가 소유한 같은 authority를 native/inner ingress와 SQLite COMMIT 직전에 주입한다. 실제 native UUID와 core session ID는 별도로 유지한다.
- 인증된 private owner 연결에서 renew/end를 처리하며 5분 controller를 추가했다. 공개 UUID·Hook·MCP·nonce ACK에는 lease 갱신 권한을 주지 않는다.
- 일반 UDS의 `claude_session_v2`는 외부 capability wrapper와 secret-free envelope를 분리한다. 제품 오류도 고정 계약 코드를 사용한다. 기존 개발 v1이나 Codex 요청으로 대체하지 않는다.
- metadata/core 쓰기 준비 중 회수·만료가 발생하면 실제 COMMIT을 차단한다. 이미 pending 감사 상태가 생겼다면 해당 scope를 격리하며, 부분 claim 뒤 회수되면 실행할 action을 반환하지 않는다.
- 제품 heartbeat 손실은 미claim 카드와 Stop을 폐기하고 새 Hook·제안을 요구한다. heartbeat가 유지된 순수 readiness 만료는 별도다. 인증된 native ID/cwd 변경·미지원 source는 권한을 회수한다.

| 검증 | 결과 | 증거 |
| --- | --- | --- |
| `npm run test:product-lifetime` 등록/owner | Swift 71개/4 suite·기존 연결 Node 16개 통과. 실제 private socket·FD·일반 UDS, 24시간 fake owner, owner 중복/만료/종료, metadata/core 최종 fence 포함 | 최종 로그 (`claude/build/product-lifetime/validation-final.log`; 이전 로컬 생성물) |
| 같은 명령의 공통 엔진 | Swift 76개/5 suite·Node 154개 통과. 신규 native 권한 16개 테스트/26개 파라미터 사례, claim/complete 경합·오류 응답·기존 v1/왕복 포함 | 최종 로그 (`claude/build/product-lifetime/validation-final.log`; 이전 로컬 생성물) |
| 일반 Coordinator 빌드 | `BLABEE_JOURNAL_TEST_HARNESS` 없는 별도 scratch의 `blabee-coordinator` 빌드 통과. 설치/실행하지 않음 | 빌드 로그 (`claude/build/product-lifetime/production-build.log`; 이전 로컬 생성물) |
| 기존 v1 계약 | root `npm run test:contracts` 129개 통과 | 로그 (`claude/build/product-lifetime/legacy-contracts.log`; 이전 로컬 생성물) |
| JS 문법 | Claude `npm run check` 40개 파일 통과 | 로그 (`claude/build/product-lifetime/syntax.log`; 이전 로컬 생성물) |
| 추가 기본 SQLite 회귀 | contract pin·exact schema·fake COMMIT trigger·schema version 4개 통과. 추가 선택한 기존 queued-claim 테스트 1개는 카드 만료 간격 오류로 실패 | 로그 (`claude/build/product-lifetime/core-regression.log`; 이전 로컬 생성물) |
| 독립 읽기 검토 | native/inner identity·잠금·회수, private owner/EOF, core/metadata fence와 오류 응답 검토 후 현재 범위의 추가 필수 결함 없음 | 코드 검토이며 실제 모델/서명된 owner 증거와 구분 |

초기 fixture의 `proposal.value` 오기와 제품 내부 오류 코드의 wire 변환 누락을 수정한 뒤 전체 CP-03 명령을 통과했다. 초기 실패 로그도 격리 build 폴더에 보존했다. 공통 테스트의 `#require` 중복 macro 경고 1개와 기존 production 소스 경고 2개는 빌드/테스트 실패가 아니다.

추가 queued-claim 실패는 [기존 fixture](../../../../Tests/swift/CoordinatorSwiftTests/SQLiteQueuedActionClaimTests.swift)가 120초 카드 TTL을 만들지만 [routing 검증](../../../../engine/routing/CoordinatorRoutingApplication.swift)이 정확히 600초를 요구하는 불일치다. 두 파일의 hash는 CP-03 시작 기준점과 동일하다. `seal_packet` 검증에서 해당 append/COMMIT 및 중복 claim 검사에 도달하기 전에 실패하며, fixture의 journal은 새 gate를 전달하지 않는다. 관련 없는 기존 파일은 수정하지 않았고 별도 후속으로 남긴다.

작업 전 기준점은 `claude/build/cp03-baseline-zqmvm74i/`의 925개 파일 hash와 Git 상태다. 기존 21개 파일과 신규 5개 파일만 변경했다. 신규는 owner controller·제품 journal wrapper·각 Swift 테스트·구현 문서다. 삭제·새 의존성·`Contracts/v1` 12개 파일 변경은 없다. 변경한 26개 파일의 공백·마지막 개행, 문서 11개의 코드 블록과 로컬 링크 190개, scoped `git diff --check`를 확인했다. 변경 범위 기록 (`claude/build/product-lifetime/scope-report.json`; 이전 로컬 생성물)에 파일 목록을 남겼다. 다른 미커밋 변경은 이번 구현에 합산하지 않았고 commit·push·앱 설치/교체는 하지 않았다.

실제 서명된 owner·설치 서비스·Claude 모델 왕복·Mac 수면 복귀·실제 24시간 사용은 검증하지 않았다. private owner callback 처리 중 EOF 확인은 callback 반환까지 지연될 수 있으며 registry control에는 저장소 I/O를 넣지 않는다. 실제 자식 종료 관측은 설치 launcher CP-05에 남아 있다. CP-03에는 CP-04의 compact·durable tombstone·누적 quota와 CP-06 UI를 포함하지 않았다. CP-04 결과는 아래에 별도로 기록한다. 따라서 현재 개발 launcher의 고정 1시간 연결 오류를 이번 단계에서 해결했다고 보고하지 않는다.


## CP-04 수명 관측과 장기 상태

[구현 문서](SESSION_LIFECYCLE.md)에 상태 전이·저장·시간 처리와 검증 경계를 기록했다. 구현과 관련 격리 자동 검증을 완료했으며, 실제 모델·설치 앱 수용은 후속이다.

- 같은 prompt의 compact는 새 내부 boundary를 만든다. 누락·불일치·현재 prompt의 digest 충돌은 미claim 카드/readiness를 폐기하며 이미 claim한 원래 결과 보고를 보존한다. Stop의 background 미관측·관측된 없음·활성을 구분하고 StopFailure를 완료로 처리하지 않는다.
- metadata v2는 prompt/proposal/selection/Hook replay key와 파생 lookup을 HMAC audit·freshness에 묶는다. 일반 검증은 이력을 순차 처리하며 v1은 history-only로 읽는다. core strict schema와 `Contracts/v1`은 그대로다.
- 제품 lifetime 횟수 제한을 현재 상태·32개 미보고 claim·시간 창 rate limit으로 바꿨다. Channel은 마지막 sequence/digest, Pet는 현재 카드 시도·응답만 보관한다.
- poll/Pet 조회는 core 쓰기를 하지 않는다. 만료는 즉시 선택/전달을 차단하고, durable 정리는 후속 mutation 또는 scope별 단일 maintenance 작업에서 처리한다. 공통 scheduler는 한 scope의 저장/COMMIT 잠금을 기다리지 않는다.

| 검증 | 결과 | 증거 |
| --- | --- | --- |
| 등록/metadata/registry/owner/Pet transport | Swift 98개/5 suite·Node 16개 통과. 실제 SQLite 1,000개 replay key, lookup 변조·crash·이력, 만료 poll 무쓰기·느린 scope/Codex 격리, Pet 500회 포함 | 등록 단계 로그 (`claude/build/product-lifecycle/registration-validation.log`; 이전 로컬 생성물) |
| 기존 공통 엔진 | Swift 76개/5 suite 통과. 기존 race 조건과 제한 시간 유지 | 공통 엔진 단계 로그 (`claude/build/product-lifecycle/shared-base-validation.log`; 이전 로컬 생성물) |
| 제품 lifecycle 경계·짧은 왕복 | Swift 14개 통과. 메모리/SQLite 각 3회에서 원래 ID·내부 성공 상태·보고문 검증, 1,000 prompts, 100,000 polls와 1,000 snapshots 포함 | 로그 (`claude/build/product-lifecycle/lifecycle-short-validation.log`; 이전 로컬 생성물) |
| 제품 lifecycle 누적 왕복 | Swift 1개 통과. 메모리 journal로 native/core 500회 왕복, 성공 결과 500개·Channel 전달 1,000개·원래 선택 ID와 보고문 확인 | 로그 (`claude/build/product-lifecycle/lifecycle-validation.log`; 이전 로컬 생성물) |
| 공통 연결·제품 계약 Node | 164개 통과. 공유 fixture 146개, 실제 공통 엔진 왕복 포함 | 로그 (`claude/build/product-lifecycle/shared-node-validation.log`; 이전 로컬 생성물) |
| v2 Hook·Channel helper | Node 12개 통과. 1,000개 cursor 전달, notify 실패 후 재전송 금지, raw background 관측·StopFailure 정규화 | 로그 (`claude/build/product-lifecycle/node-initial.log`; 이전 로컬 생성물) |
| 제품 schema | 공유 fixture 146개를 포함한 Node 152개 통과 | 로그 (`claude/build/product-lifecycle/schema-initial.log`; 이전 로컬 생성물) |
| 기존 v1 계약 | root `npm run test:contracts` 129개 통과 | 로그 (`claude/build/product-lifecycle/legacy-contracts.log`; 이전 로컬 생성물) |
| JS 문법 | `npm run check` 44개 파일 통과 | 로그 (`claude/build/product-lifecycle/syntax.log`; 이전 로컬 생성물) |
| 일반 제품 빌드 | 테스트 define 없는 `blabee-coordinator` 빌드 통과. CP-04 소스 경고 없음; 기존 Codex 소스 경고 2개 유지 | 로그 (`claude/build/product-lifecycle/production-build.log`; 이전 로컬 생성물) |
| 독립 읽기 검토 | 제안 ID 문법, scheduler의 저장/authority 잠금 대기, 만료 poll, 현재 digest 충돌을 보완한 뒤 현재 범위의 추가 필수 결함 없음 | 소스·fixture 검토이며 실제 모델 수용과 구분 |

초기 인자 순서·테스트 helper 컴파일 오류는 수정했다. 첫 공통 병렬 실행은 긴 동기 반복 fixture와 기존 semaphore 경합 테스트가 겹쳐 9개 issue를 기록했다. 긴 suite를 별도 실행한 뒤 기존 76개가 통과했으며 assertion이나 timeout을 완화하지 않았다. 초기 병렬 실패는 전체 실행 로그 (`claude/build/product-lifecycle/registration-and-parallel-shared.log`; 이전 로컬 생성물)에 남겼다. 메모리 journal의 debug 실행과 release 초기 실행도 비용을 확인한 뒤 중단했다. 최종 장기 fixture는 release 빌드에서 각 반복의 Foundation 임시 객체를 autoreleasepool로 해제하고 직렬 실행한다. 검증 완료한 각 단계의 로그를 분리했으며, 최종 집계 명령을 다시 전부 실행한 결과로 표시하지 않는다.

500회 실제 SQLite 디버그 실행은 약 4~5분에 43회 완료 상태를 관측한 뒤 테스트 프로세스만 종료했다. 따라서 이 실행은 500회 성공 증거가 아니다. 반복 횟수와 실제 native/ingress/core 상태 전이는 테스트용 메모리 journal로 검사하며, 같은 helper의 SQLite 3회와 별도 registry·metadata·COMMIT 검증을 유지한다. 실제 SQLite metadata의 1,000개 소비 검사는 331.767초에 통과했다. 이 비용과 디버그 core 반복 비용은 제품 후보의 대규모 이력 성능을 별도 측정해야 할 근거이며, 설치 사용의 지연으로 일반화하지 않는다. 수정 전 release fixture 실행 중 1초 호출 스택 표본 (`claude/build/product-lifecycle/lifecycle-process-sample.txt`; 이전 로컬 생성물)도 선택 claim 아래 semantic replay와 StrictJSON 처리를 확인했다. 이는 그 시점의 표본이며 전체 시간 비율이나 제품 서비스 벤치마크는 아니다.

기준점 `claude/build/cp04-baseline-ygujs80_/`의 930개 파일과 비교해 기존 27개 파일을 변경하고 7개를 추가했다. 삭제·새 의존성·`Contracts/v1` 12개 파일 변경은 없다. 34개 파일의 공백·마지막 개행과 scoped `git diff --check`가 통과했다. 변경 범위 (`claude/build/product-lifecycle/scope-report.json`; 이전 로컬 생성물)에 목록을 남겼다. 다른 미커밋 변경은 합산하지 않았고 commit·push는 하지 않았다.

최초 완주한 장기 실행은 500회 자체와 projection의 500개 결과·1,000개 전달을 확인했지만, 마지막 raw-state 비교가 외부 `completed`를 내부 상태값으로 사용해 실패했다. 실제 core는 `succeeded`로 저장한다. 수정 전 결과 (`claude/build/product-lifecycle/lifecycle-before-status-fix.log`; 이전 로컬 생성물)는 500회 3,910.471초·전체 3,991.654초이며 성공 로그로 사용하지 않는다. 기대값을 고친 뒤 같은 helper의 메모리 3회·SQLite 3회를 포함한 14개를 73.096초에 통과했고, 마지막 500회 검사도 4,035.191초에 통과했다. 두 실행을 합쳐 lifecycle 15개 테스트가 통과했다. runner도 짧은 검사를 먼저 실행한다. 테스트용 메모리 append의 중복 candidate replay만 제거했고, 실제 core의 commit 전 candidate 검증·CAS·authority fence와 마지막 전체 replay·개수·원래 ID·보고문 검사는 유지했다. 이 긴 검사는 일반 `test:shared-engine`과 분리되어 있으며 자동 테스트의 통과를 실사용 성능 충족으로 해석하지 않는다.

현재 개발 launcher와 설치 앱·실제 Claude 세션은 바꾸지 않았다. 새 v2 helper의 실제 client 연결은 CP-05, 제품 Pet wire/UI는 CP-06다. 실제 compact·모델 왕복·2시간/8시간 사용·수면 복귀와 설치/일반 배포는 G2~G5에 남아 있다. 기존 queued-claim 120초/600초 fixture 불일치도 이번 범위에서 수정하지 않았다.

## CP-05 native 실행기와 실제 Hook/MCP 연결

[구현 문서](INSTALLED_SESSION.md)에 공개 인자·역할 환경·모델 응답·출처 바인딩과 후속 경계를 기록했다.

- 같은 native 실행 파일이 private owner socket에 등록하고 5분 갱신 controller와 새 Claude 자식을 소유한다. 일회용 grant pipe·서명/빌드/peer·정확한 authority를 검증하며 일반 Hook/MCP에는 owner·selector 자격을 전달하지 않는다.
- TTY foreground와 termios를 보존하고 Ctrl-Z·background·fg·Ctrl-C·자식 종료를 처리한다. 서비스 EOF는 해당 Blabee 연결만 회수하며 이미 실행 중인 Claude를 종료시키지 않는다. Terminal 진입점은 `fg`가 가능한 셸을 유지한다.
- Hook 다섯 종과 MCP 설정을 세션별로 생성한다. MCP의 public scope/runtime 값도 명시적으로 환경 참조해 상속 제한 환경에서 누락되지 않는다. 비밀값은 argv/config에 넣지 않으며 사용자 설정·native 승인을 변경하지 않는다. 같은 MCP 이름과 관리 설정 충돌은 등록 전에 진단한다.
- 별도 v2 Node client가 실제 Hook과 stdio MCP를 연결한다. 다섯 모델 도구의 `_v1` 이름을 유지하며 응답 authority/correlation·strict JSON·bounded queue/Channel 전송을 검증한다. 유실된 mutation이나 Channel을 자동 재시도하지 않는다.
- 제품 continuation은 등록된 source의 정확한 wrapper·본문·참조를 요구한다. 기존 v1 개발 경로의 본문 호환은 유지한다. plugin source fixture는 등록 승인이나 패키징 완료의 증거가 아니다.

| 검증 | 결과 | 증거 |
| --- | --- | --- |
| source/authority/Channel 바인딩 | Swift 31개/3 suite 통과 | `build/claude-tests/cp05/source-validation.log` |
| native owner/등록/갱신/실제 IPC·PTY | Swift 58개/4 suite 통과. 생성 설정을 사용하는 실제 command Hook·stdio MCP·private/common UDS, Channel ACK·제안·compact·SessionEnd, Ctrl-Z/background/fg/Ctrl-C·FD 격리 포함 | `build/claude-tests/cp05/native-validation-final.log` |
| Node v2 및 기존 v1 회귀 | 195개 통과. 실제 stdout pipe backpressure로 막힌 MCP 자식의 종료 포함 | `build/claude-tests/cp05/node-validation-approved.log` |
| 기존 v1 계약 | 129개 통과 | `build/claude-tests/cp05/legacy-contracts.log` |
| 일반 Coordinator 빌드 | 테스트 전용 define 없는 별도 scratch의 `blabee-coordinator` 빌드 통과. 설치·실행하지 않음 | `build/claude-tests/cp05/production-build.log` |
| 문법 | JavaScript 39개와 Python PTY fixture 문법 통과 | `build/claude-tests/cp05/syntax-final.log` |

검증 중 macOS `/private` 경로 정규화 불일치, 정상 end 응답 직후 EOF를 오류로 판정하는 경합, MCP 환경 상속 의존, 일시정지된 자식의 foreground 복구와 실제 stdout backpressure 종료를 수정했다. 테스트의 ACK 기대 필드와 PTY `^C` echo/JSON 경계도 실제 계약에 맞췄다. 초기 실패 로그는 같은 build 폴더에 보존하며 최종 통과와 구분한다. 테스트용 peer와 freshness만 사용했고 제품 Keychain·실제 Claude 계정·설정은 변경하지 않았다.

시작 기준점은 `build/claude-tests/cp05/baseline.json`의 537개 파일이다. 기존 11개 파일 변경·17개 추가이며 삭제·새 의존성은 없다. 공통 engine·Codex bridge·`Contracts/v1` 12개 파일은 기준점과 같다. 변경 범위·계약 보존·문서 검사는 같은 폴더의 `scope-report.json`과 `audit.log`에 기록했다. 기존 dirty reorganization과 작업 중 다른 세션이 추가한 DB 감사 문서는 이번 변경으로 합산하지 않는다. commit·push·설치 상태 변경은 하지 않았다.

다음은 CP-06 공통 Pet의 Claude 시작·세션 집계·확인/해제와 최초 probe 조립이다. CP-05는 명시적인 `check_connection_v1`을 제공하며 초기화를 ready로 취급하지 않는다. CP-07 불변 payload/Node 번들·서명/설치·업데이트 guard와 CP-08 실제 모델·장시간·수면·다중 provider 수용은 남아 있다. 일반 빌드를 설치 앱에 적용하거나 기존 `claude:shared` 경로를 교체하지 않았다. G2~G5는 미검증이다.

## CP-06 공통 Pet 연결

[구현 문서](PRODUCT_PET.md)에 앱 전용 인증과 두 provider의 조회·선택·상태·시작·확인·해제 경계를 기록했다. 소스 구현과 관련 격리 회귀 검증을 마쳤다.

- 앱이 시작한 서비스에 private lifetime pipe로 selector capability를 전달한다. 자격은 argv·환경·설정·ready frame에 넣지 않는다. public runtime identity나 Hook/MCP 자격으로 UI 권한을 발급하지 않는다.
- 별도 directory 계약은 Codex pool과 여러 Claude scope를 구분한다. 조회는 native 초기화·이력 복구·core 쓰기를 하지 않는다. 선택한 Claude의 상태만 조회하며 다른 provider의 카드/승인을 합치지 않는다.
- 프로젝트 선택과 CP-05 Terminal 실행기를 공통 Pet에 연결했다. bundle에 필요한 파일이 없으면 명시적으로 안내한다. payload/Node 번들·manifest·서명·업데이트 보호는 CP-07이다.
- 실제 startup Hook과 bridge 준비를 관측한 뒤 최초 probe를 한 번 생성한다. 명시적인 재확인과 실제 Channel ACK를 분리하며 모델 호출을 주기적으로 반복하지 않는다.
- 클릭·단축키·지연 응답·겹친 snapshot을 service/provider/UI 세대로 검사한다. Codex fallback에도 같은 앱 자격을 고정한다. 개별 Claude 해제는 그 authority만 회수하며 Claude 프로세스나 다른 세션을 종료하지 않는다.

검증 기록은 `build/claude-tests/cp06/`에 격리했다.

| 검증 | 결과 | 증거 |
| --- | --- | --- |
| 공통 Pet·selector bootstrap·실제 UDS·registry·launcher·UI/transport 회귀 | Swift 155개/12 suite 통과 | `pet-validation-final.log` |
| native 상태·Channel 출처·product authority | Swift 31개/3 suite 통과 | `source-validation.log` |
| native launcher·실제 Hook/MCP·PTY·registry 회귀 | Swift 44개/3 suite 통과 | `native-validation.log` |
| Node v1/v2·provider/directory schema | 198개 통과 | `node-validation-approved.log` |
| 기존 v1 계약 | 129개 통과 | `legacy-contracts.log` |
| 일반 제품 빌드 | 테스트 define 없는 별도 scratch의 `blabee-coordinator` 빌드 통과 | `production-build-final.log` |
| 문법 | JavaScript 41개 통과 | `syntax.log` |

처음 SwiftPM과 Node 소켓 검증은 샌드박스 제한으로 실행하지 못했고, 승인된 격리 실행으로 재검증했다. 초기 컴파일의 helper 인자/빈 projection/throwing macro 문제를 수정했다. 첫 Pet 실행은 UI까지 통과한 뒤 bootstrap 테스트의 ready pipe 원본 writer가 열려 있어 EOF 대기에서 멈췄다. 테스트 프로세스만 중단하고 fixture writer를 닫은 뒤 비차단 bounded 읽기로 바꿨다. 제품 bootstrap 검증 조건은 완화하지 않았다. 초기 로그는 같은 폴더에 보존하고 최종 통과와 구분한다. 일반 빌드의 기존 Codex 소스 경고 2개는 그대로이며 CP-06 소스 경고는 없다.

읽기 검토에서 확인한 routing 캐시 누락, 지연된 startup의 최초 probe, provider 전환 후 반환 앱 잔류, 겹친 snapshot 덮어쓰기, Codex fallback의 자격 고정과 await 이후 context 검사를 보완했다. 별도 회귀로 결과를 확인했다. 소스 검증을 실제 설치 앱·모델의 실행 증거로 대체하지 않는다.

시작 기준점 555개 파일과 비교해 기존 26개 파일을 수정하고 15개를 추가했다. 삭제·새 의존성·기존 `Contracts/v1` 12개, engine 21개, Codex bridge 37개 파일 변경은 없다. 공백·마지막 개행·문서 링크·명시적 Swift manifest·scoped `git diff --check`를 확인했으며 결과는 `scope-report.json`과 `audit.log`에 기록했다. 기존 dirty reorganization을 이번 변경으로 합산하지 않는다.

다음은 CP-07 불변 payload/Node 번들·서명/설치·업데이트 guard다. CP-08 실제 모델 ACK·선택·완료, Terminal 앱 조작, 장시간/수면 사용은 미검증이다. 기존 `claude:shared` 개발 launcher, 운영 앱·세션·DB·사용자 설정은 변경하지 않았고 commit·push·설치를 하지 않았다.


## CP-07 Claude runtime 패키징과 업데이트 보호

[구현·재현 문서](RUNTIME_PAYLOAD.md)에 descriptor·서명·불변 사본·사용 기록·preview 배포 범위를 기록했다. 소스 및 개발 preview 패키지 검증을 마쳤다. 일반 Channels 승인은 확보하지 않았으며 승인된 plugin 배포 경로를 완성했다고 보고하지 않는다. 일반 plugin 패키징·launcher source 전환은 승인 조건을 확인한 뒤 후속 구현해야 한다.

- 기존 MCP SDK와 실행 의존성, 제품 bridge 11개, 공식 Node 22.23.2와 전체 LICENSE를 529개 파일로 묶었다. 기존 assembly v2 형식을 유지하고 독립 `claude-runtime.v1` descriptor를 포함한다. Node를 먼저 서명·재봉인한 뒤 앱 manifest와 앱 서명을 만든다.
- native owner는 서명 검증된 assembly bytes에 고정된 descriptor 해시를 사용한다. 정확한 파일·버전·architecture·permission·link·digest를 검사하고, 실제 Node version probe도 고정 버전에 맞아야 한다. private store에 사본을 원자적으로 게시하고 Hook/MCP가 그 경로만 사용한다.
- durable 사용 기록은 자식 시작 전 생성하며 owner kill·PID 부재로 지우지 않는다. 정상 reap/미실행이 확실한 owner만 자기 기록을 정리한다. 잠깐의 잠금 경합만 5초 이내 재시도한다. 4096개 사용 기록 한도를 쓰기 전에 검사한다. payload 자동 GC는 없다.
- live installer의 Claude admission guard가 legacy/v1·신규 설치·publish/rollback을 모두 보호한다. Node 때문에 보수적 legacy process guard로 내려가도 coordinator inode EX를 함께 잡는다. updater의 준비·helper ready·각 Codex pause/install 전에 다시 검사한다.
- 일반 빌드로 ad-hoc preview 후보를 만들었다. `build/claude-tests/cp07/preview-candidate/Blabee.app`에 있으며 설치·실행 중 앱 교체는 하지 않았다. 일반 Developer ID release에 이 preview를 전달하면 조립 전에 거절한다.

| 검증 | 결과 | 증거 (`build/claude-tests/cp07/`) |
| --- | --- | --- |
| Node packaging·기존 assembler·release signing 회귀 | 81개 통과 | `packaging-escalated.log` |
| 기존 dogfood 준비 회귀 | 8개 통과 | `dogfood-regression.log` |
| payload/use·Pet launcher·native launcher·설치/업데이트·metrics | 최종 Swift 193개/13 suite 통과 | `native-integration-final.log` |
| 실제 command Hook·stdio MCP·private/common UDS·기존 PTY·불변 payload/owner kill | Swift 8개/2 suite 통과. checkout 밖에서 사용자 Node/npm PATH 없이 ACK·제안·compact·종료. owner kill 뒤 원래 bundle 사본 삭제 후 Node 지연 SDK import 및 설치 차단 확인 | `native-integration-final.log` |
| 일반 제품 빌드 | 테스트 define 없는 별도 scratch 빌드 통과 | `production-build.log` |
| 실제 Node 입력·서명·JIT·SDK | 공식 archive SHA256 일치, 외부 비시스템 dylib 없음, 최소 allow-jit로 ad-hoc 서명 후 실행 통과. PGP 검증은 수행하지 않음 | `node-qualification.json` |
| 일반 빌드 기반 preview 앱 | dogfood 조립·실제 runtime identity 확인·deep/strict 서명·descriptor↔assembly 해시·포함 Node 버전 확인 통과 | `preview-candidate.log`, `preview-signature.log`, `preview-qualification.json` |

첫 packaging 실행은 nested sandbox 검사 3개가 실패했다. 샌드박스 밖 동일 격리 테스트에서 81개 모두 통과했다. 첫 native/실제 IPC 실행의 192개+8개 통과 후 exact Node version 검사를 보강했고, 최종 193개+8개를 다시 확인했다. 기존 SwiftPM unhandled-file 경고와 Codex 소스 경고 2개는 CP-06 로그에서도 동일하며 이번 범위에서 수정하지 않았다. 새 코드에 컴파일 실패는 없다.

독립 읽기 검토에서 표준 `/Applications`의 root-owned 0775 ancestor 거절, 서명된 descriptor pin 누락, 정상 종료의 일시적 admission 경합, 4096번째 등록 이후 한도 초과를 발견하고 회귀와 함께 수정했다. 재검토에서 남은 blocker는 없었다. 실제 모델·설치 성공으로 확대해석하지 않는다.

시작 기준점은 `baseline.json`의 581개 파일이다. 기존 23개 파일 변경·12개 추가이며 삭제·새 npm 의존성은 없다. engine 21개·Codex bridge 37개·`Contracts/v1` 12개는 기준점과 같다. 명시적 Swift source 목록·문법·공백·문서 링크·scoped diff 검사는 `scope-report.json`, `audit.log`에 기록했다. 기존 미커밋 정리 작업을 합산하지 않았고 commit·push를 하지 않았다.

다음은 CP-08의 최종 후보 기반 실제 Claude ACK→사람의 Pet 선택→동일 세션 claim/완료, Codex+Claude 2개 동시 사용, 2시간/8시간·수면·compact 수용이다. G4의 실제 설치/앱 버튼과 G5의 일반 Channels 배포 자격은 아직 미검증이다. owner 강제 종료 뒤 불명 사용 기록을 자동 삭제하지 않으므로 업데이트가 계속 보류될 수 있다. 해당 기록의 안전한 복구 절차와 구 payload 정리는 별도 후속으로 남긴다.

## CP-08 설치 전 점검과 내부 서명 경로

[실제 수용 절차](ACCEPTANCE.md)에 연결 확인과 A/B 선택 프롬프트, 사람의 클릭 증거,
장시간·수면·다중 세션·설치 gate를 나눠 기록했다. 실제 모델 수용은 아직 수행하지 않았다.

설치 앱은 `0.1.0 / 61`이며 Claude payload가 없었고, 여러 Blabee 프로세스가 실행 중이었다.
CP-07의 ad-hoc 후보 build `1`은 제품 owner의 Apple anchor/Team 조건을 만족하지
못하며 정상 업그레이드 대상보다 번호도 낮았다. `codesign --test-requirement`로
ad-hoc 후보의 해당 조건 실패를 확인했다. socket/HOME만 바꿔 제품 실행을 격리하는
경로도 없으므로 후보를 운영 서비스에 연결하거나 실행 중인 앱을 바꾸지 않았다.

다음 패키징 변경은 이 설치 전 문제를 해결한다.

- 별도 `build-claude-preview-app.mjs`와 `internalClaudePreviewSigning` 모드를 추가했다.
  명시적 runtime·build·Developer ID/Team을 요구하며 다른 서명 모드와 결합할 수 없다.
- staging의 Node를 먼저 서명·검증하고 descriptor→assembly manifest→앱 순으로 봉인한다.
  Apple anchor·같은 Team·identifier·timestamp·Hardened Runtime과 Node allow-jit/앱
  Apple-events 단일 entitlement를 확인한다. 원본 runtime·native binary는 변경하지 않는다.
- 일반 release의 Claude preview/추가 executable 거절과 Swift peer 인증은 유지한다.
  코드 서명은 개발 Channels를 일반 승인 plugin으로 바꾸지 않는다.

| 검증 | 결과 | 증거 (`build/claude-tests/cp08/`) |
| --- | --- | --- |
| 내부 signing·payload·assembler·기존 release signing/DMG 회귀 | 110개 통과, 실패/skip 없음 | `packaging-validation-final.log` |
| CP-07 사본의 저장소 밖 Node/ESM SDK·529개 파일·descriptor pin·서명 | 통과. 제품 owner용 Apple 조건은 예상대로 실패 | `preflight.json`, 관련 로그 |
| r62 내부 Developer ID 후보 조립·서명 | Node→앱 순서, 같은 Team·Apple 인증서·timestamp·정확한 entitlement 검사 통과 | `signed-preview-build.log` |
| r62 저장소 밖 사본·실제 native identity·제품 owner 인증서 조건·Node/ESM SDK | 모두 통과. 동적 peer 등록·모델·설치는 미실행 | `signed-preview-qualification.json`, 관련 로그 |
| CLI/설치 경로 읽기 검토 | Claude 2.1.276·필수 인자 확인, 고정 운영 namespace/서명 조건/낮은 build 발견 | `claude-version.log`, `claude-help.log`, 이 문서와 수용 절차 |
| 내부 패키징 변경 읽기 검토 | staging만 변경·정확한 nested executable·일반 release 분리·실패 시 보존 확인 | 독립 reviewer 검토, 실제 peer 연결과 구분 |

첫 중앙 실행은 신규 fixture의 서명 변수명 오류로 105개 통과/5개 실패했다.
변수 연결을 고친 뒤 동일 전체 명령에서 110개가 통과했다. 초기 로그는
`packaging-validation.log`에 보존했다. 초기 사전 점검 wrapper의 eval argv/ESM 해석
오류도 별도 로그로 남겼으며, 제품 payload 변경 없이 올바른 ESM import로 통과했다.
Swift 소스 변경이 없어 CP-07의 일반 빌드 native binary를 재사용한다.

최종 후보는 `build/claude-tests/cp08/signed-preview-r62/Blabee.app`이며 build `62`다.
runtime identity는 `sha256:17b66ebb13a87ed562a63d687cd53468fc20d0920943453012e6dae3be974815`,
payload digest는 `sha256:478953a406821fef3177c233f8ace39b37eb03470d1c59a7c672e85862704f2f`다.
Node와 앱 모두 Team `VN7AMDG677`의 Developer ID·Hardened Runtime·secure timestamp로
서명했다. 원본 native binary와 CP-07 runtime은 실제 해시 검사에서도 변하지 않았다.
저장소 밖 사본의 번들 Node `22.23.2`와 ESM SDK import는 `PATH=/usr/bin:/bin`에서 통과했다.
검사는 MCP 서버나 Claude 모델을 시작하지 않았으며 notarization·일반 배포도 하지 않았다.

샌드박스 안에서는 Developer ID 사본의 서명을 invalid로 보고했지만 같은 사본의
샌드박스 밖 explicit certificate requirement와 전체 산출물 검사는 통과했다.
초기 결과는 `signed-preview-qualification-sandbox-error.log`에 보존했다.
이는 정적 인증서 조건의 검증이며 실제 프로세스 간 private peer 인증 성공으로 확대하지 않는다.

기준점 대비 기존 11개 파일 변경·3개 추가이며 삭제·의존성 추가가 없다.
`app/`, engine, Codex bridge, Claude Swift, `Contracts/v1`은 동일하다. JavaScript 6개 문법,
문서 링크·공백·scoped diff를 검사했다. `scope-report.json`에 변경 범위를 기록한다.
현재 설치 build `61`의 assembly hash와 Pet/서비스 PID도 유지돼 있다.
빈 테스트 프로젝트 2개는 checkout 밖에 준비했고 경로는 `workspace.json`에 기록했다.

남은 실행은 기존 연결 세션을 정상 종료할 수 있는 시점의 후보 설치, 실제 새 Claude
ACK→사용자의 Pet A 클릭→같은 세션의 claim/완료다. G2~G5는 미통과이며 2시간/8시간,
수면·compact·다중 세션·업데이트 수용도 남아 있다. 현재 Mac에서 운영 앱을 교체하는
단계는 기존 사용자 세션 보호를 위해 확인 후 진행한다. commit·push는 하지 않았다.


## CP-08 별도 Claude Preview r1 — 과거 기록

이후 사용자 결정으로 별도 제품은 폐기했다. 아래 결과는 당시 후보에만 해당하며 현재 통합 후보의 검증을 대신하지 않는다.

사용자의 버전 분리 결정에 따라 [Preview 프로필](PREVIEW_ISOLATION.md)을 구현했다.
`BLABEE_CLAUDE_PREVIEW`로 같은 소스를 컴파일하며 기존 제품의 이름·ID·버전은 유지한다.
Preview는 `Blabee Claude Preview.app`, `com.biadone.blabee.claude-preview`,
Application Support의 `BlabeeClaudePreview`, freshness account `claude-preview-primary`를 사용한다.
소켓·잠금·설정·불변 payload/use 기록도 분리했다. owner의 Apple anchor·Team·CDHash 검사는 유지한다.

공통 Pet는 Claude 전용 목록/선택으로 조립한다. production 계정·Codex 설정·telemetry·
로그인 자동 시작·전역 단축키를 생성하지 않으며 updater는 직접 메서드 호출에도 차단된다.
첫 버전은 DMG에서 별도 앱을 Applications로 드래그해 설치한다. 자동 설치·업데이트는 제공하지 않는다.

| 검증 | 결과 | 증거 (`build/claude-tests/cp08-preview-isolation/`) |
| --- | --- | --- |
| 표준 Swift 회귀 | 180개 / 14 suite 통과 | `standard-validation.log` |
| Preview Swift 회귀 | 131개 / 10 suite 통과. compile-time updater 차단·버튼 표시 포함 | `preview-validation.log` |
| Node 패키징 | 서로 다른 198개 통과. 초기 198개 중 6개는 sandbox의 hdiutil/nested sandbox 제한으로 실패했고, 해당 두 파일 76개를 외부 실행해 모두 통과 | `packaging-validation.log`, `packaging-native-validation.log` |
| Preview 일반 빌드 | 테스트 define 없이 빌드 성공. native query가 정확한 Preview profile/ID 반환 | `preview-product-build.log` |
| 실제 앱·DMG 생성 | `0.1.0 / 1`, arm64, Developer ID 앱·DMG 서명, profile-bound 조립·readonly mount·checksum 성공 | `preview-dmg-build.log` |
| 저장소 밖 검사 | 서명·entitlement·native assembly identity·529개 payload·Node 버전·SDK server/stdio ESM import 성공 | `qualification.json`, `qualification.log` |

초기 SDK 검사에서 작업 디렉터리를 runtime root로 잘못 지정한 실행은 실패했다.
실제 module 위치인 `payload/`로 검사 스크립트를 고친 뒤 통과했다.
`qualification-initial-error.log`는 별도 보존한다. 앱/DMG bytes는 이 수정으로 바꾸지 않았다.

DMG SHA256: `82b6aff526d2bb8b7d17a51fd9185ca3d165c09350a31aa07bc3dd28b9e4e6b2`.
Native identity: `sha256:5ac4d10f536db9e98a30c795dc5d1e85acf1ae0f9958537b6c7f514bcb12ccef`.
일반 Channels 배포 승인·공증·실제 설치·두 앱 동시 실행·signed peer의 동적 등록·모델·
사람 클릭·2시간/8시간/수면 수용은 여전히 미검증이다. 자동 fixture의 두 프로필 잠금/
설정/payload 격리를 실제 두 GUI의 병행 사용 성공으로 계산하지 않는다.

이번 기준점은 `baseline.json`의 449개 파일과 `source-before/` 사본이다.
기존 미커밋 변경과 합산하지 않으며 최종 범위는 `scope-report.json`에 기록한다.
공통 engine·Codex bridge·Contracts/v1, 기존 설치 앱의 보존은 `audit.log`와
`installed-preservation.json`에서 확인한다. commit·push·설치는 수행하지 않았다.


## CP-08 통합 Blabee 앱 r62

최종 사용자 결정에 따라 [하나의 앱과 DMG](UNIFIED_DISTRIBUTION.md)로 변경했다.
별도 Preview 프로필·명령·화면·updater 차단을 제거하고 기존 Blabee identity·저장소·
공통 Pet·계정·설정·단축키·업데이트를 사용한다. `BLABEE_CLAUDE_PREVIEW`는 명시적
컴파일 오류가 된다. 세션 선택은 Codex와 여러 Claude를 함께 표시하며 인증된 대상을 유지한다.

Claude만 쓰는 사용자는 첫 실행에서 Codex 연결을 건너뛸 수 있다. 서비스 준비 전에는
Claude 시작 대신 정확한 설정 안내를 표시한다. 기존 macOS 서비스 등록을 자동 변경하지
않으며 사용자의 등록 해제·앱 서비스 재시작 뒤 Claude 시작이 가능해진다.
검토에서 발견한 blocked 상태의 버튼 이름 불일치를 수정하고 해당 전환 회귀를 추가했다.

기존 `build:macos-app`과 `build:internal-dmg`에 내부 Claude 서명 옵션을 연결했다.
fresh 경로의 소스·runtime 재검사, Node→descriptor→assembly→앱 서명 순서,
기존 installer/Claude 사용 중 guard를 유지한다. 공개 release는 개발 payload를 거부하며
공증 경로도 실제 readonly DMG 내용에서 개발 Channels를 확인하면 업로드 전에 거부한다.

| 검증 | 결과 | 증거 (`build/claude-tests/cp08-unified-app/`) |
| --- | --- | --- |
| Swift 관련 회귀 | 247개 / 16 suite 통과 | `swift-validation.log` |
| 안내 수정 뒤 전환 회귀 | 위 247개에 포함된 2개 재검증 통과. 기존 SM enabled/requiresApproval 두 사례 포함 | `swift-service-recovery.log` |
| Node 패키징 | 9파일의 서로 다른 205개 통과 | root 3파일 91개: `packaging-native-validation.log`; 담당자 6파일 114개: `packaging-scoped-report.json` |
| 현재 소스 fresh 빌드·앱/DMG 생성 | 테스트 define 없이 release 빌드, 표준 Blabee ID, Developer ID 앱·DMG 서명, checksum·읽기 전용 마운트 검증 | `unified-dmg-build.log` |
| 저장소 밖 실행 검사 | native identity, Codex 0.1.1/Claude 0.1.0, Node 22.23.2, SDK import, 529개 payload 파일 검사 통과 | `qualification.json`, `qualification.log` |
| 공개 배포 차단 | 실제 통합 DMG의 개발 Channels payload가 공증 전 검사를 거부시킴. notarytool 제출 없음 | `qualification.json`의 `public_distribution_rejected: true` |
| 독립 검토 | 서비스 안내 1건 수정 후 source·패키징 범위의 추가 확정 결함 없음 | 담당 reviewer의 읽기 검토, 실제 설치 증거와 구분 |

패키징 담당자의 최초 6파일 실행은 113개 통과·기존 notary fixture 1개 실패였다.
새 payload 검사 seam에 테스트 Team ID 설정을 맞춘 뒤 관련 3파일 65개가 통과했고,
최초 실행에서 통과한 나머지 49개와 합산했다. 해당 raw 로그 파일은 저장되지 않았으며
도구 세션 ID와 실패·재검증 내역을 `packaging-scoped-report.json`에 구분해 기록했다.
root의 추가 3파일은 실제 hdiutil/nested sandbox 검사를 허용한 환경에서 91개 모두 통과했다.

산출물은 `artifacts/Blabee-0.1.0-arm64-r62.dmg`다. 앱 `0.1.0 / 62`이며
현재 설치 `0.1.0 / 61`을 교체하지 않았다. 내부 후보는 미공증이며 공개 배포 대상이 아니다.
DMG SHA256: `9e150e39b8f96d5193a2c7ed8a201dcbe3c70f2effb5734ede6d4f439e21a344`.
Native identity: `sha256:9c057c00ccbc007b827fadbd3e0763a2a93793b62a8060bf5b0c89e7e63f4b11`.
Assembly manifest: `sha256:a3b7a6ad36d7cdcb5febb483bdb43b9dc768e52c61f5ba3d6875173344ef38b7`.

기준점 433개 파일 대비 범위는 `scope-report.json`, 문서·공백 검사는 `audit.log`,
설치 앱의 Info.plist·coordinator·assembly 보존은 `installed-preservation.json`에 기록한다.
engine·Codex bridge·Contracts/v1의 기준점 파일은 동일하다. 이전 미커밋 작업은 이번 변경에
합산하지 않는다. 설치·GUI/서비스·실제 모델 시작, commit·push·공증·배포는 하지 않았다.
G2~G5와 사람 클릭·다중 provider·장시간·수면/compact·실제 업데이트 수용은 남아 있다.

## CP-08 일반 Claude 명령 자동 연결 — r63

사용자가 일반 `claude`와 `claude --resume`으로도 연결하도록 요청했다.
[자동 연결](AUTO_CONNECT.md)은 설치 앱의 **설정 → 연결 → Claude 터미널 자동 연결**에서
한 번 켜는 방식이다. 새 zsh에 별도 관리 PATH shim을 추가하고 원래 Claude 실행 파일과
업데이터를 보존한다. 앱 버튼 경로도 유지한다. 이번 작업에서 실제 사용자 셸은 변경하지 않았다.

첫 실제 SessionStart 뒤 private `enroll_observed`가 관측한 대화 ID/source를 등록한다.
대화 선택 화면에서는 권한을 만들지 않는다. 재개한 대화에도 새 scope·자격·readiness를
발급하고 옛 선택을 재생하지 않는다. MCP 초기화가 Hook 등록을 기다려 교착되지 않도록
준비 대기와 논리 세션 연결을 분리했다. 관리 명령·스크립트·명시적 사용자 구성·미지원 CLI
형식은 원래 인자 그대로 Claude에 전달한다. 취소 후 늦은 boundary나 재실행은 차단한다.

주요 파일은 `bridges/claude/swift/service/ClaudeAutoConnect{Command,Bootstrap,Setup}.swift`,
`bridges/claude/src/auto-connect-{client,hook,mcp}.mjs`, 기존 launcher/registry/codec,
`app/ui/settings/ClaudeAutoConnectSettingsView.swift`와 관련 테스트다. 역할별 범위는
[작업 소유권](AGENT_TASKS.md)을 따른다. 새 production dependency는 추가하지 않았다.

| 검증 | 결과 | 증거 (`build/claude-tests/auto-connect/`) |
| --- | --- | --- |
| native·설정·등록·기존 runtime 회귀 | 149개 / 13 suite 통과 | `native-tests-verified.log` |
| 마지막 인자 분류·최종 runtime 재검증 | 위 범위 중 18개 / 4 suite 통과. real PTY startup/resume/picker 취소/preflight 취소 포함 | `native-final-delta.log` |
| adapter/native/authority/Channel source/codec | 48개 / 4 suite 통과. 관측 등록의 native ID 응답 binding과 최초 source 소비 포함 | `source-final.log` |
| Node bootstrap·Hook/MCP·취소·기존 v2 | 47개 통과 | `node-final.log`, `node-final-report.json` |
| runtime/app/schema | 서로 다른 223개 통과. 최초 220개와 nested sandbox 허용 후 3개 재검증 합산 | `node-packaging.log`, `packaging-sandbox-recheck.log` |
| 독립 소스 검토 | CLI variadic 인자·MCP native ID 상속·PATH·취소·옵션 값 오분류 보완 후 미해결 확정 결함 없음 | `source-review.json` |
| 새 release 앱·DMG | 소스 fresh 빌드, Developer ID 앱/DMG 서명 완료 | `build-r63-attempt2.log`, `artifacts/build-executions.json` |
| 저장소 밖 검증 | 공통 profile/build 63, 서명/entitlement, 532개 파일·pin, Node 22.23.2·SDK·자동 연결 모듈 import 통과 | `qualification.json`, `qualification-attempt2.log`, `qualification-manifest-pin.json` |
| 공개 배포 guard | 실제 DMG의 개발 Channels를 공증 전 거부. 업로드/공증 없음 | `qualification.json` |

초기 Swift 실행에서 누락된 fixture runtime 경로·새 파일을 반영하지 않은 fixture hash와
테스트 매크로 컴파일 문제를 고친 뒤 재검증했다. Node의 sandbox UDS 오류와 nested
sandbox 검사 실패는 허용된 환경의 별도 실행으로 구분했다. DMG의 첫 실행은 출력 폴더
누락, 첫 qualifier는 이전 r62의 Codex 버전 가정 때문에 실패했다. 원본 실패 로그와
재실행 결과를 보존하며 제품 결함이나 실제 연결 성공으로 합산하지 않는다.

산출물은 `artifacts/Blabee-0.1.0-arm64-r63.dmg`다. 앱 `0.1.0 / 63`, 현재 소스의
Codex 브릿지 `0.1.2`, Claude 브릿지 `0.1.0`을 포함한다. DMG SHA256:
`d6e79c138717b877026b2f30fc600ebc6775dee7da1d9c25a8bf8d576873bc09`.
Native identity: `sha256:67de75817997ea106e4298e5d4b4fa406b7b74b35bba004e64c15ad2696403b4`.
Assembly manifest: `sha256:b2c591a9e1aa58592174dd42b1b7bd2bc66d6c81e1279525a744337ae0e8d4ec`.

기준점은 406개 파일의 `baseline.json`과 `source-before/`다. 변경 범위와 다른 작업자의
동시 변경은 `scope-report.json`에서 구분한다. 기준점에 포함된 engine·Contracts/v1은
같으며 Codex의 동시 변경은 이 구현으로 보고하지 않는다. 통합 후보에는 fresh 빌드 시점의
현재 Codex 소스가 함께 포함된다. 운영 앱·세션·DB·인증·실제 셸 설정, commit·push는 건드리지 않았다.

서명된 내부 후보는 공증되지 않았고 자동으로 설치하지 않았다. 다음은 사용자가 설치·자동
연결을 켠 뒤 일반 `claude`의 ACK/A 왕복, 정상 종료 뒤 `claude --resume`의 새 ACK와
대화 유지 여부를 [수용 절차](ACCEPTANCE.md)대로 확인하는 것이다. 실제 모델·사람 클릭,
다중 provider·장시간·수면/compact·일반 Channels 승인은 아직 이 후보의 합격 근거가 없다.
