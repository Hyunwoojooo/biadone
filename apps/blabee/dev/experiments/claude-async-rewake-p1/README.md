# P1 도구: 5초 Hook과 이벤트 관측

2026-09-27 추가 확인: 사용자가 허용한 임시 Claude 프로필에서 같은 세션의 native wake를 관측했다.
실제 관측과 제품 연결의 검증 범위는 [공개 MCP·Hook 기록](../../../docs/bridges/claude/product-connection/PUBLIC_MCP_HOOK.md)을 따른다.
아래의 미실행 설명은 이 실험 도구를 처음 작성한 시점의 범위다.

이 도구는 [격리 검증 계획](../../../docs/bridges/claude/product-connection/ASYNC_REWAKE_QUALIFICATION_PLAN.md)의
P1을 **준비**한다. 사용자가 설치할 Blabee 기능에 포함하지 않는다.
이번 작성·검사는 실제 Claude, 모델/API, 설치 앱, 운영 서비스/DB/Keychain을 사용하지 않는다.

확인하려는 것은 실제 Claude에서 짧은 알림이 같은 테스트 세션을 깨우는지다.
이 디렉터리는 준비와 기록을 담당하며, Claude를 실행하는 launcher나 실제 작업 claim 도구는 없다.
P0의 선택 상태 모형과 제품 코드도 변경하지 않는다.

## 구성

| 파일 | 역할 |
| --- | --- |
| `prepare.mjs` | 새 전용 run 디렉터리, 세션 UUID, 설정·관측 템플릿 생성 |
| `hook.mjs` | stdin JSON 수신, 사건 기록, 조건에 맞는 첫 Stop에서 5초 대기·종료 |
| `core.mjs` | 대조군, 세션/입력 확인, 단회 예약, 짧은 파일 잠금, 취소, 요약 |
| `record.mjs` | 기록 요약 출력 또는 실험 취소 기록 |
| `settings.examples.json` | 세 대조군의 설정 구조 예시. 절대 경로 placeholder 포함 |
| `p1.test.mjs` | 합성 Hook 입력과 테스트 소유 Node 프로세스만 사용하는 검사 |
| `RESULTS.md` | 검사 결과와 실제 Claude 미검증 항목 |
| `ISOLATED_RUNBOOK.md` | 현재 환경 준비 상태, 고정 후보 버전, 격리 환경의 세 대조군 실행 절차 |

Node 내장 모듈만 사용하며 설치할 패키지는 없다. Node v22.23.2에서 검사했다.
예시 설정은 읽기용이다. 실제 파일은 아래 prepare 명령이 해당 환경의 절대 경로로 생성한다.
`/ABSOLUTE/...` 예시를 사용자 Claude 설정에 붙여 넣지 않는다.

## 모델 없는 검사

저장소 루트에서 실행한다. Swift나 제품 runner는 실행하지 않는다.

```sh
env -u NODE_OPTIONS -u NODE_PATH node --test --test-reporter=spec dev/experiments/claude-async-rewake-p1/p1.test.mjs
```

검사는 임시 전용 디렉터리를 만들고 끝나면 정리한다. 테스트가 소유한 Node Hook 자식만 실행한다.
한 검사는 실제 5초 타이머를 사용한다. 그 외 Stop 대기는 주입한 시계/대기 barrier로 통제하며,
stdin·writer lock 제한은 실제 짧은 타이머로 검사한다.
원래 Claude/Codex/Blabee/Node 프로세스를 찾거나 종료하지 않는다.

## 대조군과 설정 생성

| mode | Stop 설정 | 5초 뒤 정상 경로의 결과 | 이후 실제 Claude에서 관측할 것 |
| --- | --- | --- | --- |
| `async-exit0` | `async: true` | exit 0, 출력 없음 | 기준선 |
| `rewake-exit0` | `asyncRewake: true` | exit 0, 출력 없음 | exit 2가 없을 때의 반응 |
| `rewake-exit2` | `asyncRewake: true` | exit 2, stderr에 ACK 요청 | 같은 세션의 wake·ACK·Hook 오류 표시 |

각 대조군은 **새 run 디렉터리와 새 테스트 세션**을 사용한다. 한 run을 수정해서 재사용하지 않는다.
prepare는 아래 경로가 이미 있으면 중단하며 기존 파일을 덮어쓰지 않는다.

```sh
env -u NODE_OPTIONS -u NODE_PATH node dev/experiments/claude-async-rewake-p1/prepare.mjs \
  --run /private/tmp/blabee-p1-first-observation \
  --mode rewake-exit2
```

나머지 대조군은 다른 새 경로와 mode로 생성한다. 이 명령은 파일만 만들고 Claude를 실행하지 않는다.
합성 입력만 보내는 추가 로컬 검사에는 `--origin synthetic`을 명시한다.
native 준비의 기본 origin은 `native-prepared`다. 이 라벨은 실행 증거나 인증이 아니다.

생성 파일:

- `manifest.json`: 새 테스트용 세션 UUID·run 식별자·대조군·유효기간·소스/설정 hash.
- `settings.json`: SessionStart/UserPromptSubmit/Stop/SessionEnd Hook 설정.
- `mcp-empty.json`: 빈 MCP 목록. P1 ACK 관측에는 MCP 도구가 필요 없다.
- `launch-args.json`: 나중에 새 테스트 Claude에 전달할 인자 배열. 자동 실행되지 않는다.
- `project/`: 해당 run만을 위한 빈 작업 폴더.
- `events.jsonl`: 사건 기록. 생성 직후에는 `run_prepared`만 기록되어 있다.
- `observations.json`: 실제 실행 여부·버전·동일 세션 wake·오류 UI·격리/도구 확인을 사람이 기록할 양식.

전용 디렉터리는 0700, 파일은 0600이다. source/settings hash는 실험 중 설정이 바뀌는 실수를
검출하기 위한 것으로 서명·인증 수단이 아니다. 도구 소스를 수정했으면 새 run을 만든다.
새 UUID는 공식 `--session-id` 인자로 새 Claude 세션에 지정할 예정인 ID이며,
이미 실행 중인 사용자 세션의 ID를 읽거나 복사하지 않는다. 실제 Hook 입력도 그 ID와 일치해야 한다.

## 실제 Claude 실행은 다음 단계

현재 Mac의 준비 상태와 구체적인 명령은 [격리 실행 절차](ISOLATED_RUNBOOK.md)에 정리했다.

이번 작업에서는 아래 실행을 **수행하지 않았다**. 별도 macOS 테스트 사용자 또는 VM에서
새 테스트 계정·프로젝트·세션을 준비한 뒤 진행한다. 임시 폴더나 환경변수 하나만으로 격리를
확보했다고 판단하지 않는다. 기존 홈·인증정보·앱 서비스·기존 대화를 공유하지 않는다.

1. 도구 소스를 격리 환경에 복사하고 그 환경에서 prepare를 실행한다. 개발자 홈에 있는 Node/소스
   절대 경로를 VM에서 그대로 사용하지 않는다.
2. 사용할 Claude의 정확한 버전·OS를 기록하고 명령형 Hook의 `args`/`asyncRewake` 지원을 확인한다.
   `launch-args.json`의 `--settings`, `--setting-sources`, `--tools`, `--strict-mcp-config`가
   실제로 적용되는지도 확인한다. 기존 최소 지원 버전을 이 도구의 검증된 버전으로 간주하지 않는다.
3. `project/`에서 새 일반 대화형 TTY를 연다. `launch-args.json`의 값에 따라
   `--session-id`로 생성된 새 UUID, `--settings`로 생성된 파일,
   `--setting-sources ""`, `--tools ""`, `--strict-mcp-config --mcp-config .../mcp-empty.json`을 지정한다.
   `-p`, SDK, resume, 개발 Channels, 권한 우회 옵션은 이 실험 경로에 포함하지 않는다.
4. 프로젝트 신뢰와 조직 정책을 유지한다. 관리형 설정은 CLI 인자로 사라지는 것이 아니므로,
   예상하지 않은 Hook/MCP/도구가 실제로 노출되면 실행을 중단한다.
5. 첫 테스트 입력은 `준비되면 READY만 답하고 기다려 주세요.`처럼 고정한 짧은 문장을 사용한다.
   첫 응답 종료 뒤 5초를 관측한다. exit 2 대조군의 알림은 임의 작업 대신 run별 ACK 한 줄만 요청한다.
6. native wake·같은 세션인지·오류 UI·새 prompt ID 유무를 기록한다.
   모델의 ACK 문장만으로 작업 실행이나 배포 지원을 판정하지 않는다.

동작하지 않으면 stderr 오류를 숨기거나 다른 사용자 세션을 재개하지 않는다.
각 대조군의 새 run에서 관측된 사실과 미관측 항목을 구분한다.

## 반복·취소·입력 처리

- 예상한 세션 ID와 정확한 `project/` cwd, fresh `SessionStart(source=startup)`가 먼저 필요하다.
  다른 세션·cwd·subagent의 입력은 기록 후 대기 없이 종료한다. 첫 Stop으로 세션을 추정하지 않는다.
- 첫 UserPromptSubmit의 실제 `prompt_id`를 관측하고 첫 Stop과 비교한다. ID가 없거나 다르면
  대기하지 않는다. 임의 prompt ID를 만들지 않으며 absent는 로그에 명시한다.
- `stop_hook_active=false`, 빈 `background_tasks`·`session_crons`를 요구한다.
  목록을 관측할 수 없으면 idle로 추정하지 않는다. 이미 예약된 run에서는 재발한 Stop도 대기하지 않는다.
- run당 대기는 최대 한 번이다. 여러 Hook 프로세스가 동시에 들어와도 파일 잠금 안에서 예약한다.
  새 prompt·재시작·취소가 예약을 초기화하지 않는다. 실패나 응답 유실 뒤 자동 재시도하지 않는다.
- 5초 대기 동안 잠금을 잡지 않는다. 이후 취소·종료·새 입력과 설정을 다시 확인한 뒤
  예정 종료를 저장한다. 이 저장 이후 프로세스가 죽으면 알림은 유실될 수 있으며 재발송하지 않는다.
- 수동 취소나 새 입력은 다음 최종 검사에서 알림을 억제한다. **대기 프로세스는 남은 5초를 기다릴 수 있다.**
  SIGINT/SIGTERM을 받은 해당 Hook은 타이머를 중단한다. 실제 Claude의 interrupt 전달은 미검증이다.
- 이미 stdout/stderr로 넘긴 알림을 회수할 수는 없다. 최종 로컬 결정과 실제 reminder 수신 사이의
  경쟁, 실행 claim 검증은 이후 단계에서 다룬다. 이 도구에는 작업 실행 기능이 없다.
- stdin은 64KiB·2초, writer lock 획득은 약 500ms, 기록은 256사건·512KiB로 제한한다.
  malformed JSON·손상 파일·symlink·설정 변경·잠금 실패는 exit 1이며 원문 입력/오류를 출력하지 않는다.
- 입력 읽기·검증 실패도 해당 run에 취소를 기록하여 기존 대기 알림을 억제한다. 저장소 자체가
  읽히지 않으면 복구하거나 기록을 초기화하지 않는다.
  취소는 JSONL 잠금과 별도로 `cancelled/` 표시를 먼저 생성한다. 일시적 잠금 경합으로 JSONL에
  취소 사건을 쓰지 못해도 이 표시가 남으면 최종 검사에서 알림을 억제한다. 표시는 자동 삭제하지 않는다.
  파일 권한·저장 장치 오류로 표시 생성까지 실패하면 취소 확정을 보장하지 못하며,
  읽을 수 없는 저장 상태에서는 알림을 중단한다. 판정 기준은 관측한 취소 표시/기록과
  최종 로컬 결정의 순서이며 실제 키 입력 시각을 보장하지 않는다.
- 정상 억제와 recorder는 exit 0이다. 의도한 `rewake-exit2`의 단회 알림만 exit 2를 사용한다.
  run 준비 후 30분이 지나면 새 실험을 준비한다. 중단된 lock을 자동으로 탈취하거나 삭제하지 않는다.

## 이벤트 기록과 조회

```sh
env -u NODE_OPTIONS -u NODE_PATH node dev/experiments/claude-async-rewake-p1/record.mjs \
  --run /private/tmp/blabee-p1-first-observation --operation report

env -u NODE_OPTIONS -u NODE_PATH node dev/experiments/claude-async-rewake-p1/record.mjs \
  --run /private/tmp/blabee-p1-first-observation --operation cancel
```

report는 읽기만 한다. cancel은 그 run에 취소 표시와 사건을 추가하며 프로세스를 종료하지 않는다.
`cancellation_latched`는 JSONL 쓰기 성공과 별도로 취소 표시가 존재하는지 보여 준다.
`observations.json`은 사람이 작성할 별도 양식이며 report가 자동으로 채우거나 성공 판정하지 않는다.

기록 항목은 sequence, wall time, monotonic time, 호출 UUID, 사건 코드, run별 salt로 만든 세션/cwd/prompt
hash, 배열의 개수, Stop guard와 ACK의 정확 일치 여부다. 원문 prompt·assistant 응답·transcript 경로·
task 명령·계정·환경변수는 기록하지 않는다. `transcript_path` 파일도 읽지 않는다.

`wait_started`는 로컬 예약, `hook_exit_committed`는 **출력 전 예정 종료의 저장**이다.
후자는 실제 프로세스 종료·Claude 수신·모델 실행의 증거가 아니다.
`hook_ack_match_count`도 제공된 stdin에 ACK 문자열이 있었다는 뜻이며 Hook 출처 인증은 아니다.
report의 `native_qualification`은 항상 `NOT_EVALUATED`다.

sequence는 이 run의 기록 순서다. elapsed는 동일 waiter의 monotonic clock 차이로 측정한다.
서로 다른 프로세스의 clock 원점·실제 native 이벤트 발생 순서를 sequence만으로 증명하지 않는다.
wall time과 native 관측은 별도 기록한다. JSONL과 메모리 없이 재읽는 단회 예약은 모형의 편의 장치이며
제품 MAC/freshness, 악의적인 같은 사용자, 파일 rollback, fsync/전원 장애 내구성을 보증하지 않는다.
hash 확인 대상은 manifest/settings/core/hook이다. `launch-args.json`·`mcp-empty.json`과 실제
Claude의 유효 설정 전체를 봉인한 것이 아니므로 native 단계에서 별도로 확인한다.

## 확인한 공식 문서

2026-09-26 확인. 아래 문서에 근거한 후보 설정이며 실제 설치 버전의 실행 검증은 남아 있다.

- [Hook 공통 입력](https://code.claude.com/docs/en/hooks#common-input-fields): 세션·prompt ID와 stdin 형식.
- [명령형 Hook 필드](https://code.claude.com/docs/en/hooks#command-hook-fields): exec 형식의 args와 asyncRewake.
- [Stop 입력](https://code.claude.com/docs/en/hooks#stop-input): 재진입 flag, background/cron 목록.
- [백그라운드 Hook](https://code.claude.com/docs/en/hooks#run-hooks-in-the-background): timeout·중복 발화의 경계.
- [CLI](https://code.claude.com/docs/en/cli-reference): 새 session ID, 세션 설정, 도구/MCP 제한 인자.

이 도구의 통과는 Claude 지원 버전, 10분 수명, 다중 세션 전달, 실제 선택 실행, 설치 제품 배포를 입증하지 않는다.
