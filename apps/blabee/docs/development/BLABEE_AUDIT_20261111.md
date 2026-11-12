# Blabee 전체 감사 (2026-11-11)

상태: 조사 전용. 이 문서 외에 저장소·설치 앱·실행 중 서비스·운영 DB는 바꾸지 않았다.
기준: 브랜치 `feat/common-lineage-v01-verifier`, HEAD `ae502b1`(r91 게시 기록), 작업 트리 clean. 설치 앱은 build 89.

방법: 여섯 영역(Engine, Codex Bridge, Claude Bridge, 앱 셸, DB·계정·텔레메트리, 저장소·테스트·문서)을 각각 읽기 전용으로 감사하고,
영역마다 영향이 큰 주장 4~6개를 원본 코드나 기록으로 다시 대조했다. 실행 환경(프로세스, 저장 폴더, 세션 기록, npm 레지스트리)은 직접 측정했다.
Swift 빌드·테스트는 돌리지 않았다. 각 항목의 확신도는 아래 세 가지로 적는다.

- **확인**: 코드 경로를 끝까지 읽었거나 측정·기록으로 뒷받침됨
- **코드 확인, 미재현**: 코드상 성립하지만 실제로 일으켜 보지는 않음
- **의심**: 구조는 확인했으나 외부 동작(Codex, Claude Code, Apple, Supabase)에 달려 있음

용어는 문서 끝 "용어"에 모았다.

## 1. 가장 심각한 것 (영역 통합 순위)

| # | 문제 | 한 줄 요약 | 상세 |
| --- | --- | --- | --- |
| 1 | Codex 버전을 따라잡지 못한다 | Codex 안정판은 2~3일마다 나오는데 Blabee는 버전마다 수동 등록과 새 앱 릴리스가 필요하다. 이 Mac은 0.167.1, 지원 목록은 0.166.0에서 끝난다. 미지원 상태에서도 카드는 뜨지만 선택은 전부 실패한다 | CDX-1, CDX-7 |
| 2 | 앱이 스스로 업데이트를 확인하지 않는다 | 확인은 사용자가 버튼을 눌러야만 실행된다. 그래서 r91 게시 5일 뒤에도 설치본은 r89다. 고친 것이 사용자에게 도달하지 않는다 | APP-2, APP-3, APP-6 |
| 3 | Claude 연결이 일상 동작으로 영구히 끊긴다 | 모델이 `cd`로 폴더를 옮기거나, `/resume`·`/clear`, 1시간 넘는 잠자기, 서비스 재시작, heartbeat 한 번 실패 중 하나만 있어도 그 창은 끝이다. 복구는 창 재시작뿐 | CLD-1, CLD-2, CLD-3 |
| 4 | 요청마다 저장 기록 전체를 다시 검증한다 | 상태를 바꾸는 요청 한 번에 journal 전체를 3~11회 읽고 검증한다. 기록은 지워지지 않고 계속 쌓인다. 저장소 자체 벤치에서 2,500 이벤트일 때 3.5~3.9초, Hook 제한은 3.9초다 | ENG-1, ENG-2, ENG-3, CLD-9 |
| 5 | 같은 사용자 권한의 아무 프로세스나 승인 카드를 대신 누를 수 있다 | 메인 소켓은 사용자 ID만 확인한다. 승인·선택 요청은 Pet 전용 비밀값 없이 통과한다 | APP-4 |
| 6 | 릴리스가 테스트보다 먼저 공증된다 | 릴리스 스크립트는 git에 없는 `build/` 폴더에 매번 복사되고, r91은 전체 테스트가 끝나기 전에 공증됐다. CI는 없다. 게시된 빌드와 커밋이 대응하지 않는다 | REPO-1, REPO-2, REPO-4, APP-7 |
| 7 | 아무 일도 없을 때도 계속 일한다 | Pet은 초당 2회, 서비스는 초당 4회, Claude 창마다 초당 2회씩 깨어난다. 프로세스 2개가 각각 CPU 약 1%를 상시 사용한다 | APP-1, ENG-11, CLD-10 |
| 8 | 프롬프트·실행마다 지연이 붙는다 | Codex Hook 한 번에 앱 전체 서명 검증 2회(추정 0.35~0.45초), `claude` 실행 시 서명 검증 약 14회와 payload 해시 3회(추정 1.5~2초), Claude Hook 실측 190~280ms | CDX-2, CLD-4, CLD-9 |
| 9 | 한 번의 일시 오류가 영구 차단으로 굳는다 | Codex 전달 실패(네트워크·타임아웃 포함)가 디스크에 저장되어 수동 재검사 전까지 모든 전달을 막는다. 업데이트가 한 번 꼬이면 인앱 업데이터가 잠긴다. 초기 활성화 5회 실패는 전 세션을 막는다 | CDX-3, APP-3, ENG-5, ENG-6 |
| 10 | 모든 Pet 동작이 Supabase 응답에 달려 있다 | 접근 확인을 60초마다 영구히 호출하고, 200이 아닌 응답 하나로 즉시 차단된다. 사용 통계 RPC에만 일일 한도가 없다 | DB-1, DB-2, DB-7 |
| 11 | 테스트 시간이 한두 곳에 몰려 있다 | Swift 테스트 1개가 전체의 72%(410초)다. Node 테스트는 같은 Swift 제품을 7번 새로 빌드한다(169초) | REPO-3, REPO-6 |
| 12 | 실사용에서 선택까지 가는 경우가 드물다 | 이 프로젝트 세션 19개 기록: 연결 확인 17회, 성공한 제안 5회, 선택 1회 | 2절, CLD-12, CLD-6 |

## 1-1. 전체 우선순위 목록 (91건을 42개 묶음으로)

순위 기준은 차례로 다음과 같다. 지금 사용자에게 기능이 죽어 있거나 조용히 사라지는가, 보안 문제인가, 되돌릴 수 없는 실수를 부르는가,
시간이 갈수록 나빠지는가, 상시 비용인가, 유지보수 부담인가. 규모는 수정 방향을 보고 어림한 값이다.

### 1순위: 지금 기능이 죽어 있거나 조용히 사라지는 것, 보안

| 순위 | 문제와 영향 | 규모 | 항목 |
| --- | --- | --- | --- |
| 1 | 앱이 스스로 업데이트를 확인하지 않는다. 고친 내용이 사용자에게 도달하지 않는다 | 중간 | APP-2 |
| 2 | 지원 목록보다 새 Codex에서 카드는 뜨는데 선택이 전부 실패하고 안내가 막다른 길이다 | 중간 | CDX-1 |
| 3 | 모델이 `cd`로 폴더를 옮기면 Claude 연결이 영구 종료되고 안내문은 원인을 잘못 말한다 | 중간 | CLD-1 |
| 4 | Claude 쪽 MCP 서버가 heartbeat 한 번 실패나 서비스 재시작으로 영구 종료된다 | 중간 | CLD-3 |
| 5 | 1시간 넘게 잠자기 하면 열린 모든 Claude 창의 연결이 끝난다 | 큼 | CLD-2 |
| 6 | 같은 사용자 권한의 프로세스가 승인과 선택을 대신 보낼 수 있다 | 중간 | APP-4 |
| 7 | 업데이트가 한 번 꼬이면 인앱 업데이터가 영구히 잠긴다. 비정상 종료 기록은 재시동 전까지 업데이트를 막는다 | 중간 | APP-3, APP-6 |
| 8 | Codex 전달의 일시 실패가 저장되어 수동 재검사 전까지 모든 전달을 막는다 | 작음 | CDX-3, CDX-12 |
| 9 | 릴리스가 테스트와 번들 런타임 검사보다 먼저 공증되고, 절차가 git 밖에 있다 | 중간 | REPO-1, REPO-5, APP-7, APP-10 |
| 10 | 서비스가 죽어도 표시와 재시작이 없어 카드와 승인이 조용히 멈춘다 | 작음 | APP-8 |

### 2순위: 시간이 갈수록 나빠지거나 한 번 터지면 큰 것

| 순위 | 문제와 영향 | 규모 | 항목 |
| --- | --- | --- | --- |
| 11 | 엔진이 요청마다 불필요한 전체 스캔과 Keychain 호출을 더한다. 설계를 바꾸지 않고 절반 이하로 줄일 수 있다 | 중간 | ENG-7, ENG-8 |
| 12 | 엔진이 요청마다 journal 전체를 다시 검증한다. 기록이 늘수록 느려져 Hook 제한 시간에 닿는다 | 큼 | ENG-1 |
| 13 | journal과 비밀값 목록이 무제한으로 늘어난다 | 큼 | ENG-2, ENG-3 |
| 14 | Claude 세션 저장소도 변경마다 전체를 검증한다. Swift 테스트 410초의 원인이다 | 중간 | CLD-9, REPO-3 |
| 15 | 엔진의 전역 차단 경로. 5회 실패 격리, 중단된 기록 뒤 영구 잠김, 한 요청이 전체를 막음, 느린 재시작 복구 | 큼 | ENG-5, ENG-6, ENG-4, ENG-12 |
| 16 | Codex 버전 하나 등록에 21개 파일이 바뀐다. 0.166.0 전용 분기 때문에 이후 버전이 전부 잘못된 패키지로 보인다. 새 버전 감시가 없다 | 큼 | CDX-7, CDX-10, CDX-14, REPO-17 |
| 17 | 모든 Pet 동작이 Supabase 응답에 의존한다. 200 외 응답은 즉시 차단하고 60초마다 영구 호출한다 | 작음 | DB-2, DB-7 |
| 18 | 사용 통계 RPC에만 일일 한도가 없고, 보존 정리는 감시 없는 예약 작업에 의존한다 | 작음 | DB-1, DB-3 |
| 19 | "계정과 함께 삭제"를 약속하지만 삭제 수단이 없다. 온보딩 재실행 시 통계 동의 처리가 어긋난다 | 작음 | DB-4, DB-11 |
| 20 | Claude 카드는 10분 떠 있지만 5분 뒤 클릭은 거부된다. 거절된 제안은 재시도해도 다시 거절된다. 같은 프롬프트 ID가 다시 관측되면 boundary가 폐기된다 | 중간 | CLD-6, CLD-7, CLD-5 |
| 21 | Claude 선택 전달이 Claude Code 내부 문구의 바이트 일치에 의존한다. 2.1.322에서 확인되지 않았다 | 작음 | CLD-8 |
| 22 | Codex 승인 요청의 키나 폴더가 조금만 달라도 Pet 승인 카드가 조용히 생략된다. SessionStart 안내 한도가 맞지 않는다 | 중간 | CDX-5, CDX-8 |
| 23 | Codex 전달이 세션과 다른 `codex`를 쓸 수 있고, 일부 설치 방식은 미설치로 보인다 | 중간 | CDX-6 |
| 24 | CI가 없고 게시된 빌드가 커밋과 대응하지 않는다. 모든 작업이 한 브랜치에 있다 | 중간 | REPO-4, REPO-2 |
| 25 | README가 r85를 안내하고 공개 문서 저장소는 r89에 머물러 있다 | 작음 | REPO-9 |
| 26 | Pet의 가짜 끊김 표시, 세션 1,024개 상한, 타이머 지연 시 승인 카드 누락 가능성 | 중간 | APP-5, ENG-13, APP-13 |

### 3순위: 상시 비용과 지연

| 순위 | 문제와 영향 | 규모 | 항목 |
| --- | --- | --- | --- |
| 27 | 아무 일이 없어도 Pet은 초당 2회, 서비스는 4회, Claude 창마다 2회 폴링한다 | 큼 | APP-1, ENG-11, CLD-10 |
| 28 | Codex Hook마다 앱 전체 서명 검증을 2회 한다 | 중간 | CDX-2 |
| 29 | `claude` 실행마다 서명 검증 약 14회와 payload 해시 3회를 한다 | 중간 | CLD-4 |
| 30 | Codex는 프롬프트마다 같은 안내문 3,760자를 넣는다. Claude는 연결 확인 도구가 제안보다 많이 호출된다 | 중간 | CDX-4, CLD-12 |
| 31 | 디스크 누수. 숨은 앱 백업 1.2GB, 옛 런타임 사본, 실행마다 남는 Claude scope와 Keychain 항목, 저장소의 방치 폴더 2GB | 작음 | APP-9, CLD-11, REPO-10 |
| 32 | 테스트 속도. Node 테스트의 Swift 7회 새 빌드, 직렬 실행, 단일 대형 모듈 | 중간 | REPO-6, REPO-12, REPO-11 |
| 33 | 텔레메트리 클라이언트가 이벤트마다 큐 전체를 다시 쓰고 요청을 따로 보낸다 | 작음 | DB-10 |
| 34 | 관리형 Codex 경로는 출시 앱에 실행기가 없는데 브릿지 코드의 절반을 차지한다 | 결정 필요 | CDX-9 |
| 35 | Claude 실행기가 사용자의 환경 변수를 지우고 다른 MCP 서버 설정까지 바꾼다 | 작음 | CLD-13 |

### 4순위: 유지보수 부담과 정리

| 순위 | 문제와 영향 | 규모 | 항목 |
| --- | --- | --- | --- |
| 36 | 손으로 맞추는 고정값이 여러 곳에 흩어져 있다. r90을 폐기시킨 종류다 | 중간 | CLD-14, REPO-8, APP-11, ENG-10 |
| 37 | Node 참조 엔진이 Swift와 어긋나 현재 기록을 처리하지 못한다 | 결정 필요 | ENG-9, REPO-14 |
| 38 | DB 로직 대부분에 자동 테스트가 없고 운영 DB가 저장소와 같은지 확인할 수단이 없다 | 중간 | DB-5, DB-6 |
| 39 | 언어 처리와 용어 혼용. 기본값이 영어이고 언어를 바꿔도 굳은 문구는 그대로다 | 큼 | APP-12 |
| 40 | 출시되거나 테스트되는 레거시와 죽은 코드 | 중간 | CLD-15, CDX-13, ENG-15, APP-15, REPO-15, DB-12, DB-13 |
| 41 | 문서 불일치, 깨진 링크 84개, 사라진 증거 경로, 중복된 에이전트 지침 | 작음 | REPO-7, REPO-13, REPO-16, DB-15 |
| 42 | 작은 버그와 비효율 | 작음 | ENG-14, APP-14, DB-8, DB-9, DB-14, CDX-11 |

## 2. 직접 측정한 값

| 항목 | 값 |
| --- | --- |
| 설치 앱 | `/Applications/Blabee.app` build 89. 게시 최신은 r91(2026-11-06) |
| 이 Mac의 Codex | 감사 시작 시 0.167.0, 도중 Homebrew가 0.167.1로 올림 |
| 지원 목록 | 30개 버전 문자열. 마지막 0.166.0, 0.165.0 없음 |
| Codex 안정판 간격 | 최근 20개 평균 2.65일, 중앙값 2일(npm 레지스트리) |
| 최근 공개일 | 0.164.0 10-23, 0.165.0 10-27, 0.166.0 10-29, 0.167.0 11-06, 0.167.1 11-10 |
| Blabee 지원 기록일 | 0.164.0 10-24, 0.166.0 11-04(r91 게시 11-06은 0.167.0 공개일) |
| idle 프로세스 | Pet 앱 RSS 99MB, 서비스 RSS 114MB. 각각 CPU 약 1%, context switch 초당 약 50·38 |
| 저장 폴더 | `~/Library/Application Support/Blabee` 395MB: 앱 사본 2개 276MB, Claude payload 112MB, 저장소 7MB |
| 숨은 백업 | `/Applications/.Blabee.backup-*.app` 21개 1.2GB(9-09~10-19) |
| journal | 이벤트 701, 패킷 209, 검증 기록 9. 1.9MB + WAL 0.6MB. 10-19 생성, 하루 약 30 이벤트 |
| Claude Hook | SessionStart 중앙값 277ms(최대 407ms, n=11), 실패한 UserPromptSubmit 약 190ms |
| 주입 글자수(설치 r89) | Claude 프롬프트마다 1,250자. r91 소스는 한 줄(62자) |
| Blabee 도구 호출(세션 19개) | check 8, ack 9(실패 1), emit 6(실패 1), claim 1, complete 1 |
| 저장소 | Swift 362파일 19만 줄, mjs 152파일 5.1만 줄, md 210파일 3.2만 줄. 미추적 대용량: build 1.6G, src 1.1G, demo-site 466M, ui-demos 231M, tmp 181M |
| 브랜치 | main보다 60 커밋 앞. 공개 문서 저장소 clone에 r91 문서 수정이 미커밋 |

기록으로 확인한 사례: 11-06 세션에서 UserPromptSubmit Hook이 프로젝트 루트에서는 14번 성공했다.
작업 폴더가 `build/release-public-20261106-r90/github-publication`으로 옮겨진 뒤 첫 프롬프트(10:08:34)부터 6번 연속 `claude_bootstrap_session_changed`로 실패했다. `/resume`은 없었다.

## 3. Engine

읽은 파일 약칭: J=`engine/persistence/SQLiteJournal.swift`, SA=`engine/semantic/CoordinatorSemanticApplication.swift`, SS=`engine/semantic/CoordinatorSemanticState.swift`,
R=`engine/routing/CoordinatorRoutingApplication.swift`, O=`app/coordination/CoordinatorOperationalApplication.swift`, U=`app/service/UnixDomainSocketTransport.swift`.

요청 한 번의 비용(코드 경로를 읽어 센 값):

| 동작 | 전체 스캔 | 전체 replay | Keychain 호출 | 커밋 |
| --- | --- | --- | --- | --- |
| Pet 상태 조회, `stop`, 열린 카드 없는 사람 프롬프트 | 0 | 0 | 0 | 0 |
| 열린 카드 하나를 대체하는 프롬프트 | 5 | 3 | 9 | 1 |
| `emit_decision` | 4 | 2 | 8 | 1 |
| `dismiss_interaction` | 3 | 1 | 7 | 1 |
| `select`(이어지는 queued 프롬프트 포함) | 11 | 5 | 23 | 3 |
| 카드 만료 | 7 | 3 | 15 | 2 |

스캔 한 번은 모든 행에 HMAC 검증 1회, strict JSON 파싱 2회, 스키마 검증 2회, 비밀값 검사 2회를 한다.

- **ENG-1 (높음, 확인)** 상태 변경 요청마다 journal 전체를 3~11회 다시 검증하고 1~5회 replay한다. 요청 사이에 남는 상태가 없다. 근거 J:257, J:429, J:571, J:1083, SA:173-174, SS:410-411. 저장소 벤치(`docs/features/QUEUED_HOOK_ORDERING.md:398-408`)는 2,500 이벤트에서 claim 1회 3,464~3,947ms(debug 빌드)다. Hook 응답 제한은 3,900ms(`bridges/codex/swift/hooks/OperationalCLI.swift:129`). 방향: 검증된 메모리 projection을 유지하고 추가분만 검증.
- **ENG-2 (높음, 확인)** `runtime_events`·`packet_documents`·`verification_records`를 줄이는 코드가 없다. `docs/features/RESOURCE_STABILITY.md:32`가 미구현이라고 적는다. ENG-1 비용이 설치 수명 내내 선형으로 늘어난다. 방향: 인증된 체크포인트(스키마 변경 절차 필요).
- **ENG-3 (중~높음, 확인)** `RuntimeSecretCorpus`는 프로세스 수명 동안 지워지지 않는 배열이고, 모든 스캔의 모든 행에서 선형 탐색한다(`engine/validation/RuntimeSecretCorpus.swift:10-34`, J:1262-1263). 제안·선택·토큰마다 항목이 늘어 ENG-1에 비밀값 수가 곱해진다. 시간은 미측정.
- **ENG-4 (중~높음, 코드 확인)** 모든 journal 작업이 단일 actor에서 동기로 돈다(O:40, R:118). 한 요청이 느려지면 Pet 조회(제한 500ms, `app/service/PetTransport.swift:69-70`)와 다른 세션 Hook(5초)이 줄줄이 타임아웃한다.
- **ENG-5 (중, 확인)** 초기 활성화가 5회 연속 실패하면 전역 quarantine이 걸려 재시작 전까지 모든 세션의 요청이 거부되고 스케줄러도 멈춘다(O:819-828, O:916, O:1405-1419). 디스크 오류 약 3.75초, Keychain 장애 약 233초면 도달한다. 시간이 지나도 풀리지 않는다.
- **ENG-6 (중, 코드 확인)** Keychain에 pending을 쓴 뒤 SQLite COMMIT 전에 중단되면 저장소가 영구 fail-closed가 되어 데몬이 다시 뜨지 않는다(J:519-542, J:249-262, J:882, R:153). 종료 시 진행 중 요청을 기다리지 않는다(U:1064). `docs/features/ENGINE_DEBUG_20261003.md` 3절이 자동 복구 없음을 적는다. 의심: `fullfsync` 미설정(J:806)으로 정전 시 rollback 오탐.
- **ENG-7 (중, 확인)** routing이 불필요한 전체 스캔을 더한다(R:1705, R:259, R:2038, R:1861, R:1946). `select`는 연속 append 2회를 따로 커밋한다(O:3827, O:3891). 무결성 설계를 건드리지 않고 `select`를 11회에서 4~5회로 줄일 수 있다. 가장 싼 개선.
- **ENG-8 (낮~중, 확인)** append마다 Keychain XPC 6회, load마다 1회, 매번 새 `LAContext`(`engine/persistence/KeychainFreshnessAnchorStore.swift:43,130,135,176`). 잠금 파일은 매번 경로 전체를 `openat`으로 걷는다.
- **ENG-9 (중, 확인)** Node reference engine은 `queued_action_context_claimed`를 모른다(`Tests/support/reference-engine/*.mjs`에 0건, `state.mjs:219`가 미지 이벤트를 거부). 현재 journal을 replay할 수 없는데 `engine/CLAUDE.md` 변경 절차 4단계는 여전히 필수로 적는다.
- **ENG-10 (중, 확인)** 이벤트 타입 하나를 추가하려면 같은 목록을 7곳에서 고친다(`V1IngressValidator.swift:427`, SA:618, SS:1037, 스키마, `decide.mjs:22`, `state.mjs:22`, `Tests/Contracts/semantic-trace.mjs:23`). 정규식 전체 일치 수정은 한 곳(`V1IngressValidator.swift:592`)에만 들어갔다.
- **ENG-11 (낮~중, 확인)** 스케줄러가 250ms마다 영구히 깬다(U:1466). APP-1과 같은 문제의 서버 쪽.
- **ENG-12 (낮~중, 코드 확인)** 재시작 복구가 이력에 선형이고 소켓 공개 전에 돈다(`integrity_check`, 스캔 3회 이상, replay 2회). 레거시 unsealed 상태는 매 시작마다 다시 quarantine되고 빠져나오는 절차가 문서에 없다(R:1585).
- **ENG-13 (낮~중, 확인)** 세션 표가 1,024개에서 막힌다(O:95, O:1734-1737). 서비스 수명 동안 지우지 않으므로 초과하면 새 세션은 재시작 전까지 Blabee를 못 쓴다. `boundaries`·`registrations`도 내용만 비우고 항목은 남긴다.
- **ENG-14 (낮)** 메모리와 journal이 어긋나는 경로 2개. (a) `processTime` 밖에서 생긴 notice가 큐에 남아 `update_status.ready`가 false로 유지됨(R:124, R:1117-1163, 코드 확인). (b) emit 일시 실패 뒤 Stop이 cooldown 중에 오면 카드가 선택 불가 상태로 600초 뒤 만료(의심).
- **ENG-15 (낮, 확인)** `open_boundary`·`seal_packet`·`reserve/claim_format_repair`는 제품 호출자가 없다. 레거시 stdin NDJSON 입구(`app/entrypoints/main.swift:374`)로만 닿는다.

## 4. Codex Bridge

- **CDX-1 (높음, 코드 확인. 이 Mac의 현재 상태)** 지원 목록보다 새 Codex에서 Hook은 계속 안내문을 넣고 카드를 띄우지만 선택은 전부 실패한다. 실패 코드 `codex_native_version_unqualified`는 캐시된다. Pet은 "Codex 실행 검사를 다시 진행해 주세요"라고 안내하지만 재검사 결과도 "아직 검증되지 않았습니다"라서 막다른 길이다. 일회성 승인도 꺼진다. 관리형 경로는 "unsafe bundle"로 잘못 표시한다. 근거 `bridges/codex/swift/setup/CodexCompatibility.swift:19-50`, `CodexPluginSetup.swift:803-806`, `CodexNativeFailureGuard.swift:26-27,121-125`, O:1580-1610, `app/coordination/PetViewModel.swift:104-124`, `CodexRuntimeBundle.swift:45-51`. 방향: 미지원이면 Hook이 `enabled:false`나 한 줄 안내만 돌려주고, Pet에 "Codex X 아직 미지원" 상태 하나를 보여준다.
- **CDX-2 (높음, 확인. 지연은 추정)** Hook 이벤트마다 138MB 앱 전체의 정적 서명 검증을 2회 한다. 캐시가 없고, 활성화하지 않은 프로젝트와 Blabee가 꺼져 있을 때도 치른다. launcher는 100ms 단위로 폴링하고 프로세스를 12개 이상 띄운다. 근거 `app/entrypoints/main.swift:1613`, `app/service/AppRuntimeUseLease.swift:119-122`, U:73-80, U:478-515, `bridges/codex/plugin/scripts/blabee-launcher:153-158`. r91 산출물에서 검증 1회 0.10~0.11초(M5). 이벤트당 0.35~0.45초 추정.
- **CDX-3 (중~높음, 확인)** 카드 전달 1회에 온라인 공증 확인 2회와 271MB 바이너리 서명 검증 6회를 한다. 공증 조회 실패, 5초 초과, 프로세스 종료가 실패 기록으로 저장되어 사용자가 재검사를 누를 때까지 모든 전달을 막는다(`CodexNativeRuntime.swift:318-329`, `CodexNativeFailureGuard.swift:26-35,128-156`). 설정 화면이 플러그인 검사를 도는 동안 카드를 누르면 2초 뒤 선택이 사라진다(`:463-496`). 방향: 네트워크·타임아웃 계열은 저장하지 않거나 짧은 유효기간.
- **CDX-4 (중, 확인)** UserPromptSubmit마다 같은 문구 3,214자와 boundary 줄 약 550자를 넣는다. 도구 설명 2,086자와 `SKILL.md` 9,546바이트에 같은 내용이 또 있다(`engine/semantic/BlabeeSuggestionMode.swift:39-68`, O:4764-4765). Claude 쪽은 r91 소스에서 한 줄로 줄였다.
- **CDX-5 (중, 확인. 빈도 미측정)** PermissionRequest에 키가 하나라도 추가되거나 `cwd`가 세션의 마지막 프롬프트 폴더와 다르면 Pet 승인 카드가 조용히 생략된다(O:1938-1945, O:1979-1984, O:1998-2005). `tool_hook_cwd` 처리는 여전히 0건이고 hooks.json에 Bash matcher도 없다.
- **CDX-6 (중, 코드 확인)** 전달은 고정 목록에서 찾은 `codex`를 쓴다. 세션을 띄운 Codex와 무관하다. 서비스 PATH가 `/usr/bin:/bin:/usr/sbin:/sbin`이라 bun·pnpm·asdf·mise 설치는 "미설치"로 보인다(`app/service/AppOwnedServiceProcess.swift:53-58`, `CodexPluginSetup.swift:200-240`). `CODEX_HOME`도 무시한다.
- **CDX-7 (중, 확인)** 버전 하나 등록에 약 21개 파일, 1,300줄 이상이 바뀐다. catalog가 `CodexRuntimeBundle.swift`의 31%(1,770줄)다. `version == "0.166.0"` 분기(`:46`) 때문에 `execServer`를 가진 이후 버전은 전부 잘못된 패키지로 보인다. 주의: `UpdateManagedCodexProfile.supportedVersions`는 관리형 집합과 다르므로 단순 참조 치환은 동작을 바꾼다. 0.149.1·0.150.1은 catalog가 없다.
- **CDX-8 (중, 의심)** hooks.json은 SessionStart에 `additionalContextLimit: 600`을 선언하는데 실제 반환은 약 3,250자다(`bridges/codex/plugin/hooks/hooks.json:13`, `app/service/DoctorApplication.swift:1459`). Codex가 이 한도를 강제하면 SessionStart 안내가 잘린다.
- **CDX-9 (중~낮, 확인)** `managed-codex` 실행마다 408MB 패키지를 4번 해시하고 사본을 1번 만든다. 그런데 출시 앱에는 이 경로의 실행기가 없다. 브릿지 2.3만 줄 중 약 1.1만 줄과 버전별 catalog가 이 경로를 위해 존재한다. 출시 여부 결정이 필요하다.
- **CDX-10 (낮~중, 확인)** 가이드의 qualify 명령(`--check-notarization`, `--json`)은 스크립트가 받지 않는 인자다(`scripts/qualify-codex-compatibility.mjs:316-328`). probe마다 패키지 전체를 해시해 1회 실행에 약 59GB를 해시한다.
- **CDX-11 (낮~중, 의심)** 다른 플러그인 항목 하나가 형식에 안 맞으면 Blabee 플러그인 검사 전체가 실패한다(`CodexPluginSetup.swift:2590-2632`).
- **CDX-12 (낮, 의심)** 실패 기록은 32칸이고 정리되지 않는다. Homebrew의 버전별 경로마다 기록이 남아 32번 뒤에는 모든 native 동작이 실패한다(`CodexNativeFailureGuard.swift:23,329,345-365`).
- **CDX-13 (낮, 확인)** 테스트·개발 전용 코드가 제품에 있다: `CodexQueueProcessRunner`, legacy 초기화, dogfood marketplace 마이그레이션.
- **CDX-14 (낮, 확인)** 0.166.0 검증 증거 폴더(`/private/tmp/…`)가 이미 없다.

문제없음: launcher는 모든 경로에서 fail-open, 전달 자동 재전송 없음, 일회성 승인은 응답 직전 재검증, 타임아웃 순서 일치.

## 5. Claude Bridge

- **CLD-1 (높음, 확인. 기록으로 뒷받침)** Hook의 `cwd`가 실행 폴더와 다르면 연결이 영구히 끝난다. 모델이 `cd`로 하위 폴더에 머문 채 다음 프롬프트가 오면 발생한다(`bridges/claude/src/auto-connect-hook.mjs:27`, `bridges/claude/swift/service/ClaudeAutoConnectBootstrap.swift:224`, `ClaudeNativeSession.swift:421-429`). 안내문은 원인을 "/resume·/clear"라고 잘못 말하고, 끝난 뒤에도 프롬프트마다 반복된다. 방향: 세션 ID와 프로세스 트리로 묶고 cwd 변화는 관측 생략으로 처리.
- **CLD-2 (높음, 코드 확인)** 남은 lease(55~60분)보다 긴 잠자기 뒤에는 열린 모든 창의 연결이 끝난다. lease 시계가 잠자기 시간을 포함하고, 깨어난 뒤 구조 갱신을 하지 않는다(`ClaudeSessionAuthority.swift:10,218`, `ClaudeOwnerRenewalController.swift:186-191`). 사용자 신호는 Claude 화면에 섞여 나오는 stderr 한 줄뿐이다.
- **CLD-3 (높음, 실행으로 확인)** MCP 서버는 한 번 실패하면 끝이다. heartbeat 1회 실패, 서비스 재시작, 앱 업데이트, 5초 정지, Claude Code의 서버 재시작 중 무엇이든 영구 종료로 이어진다(`session-v2-channel-poller.mjs:79-88`, `session-v2-mcp.mjs:157-192`, `ClaudeNativeSession.swift:897-899`). "failed to connect"의 일반 원인이다. 11-06의 preflight 수정은 이 경로에 닿지 않는다.
- **CLD-4 (높음, 횟수 확인. 시간 추정)** `claude` 실행 때마다 두 프로세스가 처음부터 다시 검증한다. 앱 전체 서명 검증 약 14회, 534파일 payload 해시 3회, 보조 프로세스 3개(`claude --version`, `node --version`, `open -g`). 추가 1.5~2초 추정.
- **CLD-5 (중~높음, 코드 확인. 기록으로 뒷받침)** 이미 본 `prompt_id`에 다른 본문이 오면 boundary를 폐기하고 Hook이 exit 1로 실패한다(`ClaudeNativeSession.swift:700-705,882,1122-1124`). 기록상 `session_v2_binding_mismatch` 5건이 모두 같은 promptId를 공유하는 항목(작업 알림 등) 뒤에 났다. 이후 모델의 emit도 실패한다.
- **CLD-6 (중, 코드 확인)** 카드는 600초 살아 있지만 선택은 300초까지만 받는다(`ClaudeNativeSession.swift:124,1212,1225`, R:108). 5~10분 사이의 클릭은 거부되고 되살릴 방법이 없다. 대기의 뒤 절반은 약 600번의 헛폴링이다.
- **CLD-7 (중, 코드 확인)** 거절된 emit이 `proposal_id`를 소모한다. 모델이 같은 제안을 바로 다시 보내면 같은 불투명한 코드로 또 거절된다(`:462,467,695,882`). `proposal_id`가 호출마다 새 값이어야 한다는 설명이 어디에도 없다.
- **CLD-8 (중, 의심)** 선택 전달이 Claude Code 내부 문자열의 바이트 일치에 달려 있다. 2.1.282에서 관측한 값이고 설치본은 2.1.322다(`ClaudeNativeSession.swift:1754-1759`). 버전 검사는 최소값만 본다. 어긋나면 조용히 실패한다. 2.1.322에서 카드 클릭 1회로 확인 필요.
- **CLD-9 (중, 확인)** Hook마다 서버가 150~250ms의 무결성 작업을 한다. 한 번의 처리에 체인 전체 검증 4회, 체크포인트 2회, Keychain 읽기 약 12회와 갱신 4회(`ClaudeSessionMetadataStore.swift:202-250`, `ClaudeSessionRegistry.swift:928-934`). 세션이 길수록 느려진다. REPO-3의 410초 테스트가 같은 경로다.
- **CLD-10 (중, 확인)** 열린 창마다 계속 폴링한다. MCP heartbeat 2Hz(매번 새 소켓), 감독 루프 50Hz, EOF 타이머 10Hz, 갱신 1Hz, Stop 대기 2Hz. 응답 형식은 이미 long-poll을 허용한다. 싼 대안은 2초 간격.
- **CLD-11 (중, 확인)** `claude` 실행마다 scope 폴더 하나와 Keychain 항목 2개가 영구히 남는다. 삭제 코드가 없다(`ClaudeSessionRegistry.swift:904-913,284,287`).
- **CLD-12 (중, 측정)** 모델에 보이는 표면: MCP 지시문 542자, 도구 목록 3,907자(emit 스키마만 1,783자), 프롬프트마다 62자. 한 주기는 도구 3회와 추가 턴 1회. 실사용은 연결 확인이 제안의 약 3배였다. 의심: 서브에이전트가 같은 도구로 boundary의 단 한 번인 emit을 써 버릴 수 있다.
- **CLD-13 (중~낮, 확인)** launcher가 사용자의 `NODE_OPTIONS`·`NODE_PATH`·`BASH_ENV`·`ENV`를 Claude 세션 전체에서 지우고, 사용자의 다른 MCP 서버까지 legacy 협상을 강제한다(`ClaudeInstalledLaunchConfiguration.swift:32-41`). 안내가 없다.
- **CLD-14 (중, 확인)** 손으로 맞추는 고정값이 세 곳 외에도 많다: Node 22.23.2(3곳), 출시 소스 목록(JS·Swift), "1.30.0"(8곳 이상), 계약 버전 문자열, entitlements 문구, Stop 안내문(JS·Swift). manifest 크기 한도는 이미 어긋났다(JS 1MiB, Swift 2MiB). r90을 폐기시킨 것과 같은 종류다.
- **CLD-15 (낮~중, 확인)** 아직 출시·컴파일·테스트되는 레거시: `native-session-client.mjs`·`product-core-client.mjs`(상수 하나 때문에 출시), `product-hook/mcp.mjs`, `launchers/`, `dev/claude-standalone`(3,951줄과 테스트 2,333줄), 참조 없는 `claude-session.v2.json`, Swift가 거부하는 development-preview manifest 경로, `ClaudeNativeHost`·`ClaudeBridgeCoordinator`.

연결을 끝내는 창 안 사건 정리: `cd`(CLD-1), `/clear`, `/resume`, 반복 SessionStart, MCP 서버 재시작, 서비스 재시작·앱 업데이트·heartbeat 1회 실패(CLD-3), lease를 넘긴 잠자기(CLD-2). `/compact`는 연결은 유지하나 현재 boundary를 잃을 수 있다. `/model`은 끝내는 경로가 없다.

문제없음: 프롬프트 주입은 실제로 한 줄, Hook은 MCP SDK를 로드하지 않음(20~30ms), 폴링은 SQLite·Keychain을 건드리지 않음, 제출된 요청의 자동 재시도 없음, 자격 증명이 argv·임시 JSON에 없음.

## 6. 앱 셸 · UI · 업데이트

참고: PID로 본 두 프로세스는 메뉴바 Pet 앱과 그 자식인 서비스다. LaunchAgent 서비스가 아니다.

- **APP-1 (높음, 확인)** Pet이 초당 2회 영구히 폴링한다. 틱마다 새 소켓 연결로 RPC 2개 이상(Claude 세션마다 1개 추가)을 보내고, 스냅샷 JSON을 RPC당 5~6번 직렬화·파싱하며, 요청마다 파일 잠금 약 20 syscall을 치른다. 패널이 숨겨져 있어도, 세션이 없어도 같다(`PetViewModel.swift:2931`, `app/ui/PetApplication.swift:379`, `app/service/PetProviderTransport.swift:238-474`, U:661, U:1219, U:1265-1278). 추가로 5초마다 접근 확인, 60초마다 HTTPS. 주의: 이 폴링이 3초짜리 heartbeat 역할도 하므로, 상태 버전을 실은 long-poll이나 알림 + 느린 heartbeat로 바꿔야 한다.
- **APP-2 (높음, 확인)** 앱이 스스로 업데이트를 확인하지 않는다. `checkForAppUpdates()` 호출자는 전부 사용자 버튼이다(`PetSettingsView.swift:314`, `PetConnectionSetupView.swift:365`, `CodexPluginRecheckReportView.swift:148`, `PetAppUpdateView.swift:62`, 상태 메뉴). r91 릴리스 자체는 정상 게시돼 있다. 방향: 실행 시와 하루 1회 확인, 상태 아이콘 배지, 설치는 사용자 확인 유지.
- **APP-3 (높음, 코드 확인)** 업데이트가 한 번 꼬이면 인앱 업데이터가 영구히 잠긴다. journal의 `recoveryRequired`가 설정을 열 때마다 다시 유도되고 지우는 수단이 없다(`app/update/AppUpdateTransaction.swift:413,567,734-754,166`). 트리거: 새 앱의 서비스가 30초 안에 정상 확인이 안 됨(앱 자체 시작 예산은 120초), 도중 helper 종료나 Mac 종료, helper가 journal을 읽기 전 종료.
- **APP-4 (중~높음, 구조 확인. 샌드박스 도달 여부는 의심)** 메인 소켓은 peer 사용자 ID만 본다(U:1157). `resolve_permission_request`·`select`·`dismiss_interaction`·`enable_project`는 Pet 비밀값 없이 통과한다(U:901-928, `ClaudeProductServiceCoordinator.swift:81`, `PetProviderService.swift:168-178`). 승인 요청에 필요한 ID는 `get_state`가 돌려준다(O:2102-2128). 같은 사용자의 프로세스가 사용자보다 먼저 `allow_once`를 보낼 수 있다. 방향: 이 요청들에 Pet 비밀값을 요구하거나 peer PID와 코드 서명으로 묶는다.
- **APP-5 (중, 코드 확인)** 겹친 스냅샷 요청에서 밀린 쪽이 연결 실패로 처리되어 화면 상태를 지우고, 뒤따른 정상 응답까지 버린다(`PetViewModel.swift:3136-3141,3762,3796-3846`, `PetProviderTransport.swift:242,476`). 사용자 동작 직후 최대 1초의 가짜 끊김과 가짜 오류 통계가 생긴다.
- **APP-6 (중, 코드 확인)** 업데이트는 연결이 0개여야 한다. Claude payload 사용 기록은 생존 여부로 판단하지 않아서, 비정상 종료가 남긴 기록은 Mac을 재시동할 때까지 업데이트를 막는다(`AppUpdateTransitionPreflight.swift:62-252`, `ClaudeRuntimePayloadUse.swift:140`). 어느 세션이 막는지 창에 나오지 않는다.
- **APP-7 (중, 확인)** 실제 번들 런타임 검사가 공증 뒤의 별도 수동 단계다. 인앱 업데이트 경로는 릴리스 검증에서 한 번도 실행되지 않았다(r91 `VALIDATION.md`). REPO-1 참조.
- **APP-8 (중, 코드 확인)** 서비스가 죽으면 조용히 멈춘다. 자동 재시작이 없고 상태 아이콘에 표시가 없으며, 그동안 승인은 Codex 기본 화면으로 넘어간다(`app/service/PetAppService.swift:50,206-216`).
- **APP-9 (중, 측정)** 옛 앱 사본을 지우지 않는다. `/Applications`의 숨은 백업 21개 1.2GB, 삭제 코드 없음(`app/update/AppInstallation.swift:332,385-386`). `runtimes/` 정리는 Claude 사용 기록이 있으면 실패한다.
- **APP-10 (중, 측정)** 릴리스마다 스크립트 약 980줄을 복사하고 리터럴 약 77개를 손으로 고친다. 이전 릴리스의 미추적 `build/` 폴더에 의존한다.
- **APP-11 (중, 확인)** Doctor가 Codex 플러그인 계약을 바이트 단위로 따로 들고 있다. SHA-256 4개, Hook 명령 문자열, timeout, `additionalContextLimit`(`DoctorApplication.swift:363-369,1446-1470`). 어긋나면 앱 스스로 유효한 플러그인을 거부한다. Doctor 요약 78개는 한국어 전용이다.
- **APP-12 (중, 확인)** 언어 처리. 기본값이 영어이고 시스템 언어를 보지 않는다(`app/ui/PetLocalization.swift:17`). 번역 호출 1,406곳 중 792곳이 UI 밖이고 대부분 모델 상태에 굳어, 언어를 바꿔도 이미 만든 문구는 그대로다. `Text("Waiting")`와 원시 오류 코드 노출 18곳. 용어 혼용: "Codex 연결" 22 / "Plugin" 42 / "플러그인" 1, "다시 시작" 22 / "재시작" 11, 합니다체 약 635 / 해요체 약 332.
- **APP-13 (중~낮, 의심)** 3초 heartbeat가 500ms 타이머의 정시성에 달려 있다. 메뉴바 앱이 App Nap 방지를 하지 않아, 패널이 숨겨진 동안 타이머가 늦어지면 승인 카드가 뜨지 않을 수 있다.
- **APP-14 (낮, 확인)** 업데이트 확인은 파싱 안 되는 태그 하나로 전체가 실패하고, 릴리스 500개가 상한이며, 응답을 1바이트씩 읽는다(`app/update/PetAppUpdates.swift:238-240,263,409-413`).
- **APP-15 (낮, 의심)** 레거시 서비스 경로(LaunchAgents, `daemon`/`service` 명령, NDJSON)가 남아 있다.

문제없음: 소켓 파일 권한과 경로 검사, Pet 비밀값 전달 방식, 업데이트 다운로드 검증, 폴링 루프 취소와 backoff.

## 7. DB · 계정 · 텔레메트리

- **DB-1 (높음~중, 실행으로 확인)** `record_blabee_usage`만 일일 한도가 없다. PGlite에서 한 사용자·하루 1,500건이 전부 들어갔다(`supabase/migrations/202609170001_blabee_usage.sql:91-108`, 대조 `…0004…:273`). 2026-09-20 감사의 P2-1이 아직 열려 있다. 영수증 행은 정리 예약도 없다(DB-3).
- **DB-2 (중~높음, 코드 확인)** 모든 Pet 동작이 Supabase 왕복에 달려 있다. 읽기 경로가 매번 insert를 하므로 DB가 읽기 전용이 되면 실패한다(`…access_control.sql:188-189`). 200이 아닌 응답(402·404 등)은 유예 없이 즉시 차단한다(`app/account/ProductAccess.swift:291,220`). 토큰을 만료 60초 전에야 갱신해 300초 유예가 60초까지 줄어든다(`PetAccountController.swift:271`).
- **DB-3 (중, 실행으로 확인)** 보존 정리는 아무도 감시하지 않는 pg_cron 3개에 달려 있고, 사용 통계 영수증은 수동이다(`…0001…:121`). 상태 점검 쿼리는 한 작업만 본다.
- **DB-4 (중, 확인)** 동의 화면은 "계정과 함께 삭제"라고 하지만 계정 삭제 수단이 앱에도 운영 절차에도 없다(`app/telemetry/PetUsageAnalyticsView.swift:20`). 통계를 꺼도 서버 데이터는 남는다.
- **DB-5 (중, 확인)** DB 로직 대부분에 실행 가능한 테스트가 없다. 실행기는 2개뿐이고 `npm test`에 포함되지 않는다. 0004(22KB)·0006(30KB)는 자동 검증 0. 좋은 소식: 방치된 테스트 SQL은 현재도 PGlite에서 통과하므로 연결만 하면 된다. PGlite로 못 보는 것: pg_cron, 실제 auth 스키마, HTTP 상태 매핑, 동시성.
- **DB-6 (중, 확인)** 운영 DB가 저장소와 같은지 보일 방법이 없다. 해시 기록은 9개 중 2개, 적용 기록은 산문으로 흩어져 있다.
- **DB-7 (중~낮, 확인)** 설치본마다 60초 간격으로 접근 확인을 영구 호출한다(`ProductAccess.swift:242,302`). 하루 1,440회. 실패해도 간격이 같다.
- **DB-8 (중~낮, 확인)** 오류 진단 클라이언트가 사용 통계 클라이언트의 복제다(153줄 중 3줄 차이). URL 검증 5곳, 헤더 검증 4곳, 버전 정규식 19곳.
- **DB-9 (낮~중, 코드 확인)** Mac 시계가 5분 이상 틀리면 로그인이 실패하고 "인터넷 연결을 확인하세요"로 표시된다(`app/account/PetAccountAuth.swift:286-291`).
- **DB-10 (낮, 확인)** 이벤트마다 HTTPS 1회, 큐 전체 재인코딩 5회 이상, fsync 2회를 메인 스레드에서 한다. 앱이 활성화될 때마다 계정 조회를 한다.
- **DB-11 (낮, 의심)** 온보딩이 다시 뜰 때 오류 진단은 강제로 끄지만 사용 통계는 끄지 않는다(`app/ui/PetApplication.swift:295`).
- **DB-12 (낮, 확인)** `account-web`은 배포되지 않은 로그인 페이지다. 개발 도구 권고 2건, 자체 README가 소유하지 않는다고 한 도메인 링크 2개.
- **DB-13 (낮, 확인)** 결제 이벤트 RPC와 표가 운영에 있지만 호출자가 없다.
- **DB-14 (낮)** 보고 쿼리의 작은 비효율 3건. 인덱스 `error_events_connection_received_idx`의 선두 컬럼이 쓰이지 않는 것으로 보인다(의심).
- **DB-15 (낮, 확인)** 문서 3곳이 코드와 다르다(`supabase/CLAUDE.md:9,11`, `docs/features/PRODUCT_ACCESS.md:33`).

문제없음: 모든 public 함수가 `security definer`와 빈 `search_path`, anon 호출 불가, RLS 켜짐, `user_id` 위조 불가, 다른 사용자 행 노출 없음, 토큰은 Keychain에만, 클라이언트가 스스로 접근 권한을 줄 수 없음.

## 8. 저장소 · 테스트 · 문서 · 작업 흐름

- **REPO-1 (높음, 확인)** 릴리스 절차가 gitignore된 `build/release-public-*/`에 릴리스마다 복사된다. `scripts/*.mjs` 어디에도 테스트 게이트가 없다. r91은 공증(19:28:55)이 Swift 전체 테스트(19:34:11)와 실제 payload 검사(19:34:18)보다 먼저 끝났다. r90은 공증 뒤 폐기됐다. 다음 릴리스에 필요한 r89 서명 앱도 `build/`에만 있다.
- **REPO-2 (높음, 확인)** 모든 작업이 이름과 무관한 한 브랜치에 있다. main보다 60 커밋, 1,906파일. 체크포인트 커밋이 수백 파일씩이고 r84~r89 빌드는 대응 커밋이 없다. 로컬 태그가 없고, 정리되지 않은 worktree가 8개다. 회귀를 이분 탐색할 수 없다.
- **REPO-3 (높음, 확인)** Swift 테스트 1개가 409.7초로 전체 525.7초의 72%다(`Tests/swift/BlabeePetTests/ClaudeSessionMetadataStoreTests.swift:607`). 호출 한 번이 0.41초인데 원인은 CLD-9다. 문서가 이미 건너뛰기를 권한다.
- **REPO-4 (높음, 확인)** Blabee용 CI가 없다. 설계 문서는 미구현, CI 브랜치는 방치, Codex 새 버전 감시 워크플로는 템플릿이다.
- **REPO-5 (높음, 확인)** 릴리스를 지키는 테스트 여럿이 기본 흐름 밖이다: r90을 잡은 번들 런타임 검사(환경 변수 필요), `Tests/Cloud`, `supabase/tests` 6개, `Tests/bridges/claude/integration` 7개, shared-engine 101개, account-web.
- **REPO-6 (중~높음, 확인)** 루트 Node 테스트가 같은 Swift 제품을 `/tmp`의 일회용 폴더에 7번 새로 빌드한다(358초 중 169초). scratch 트리가 최대 18곳이고 `/tmp`는 재부팅마다 지워진다.
- **REPO-7 (중, 확인)** 문서가 증거로 인용하는 `build/`·`/tmp` 경로 대부분이 사라졌다. 상대 링크 1,020개 중 84개가 깨졌다. `PRE_LAYOUT_ARTIFACTS.md`가 말하는 2.2GB 복구 압축본이 없다.
- **REPO-8 (중, 확인)** 출시 런타임의 MCP SDK 1.30.0에 권고 6건이 열려 있고(대부분 HTTP·OAuth 경로), 고정값이 10곳 이상에 박혀 있다. `dev/claude-standalone` lock은 zod 4.6.2 그대로다.
- **REPO-9 (중, 확인)** 저장소 `README.md`와 `README.ko.md`가 r85를 현재 다운로드로 안내한다(`:14,16,46,48`). 공개 문서 저장소는 r89이고 r91 수정은 `build/` 안에 미커밋 상태다.
- **REPO-10 (중, 확인)** 이동 전의 미추적 폴더 약 2GB: `src`(1.1GB, 9월 빌드 산출물뿐), `ui-demos`, `tmp`, `demo-site/node_modules`. `ui-demos` 때문에 Swift 빌드마다 경고 약 500줄이 나온다.
- **REPO-11 (중, 확인)** `Package.swift`는 손으로 관리하는 175개 경로이고 완전성 검사가 없다. 제품이 131파일 단일 모듈이라 무엇을 고쳐도 전체가 다시 빌드된다. 테스트용 플래그 때문에 빌드 변형이 3개 이상이다.
- **REPO-12 (중, 확인)** 두 테스트 묶음이 직렬인 이유는 테스트가 기기 전역 상태를 공유해서다. Claude 브릿지 스크립트 중 5개는 Swift 잠금을 잡지 않는다.
- **REPO-13 (중~낮, 확인)** 현행처럼 보이는 문서 6개가 이동 전 경로와 명령을 준다(`docs/development/SWIFT_RUNTIME.md:20` 등). `src/coordinator-…` 언급이 376건이다.
- **REPO-14 (중~낮, 확인)** 엔진 의미가 세 번 구현돼 있고(Swift, reference engine 1,976줄, semantic-trace 740줄) Swift와 비교하는 테스트가 없다. ENG-9 참조.
- **REPO-15 (낮~중, 확인)** 추적 중인 방치물: `demo-site`(중첩 `.git` 포함 28파일), `dev/recording` 중복, `output/pdf`, `dev/claude-standalone`, `dev/experiments`, `dev/spikes/m1`(아직 `npm test`에 포함).
- **REPO-16 (낮~중, 확인)** 에이전트 지침이 9개 파일 518줄에 중복되고 이미 어긋났다. `bridges/claude/AGENTS.md`는 pin 2곳, `CLAUDE.md`는 3곳. `docs/bridges/claude/NATIVE_SESSION.md:91`은 최소 버전 2.1.248(코드는 2.1.282). 루트 `CLAUDE.md:67`의 "Node 전체"는 세 묶음을 빼고 있다.
- **REPO-17 (낮~중, 확인)** 기본 Node 테스트가 PATH의 `codex`에 의존한다. Homebrew가 올리면 결과가 달라질 수 있다.

문제없음: 어느 타깃에도 없는 Swift 파일 없음, 추적된 빌드 산출물·비밀값 없음, 최소 macOS 13 일관, 런타임 버전 세 곳 일치 테스트 있음, Claude 브릿지 Node 테스트는 8초.

## 9. 확인하지 못한 것

- 릴리스 빌드에서의 실제 시간. 시간 수치는 저장소의 debug 벤치, r91 산출물로 잰 대용값, 또는 추정이다.
- Codex 내부 동작: `additionalContextLimit`의 의미, 0.166·0.167의 실제 PermissionRequest 키와 cwd, 플러그인 목록 형식.
- Claude Code 내부 동작: 2.1.322의 Stop 문구 바이트, `/mcp` 재연결과 원격 제어 연결 시 서버 재시작 여부, 서브에이전트에 MCP 지시문이 보이는지.
- Codex 샌드박스 안의 명령이 Blabee 소켓에 닿는지(APP-4).
- 운영 Supabase의 실제 상태: 적용된 스키마, cron 실행 이력, 요금제와 사용량.
- 설치 앱의 실패 기록 저장소, Claude scope 폴더와 Keychain 항목 수.

## 10. 이미 알려져 있던 것 (다시 세지 않음)

버전 문자열 중복(다음 버전 등록 때 정리 예정), 창 안 `/resume`의 연결 종료, MCP SDK 1.30.0 고정, Codex 쪽 프롬프트 주입 길이, DMG 동시 빌드 테스트의 불안정, Swift 테스트 직렬 잠금, 미제출 전달 마커 상한(11-06 수정), preflight 타임아웃 범위(11-06 수정), `supabase/tests/errors.sql`이 업그레이드 전 단계 테스트라는 점.

## 용어

- **Hook**: Codex나 Claude Code가 세션 시작·프롬프트 제출·답변 끝 같은 시점에 자동으로 실행해 주는 외부 스크립트.
- **journal**: 코디네이터가 모든 사건을 순서대로 덧붙여 적는 SQLite 장부. 지우거나 고치지 않는다.
- **replay**: journal을 처음부터 다시 읽어 현재 상태를 계산하는 일.
- **boundary**: 한 번의 프롬프트에 대응하는 작업 단위. 제안 카드는 boundary에 묶인다.
- **lease**: 일정 시간 동안만 유효한 사용 권한. 주기적으로 갱신해야 한다.
- **heartbeat**: "나 살아 있다"를 주기적으로 알리는 신호.
- **quarantine**: 반복 실패한 작업을 더 시도하지 않도록 격리하는 것.
- **fail-open / fail-closed**: 실패했을 때 원래 동작을 그대로 통과시키는 것 / 막는 것.
- **공증(notarization)**: Apple 서버가 앱을 검사해 주는 절차. 되돌릴 수 없는 릴리스 단계.
- **CDHash**: 실행 파일 서명의 지문. Blabee는 이 값으로 "진짜 공식 Codex인가"를 판단한다.
- **long-poll**: 서버가 변화가 생길 때까지 응답을 붙잡아 두는 방식. 주기적 폴링을 대신한다.
- **RPC**: 클라이언트가 서버의 함수를 원격으로 호출하는 것.
- **RLS**: 행 단위 접근 제어. 표에 직접 접근하는 것을 막는다.
- **pg_cron**: Postgres 안에서 예약 작업을 돌리는 확장.
