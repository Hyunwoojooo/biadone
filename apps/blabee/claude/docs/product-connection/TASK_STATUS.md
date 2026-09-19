# 제품 연결 작업 상태

기준일: 2026-09-19. **CP-00~CP-04 구현 및 관련 격리 검증 완료**. CP-04 native lifecycle·durable replay 상태·누적 한도와 시간 처리를 구현했다. 설치 앱이나 실제 실행 중인 Claude에는 적용하지 않았다.

| 산출물 | 상태 |
| --- | --- |
| [RESEARCH](RESEARCH.md) | 현재 코드와 Claude 공식 Channels/Plugin/MCP/Hook 근거, 외부 배포 제약 정리 |
| [TECH_SPEC](TECH_SPEC.md) | 등록·60분 sliding lease/5분 owner renewal·독립 readiness·종료/compact/복구·공통 UI·payload 정책 결정 |
| [CODEMAP](CODEMAP.md) | 기존 연결 지점/신규 제안 파일/고정 계약/관련 테스트를 구분 |
| [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md) | CP-00~08, AC-01~16, 실제 모델/설치/일반 배포 G1~G5 분리 |
| [AGENT_TASKS](AGENT_TASKS.md) | 단계별 담당·소유 파일·인계·공유 파일 직렬 편집 규칙 |
| [SESSION_AUTHORITY](SESSION_AUTHORITY.md) | CP-01A 실제 API·시간/회수/commit 계약·신뢰 경계·미연결 범위 |
| [PRODUCT_WIRE](PRODUCT_WIRE.md) | CP-01B 제품 wire 계약·codec·공유 fixture·인증/inner DTO 검증과의 구분 |
| [SESSION_REGISTRATION](SESSION_REGISTRATION.md) | CP-02 private peer·grant FD·scope 등록·별도 metadata·읽기 전용 이력·공통 서비스 조립 |
| [SESSION_LIFETIME](SESSION_LIFETIME.md) | CP-03 같은 authority의 native/inner 연결·private owner renew/end·5분 controller·실제 COMMIT fence |
| [SESSION_LIFECYCLE](SESSION_LIFECYCLE.md) | CP-04 compact/StopFailure·metadata v2 재생 기록·bounded state·조회 cache·공통 timer |

결정한 핵심:

- 한 앱·공통 엔진·한 Pet에서 provider/session을 구분한다.
- 앱의 `Claude에서 시작`과 선택적인 설치 wrapper가 사용자 npm 명령을 대체한다. 세션별 Channels 활성화와 Claude 승인은 유지한다.
- 세션 authority는 살아 있는 owner가 갱신한다. 모델 수신 확인은 5분 nonce ACK로 별도 유지하고 카드 TTL도 독립적이다.
- 서비스 재시작·권한 만료·MCP 프로세스 교체는 첫 제품에서 새 Claude 시작으로 복구한다. 옛 작업을 자동 재전달하지 않는다.
- compact·누적 quota·인증된 metadata·불변 payload까지 장시간 사용 범위에 포함한다.

검토에서 보완한 항목: 내부 ingress의 이중 만료 검사, 수면 포함 시계, prompt/selection/proposal/probe/poll/Channel/Pet 누적 한도, nonce의 Claude transcript 노출 가능성, plugin Channel source, renewal sequence와 authority epoch 분리, compact의 실제 prompt 관측 조건, 조회 중 core 쓰기와 순수 replay 분리, MCP protocol qualification.

## CP-01A 구현과 검증

- [ClaudeSessionAuthority.swift](../../../src/coordinator-swift/Sources/ClaudeCoreAdapter/ClaudeSessionAuthority.swift): 서버 연속 시각 기준 60분 lease, 권장 갱신 간격 5분, 정확한 owner/sequence, 직전 중복의 동일 receipt, 최종 만료·회수, 고정 epoch, opaque ticket과 commit 직전 fence.
- [SessionAuthorityTests.swift](../../shared-engine/Tests/ClaudeCoreAdapterTests/SessionAuthorityTests.swift): 24시간 가짜 시계, 만료 전/정각/후, 시계 역행·극값, 잠자기 전 남은 기한, identity·객체·scope 격리, 갱신·회수·commit 경합, callback 오류 후 잠금 해제.
- owner/IPC 인증, registry, 실제 타이머나 기존 native/inner ingress 변경은 포함하지 않는다. 회수 API가 Claude 작업 자체를 취소하지는 않는다.

| 검증 | 결과 | 증거 |
| --- | --- | --- |
| 신규 authority 단독 | `--filter SessionAuthorityTests --no-parallel`, 14개 테스트 / 파라미터 포함 27개 사례 통과 | [로그](../../build/cp01-authority/authority-tests.log) |
| `npm run test:shared-engine` | Swift 45개(신규 14개 포함), Node 12개 통과. 병렬 authority suite도 통과 | [로그](../../build/cp01-authority/shared-engine-tests.log) |
| 기존 공통 Coordinator 회귀 | 계약 pin·exact SQLite·fake commit·schema/replay binding·시간/권한/재시작 관련 12개 통과 | [로그](../../build/cp01-core-regression/test.log) |
| 독립 코드·테스트 검토 | 현재 범위의 결함·필수 누락 없음 | 시간 경계, 중복 sequence, instance 격리, 회수와 commit의 순서, lock 해제 검토 |

SwiftPM은 sandbox 안에서 `sandbox_apply: Operation not permitted`로 시작하지 못했다. 승인 후 격리 build/cache 경로를 사용하는 동일 테스트를 실행했다. 전체 Swift suite의 기존 SQLite 대용량 이력 테스트가 약 125초 걸렸고, 신규 authority suite는 병렬 실행에서 3.573초에 통과했다. 제품 Keychain·설치 앱·실제 모델은 사용하지 않았다. 로그와 build 결과는 Git에 포함하지 않는다.

기준점은 `claude/build/cp01-baseline-5x41kcl0/`의 919개 파일 hash와 Git 상태다. 기준점 대비 기존 문서 7개만 바뀌었고 기존 소스/테스트 변경·삭제는 없다. 새 Swift 파일 2개와 API 문서 1개를 추가했다. `Contracts/v1` 12개 hash도 동일하다. 기존 미커밋 변경을 이번 구현으로 합산하지 않는다. CP-00 때의 문서 검증(9개 문서·143개 링크, v1 12개 hash 동일)은 설계 완료 당시의 별도 기록이다.

이번 변경 10개 파일의 공백·마지막 개행, 문서 8개의 코드 블록과 로컬 링크 112개를 검사해 통과했다. `git diff --check`도 통과했다.

**실행 중인 Claude의 고정 1시간 grant는 아직 바뀌지 않았다.** 새 클래스의 24시간 fake-clock 통과를 실제 장시간 실행 성공이나 G1~G5 전체 통과로 보고하지 않는다. 기존 모델 A 왕복과 만료 오류는 [기존 QA](../../QA_REPORT.md)를 따른다.

## CP-01B 제품 wire 계약

기존 v1과 별도로 owner·native session v2·Pet provider envelope와 공통 값 schema 4개를 추가했다. 순수 Swift codec은 엄격한 JSON, role/operation, 원 요청과 응답의 correlation, 등록한 비밀값의 반사를 검사한다. 실제 role 인증·현재 권한·private challenge/FD·registry·MCP/Hook/설치 앱 연결은 포함하지 않는다.

공유 fixture 136개를 Swift와 Node Ajv가 각각 읽으며, raw byte·응답 binding·알려진 secret 값은 Swift에서 별도로 검사한다. 기존 root Ajv 개발 의존성을 재사용했고 새 production dependency는 없다. `test:shared-engine` runner에 Node schema 검증을 포함했다.

| 검증 | 결과 | 증거 |
| --- | --- | --- |
| 새 `ProductWireCodecTests` 단독 | 15개 테스트 통과. 공유 fixture 136개·정상/오류 correlation·raw byte·비밀값·opaque/NFC 경계 포함 | [로그](../../build/cp01b-contracts/narrow-tests.log) |
| Node schema 단독 | 142개 통과. 공유 fixture와 UInt64/role/variant 별도 변조 | [로그](../../build/cp01b-contracts/schema-tests.log) |
| `npm run test:shared-engine` | Swift 60개·Node 154개 통과. 신규 suite와 기존 adapter/native/ingress/왕복 포함 | [로그](../../build/cp01b-contracts/shared-engine-tests.log) |
| 기존 v1 계약 | `npm run test:contracts` 129개 통과 | [로그](../../build/cp01b-contracts/legacy-contracts.log) |
| JS 문법 | `npm run check` 39개 파일 통과 | [로그](../../build/cp01b-contracts/syntax.log) |
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
| `npm run test:product-registration` 신규 Swift | 48개 테스트/3 suite 통과. 실제 private socket·SCM_RIGHTS, wrong peer/참조/FD, full pipe 제한 시간, EOF, 복수 scope·Codex, metadata 중간 실패/rollback/경합 | [최종 로그](../../build/product-registration/validation.log) |
| 같은 runner의 기존 연결 회귀 | Node product ingress/native session 16개 통과 | [최종 로그](../../build/product-registration/validation.log) |
| 일반 Coordinator 빌드 | `BLABEE_JOURNAL_TEST_HARNESS` 없이 별도 scratch의 `blabee-coordinator` 빌드 통과. CP-02 소스 경고 없음; 기존 소스의 경고는 유지 | [빌드 로그](../../build/product-registration/production-build.log) |
| 기존 v1 계약 | root `npm run test:contracts` 129개 통과 | [로그](../../build/product-registration/legacy-contracts.log) |
| JS 문법 | Claude `npm run check` 40개 파일 통과 | [로그](../../build/product-registration/syntax.log) |
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
| `npm run test:product-lifetime` 등록/owner | Swift 71개/4 suite·기존 연결 Node 16개 통과. 실제 private socket·FD·일반 UDS, 24시간 fake owner, owner 중복/만료/종료, metadata/core 최종 fence 포함 | [최종 로그](../../build/product-lifetime/validation-final.log) |
| 같은 명령의 공통 엔진 | Swift 76개/5 suite·Node 154개 통과. 신규 native 권한 16개 테스트/26개 파라미터 사례, claim/complete 경합·오류 응답·기존 v1/왕복 포함 | [최종 로그](../../build/product-lifetime/validation-final.log) |
| 일반 Coordinator 빌드 | `BLABEE_JOURNAL_TEST_HARNESS` 없는 별도 scratch의 `blabee-coordinator` 빌드 통과. 설치/실행하지 않음 | [빌드 로그](../../build/product-lifetime/production-build.log) |
| 기존 v1 계약 | root `npm run test:contracts` 129개 통과 | [로그](../../build/product-lifetime/legacy-contracts.log) |
| JS 문법 | Claude `npm run check` 40개 파일 통과 | [로그](../../build/product-lifetime/syntax.log) |
| 추가 기본 SQLite 회귀 | contract pin·exact schema·fake COMMIT trigger·schema version 4개 통과. 추가 선택한 기존 queued-claim 테스트 1개는 카드 만료 간격 오류로 실패 | [로그](../../build/product-lifetime/core-regression.log) |
| 독립 읽기 검토 | native/inner identity·잠금·회수, private owner/EOF, core/metadata fence와 오류 응답 검토 후 현재 범위의 추가 필수 결함 없음 | 코드 검토이며 실제 모델/서명된 owner 증거와 구분 |

초기 fixture의 `proposal.value` 오기와 제품 내부 오류 코드의 wire 변환 누락을 수정한 뒤 전체 CP-03 명령을 통과했다. 초기 실패 로그도 격리 build 폴더에 보존했다. 공통 테스트의 `#require` 중복 macro 경고 1개와 기존 production 소스 경고 2개는 빌드/테스트 실패가 아니다.

추가 queued-claim 실패는 [기존 fixture](../../../src/coordinator-swift/Tests/CoordinatorSwiftTests/SQLiteQueuedActionClaimTests.swift)가 120초 카드 TTL을 만들지만 [routing 검증](../../../src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorRoutingApplication.swift)이 정확히 600초를 요구하는 불일치다. 두 파일의 hash는 CP-03 시작 기준점과 동일하다. `seal_packet` 검증에서 해당 append/COMMIT 및 중복 claim 검사에 도달하기 전에 실패하며, fixture의 journal은 새 gate를 전달하지 않는다. 관련 없는 기존 파일은 수정하지 않았고 별도 후속으로 남긴다.

작업 전 기준점은 `claude/build/cp03-baseline-zqmvm74i/`의 925개 파일 hash와 Git 상태다. 기존 21개 파일과 신규 5개 파일만 변경했다. 신규는 owner controller·제품 journal wrapper·각 Swift 테스트·구현 문서다. 삭제·새 의존성·`Contracts/v1` 12개 파일 변경은 없다. 변경한 26개 파일의 공백·마지막 개행, 문서 11개의 코드 블록과 로컬 링크 190개, scoped `git diff --check`를 확인했다. [변경 범위 기록](../../build/product-lifetime/scope-report.json)에 파일 목록을 남겼다. 다른 미커밋 변경은 이번 구현에 합산하지 않았고 commit·push·앱 설치/교체는 하지 않았다.

실제 서명된 owner·설치 서비스·Claude 모델 왕복·Mac 수면 복귀·실제 24시간 사용은 검증하지 않았다. private owner callback 처리 중 EOF 확인은 callback 반환까지 지연될 수 있으며 registry control에는 저장소 I/O를 넣지 않는다. 실제 자식 종료 관측은 설치 launcher CP-05에 남아 있다. CP-03에는 CP-04의 compact·durable tombstone·누적 quota와 CP-06 UI를 포함하지 않았다. CP-04 결과는 아래에 별도로 기록한다. 따라서 현재 개발 launcher의 고정 1시간 연결 오류를 이번 단계에서 해결했다고 보고하지 않는다.


## CP-04 수명 관측과 장기 상태

[구현 문서](SESSION_LIFECYCLE.md)에 상태 전이·저장·시간 처리와 검증 경계를 기록했다. 구현과 관련 격리 자동 검증을 완료했으며, 실제 모델·설치 앱 수용은 후속이다.

- 같은 prompt의 compact는 새 내부 boundary를 만든다. 누락·불일치·현재 prompt의 digest 충돌은 미claim 카드/readiness를 폐기하며 이미 claim한 원래 결과 보고를 보존한다. Stop의 background 미관측·관측된 없음·활성을 구분하고 StopFailure를 완료로 처리하지 않는다.
- metadata v2는 prompt/proposal/selection/Hook replay key와 파생 lookup을 HMAC audit·freshness에 묶는다. 일반 검증은 이력을 순차 처리하며 v1은 history-only로 읽는다. core strict schema와 `Contracts/v1`은 그대로다.
- 제품 lifetime 횟수 제한을 현재 상태·32개 미보고 claim·시간 창 rate limit으로 바꿨다. Channel은 마지막 sequence/digest, Pet는 현재 카드 시도·응답만 보관한다.
- poll/Pet 조회는 core 쓰기를 하지 않는다. 만료는 즉시 선택/전달을 차단하고, durable 정리는 후속 mutation 또는 scope별 단일 maintenance 작업에서 처리한다. 공통 scheduler는 한 scope의 저장/COMMIT 잠금을 기다리지 않는다.

| 검증 | 결과 | 증거 |
| --- | --- | --- |
| 등록/metadata/registry/owner/Pet transport | Swift 98개/5 suite·Node 16개 통과. 실제 SQLite 1,000개 replay key, lookup 변조·crash·이력, 만료 poll 무쓰기·느린 scope/Codex 격리, Pet 500회 포함 | [등록 단계 로그](../../build/product-lifecycle/registration-validation.log) |
| 기존 공통 엔진 | Swift 76개/5 suite 통과. 기존 race 조건과 제한 시간 유지 | [공통 엔진 단계 로그](../../build/product-lifecycle/shared-base-validation.log) |
| 제품 lifecycle 경계·짧은 왕복 | Swift 14개 통과. 메모리/SQLite 각 3회에서 원래 ID·내부 성공 상태·보고문 검증, 1,000 prompts, 100,000 polls와 1,000 snapshots 포함 | [로그](../../build/product-lifecycle/lifecycle-short-validation.log) |
| 제품 lifecycle 누적 왕복 | Swift 1개 통과. 메모리 journal로 native/core 500회 왕복, 성공 결과 500개·Channel 전달 1,000개·원래 선택 ID와 보고문 확인 | [로그](../../build/product-lifecycle/lifecycle-validation.log) |
| 공통 연결·제품 계약 Node | 164개 통과. 공유 fixture 146개, 실제 공통 엔진 왕복 포함 | [로그](../../build/product-lifecycle/shared-node-validation.log) |
| v2 Hook·Channel helper | Node 12개 통과. 1,000개 cursor 전달, notify 실패 후 재전송 금지, raw background 관측·StopFailure 정규화 | [로그](../../build/product-lifecycle/node-initial.log) |
| 제품 schema | 공유 fixture 146개를 포함한 Node 152개 통과 | [로그](../../build/product-lifecycle/schema-initial.log) |
| 기존 v1 계약 | root `npm run test:contracts` 129개 통과 | [로그](../../build/product-lifecycle/legacy-contracts.log) |
| JS 문법 | `npm run check` 44개 파일 통과 | [로그](../../build/product-lifecycle/syntax.log) |
| 일반 제품 빌드 | 테스트 define 없는 `blabee-coordinator` 빌드 통과. CP-04 소스 경고 없음; 기존 Codex 소스 경고 2개 유지 | [로그](../../build/product-lifecycle/production-build.log) |
| 독립 읽기 검토 | 제안 ID 문법, scheduler의 저장/authority 잠금 대기, 만료 poll, 현재 digest 충돌을 보완한 뒤 현재 범위의 추가 필수 결함 없음 | 소스·fixture 검토이며 실제 모델 수용과 구분 |

초기 인자 순서·테스트 helper 컴파일 오류는 수정했다. 첫 공통 병렬 실행은 긴 동기 반복 fixture와 기존 semaphore 경합 테스트가 겹쳐 9개 issue를 기록했다. 긴 suite를 별도 실행한 뒤 기존 76개가 통과했으며 assertion이나 timeout을 완화하지 않았다. 초기 병렬 실패는 [전체 실행 로그](../../build/product-lifecycle/registration-and-parallel-shared.log)에 남겼다. 메모리 journal의 debug 실행과 release 초기 실행도 비용을 확인한 뒤 중단했다. 최종 장기 fixture는 release 빌드에서 각 반복의 Foundation 임시 객체를 autoreleasepool로 해제하고 직렬 실행한다. 검증 완료한 각 단계의 로그를 분리했으며, 최종 집계 명령을 다시 전부 실행한 결과로 표시하지 않는다.

500회 실제 SQLite 디버그 실행은 약 4~5분에 43회 완료 상태를 관측한 뒤 테스트 프로세스만 종료했다. 따라서 이 실행은 500회 성공 증거가 아니다. 반복 횟수와 실제 native/ingress/core 상태 전이는 테스트용 메모리 journal로 검사하며, 같은 helper의 SQLite 3회와 별도 registry·metadata·COMMIT 검증을 유지한다. 실제 SQLite metadata의 1,000개 소비 검사는 331.767초에 통과했다. 이 비용과 디버그 core 반복 비용은 제품 후보의 대규모 이력 성능을 별도 측정해야 할 근거이며, 설치 사용의 지연으로 일반화하지 않는다. 수정 전 release fixture 실행 중 [1초 호출 스택 표본](../../build/product-lifecycle/lifecycle-process-sample.txt)도 선택 claim 아래 semantic replay와 StrictJSON 처리를 확인했다. 이는 그 시점의 표본이며 전체 시간 비율이나 제품 서비스 벤치마크는 아니다.

기준점 `claude/build/cp04-baseline-ygujs80_/`의 930개 파일과 비교해 기존 27개 파일을 변경하고 7개를 추가했다. 삭제·새 의존성·`Contracts/v1` 12개 파일 변경은 없다. 34개 파일의 공백·마지막 개행과 scoped `git diff --check`가 통과했다. [변경 범위](../../build/product-lifecycle/scope-report.json)에 목록을 남겼다. 다른 미커밋 변경은 합산하지 않았고 commit·push는 하지 않았다.

최초 완주한 장기 실행은 500회 자체와 projection의 500개 결과·1,000개 전달을 확인했지만, 마지막 raw-state 비교가 외부 `completed`를 내부 상태값으로 사용해 실패했다. 실제 core는 `succeeded`로 저장한다. [수정 전 결과](../../build/product-lifecycle/lifecycle-before-status-fix.log)는 500회 3,910.471초·전체 3,991.654초이며 성공 로그로 사용하지 않는다. 기대값을 고친 뒤 같은 helper의 메모리 3회·SQLite 3회를 포함한 14개를 73.096초에 통과했고, 마지막 500회 검사도 4,035.191초에 통과했다. 두 실행을 합쳐 lifecycle 15개 테스트가 통과했다. runner도 짧은 검사를 먼저 실행한다. 테스트용 메모리 append의 중복 candidate replay만 제거했고, 실제 core의 commit 전 candidate 검증·CAS·authority fence와 마지막 전체 replay·개수·원래 ID·보고문 검사는 유지했다. 이 긴 검사는 일반 `test:shared-engine`과 분리되어 있으며 자동 테스트의 통과를 실사용 성능 충족으로 해석하지 않는다.

현재 개발 launcher와 설치 앱·실제 Claude 세션은 바꾸지 않았다. 새 v2 helper의 실제 client 연결은 CP-05, 제품 Pet wire/UI는 CP-06다. 실제 compact·모델 왕복·2시간/8시간 사용·수면 복귀와 설치/일반 배포는 G2~G5에 남아 있다. 기존 queued-claim 120초/600초 fixture 불일치도 이번 범위에서 수정하지 않았다.
