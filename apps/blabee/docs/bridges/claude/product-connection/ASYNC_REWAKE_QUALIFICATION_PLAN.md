# Claude asyncRewake 대안의 최소 격리 검증 계획

기준일: 2026-09-25. 상태: **설계 완료 / 실행하지 않음**.

목표는 일반 MCP와 공식 `asyncRewake` Hook으로 사용자가 선택한 Blabee 작업을
같은 Claude 터미널 세션에서 이어갈 수 있는지 판단하는 것이다. 깨우기 성공,
선택 검증, 작업 실행, 완료 기록을 각각 증명한다. 이 문서는 구현 또는 배포 승인서가 아니다.

## 1. 이번 작업과 이후 실험의 경계

- 이번 변경은 이 계획 문서 하나다. 제품 코드·설치 앱·계정·사용자 세션은 변경하거나 실행하지 않는다.
- 현재 Blabee/Claude 바이너리, 기존 테스트 runner, 운영 DB·Keychain·셸 설정을 사용하지 않는다.
- 이후 fixture 작성·실험 실행·테스트 계정 로그인은 별도 작업 범위다. 아래 절차를 자동 실행하지 않는다.
- 조직의 plugin·MCP·Hook 제한, 프로젝트 신뢰 및 도구 권한 확인은 그대로 적용한다.
- Channels 개발 옵션, 위조 Channel 메시지, 터미널 키 입력 주입, 기존 세션 강제 재개는 실험 수단에서 제외한다.

## 2. 확인된 사실과 아직 검증할 가정

| 구분 | 확인 내용 또는 검증 질문 |
| --- | --- |
| 공식 기능 | command Hook의 `asyncRewake: true`는 종료 코드 2에서 idle Claude를 깨우고 stderr, 없으면 stdout을 system reminder로 전달한다. 공식 설명의 용도는 장시간 백그라운드 실패 알림이다. |
| 공식 제약 | `asyncRewake`에는 timeout이 적용된다. 반복 Hook 발화 간 자동 중복 제거는 없다. 일반 `async: true`의 다음 턴 전달과 구분한다. |
| 버전 미확정 | 문서에 설명된 기능이 현재 지원 최저 버전에서 모두 성립하는지 미확인이다. 최소 지원 버전을 임의로 정하지 않는다. |
| native 관측 미확정 | wake 시 `UserPromptSubmit`이 발생하는지, 새로운 `prompt_id`가 생기는지, 기존 ID가 유지되는지 확인해야 한다. system reminder를 사용자 입력으로 간주하지 않는다. |
| 실행 순서 미확정 | idle·모델 응답 중·사용자 입력 중·권한 대기 중 wake의 처리 순서, 중단/종료 때의 정리, 오류 표시를 관측해야 한다. |
| 제품 적합성 미확정 | 실패 알림용 기능을 정상 선택 알림으로 사용해도 오류 안내·재시도 루프·문맥 오염 없이 동작하는지 미확인이다. 공식 기능의 존재가 이 통합의 지원을 보증하지 않는다. |

공식 근거: [command Hook 필드](https://code.claude.com/docs/en/hooks#command-hook-fields),
[백그라운드 Hook과 제한](https://code.claude.com/docs/en/hooks#run-hooks-in-the-background).

Anthropic의 [security-guidance Hook 설정](https://github.com/anthropics/claude-code/blob/main/plugins/security-guidance/hooks/hooks.json)은
`Stop`과 `PostToolUse`에 이 기능을 사용한다. 같은 예제의
[UserPromptSubmit 처리 주석](https://github.com/anthropics/claude-code/blob/main/plugins/security-guidance/hooks/security_reminder_hook.py#L404-L413)은
새 입력의 상태 초기화와 asyncRewake Stop 처리 사이의 경쟁을 설명한다.
예제의 대응을 Claude 전체의 순서 보장으로 해석하지 않는다. 이 링크는 움직이는 `main`이며,
실험 시작 전에 확인한 문서/예제 사본의 시각·해시와 확보 가능한 commit을 기록한다.

현재 소스에서 확인한 차이는 다음과 같다.

- [실행 설정](../../../../bridges/claude/swift/service/ClaudeInstalledLaunchConfiguration.swift)은
  개발 Channels와 세션별 Hook/MCP를 사용한다. `supportsVersion`의 2.1.248 하한은
  현재 경로의 호환 조건이며 `asyncRewake`의 검증된 하한이 아니다.
- [native 세션 처리](../../../../bridges/claude/swift/adapter/ClaudeNativeSession.swift)는
  실제 `UserPromptSubmit`에서 받은 digest를 등록된 `<channel source=...>` 전체 형식과 비교한다.
  일반 system reminder에는 이 경로를 그대로 적용할 수 없다.
- 선택 가능 상태는 연결 확인과 현재 prompt의 `Stop`, 그리고 알려진 idle 상태를 요구한다.
  새 대기 Hook이 `background_tasks`에 포함되면 자신의 대기 때문에 선택이 막힐 가능성도 검사한다.
- 현재 카드 유효기간은 600초, 선택 이후 continuation은 120초다.
  Claude readiness는 300초, heartbeat는 5초다. 이 네 시간을 동일한 timeout으로 취급하거나
  실험을 통과시키기 위해 늘리지 않는다. 특히 5분 이후 선택 가능성은 따로 증명한다.

근거: [라우팅 시간 상수](../../../../engine/routing/CoordinatorRoutingApplication.swift),
[Claude 연결 수명](../../../../bridges/claude/swift/adapter/ClaudeNativeSession.swift).

## 3. 격리 조건: 충족하지 못하면 native 실험을 시작하지 않는다

1. native Claude 실험은 새 macOS VM 또는 별도 테스트 사용자 계정에서 수행한다.
   개발자의 로그인 Keychain, Claude 설정·대화, `/Applications/Blabee.app`, 운영 서비스/소켓과
   Application Support를 공유하지 않는다. 임시 DB 경로나 `CLAUDE_CONFIG_DIR`만 바꾸는 것은 격리 증거가 아니다.
2. 먼저 모델·로그인 없는 모의 Hook/MCP fixture를 만든다. fixture 전용 디렉터리, 0700 권한,
   짧은 전용 UDS 경로, 임시 journal, fake clock 및 명시적인 테스트 freshness 저장소만 사용한다.
   설치 제품의 Keychain 기본 구현에 도달할 수 있으면 중단한다.
3. native 단계는 사용자가 허용한 테스트 계정과 테스트 프로젝트에서 새 일반 대화형 Claude 세션 A/B를 연다.
   기존 대화의 resume, 인증정보 복사, 전체 홈 마운트는 하지 않는다. 외부 요청은 Claude 인증·모델 통신에 필요한 범위만 허용한다.
4. 주입하는 MCP는 일반 tools만 제공하며 `claude/channel` capability나 Channel flag가 없어야 한다.
   실험용 도구는 claim과 고정된 테스트 표식 기록만 제공한다. 임의 셸·운영 파일 수정은 실험 작업에 포함하지 않는다.
   native Claude의 기본 도구도 별도로 제한하고 실제 노출 목록을 검사한다. 프롬프트의 요청만으로
   셸/파일/다른 MCP 접근이 제한된 것으로 간주하지 않는다. 도구 제한을 확인할 수 없으면 시작하지 않는다.
   후보 설정은 `--tools ""`와 fixture만 담은 `--strict-mcp-config`다. MCP 도구와 Claude의
   대화 종료 도구가 남는 경우를 실제 목록에서 확인한다. `--allowedTools`는 도구 제한과 다르므로
   이를 격리 근거로 쓰지 않는다. [공식 CLI 설명](https://code.claude.com/docs/en/cli-reference#flags)을 따른다.
5. 앱 UI 대신 fixture controller에서 A/B 선택을 발생시킨다. 이 결과는 Pet 클릭·단축키 검증으로 보고하지 않는다.
6. OS·architecture·Claude 버전/실행 파일 해시·설정 해시·fixture revision을 기록한다.
   전역 설치·업데이트 없이 별도 검증 대상 바이너리를 사용하며, 종료는 실험이 만든 정확한 프로세스에만 적용한다.
7. 원래 terminal 사용 흐름은 native 단계에서 실제 TTY로 확인한다. `-p`/SDK의 성공을
   일반 terminal 세션의 성공으로 대체하지 않는다.

기존 [test-native-session.mjs](../../../../Tests/bridges/claude/scripts/test-native-session.mjs)는
Swift 빌드를 시작한다. 이번에는 실행하지 않는다. 기존 fixture는 구조 참고 자료이며,
mock native 입력을 전달한 결과만으로 실제 Claude Hook 동작을 입증할 수 없다.

## 4. 검증할 후보 흐름

```text
실제 사용자 입력 → 해당 세션의 제안 생성 → bounded Hook 대기 등록
사용자 선택 → fixture의 선택 commit → 대기 Hook 완료(exit 2, 불투명한 참조만 전달)
Claude의 같은 native 세션이 깨어남 → 일반 MCP로 참조 claim
인증·세션·generation·만료·취소 검증과 단일 claim commit
→ 선택된 테스트 표식 한 번 기록 → 완료 확인
```

이 흐름은 제안 설계다. 현재 제품에 구현되었다고 해석하지 않는다.

- 첫 후보 trigger는 응답 종료 후의 `Stop`이다. 알려진 대기 카드가 없으면 즉시 정상 종료한다.
  사용자 interrupt에서 Stop이 없거나 wake 재진입으로 루프가 생기면 실패를 기록한다.
- 대안 trigger는 제안 MCP 호출 성공에 한정한 `PostToolUse`다. 모든 도구 실행마다 대기자를 만들지 않는다.
  native 실험에서 실제 등록된 도구 이름을 확인한 뒤 matcher를 고정한다.
- 일반 `async`+exit 0, `asyncRewake`+exit 0, `asyncRewake`+exit 2를 대조한다.
  readiness 시험용 wake는 작업 claim을 만들지 않는다.
- Hook 출력은 작업 본문이나 실행 권한이 아니다. fixture가 기록한 무작위 단회 참조만 전달하고,
  인증된 MCP claim의 성공 응답만 실행 대상으로 사용한다. `<channel>`을 조립하거나 prompt ID를 만들어 넣지 않는다.
- callback은 선택한 세션의 MCP 연결과 제한된 역할의 인증에 묶는다. source 문자열·nonce만으로
  권한을 인정하지 않고 native session, canonical cwd, session/service incarnation,
  owner/bridge identity, prompt generation, packet/revision, 선택 ID와 deadline을 함께 확인한다.
- 신뢰된 native Hook에 새 사용자 입력이 접수되면 그 이전의 미claim 선택을 취소한다.
  판정 경계는 사람이 키를 누른 시각이 아니라 신뢰된 입력 관측과 claim commit의 직렬화 순서다.
  새 입력 관측이 먼저인데 과거 선택이 claim되면 실패다. 이미 claim된 실행의 중단은 별도 동작으로 기록한다.
- 새 native prompt ID가 관측되지 않으면 과거 ID를 재사용하지 않는다. 별도 wake generation을
  인증된 관측에 결합해 동등한 보장을 만들 수 있는지 검토한다. 올바른 세션·현재 입력과의 순서를
  입증할 수 없으면 자동 이어가기를 지원하지 않는다.
- Hook 종료·알림 수신과 실행을 분리한다. 응답 유실 뒤 claim이나 작업을 자동 재전송하지 않는다.
  불확실한 결과는 중단 상태로 남기고, 해당 참조로 작업 본문을 다시 반환하지 않는다.

## 5. 단계별 절차와 중단 기준

최초 실험 범위는 **P0의 핵심 상태 전이와 P1의 짧은 wake 관측**이다.
두 단계에서 부적합이 드러나면 P2–P5로 확대하지 않는다. 뒤의 수락 행렬은
자동 이어가기 지원을 주장하기 전에 충족해야 할 조건이며 첫 실행에 모두 수행하는 목록은 아니다.

| 단계 | 절차 | 다음 단계로 넘어가는 조건 |
| --- | --- | --- |
| P0: 모델 없는 fixture | fake clock/인증/임시 journal로 선택·wake·claim 상태 전이를 검사한다. 중복·잘못된 세션·취소·응답 유실을 결정적으로 주입한다. | 아래 안전성 조건 통과. production DB/Keychain/서비스 접근 0건. native 호환성을 증명한 것으로 보고하지 않음. |
| P1: native wake 관측 | 별도 TTY에서 짧은 5초 대기로 대조군을 실행한다. exit 2는 우선 ACK만 요청한다. 실제 Hook 이벤트·prompt ID·모델 반응·UI 오류를 기록한다. | 자동 wake 관측, 사용자/프로젝트 동의 유지, 오류 루프 없음. 실제 관측할 수 없는 ID·순서는 미확정으로 남김. |
| P2: 단일 세션 claim | 고정 A/B 선택 후 동일 세션에서 인증된 claim과 표식 기록을 수행한다. 정상 사례는 최소 10회, 코드 변경 시 새 revision으로 분리한다. | 선택 ID당 claim commit 1회, 표식 1회, 미선택 표식 0회. 실행 확인과 모델의 완료 주장 분리. |
| P3: 경쟁·수명 | 두 native 세션, 새 입력, 취소, 만료, Hook/MCP/서비스 종료, 응답 유실과 재개를 검사한다. 결정적 fault case는 최소 3회 반복하고 native 증거를 별도 표시한다. | 잘못된 세션·만료·취소된 작업 실행 0건. 관측되지 않은 순서는 성공으로 추정하지 않음. |
| P4: 시간·자원 | 10분 대기, 5개 세션 대기, 100회 모의 교체/선택, native의 연속 새 카드 최소 10회로 대기자·FD·메모리·CPU를 관측한다. | 아래 자원/수명 기준 통과. 짧은 재현으로 10분 지원을 주장하지 않음. |
| P5: 버전/UX 판정 | 검증된 현재 버전, 소스의 기존 하한 2.1.248, 도입 시점 근거가 확보되면 그 경계 버전을 분리 시험한다. | 통과한 정확한 버전/OS 조합만 자격 부여. 미확인 버전에 자동 적용 금지. |

시간이나 계정 조건 때문에 어떤 단계도 실행하지 못하면 `NOT RUN`이다. P0만 통과하면
모의 상태 전이만 확인한 것이다. P1만 통과하면 wake 기능만 확인한 것이다.
P0–P5를 모두 통과해도 제품 연결·공증 앱의 새 Mac 설치·배포 자격은 별도 검증이다.

## 6. 필수 수락 행렬

| ID | 입력/경쟁 조건 | 성공·실패 판정 |
| --- | --- | --- |
| A01 | idle 상태에서 A 선택 | 같은 세션의 A만 1회 claim/실행. 출력·완료 기록까지 식별자 일치. |
| A02 | A/B 두 세션, 같은 cwd 또는 다른 cwd, 도착 순서 뒤집힘 | 선택한 native 세션만 처리. cwd나 최근 전면 창으로 세션을 추정하지 않음. |
| A03 | 참조를 다른 세션에 복사, MCP 재연결, 잘못된 역할/nonce | 실행 0건. raw ref 보유만으로 claim되지 않음. |
| A04 | 같은 선택 알림 2개, Hook 2개, 동시 claim 2개 | claim commit·실행 최대 1회. 두 응답 모두 작업 본문을 주면 실패. |
| A05 | claim 전/commit 후/응답 전 단절과 fixture 재시작 | 미확정 결과 자동 실행·재전송 없음. 사용한 참조 재사용 불가. 정상 재시작도 과거 참조를 활성화하지 않음. |
| A06 | 카드 만료 전후, stale revision, 선택 후 continuation 만료 | 경계값 전후를 fake clock으로 검사하고 native 장기 사례를 구분. 만료된 작업 0건. |
| A07 | 선택 직전·wake 직전·claim 직전에 새 프롬프트, 그 뒤 이전 턴의 늦은 Stop | 새 입력 관측이 claim commit보다 먼저면 기존 선택 거절. 뒤늦은 reminder/Stop이 새 작업을 덮어쓰거나 이전 대기자를 다시 등록하지 않음. |
| A08 | 건너뛰기/취소/사용자 interrupt/SessionEnd | Hook 알림 발송 전에 취소되면 새 wake를 만들지 않음. 이미 발송된 reminder가 늦게 도착할 수 있으므로 이 경우에는 stale claim·실행 0건으로 판정. 대기자 종료 및 새 연결 authority 필요. |
| A09 | Hook timeout·MCP EOF·서비스 incarnation 변경 | 원래 Claude 이용을 무한 대기로 막지 않음. 과거 권한 재사용·자동 프로세스 재시작 없음. |
| A10 | 위조 메시지, journal 변조·rollback, freshness 불일치 | MAC·저장 무결성·freshness 실패를 계속 거절. mocked 검증 통과로 native/제품 검증을 대체하지 않음. |
| A11 | Hook waiter가 Stop의 background_tasks에 포함됨 | 자신 때문에 영원히 선택 불가해지는지 검출. 전체 background 목록 무시 금지. 인증된 자체 waiter만 별도로 구분할 수 없으면 실패. |
| A12 | 0·299·301·599초 이후 선택과 600초 이후 만료 | readiness 300초를 넘겨도 600초 카드 지원을 주장하려면 연결 검증 수명까지 증명. 자동 갱신 루프/기존 TTL 연장으로 통과시키지 않음. |
| A13 | 모델 처리 중·도구 승인 대기 중 wake | native 승인 대신 Hook이 허용하지 않음. 관측한 정확한 순서와 처리 보류/취소 결과를 기록. 예상 순서를 가정하지 않음. |
| A14 | 정상 선택 처리 시 Hook 오류 표시, 연속 Stop 재발화 | 성공한 선택을 반복 오류로 표시하거나 무한 응답/유령 카드가 생기면 UX 실패. Claude 경고를 숨겨 통과시키지 않음. |
| A15 | 테스트 세션의 `/clear`, compact, 정상 종료 후 명시적 resume | 이전 generation의 wake/claim은 거절. native ID 유지 여부를 실측하며, 새 연결 관측 없이 과거 readiness·선택을 복원하지 않음. |

변조/freshness/claim의 durable 확인은 테스트 전용 저장소로 수행한다. 단순 인메모리 카운터는
프로세스 재시작이나 journal 무결성의 증거가 아니므로 별도 fixture 조건으로 분리한다.

## 7. 시간·요청 수·자원 측정

다음 목표값은 **이번 실험을 위한 제안 기준**이며 현재 제품의 측정값이나 보장값이 아니다.

- 로그 시각은 monotonic clock으로 기록한다. 비교 범위가 다른 프로세스라도 동일 host의 clock 기준을 사용한다.
  `선택 commit → Hook 종료 → native 수신 관측 → MCP claim 요청 → claim commit → 표식 기록 → 완료 확인`을 분리한다.
  native 수신 시각이 노출되지 않으면 `미관측`으로 표시하고 모델 호출 시작/ACK 시각으로 대체했다고 명시한다.
- 로컬 전달 목표: 선택 commit→Hook 종료 p95 250ms 이내. 순수 로컬 측정은 최소 20표본으로 보고한다.
  모델 스케줄·API 대기 시간은 별도 분포로 제시하며 이 250ms에 포함하지 않는다.
- 기록별 `wake_requested`, `hook_spawned`, `hook_exited`, `claim_requested`, `claim_committed`,
  `marker_written`, `completion_recorded`, `cancelled`의 수를 비교한다.
  정상 사례는 선택당 wake 1·claim commit 1·표식 1이다. 추가 모델 호출은 성공 수와 별개로 보고한다.
- 장기 대기자는 세션당 최대 1개다. 교체 중 새 대기자를 받기 전에 이전 것을 취소·reap한다.
  서비스 대기를 이벤트 기반으로 구현하고 주기적 자식 프로세스 재생성·모델 poll을 하지 않는다.
- idle 자원은 Blabee 없는 동일 Claude 세션을 기준선으로 삼는다. 초기 목표는 추가 구성 요소 합계의
  60초 평균 CPU < 1% of one core, 안정된 idle RSS 증가 < 100MiB/세션이다.
  5개 세션·10분 관측과 100회 모의 교체 후 프로세스/FD의 단조 증가가 없어야 한다.
  메모리는 시작 직후 대신 워밍업 후 비교하고 allocator의 일시 증가와 지속 누수를 구분한다.
- 종료/취소 뒤 대기자와 자식이 2초 이내 정리되는 것을 목표로 한다. 지연/잔존 PID는 실패로 기록하며
  무관한 Node·Claude 프로세스를 종료하지 않는다. native 프로세스 종료 방식은 테스트가 소유한 PID로 한정한다.
- 카드가 없는 idle 구간에는 이 연결로 발생한 모델 요청이 0건이어야 한다. 진단·readiness 요청도 분리 계수한다.
  워밍업 후 10분의 같은 측정 구간을 baseline/fixture에서 사용하고, 허용된 테스트 계정과
  CLI에서 얻은 세션별 요청 이벤트/요청 카운터로 확인한다. Hook·wake 수나 ACK 부재로 모델 요청 수를
  추정하지 않는다. API 요청이나 이 연결에 대한 귀속을 관측할 수 없으면 `미관측/NOT RUN`으로 남기고
  전체 P4 통과로 집계하지 않는다. 토큰 사용량만 있으면 요청 횟수로 환산하지 않는다.
- 승인된 테스트 예산을 넘거나 루프/급격한 자원 증가가 감지되면 해당 실험을 중지하고 근거를 보존한다.

## 8. 증거와 결과 분류

실행 후 생성할 산출물은 `environment.json`, `cases.jsonl`, `timings.csv`, `resource-samples.csv`,
`SUMMARY.md`다. 이번 설계 단계에서는 생성하지 않는다. 기준선·fixture·native·제품 통합 결과를 섞지 않는다.

원문 프롬프트·계정·token·Keychain 값은 수집하지 않는다. 테스트 세션 별칭, 로컬에서만 연결할 수 있는
해시, generation, 사건 코드, return code와 표식 수를 사용한다. 복사/위조 테스트에 필요한 참조는
테스트 데이터로만 취급하고 보고서에는 원문을 남기지 않는다.

| 결과 | 제공 가능한 범위 |
| --- | --- |
| P0–P5 통과 | 검증한 버전/OS에 한해 자동 이어가기 구현 후보. 다음 작업에서 Claude 브릿지 통합·회귀 및 설치본 수용 검증 필요. |
| wake는 성공, 세션·입력 순서/단일 claim 증명 실패 | 자동 실행 지원하지 않음. 사용자가 현재 Claude에서 명시적으로 재개하는 일반 MCP/skill 경로를 별도로 설계. |
| 10분 수명/자원/오류 UX 실패 | 10분 자동 선택 지원으로 배포하지 않음. 제한을 명시한 수동 경로 또는 공식 Channels 경로 검토. |
| 버전·조직 정책·프로젝트 신뢰 미충족 | 해당 환경은 지원 불가로 표시하고 사용자의 일반 Claude 이용은 유지. 개발 flag나 정책 변경으로 자동 fallback하지 않음. |
| native 실행 미승인·격리 미확보 | `NOT RUN`. mock 성공을 근거로 지원 가능 판정 금지. |

## 9. 구현으로 넘어갈 때의 변경 범위

P0/P1이 타당할 때에만 먼저 독립 fixture에서 작은 proof를 만든다. 그 후 제품 연결을 설계한다.
공통 Engine·Pet를 복제하지 않고 `bridges/claude`의 알림·세션 관측·claim 어댑터와 패키징을 중심으로 한다.
계약 변경이 필요하면 버전과 양방향 거부 검사를 먼저 정의하며 기존 Channel 검사를 느슨하게 하지 않는다.

참고 테스트는 [session-v2 Hook 입력](../../../../Tests/bridges/claude/session-v2-hook-input.test.mjs),
[lifecycle](../../../../Tests/bridges/claude/session-v2-lifecycle.test.mjs),
[취소](../../../../Tests/bridges/claude/session-v2-cancellation.test.mjs),
[heartbeat](../../../../Tests/bridges/claude/session-v2-heartbeat.test.mjs)다.
이 파일을 이번에 수정하거나 실행한 것은 아니다.

공개 배포는 별도로 정식 약관·개인정보 안내, plugin 신뢰와 조직 정책, Developer ID/공증,
깨끗한 Mac 설치·업데이트 검증을 충족해야 한다. 이 실험의 성공이 Channels 허용 등록을 뜻하지는 않는다.
