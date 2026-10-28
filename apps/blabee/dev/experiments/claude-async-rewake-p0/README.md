# asyncRewake P0: 모델 없는 선택 상태 fixture

이 디렉터리는 [격리 검증 계획](../../../docs/bridges/claude/product-connection/ASYNC_REWAKE_QUALIFICATION_PLAN.md)의
**P0 상태 전이 실험**이다. 제품 코드나 실제 Claude Hook/MCP 구현이 아니다.
`asyncRewake` 설정을 등록하지 않으며 Claude, 설치 Blabee, 운영 서비스에 연결하지 않는다.

## 실행

저장소 루트에서 Node 내장 test runner만 직접 실행한다. 외부 패키지 설치는 필요 없다.
루트 `npm test`나 기존 Claude runner는 사용하지 않는다.

```sh
env -u NODE_OPTIONS -u NODE_PATH node --test --test-reporter=spec dev/experiments/claude-async-rewake-p0/fixture.test.mjs
```

검증 환경: Node v22.23.2. 최소 지원 Node 버전이나 제품 실행 환경을 확정한 것은 아니다.
Node 프로세스와 임시 파일은 사용하지만 모델/API·네트워크·Claude 프로세스·Swift 빌드는 사용하지 않는다.

## 파일과 격리

| 파일 | 책임 |
| --- | --- |
| `fixture.mjs` | fake clock, 테스트 인증 발급, 세션/제안/선택/wake/claim/취소/표식/완료 상태 전이 |
| `test-store.mjs` | 테스트마다 새 0700 임시 디렉터리, 0600 snapshot journal, 일회 MAC 키, 별도 메모리 freshness |
| `fixture.test.mjs` | 두 세션, 경합 barrier, 시계 경계, 인증 거부, 저장/응답 유실 fault injection |
| `RESULTS.md` | 실행 결과와 미검증 범위 |

- 제품 모듈과 설정·환경 파일을 import하거나 읽지 않는다. 내장 모듈만 사용한다.
- 저장 경로를 인자로 받지 않는다. `mkdtemp`로 만든 전용 임시 디렉터리만 쓰고 각 테스트 후 삭제한다.
- MAC 키와 인증 토큰은 이 테스트가 임의 생성한 메모리 값이다. Keychain·로그인·사용자 인증정보가 아니다.
- `test-*` 세션과 `/fixture/project-a` 등의 cwd는 **합성 식별자**다. 해당 경로를 열지 않으며,
  native 세션 ID 출처, symlink, 실제 cwd canonicalization은 검증하지 않는다.
- `issueTestCredentials`와 `inspect`는 신뢰된 테스트 controller 전용이다. 실제 MCP에 노출할 API가 아니다.
- 테스트의 import/API 목록 검사는 우발적 의존성 추가를 잡는 정적 guard다. OS sandbox 보증이 아니다.

## 모형의 경계

1. 신뢰된 합성 prompt 관측으로 generation을 올린다. bridge 역할은 고정된 테스트 표식 후보만 제안한다.
2. readiness ACK와 합성 Stop 뒤 hook 역할이 대기자를 등록한다. 같은 packet/generation에는 하나뿐이다.
   카드가 없으면 대기자를 만들지 않는다. 중복 arm/Stop/조회는 기한을 늘리지 않는다.
3. selector 역할이 선택을 저장한다. wake는 불투명한 `ref`와 `nonce`만 반환한다.
   작업 본문·실행 권한을 반환하거나 native prompt/channel을 만들어내지 않는다.
4. bridge 역할의 claim은 인증·역할·세션·cwd·소유자·세션/연결/서비스 incarnation·generation·revision·nonce·
   readiness·만료·취소를 검증한다. 사전 검사와 commit 사이 barrier 뒤 **lock 안에서 다시 검사**한다.
5. claim commit이 끝나야 테스트 표식과 grant를 한 번 반환한다. `recordTestMarker`와 `complete`는
   별도 호출이다. claim 저장만으로 표식이나 완료를 만들지 않는다. 임의 명령·파일 작업은 실행하지 않는다.
6. 새 입력·취소·종료·연결 변경은 오래된 선택을 무효화한다. 이미 내보낸 알림은 돌아올 수 있지만
   늦은 claim은 거절한다. 이미 반환된 본문 자체를 회수할 수는 없다. 취소 후 표식 차단은 fixture의
   별도 표식 검증을 통과해야 하는 이 모형의 성질이며, 실제 모델의 외부 작업 취소를 입증하지 않는다.

`openTestSession`, `observeSyntheticPrompt`, `observeSyntheticStop`, `ackTestReadiness`는 관측을 **주입**한다.
실제 Claude가 동일한 이벤트·ID·순서를 제공한다는 증거가 아니다.
`reconnectTestSession`은 EOF/재연결 뒤 권한 변경을 모사한다. 실제 MCP 소켓이나 EOF는 사용하지 않는다.

## 저장과 유실의 의미

- journal은 이벤트마다 전체 상태 snapshot을 MAC chain으로 연결한다. 읽을 때 체인과 별도 freshness head를
  모두 검사한다. 과거에 유효하게 서명된 파일도 최신 anchor와 다르면 거절한다.
- `reopenStoreObject()`는 파일을 새로 읽는 저장소 객체를 만든다. 가변 상태 snapshot을 공유하지 않는다.
  다만 테스트 인증 발급자와 freshness authority, 직렬 lock은 같은 프로세스 메모리에 의도적으로 남는다.
- 서로 다른 저장소 객체의 동시 claim은 이 메모리 lock으로 직렬화한다. **다중 프로세스 lock,
  실제 재부팅/프로세스 crash, SQLite·Keychain, fsync·전원 장애 내구성은 검증하지 않는다.**
- `before_write` 실패: claim 없음. 자동 재시도 없음. 테스트 controller가 명시적으로 다시 요청하면
  유효한 미사용 ref만 claim할 수 있다.
- `after_file_before_anchor` 실패: 파일과 anchor 불일치. 다음 읽기와 claim은 거절한다.
  anchor를 파일에서 재구성하거나 데이터를 복구했다고 간주하지 않는다.
- `after_commit` 실패: claim은 저장됐지만 본문 응답은 유실됨. 재요청·객체 재생성 뒤에도 본문을
  다시 주지 않는다. **같은 턴 재응답 복구 정책을 가진 다른 제품 경로에 이 정책을 자동 적용하지 않는다.**
- 알림 유실·claim 유실·Hook 포기 후 자동 재전송/실행 worker는 없다.

## 시계·대기자·측정

카드 600초, continuation 120초, readiness 300초를 별도로 검사한다. 경계 정각부터 만료다.
이 후보 모형은 claim/표식에도 카드 만료를 다시 검사하는 보수적인 정책을 사용한다.
실제 제품의 만료 계약을 변경하거나 동일하다고 입증한 것이 아니다.
5분 뒤에도 살아 있는 카드가 readiness 부족으로 거절되는 모의 사례는 **의도된 검증 결과**다.
새 readiness ACK 없이 10분 전체 구간 선택이 된다고 보고하지 않는다.

대기자는 메모리 상태일 뿐 timer·프로세스·소켓을 만들지 않는다. fake clock을 진행하고 `wake`를
명시 호출해 논리적 timeout을 관측한다. 만료된 대기자 tombstone은 같은 카드로 다시 arm되지 않는다.
이는 native Hook의 자동 종료·정리 시간이나 background task 동작 검증이 아니다.

동시성 테스트는 sleep 대신 barrier와 promise 경합을 사용한다. 출력의 Node 실행 시간은
모의 검사를 수행한 벽시계 시간이며 Claude wake latency가 아니다. `counts`는 대기자·알림·claim·완료,
`metrics`는 요청/응답과 journal load/검증 snapshot 수다. 제품 journal replay 횟수나 성능 개선 비교가 아니다.
이 fixture에는 캐시/증분 replay 최적화가 없고 매 읽기에 전체 작은 journal을 검증한다.

## native 단계로 넘길 미검증 항목

- 실제 `asyncRewake` 지원 버전, 설정/exit 2의 수용, reminder 도착과 같은 terminal 세션 재개
- wake 때 UserPromptSubmit/prompt ID 유무, Stop 재진입, background task의 idle 판정 영향
- 모델 동작 중·권한 대기 중 순서, 사용자 입력 관측 순서, clear/compact/resume 뒤 권한 수명
- 10분·5세션에서 timer/프로세스 정리·CPU/RSS, 모델 요청 수 및 실제 지연
- Pet 클릭/단축키, 실제 MCP 인증·세션 provenance, 제품 MAC/freshness·crash recovery

다음 단계에는 별도 macOS 테스트 사용자 또는 VM과 새 테스트 계정/세션, 실제 노출 도구 제한을
먼저 확인해야 한다. P0 통과만으로 native Claude 지원이나 사용자 배포 가능을 결론 내리지 않는다.
