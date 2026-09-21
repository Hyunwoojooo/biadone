# Claude 제품 연결 설계

2026-09-21 최종 결정: [하나의 Blabee 앱과 DMG](UNIFIED_DISTRIBUTION.md)에 공통 엔진과
Codex·Claude 브릿지를 함께 담는다. 앱 버전은 하나이며 브릿지 버전은 각 manifest로
관리한다. 별도 Claude Preview 제품 경로는 폐기하고 기존 검증 기록만 보존한다.

결정일: 2026-09-19. 상태: **CP-01~07 구현·관련 격리 검증과 CP-08 통합 후보의 서명·설치 전 검사 완료, 실제 설치·모델 수용 전**. 한 Blabee 앱·공통 Swift 엔진·공통 Pet에 Codex와 Claude 브릿지를 연결한다. 이 문서의 새 동작은 아직 설치 앱에 적용되지 않았다.

현재 [CP-01A 세션 권한 기반](SESSION_AUTHORITY.md), [CP-01B 제품 wire 계약](PRODUCT_WIRE.md), [CP-02 private 등록·registry·metadata](SESSION_REGISTRATION.md), [CP-03 실제 native/inner ingress 권한·owner 갱신](SESSION_LIFETIME.md), [CP-04 수명 관측·재생 기록·장기 상태](SESSION_LIFECYCLE.md)를 구현하고 관련 격리 검증을 통과했다. [CP-05 native 실행기](INSTALLED_SESSION.md)도 소스 검증을 마쳤고 [CP-06 공통 Pet](PRODUCT_PET.md)를 연결했다. 설치·실제 UI·배포 완료와 구분하며 검증 결과와 추가 회귀의 제한은 [작업 상태](TASK_STATUS.md)에 기록한다.

현재 구현은 [NATIVE_SESSION](../NATIVE_SESSION.md), 실행 증거는 [QA](../../../../dev/claude-standalone/docs/QA_REPORT.md)를 따른다. 이 문서는 기존 [공통화 계획](../SHARED_ENGINE_PLAN.md)의 제품 등록·수명·배포 미결정 항목을 구체화한다. [조사 근거](RESEARCH.md), [파일 지도](CODEMAP.md), [구현 순서와 수용 기준](IMPLEMENTATION_PLAN.md)을 함께 사용한다.

## 1. 제품 흐름과 지원 범위

1. 사용자가 Blabee를 설치하고 연결 설정에서 **Claude Code**를 선택한다. 앱은 지원 CLI 버전·설치 경로와 배포 채널 유형을 검사한다. 인증정보를 읽거나 대신 로그인하지 않는다.
2. 사용자가 프로젝트를 고르고 **Claude에서 시작**을 누른다. 앱에 포함된 native launcher가 Terminal의 새 대화형 세션을 연다. 기본 경로에 개발 checkout, Node 설치, npm 명령, 셸 alias가 필요하지 않게 패키징한다. 경로를 셸 문자열에 연결하지 않고 argv로 전달하는 helper를 사용한다.
3. launcher가 공통 앱 서비스에 세션을 등록한 뒤, 검증된 payload의 Hook·MCP 설정과 Channels 옵션을 전달해 새 Claude를 시작한다. Claude의 프로젝트 신뢰·MCP·개발 Channels 확인과 도구 권한 승인은 Claude 화면에서 사용자가 처리한다.
4. 같은 Pet의 세션 목록에 `Claude · 프로젝트 · 세션`이 나타난다. 시작에 따른 수신 확인 1회가 실제 모델 ACK를 받아야 준비 상태가 된다. 그 뒤 제안 → 현재 카드의 사용자 선택 → 원래 Claude의 claim → 실행 → 결과 보고를 사용한다.
5. Claude를 정상 종료하면 해당 등록만 정리한다. 다른 Claude와 Codex는 계속 사용할 수 있다. Blabee의 **연결 해제**는 연결 권한을 회수하며 Claude의 작업 취소를 뜻하지 않는다.

| 시작 경로 | 첫 제품 범위 |
| --- | --- |
| Blabee의 `Claude에서 시작` | 기본 지원. 초기 터미널은 macOS Terminal 한 종류로 한정하고 실제 TTY·Ctrl-C·종료를 검증한다. 다른 터미널 선택은 후속 |
| 설치된 `blabee-claude` 진입점 | 같은 native launcher를 호출하는 선택 기능. PATH에 넣는 설치는 명시적인 사용자 선택이며 셸 프로필을 자동 수정하지 않음 |
| 일반 `claude` / 이미 실행 중인 Claude | 자동 연결을 보장하지 않음. 설치된 MCP가 보이더라도 Channels 활성화·등록·ACK가 없으면 선택 불가. 기존 프로세스에 사후 부착하지 않음 |
| `--resume`, `--continue`, `--fork-session`, 세션 내 `/resume`·`/clear`, remote/headless/SDK | 첫 제품 연결에서 미지원. 기존 대화의 조회·재개 자체를 차단하는 것이 아니라 Blabee 연결의 지원 범위를 제한함. 새 권한·incarnation을 가진 재개 기능은 후속 |
| 같은 native session의 자동/수동 compact | 필수 지원. 긴 사용 중 자동 발생하므로 후속으로 미루지 않음. §5의 상태 전이를 따름 |

Channels는 세션 시작 시 명시적으로 켜야 한다. 일반 배포는 승인된 plugin selector와 `--channels`를 사용한다. 현재 미승인 custom channel은 **개발 preview 경로**로만 `--dangerously-load-development-channels server:blabee-claude`와 Claude의 확인을 거친다. 조직 차단을 우회하거나 이를 정식 일반 배포 완료로 표시하지 않는다. [공식 규격과 배포 게이트](RESEARCH.md).

기본 제품 경로는 세션별 설정으로 시작하므로 전역 MCP 설정 변경을 요구하지 않는다. 승인된 Claude plugin 배포가 준비되면 동일 bridge payload를 plugin 경로로 제공한다. 한 세션에서 plugin Hook과 생성 Hook을 중복 등록하지 않는다. 사용자의 다른 MCP를 지우지 않으며 현재 개발 launcher의 `--strict-mcp-config`를 제품 기본값으로 그대로 옮기지 않는다.

일반 배포에는 승인된 plugin의 명시적 1회 설치가 선행한다. 이때 세션별 설정은 자격 전달/시작 정보를 맡고 Hook·MCP 선언은 plugin만 담당한다. 개발 preview는 생성 Hook·MCP만 사용한다. launcher가 선택한 서버 이름과 예상 Channel source를 scope에 고정한다. standalone의 `blabee-claude`와 plugin의 `plugin:<plugin>:<server>`는 별도 qualified 경로다. 현재 hardcoded wrapper 비교를 그대로 배포하지 않고, 해당 scope에 고정된 source·전체 본문·일회성 ref의 정확한 조합만 Hook continuation으로 인정한다. 모델 입력의 임의 source나 wildcard를 신뢰하지 않는다.

## 2. 프로세스와 계약 경계

```text
Blabee 앱 / 공통 Pet ── 앱 소유 공통 Coordinator 서비스
       │                   ├─ 기존 Codex context / 기존 계약
       │                   └─ Claude registry ─ scope별 공통 엔진 context
       └─ 설치 native launcher / 세션 owner ── Claude Code
                      │                         ├─ command Hook
                      └─ owner control 연결     └─ stdio MCP / Channels
```

엔진 소스와 UI는 하나다. Claude 세션마다 bridge 프로세스·인증 scope·저장 context는 분리한다. 현재 `claude-session-host --pet`처럼 세션마다 별도 Pet와 Coordinator를 띄우는 것은 격리 검증 경로로 남긴다.

- `Contracts/v1`, `CoordinatorBinding`, 기존 Codex session ID·queue claim 복구·approval·managed launcher를 유지한다. provider/incarnation 필드나 metadata 테이블을 기존 strict v1 DB에 추가하지 않는다.
- 새 제품 owner 계약은 `blabee.claude-owner.v1`, 제품 세션 envelope는 `blabee.claude-session.v2`로 별도 협상한다. 현재 개발용 v1을 암묵적으로 다른 의미로 해석하지 않는다. 모델 도구 이름의 `_v1`과 내부 transport 버전은 독립적이다.
- 제품 세션에는 native Hook·readiness를 거치는 경로만 허용한다. 사전 등록용 저수준 `claude_bridge_v1`을 같은 세션의 우회 진입점으로 제공하지 않는다.
- 공통 Pet 집계는 새 `blabee.pet-provider.v1` envelope로 provider별 DTO를 감싼다. 기존 Pet v1은 계속 Codex만 투영한다. Claude receipt를 Codex queue receipt로 바꾸지 않는다.
- Claude 초기화·Keychain·bridge 실패는 Claude 범위에서 표시하고 기존 Codex 기동을 유지한다. 공통 서비스 프로세스 자체의 장애 격리는 별도 운영 위험이다.

## 3. 등록과 자격 전달

1. 제품 launcher가 공통 서비스의 runtime identity·계약·빌드 조합을 확인한다. 서비스는 같은 사용자 소유 IPC, 허용된 서명/빌드의 launcher, 새 연결에 대한 일회성 challenge를 확인한다. 공개 runtime identity만으로 등록할 수 없다. unsigned fixture 우회는 테스트 빌드에만 둔다.
2. 서비스가 `scope_id`, `session_incarnation`, 예정 native session UUID, core session ID를 발급한다. 실제 `SessionStart(startup)`의 native ID·canonical cwd·main agent 관측이 일치하기 전에는 제안/선택을 허용하지 않는다. 내부 ID를 native 관측값으로 기록하지 않는다.
3. 서비스가 Hook·MCP·owner 역할별 capability를 만들고 private IPC/상속 pipe로 필요한 역할에만 전달한다. 전용 owner control socket에서 peer를 검증한 뒤 owner가 넘긴 일회용 pipe FD로 grant를 한 번 보낸다. 기존 공통 UDS의 일반 JSON 응답에 token을 추가하거나 known-secret 검사를 완화하지 않는다. owner 자격은 native supervisor에만, selector 권한은 앱/UI 측에만 둔다. Claude 부모에는 Hook·MCP에 필요한 자격만 들어간다.
4. 생성 설정은 capability 자체가 아닌 환경 참조를 쓴다. 장기 role capability·owner handle은 argv, JSON 설정, 로그, 모델 입력/도구 응답, DB, diagnostics에 넣지 않는다. Hook/MCP에 selector·owner 값이 상속되지 않도록 환경을 정리한다. **일회성 probe nonce/selection ref는 모델이 Channel과 도구로 받아야 하므로 Claude transcript에 남을 수 있다.** Blabee 자체 로그·영속 metadata·diagnostics에는 저장하지 않으며 짧은 유효기간/한 번의 소비/정확한 scope 검증으로 제한한다. Claude의 transcript 보관까지 막는다고 약속하지 않는다.
5. 세션 owner는 `exec`로 사라지지 않고 실제 자식의 종료와 control 연결을 감시한다. PID만으로 소유권을 확인하지 않는다. 연결 인스턴스와 프로세스 시작 식별을 함께 묶어 PID 재사용을 거부한다.

첫 제품은 등록당 최초 MCP 논리 연결 한 번만 연다. 소켓 단위 재접속/같은 프로세스의 heartbeat 회복은 허용하지만, 죽은 MCP를 새 프로세스로 교체해 옛 bridge token으로 `bridge.open`을 반복하는 경로는 거부한다. owner 승인으로 역할 자격을 교체하는 hot reconnect는 후속이다. 현재 v1의 재개방 동작을 제품 v2에 그대로 가져오지 않는다.

공통 Pet의 selector는 앱→서비스 시작 시 별도 private bootstrap으로 연결하며 메모리에만 보관한다. `select`, `snapshot`, 사용자가 요청한 `readiness.begin`만 scope별로 허용한다. bridge의 `check_connection_v1`과 UI의 재확인은 같은 probe 생성기를 쓰고 ACK 권한은 bridge에만 있다. owner는 enroll/renew/end를 맡으며 제안·claim·선택을 대신하지 않는다. Hook은 native 관측만 제출한다. raw scope/path를 바꿔 다른 역할·세션을 선택할 수 없다.

이는 같은 macOS 사용자 아래의 capability·제품 실행 경계다. Claude 부모의 환경이나 그 사용자가 실행하는 임의 코드를 상대로 모델·Hook의 출처를 완전하게 증명하는 보안 경계라고 주장하지 않는다. 모델의 native 도구 승인은 별도로 유지한다.

## 4. 권한·연결·카드의 시간을 분리

| 항목 | 제품 정책 | 갱신 주체 / 효과 |
| --- | --- | --- |
| 세션 authority | **60분 sliding lease**, owner가 **5분마다** 선행 갱신 | 모델 호출 없이 native owner가 갱신. 활성·유휴 모두 적용. 세션 자체에 고정 1시간 종료를 두지 않음 |
| Channel readiness | **probe 생성부터 5분**, ACK해도 만료 시각 연장 없음 | 실제 Channel을 받은 모델만 nonce ACK. owner renewal·MCP heartbeat로 대신하지 않음 |
| bridge heartbeat | 현재의 **5초** 연결 신선도 기준 | 손실은 readiness와 미claim 선택의 전달 적격성을 폐기. 실행 취소/성공 증거 아님 |
| 제안 카드 | 공통 엔진의 카드 TTL 유지, 현재 기본 **10분** | authority 갱신·readiness ACK로 카드 TTL을 연장하지 않음. 만료된 카드는 새 제안 필요 |

authority는 registry의 **한 원자적 상태**에서 판단한다. NativeSession만 연장하고 내부 BridgeIngress의 옛 만료를 남기지 않는다. 요청 접수 시 scope·incarnation·role·`authority_epoch`를 검사하고, mutation commit 직전에도 같은 epoch가 유효한지 확인한다. 만료·폐기와 mutation을 같은 직렬화 경계에서 처리한다. `authority_epoch`는 등록/폐기 경계이며 정기 갱신에는 바뀌지 않는다. owner만 사용하는 `renewal_sequence`가 증가하므로 살아 있는 Hook/MCP에 새 credential/generation을 5분마다 주입할 필요는 없다.

owner 갱신은 살아 있는 owner 연결·정확한 세션·유효한 기존 lease·증가하는 renewal sequence를 요구한다. 서버가 `현재 단조 시각 + 60분`으로 새 기한을 정하며 클라이언트 시각이나 `이전 기한 + 60분`을 사용하지 않는다. 같은 sequence의 재요청은 최초 결과만 돌려주며 기한을 추가로 늘리지 않는다. 만료 후에는 renewal 자체를 거부한다. 새 Hook, 파일에 남은 매핑, 같은 session ID로 만료된 권한을 되살리지 않는다.

판정은 수면 시간도 포함하는 단조 시계를 사용하고 wall clock은 표시/감사에만 쓴다. wake 시 **실제 남은 lease**를 검사한다. 1시간보다 짧게 잤다는 이유만으로 유효하다고 판단하지 않는다. 앱/서비스 재시작 때 단조 시계 기준점과 메모리 권한을 복원하지 않는다.

readiness는 시작 시 1회와 사용자의 **연결 확인** 요청으로만 새 probe를 보낸다. 시작 시 bridge/Hook 준비가 안 됐으면 준비 후 최초 1회만 보낸다. 5분마다 모델을 깨우는 상시 갱신은 하지 않는다. busy/permission 대기에서는 확인 중으로 표시하고 모델이 받을 때까지 기다리며, 만료되면 자동 반복하지 않는다. ACK는 기존 카드 실행을 예약하거나 대행하지 않는다.

카드가 있어도 readiness 만료 시 A/B는 비활성화하고 별도 `연결 확인` 버튼을 제공한다. 성공하면 아직 유효한 카드만 다시 선택할 수 있다. UI 요청으로 보낸 정확한 probe Channel의 Hook만 카드 경계를 보존한다. 사용자가 채팅으로 “다시 확인”을 입력하면 일반 새 입력이므로 이전 카드가 무효화될 수 있다. 실제 사용자 입력/compact/bridge 교체로 폐기하거나 TTL이 지난 카드는 ACK만으로 복구하지 않고 새 제안을 요구한다.

## 5. 종료·재연결·경합 정책

| 관측/사건 | 처리 | 이전 작업 처리 |
| --- | --- | --- |
| 같은 등록의 요청별 UDS 재접속 | 권한 재검사, epoch/incarnation 유지 | 자동 재실행 없음 |
| readiness 만료, 같은 bridge 유지 | 새 probe/ACK 필요 | 유효한 현재 카드는 보관 가능; 선택만 비활성 |
| heartbeat 손실, 같은 bridge 프로세스 유지 | readiness와 미claim 선택 폐기. 유효 owner/lease 아래 heartbeat 회복 가능 | fresh probe와 최신 Hook/새 제안 필요. 이미 claimed 결과는 원래 binding의 보고만 허용 |
| bridge 프로세스 종료·교체 | 옛 MCP의 재개방 경쟁을 허용하지 않고 해당 등록 폐기. 새 Claude 시작 안내 | owner 승인·새 역할 자격을 사용하는 hot reconnect는 후속; 옛 token으로 새 epoch 발급 금지 |
| 수면 후 복귀, lease 유효 | owner 생존 확인·선행 renewal 후 위 재확인 절차 | 수면 전 선택 자동 전달 금지 |
| lease 만료, owner control EOF, 자식 종료, SessionEnd, 사용자의 연결 해제 | 해당 scope 즉시 폐기, stale 요청 거부 | 작업이 실제 취소/완료됐다고 추정하지 않음. 폐기 후 completion도 거부 |
| 공통 서비스/앱 재시작 | 새 service incarnation; 옛 권한은 모두 무효. 첫 제품은 `Claude에서 새로 시작` 안내 | 옛 Claude는 계속 사용할 수 있어도 Blabee는 분리됨. 이력만 보존, claim/전달/보고 권한 복구 없음 |
| 같은 native ID/cwd/owner의 `SessionStart(compact)` | session incarnation·유효 authority 유지; 미claim 카드·readiness·현재 입력 경계 무효화 | 아래 규칙으로 새 내부 경계 생성. 이미 claimed 작업은 원본 결과 보고 권한 유지 |
| `/clear`·resume·fork 또는 native ID/cwd 불일치 | 미지원 수명 전환으로 해당 Blabee 연결 폐기/안내 | 새 incarnation 등록 없이 옛 자격 승계 금지 |
| Stop / StopFailure / interrupt로 Stop 누락 | 응답 정지·API 실패·관측 불명확을 구분. background 필드 부재와 빈 배열도 구분 | Stop만으로 완료/취소/모든 background 작업 종료 처리 금지 |
| claim 뒤 새 입력 → 옛 completion | 현재 권한과 원래 claim이 유효할 때 원본 audit에 기록 | 새 카드·최신 세션 상태를 옛 결과로 덮어쓰지 않음 |
| select/claim/complete 응답 유실 | 전달/실행/보고 결과를 미확인으로 표시; 읽기 조회만 허용 | mutation 자동 재전송·옛 ref 재발급 없음. Codex의 기존 멱등 claim은 별도 보존 |

연결 해제나 앱 종료는 native Claude 프로세스를 일괄 종료하지 않는다. 서비스는 자기 scope/자식 자원만 정리하며, 임의 PID kill이나 다른 세션 종료를 하지 않는다. 재연결 버튼도 기존 터미널에 명령·프롬프트를 몰래 입력하지 않는다.

compact Hook의 native `prompt_id`가 이미 관측한 현재 prompt와 정확히 일치하면 같은 native prompt/episode 아래 **새 내부 boundary**를 만들고 모델에 반환한다. 이전 Stop은 버리고 압축 이후의 Stop과 새 제안을 요구하므로 압축 전 카드를 재활성화하지 않는다. prompt ID가 없거나 불일치하면 ID를 추측하지 않고 `압축 후 새 입력 필요`를 표시한다. 다음 실제 UserPromptSubmit 전 제안/선택은 막되 원본 claimed 결과 보고는 유지한다. 이 전이는 CP-04의 제품 v2 경로에 구현하며 개발 v1 경로는 유지한다.

## 6. 저장·장시간 한도·복구

제품이 `~/Library/Application Support/Blabee/` 아래 Claude용 저장소를 결정한다. 요청자가 DB 경로를 지정할 수 없다. scope마다 DB, key 부모, authority lock, freshness account를 분리하고 중복 descriptor를 저장소 초기화 전에 거부한다. Codex `primary` 저장소·account는 그대로 둔다.

첫 제품은 **인증된 별도 provider metadata 저장소**를 채택한다. 제안 신규 `ClaudeSessionMetadataStore`는 core journal 밖의 versioned SQLite에 scope/native/core ID 매핑·incarnation·binding·operation ID·replay tombstone을 보관한다. 기존 시스템 SQLite와 crypto/freshness 구현을 재사용하며 신규 외부 라이브러리는 추가하지 않는다. metadata의 별도 HMAC 키/부모 잠금/단조 sequence·freshness account로 누락·변조·rollback을 검사한다. native prompt 원문, Channel 본문, token·nonce는 저장하지 않는다.

쓰기 순서는 `metadata prepared + freshness → core journal commit → metadata committed + freshness → 성공 응답`이다. 두 DB를 하나의 atomic transaction이라고 주장하지 않는다. 각 중간 crash에서 불일치는 해당 scope를 격리하고 감사 이력을 미확인으로 남긴다. 복구를 위해 core mutation을 재실행하지 않는다. 매핑이 정상이어도 재시작 후 실행/보고 권한은 복구하지 않는다. 불변 v1 binding과 provider mapping의 일치를 확인한 이력만 읽기 투영한다.

현재 core `snapshot()`도 due expiry/timeout을 기록할 수 있다. 따라서 active scope의 snapshot·scheduler 등 **core 상태를 진행시키는 모든 호출**은 같은 scope 직렬 실행기/authority fence/metadata prepare-commit을 거친다. 순수 Pet poll은 마지막으로 검증한 투영을 읽도록 분리하고, 기한 처리는 이 직렬 실행기의 timer에서 수행한다. 재시작·폐기된 scope의 이력 조회는 인증된 journal의 순수 replay를 사용하며 operational routing/snapshot을 실행하지 않는다. 조회만으로 새 journal event가 쓰이지 않는지 별도 검증한다.

현재의 lifetime `256 prompts`, `128 selections/proposals/probes`, `65,536 polls`, JS poller의 `256 Channel messages`, Pet의 `128 attempted selections`는 제품 수명 제한으로 사용하지 않는다. active boundary/probe/미보고 claim은 메모리에 제한하고, 과거 prompt/선택의 재생 방지는 인증된 durable tombstone으로 옮긴다. tombstone을 조용히 지워 오래된 입력을 새 입력으로 수용하지 않는다. poll/probe는 시간 창 단위 rate limit을 사용하며 lifetime counter로 종료하지 않는다. 제품 poll은 처음 소비할 때 단조 delivery_sequence를 부여한다. JS는 고정 epoch와 마지막 sequence/digest만 보관해 유한 메모리로 중복을 막고 오래된 알림을 재전송하지 않는다. Pet도 서버의 scoped 소비 상태와 현재 진행 중 요청을 기준으로 중복 클릭을 막는다. 현재 `bridgeCount < 64`는 제품에서는 최초 연결 1회 정책으로 대체한다. 동시에 미보고 claim 32건의 backpressure는 유지하고 결과가 기록되면 자리를 돌려준다. 저장 한도/오류는 새 선택 중지와 명시적 진단으로 처리한다.

최초 제품은 활성 scope의 metadata를 자동 삭제하지 않는다. 종료 scope 이력의 보관/삭제는 기존 journal 보관 정책과 함께 후속 관리 기능으로 다루며 개발 runtime 기록을 설치 DB로 자동 이관하지 않는다. 이 설계는 cloud 전송이나 사용자 콘텐츠 수집을 추가하지 않는다.

## 7. 공통 UI와 동시 사용

- 같은 Pet 목록에서 provider·프로젝트·세션을 구별한다. 선택과 단축키는 `provider/scope/incarnation/card revision/UI generation`을 검증한 대상에만 적용한다.
- 기본 상태는 `Claude 시작 중`, `연결 확인 중`, `선택 가능`, `연결 확인 필요`, `연결 끊김 · 새로 시작`, `현재 환경에서는 Channels 사용 불가`로 구분한다. MCP 등록만 된 상태를 선택 가능으로 표시하지 않는다.
- 결과의 `전달 대기`, `Claude가 작업 확인`, `완료 보고`, `결과 미확인`을 분리한다. 한 세션 오류가 다른 세션의 카드/준비 상태를 지우지 않는다.
- Codex의 설정·승인·rollback 등 기존 기능은 유지한다. 아직 검증하지 않은 Claude permission relay/rollback은 capability를 켜지 않는다.
- 동일 workspace를 두 모델이 수정하는 충돌까지 연결 격리가 해결하지 않는다. 본체가 수행하는 checkpoint/rollback은 공통 canonical workspace 잠금을 적용하고, native Claude/Codex의 임의 파일 변경은 별도 worktree 등 작업 분리가 필요하다.

## 8. 패키징과 업데이트

한 Blabee 배포물에 공통 실행 파일과 Claude bridge JS/SDK/지원 Node runtime을 포함한다. Claude Code 자체나 사용자의 인증정보를 번들하지 않는다. `assembly-manifest`가 provider 계약·bridge/runtime 버전·payload digest를 묶고 doctor는 비밀 없는 호환성만 보고한다. 개발자 Node 절대 경로에 의존하지 않는다.

호환 조합에는 Claude CLI 버전뿐 아니라 MCP client runtime·실제 협상 protocol·Channel source/startup selector를 포함한다. 현재 preview는 소유한 Claude 자식에만 `MCP_PROTOCOL_NEGOTIATION=legacy`를 전달하는 조합을 기준 후보로 유지한다. `auto`에서 `2026-07-28`로 협상한 서버는 Channels로 등록되지 않는다는 [공식 제약](https://code.claude.com/docs/en/mcp#push-messages-with-channels)을 검사하고, 도구 목록이 보인다는 이유만으로 통과시키지 않는다. 이 설정은 해당 자식의 다른 MCP에도 영향을 주므로 그 호환성도 CP-05에서 확인한다. 전역 환경은 바꾸지 않으며, 다른 조합은 실제 ACK/선택 왕복으로 별도 자격을 부여한다.

**세션별 불변 runtime payload**를 채택한다. 검증된 bundle payload를 digest 경로에 원자적으로 준비하고 Hook/MCP/owner가 세션 내내 그 절대 경로만 참조한다. symlink/hardlink나 원본 bundle 파일의 제자리 수정으로 활성 payload를 바꾸지 않는다. native app의 기존 `AppRuntimeUseLease`도 유지한다. wrapper 사망만으로 남은 Node 자식이 쓰는 파일을 교체/삭제하지 않는다.

초기 제품 업데이트는 연결된 Claude가 있으면 사용자에게 정상 종료를 안내하고 적용을 보류한다. 강제 교체/활성 세션 자동 재시작은 하지 않는다. owner가 비정상 종료한 payload는 자동 GC하지 않는 보수적인 기본값을 사용한다. 새 payload 설치·앱 재시작 후의 세션은 새 등록/ACK를 거친다. 실제 설치/서명/checkout 밖 실행/활성 payload 교체 방지/기존 Codex 회귀를 모두 통과해야 배포 완료다.

일반 사용자용 Channels allowlist 또는 조직 승인과 실제 인증/정책별 왕복이 배포 조건이다. 자체 marketplace 게시만으로 충족했다고 처리하지 않는다. 이 조건을 충족하기 전에도 격리된 개발 preview 구현과 검증은 진행할 수 있다.
