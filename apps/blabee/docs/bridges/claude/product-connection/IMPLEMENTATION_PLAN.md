# 제품 연결 구현 계획과 수용 기준

2026-09-20. 문서 설계 CP-00·권한 CP-01A·제품 계약 CP-01B·private 세션 등록 CP-02에 이어 CP-03 권한 연결·owner 갱신, CP-04 수명 관측·장기 상태, CP-05 native launcher·v2 Hook/MCP를 구현했다. 기준 정책은 [TECH_SPEC](TECH_SPEC.md), 실제 파일은 [CODEMAP](CODEMAP.md), 작업 소유권은 [AGENT_TASKS](AGENT_TASKS.md), 검증 결과는 [TASK_STATUS](TASK_STATUS.md)를 따른다.

## 단계와 완료 조건

| 단계 | 구현할 내용 | 선행 조건 | 완료 증거 |
| --- | --- | --- | --- |
| CP-00 | 현재 소스·공식 규격·제품 정책·파일 범위 확정 | 선택 작업 | 이 문서 묶음·문서 검토. 구현/배포 통과와 구분 |
| CP-01 | owner/session v2/Pet envelope 계약, 단일 `ClaudeSessionAuthority`와 가짜 시계 fixture | CP-00 | 60분/5분 renewal, stable authority epoch, 폐기·expiry·경합 규칙 검증. 기존 v1 pin 유지 |
| CP-02 | private enrollment·scope factory·동적 registry·별도 metadata store·공통 서비스 dispatch | CP-01 | 2개 Claude + Codex scope 격리, private grant 전달, strict DB 보존, 모든 중간 crash 격리 |
| CP-03 | registry authority를 native/inner ingress에 연결; owner renewal·EOF/자식/SessionEnd 회수 | CP-02 | 동일 clock source와 commit fence. fake owner로 24시간 유휴·활성 유지, 만료 이후 재생 차단 |
| CP-04 | compact/StopFailure/unknown lifecycle, durable replay state·모든 누적 한도 제거 | CP-03 | 같은 응답의 compact 후 새 제안, 누락 관측 차단, quota 초과 장기 fixture와 replay 거부 |
| CP-05 | 설치 native launcher·Terminal TTY·v2 Hook/MCP client·plugin/standalone source binding | CP-04 | 한 서비스에 새 세션 등록, 로그/argv/config 비밀 없음, native 승인 유지, 사용자 MCP와 충돌 진단 |
| CP-06 | 공통 Pet 집계·프로젝트 선택/시작·최초 probe·확인/해제·상태와 단축키 routing | CP-05 | Hook/MCP 준비 후 최초 probe 1회, Codex/Claude 다중 세션 선택·stale UI·과거 A 결과/새 C-D 카드 분리. 실제 버튼은 별도 gate |
| CP-07 | bridge/runtime 번들·불변 payload·사용 중 업데이트 guard·승인된 plugin 패키징 | CP-06 | checkout/개발자 Node 없는 실행, wrapper kill 뒤 payload 보호, 설치/서명·manifest 검증 |
| CP-08 | 실제 모델·장시간·다중 세션·설치 제품 최종 수용 | CP-07, 해당 배포의 Channels 자격 | 아래 자동/개발 preview/설치/일반 배포 gate를 각각 기록 |

CP-02는 enrollment contract → metadata crash fixture → registry/서비스 조립의 작은 변경으로 나눈다. CP-05는 Terminal 진입점과 Hook/MCP 연결을 따로 검증한다. 단계별 파일 소유권을 먼저 잡고 공유 파일에 동시에 편집하지 않는다. 공통 엔진 전체 이동이나 Codex operational 전면 분해는 선행 조건이 아니다.

**CP-07 runtime·업데이트 보호 구현·관련 격리 회귀·일반 빌드와 ad-hoc preview 후보 검증을 마쳤다**. 일반 plugin 패키징·launcher source 전환은 Channels 승인 조건 확인 뒤 후속 구현한다. 다음은 CP-08 실제 모델·설치·장시간 수용이다. [CP-07](RUNTIME_PAYLOAD.md)은 불변 runtime·Node 번들·업데이트 admission을 구현하며 일반 Channels 승인은 별도 외부 조건으로 유지한다. [CP-03 연결](SESSION_LIFETIME.md)은 같은 authority와 실제 COMMIT fence, [CP-04](SESSION_LIFECYCLE.md)는 compact·durable replay·bounded state를 처리한다. [CP-05](INSTALLED_SESSION.md)는 private owner와 실제 자식/TTY 관측·생성 Hook/MCP 설정·v2 client를 연결했다. 실제 PTY의 Ctrl-Z·background·fg·Ctrl-C와 command Hook/stdio MCP를 자동 검증했으나 Terminal 앱 조작·Claude 모델·서명된 설치 수용은 별도다. [CP-06](PRODUCT_PET.md)은 공통 Pet에 private selector·세션 목록·시작/확인/해제·최초 probe를 연결했다. CP-07 후보 bundle의 조립·서명은 검증했으며 실제 설치·모델 수용은 남아 있다. 기존 개발 launcher의 고정 1시간 grant는 변경하지 않았다.

CP-01은 요청 범위를 다음처럼 나눈다. **CP-01A**는 독립 `ClaudeSessionAuthority`와 시간·회수·commit 경합 테스트다. **CP-01B**는 owner/session v2/Pet wire envelope·독립 codec·공유 fixture다. 두 단계 모두 실제 UDS dispatcher나 IPC 자격 전달에 연결하지 않는다. CP-02에서는 codec의 구조 검사를 private transport 인증·등록 서비스·현재 권한 판정에 결합해야 한다.

CP-08 설치 전 점검에서 ad-hoc 후보가 실제 제품 owner의 Apple 서명 인증을
충족하지 못함을 확인했다. [내부 Developer ID preview](RUNTIME_PAYLOAD.md)는
일반 release와 구분해 이 조건을 갖춘 후보를 준비한다. 2026-09-21 최종 결정은
[하나의 앱과 DMG](UNIFIED_DISTRIBUTION.md)다. 기존 제품 identity·저장소·업데이트를
유지하고 두 브릿지의 버전 및 세션 인증을 내부에서 구분한다. 기존 운영 앱은 자동 교체하지 않는다.
후보 설치와 실제 모델·사람 클릭은 [수용 절차](ACCEPTANCE.md)에 따라 별도 기록한다.

## 수용 기준

다음은 제품 통합 단계의 `목표`이며 전체 기준을 통과한 상태는 아니다. CP-01~06의 권한·wire·등록·갱신·수명·native 실행·공통 Pet 경로는 관련 격리 테스트를 통과했다. 설치 제품의 실제 서명·모델 사용·UI·장시간 사용은 남아 있다. 시간 fixture의 통과를 실제 장시간 모델 사용으로 대체하지 않는다.

| ID | 시험 | 목표 결과 |
| --- | --- | --- |
| AC-01 등록 | signed owner/정확한 scope와 wrong peer·runtime·cwd·session·role, 중복 descriptor, 같은 challenge/논리 grant pipe ID 재사용 | 유효 새 등록만 성립. 일반 UDS로 credential 발급 불가. token이 일반 응답/로그에 없음. 물리 pipe의 과거 사용 이력을 영구 식별자로 저장하지 않음 |
| AC-02 갱신 | 가짜 연속 시계 24시간, 5분 owner renewal, 중복/out-of-order sequence, 두 auth 계층 | 모델 호출 없이 권한 유지. `server now+60분`, 양 계층 동일 판정. 중복이 추가 연장하지 않음 |
| AC-03 만료·경합 | 만료 직전/정각/직후, renewal과 revoke/claim/complete race | 폐기 이후 살아나지 않음. mutation commit 때 authority fence. 새 Hook도 만료 복구 못함 |
| AC-04 readiness·카드 | 5초 heartbeat, 300초 probe, 600초 카드 각각 경계; old nonce/epoch, nonce 미수신 | heartbeat/renewal만으로 ready 불가. ACK가 probe·카드 TTL을 늘리지 않음. 만료 이유와 확인 버튼 표시 |
| AC-05 수면·시계 | 잔여 lease보다 짧고 긴 수면, 마지막 renewal 4분 후 58분 수면, wall clock 앞/뒤 변경 | continuous clock으로 판단. 유효한 같은 owner만 연장, readiness/미claim은 무효화. 만료 시 새 시작 안내 |
| AC-06 누적 상태 | 1,000 prompts, 500 proposals/selections/probes, 100,000 polls, 1,000 Channel messages, Pet 500 선택; 과거 ID replay | 사용을 계속하고 중복 실행 없음. active memory가 완료 횟수에 비례해 계속 증가하지 않음. 미보고 claim 32건은 명시적 backpressure |
| AC-07 native 수명 | startup, 같은 prompt의 자동/수동 compact, compact prompt 누락/불일치, clear/resume/fork, StopFailure, interrupt·background 관측 | 지원 전이만 유지. compact 후 새 내부 경계·Stop 필요. 관측 부족이면 새 입력 안내. Stop/손실을 성공·취소로 추정하지 않음 |
| AC-08 종료/재시작 | owner kill, 자식 종료, control EOF, SessionEnd, 앱 종료, 서비스 교체; 늦은 Hook/claim/complete | 개별 owner/세션 종료는 해당 scope만 폐기하고 다른 scope 유지. 공통 앱/서비스 재시작은 모든 옛 Claude 권한 폐기·이력만 조회. 옛 작업 자동 재생 없음 |
| AC-09 MCP 수명 | 같은 논리 bridge의 UDS 재접속/heartbeat 회복, 두 프로세스의 bridge.open 경쟁, MCP 재시작 | 최초 논리 연결만 허용. old token으로 새 epoch 획득 불가. replacement는 새 Claude 시작 안내 |
| AC-10 metadata | prepare 전후·core commit 전후·finalize 전후 강제 종료, HMAC/sequence 변조, 정상 과거 파일 rollback, 다른 scope DB, snapshot/timer의 due 쓰기 | 불일치 scope 격리. 재시작 이력 조회가 새 core event를 쓰지 않음. stale mapping으로 실행/보고 권한 복구 없음. Codex/정상 scope는 정상 동작 |
| AC-11 결과·유실 | A claim→새 C/D→A completed/failed, select/claim/complete 응답 유실, 새 입력 직후 늦은 claim | 원래 결과만 기록, 현재 카드/ready 불변. 자동 mutation retry 없음. 미확인 결과를 성공으로 표시하지 않음 |
| AC-12 동시 사용 | Codex 1개 + Claude 2개, 같은 native ID 문자열/같은 cwd와 별도 cwd, 교차 token/card/selector | provider·scope·incarnation·revision·UI generation으로 대상 고정. 한 Claude 종료·초기화 실패가 다른 카드를 바꾸지 않음 |
| AC-13 기존 계약 | Contracts/v1 12개 hash, strict SQLite schema, legacy Pet codec, Codex approval·queue/retry·restart fixtures | 기존 결과 유지. 새 provider 필드/테이블 삽입·Codex queue receipt 위조 없음 |
| AC-14 Channel 출처 | standalone와 승인된 plugin의 실제 Hook source/wrapper, batched/변형/복제 메시지, 일반 사용자 확인 요청 | 등록한 source의 정확한 본문만 보존. 모호한 입력은 새 입력/미확인 정책, 임의 namespace 신뢰 금지 |
| AC-15 시작 환경 | Terminal TTY/공백·한글·셸 문법 포함 경로, CLI 미설치/미지원, trust/MCP/native 권한 대기, 다른 MCP 이름 충돌, MCP handshake/legacy/auto | argv 기반 정확한 프로젝트 시작. 정책/승인 우회 없음. 사용자 MCP 설정을 조용히 지우지 않음. 도구만 연결되고 Channels 미등록이면 준비 미확인 |
| AC-16 업데이트 | active owner/Hook/MCP 중 교체, owner kill 직후 Node의 지연 module read, 구/신 payload·plugin 조합 | 사용 중 적용 보류. 활성/불명 payload 삭제·제자리 수정 없음. 불일치 진단과 정상 종료 후 업데이트 |

AC-06에서 probe의 시간 구간 제한은 가짜 시계를 진행하며 검사한다. 실제 모델을 반복 호출해 횟수를 채우지 않는다. 자동 시험은 fixture runtime/freshness를 사용하고 제품 Keychain·설치 앱을 변경하지 않는다.

## 검증 gate와 증거

| Gate | 필요한 증거 | 대신할 수 없는 것 |
| --- | --- | --- |
| G1 소스/자동 | 관련 Swift·Node fixture와 legacy Codex 회귀, 위 AC 표 결과 | 모델의 Channel 수신·인간 클릭·설치 성공 |
| G2 개발 preview 실제 모델 | 새 Claude에서 ACK→제안→사용자의 Pet 클릭→동일 세션 claim→파일/결과. 두 Claude+Codex 동시 사용, native 권한 화면 확인 | 일반 사용자용 Channels 승인·설치 제품 자격 |
| G3 장시간 실제 실행 | 제품 후보 세션을 최소 2시간 유지해 1시간 전후·1시간 유휴 후 각각 선택 왕복. 8시간 soak에서는 bridge/owner 생존·renewal·로그상 오류 확인 후 마지막 왕복. 10분 수면 복귀와 자동/수동 compact 별도 기록 | 가짜 시계 24시간 통과만으로 장시간 성공 선언 |
| G4 설치 산출물 | checkout 밖·사용자 Node/npm 없는 환경에서 서명된 앱 버튼 시작, 한 Pet 다중 provider, 정상 종료/업데이트, payload 버전·hash·MCP 협상 protocol·Channels startup/source 경로 | 준비된 개발 바이너리의 성공 |
| G5 일반 배포 | 승인된 plugin/조직 조건, 지원 인증·정책·CLI 조합, 위 G2–G4를 최종 산출물로 수행 | community marketplace 등록이나 development flag 사용 |

기존 `test:shared-engine`, `test:product-ingress`, `test:native-session`, `test:common-pet`는 회귀 자산이다. 제품 등록/수명 테스트를 추가한 뒤 해당 변경 범위에 맞게 실행한다. 기존 공통 Pet OCR 실패 2건은 수정 전에도 재현된 별도 문제이며 새 테스트의 통과로 묻지 않는다. 현재 증거는 [기존 QA](../../../../dev/claude-standalone/docs/QA_REPORT.md)를 유지한다.

## 배포 범위와 후속

2026-09-21 범위 확장: 새 프로세스의 일반 `claude`와 CLI resume/continue/fork는
[자동 연결](AUTO_CONNECT.md)에서 첫 실제 SessionStart를 확인한 뒤 새 Blabee 권한으로 연결한다.
기존 Claude 대화 이력은 유지하지만 옛 Blabee 권한·선택은 복원하지 않는다.

계속 제외: 실행 중 기존 세션 attach, 같은 프로세스의 resume/fork/clear-in-place 복구, 자동 MCP 교체/credential rotation, 서비스 재시작 후 같은 Claude에 권한 재주입, 주기적 모델 probe, 선택 자동 재전송, permission relay, 무중단 앱 교체.

개발 preview는 공식 공개 allowlist 승인 전에 구현/검증할 수 있다. 일반 사용자 배포는 외부 Channels 승인과 실제 qualification을 기다린다. 서명·패키징·설치·전역 plugin 설정 적용은 구현 완료 후 구체적인 산출물과 변경 내역으로 별도 진행한다. CP-01 권한·계약 구현에는 이러한 적용이 포함되지 않는다.

회귀가 생기면 신규 Claude 제품 진입점을 비활성화하고 기존 Codex 경로와 개발 검증 경로를 유지한다. 이미 만든 metadata나 key를 자동 삭제하지 않는다. 옛 앱을 다시 실행하는 것을 새 저장 형식의 rollback 검증으로 대신하지 않는다.
