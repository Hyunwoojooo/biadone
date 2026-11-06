# 제품 세션 권한 연결과 owner 갱신 — CP-03

2026-09-19. [CP-02 등록](SESSION_REGISTRATION.md)의 scope별 권한 객체를 실제 native/inner ingress와 저장 경계에 연결한다. owner의 갱신 controller는 설치 launcher와 분리한다. 현재 개발용 `claude:shared`의 v1 grant나 실행 중인 세션을 자동 전환하지 않는다. 설치 owner·Claude 자식 관측·Hook/MCP v2 client를 묶는 CP-05는 후속이다.

## 인증과 요청 경로

등록에 성공한 private owner socket은 같은 peer/프로세스 시작 식별과 발급한 여섯 UUID를 유지한다. 이후 `blabee.claude-owner.v1`의 `renew`와 `end`만 받으며 추가 FD·다른 scope·역할 변경을 거부한다. 일반 UDS에서 owner를 등록하거나 갱신하지 않는다. 공개 UUID는 인증 정보가 아니다.

Hook/MCP의 일반 UDS type은 `claude_session_v2`이며 입력 payload는 다음 구조다.

```text
{
  auth_token: <해당 역할의 private capability>,
  envelope: <blabee.claude-session.v2 요청>
}
```

capability는 입력 wrapper에만 둔다. 기존 codec의 envelope·일반 응답·DB·로그에는 넣지 않으며 UDS의 알려진 비밀값 응답 검사를 유지한다. registry가 scope·여섯 UUID·Hook/bridge 역할을 확인하고, native 계층과 내부 ingress도 같은 권한 객체로 다시 판정한다. 제품 객체는 개발용 v1 handler로 진입할 수 없다. selector는 서비스 내부의 별도 자격이며 일반 session v2나 private owner의 역할로 바꿔 사용할 수 없다. Pet wire 연결은 CP-06다.

native 내부 오류는 제품 계약이 허용한 고정 오류 코드로 변환한다. 오류 응답도 원 요청과 authority에 묶어 codec 검사를 통과해야 하며, 내부 오류 문자열을 그대로 wire에 내보내지 않는다.

제품 설정은 예상 native session UUID와 core journal session ID를 분리한다. 실제 `SessionStart(startup)`의 native ID·cwd가 일치해야 제안·선택을 처리한다. 인증된 Hook이 다른 native ID/cwd 또는 미지원 source를 관측하면 해당 권한을 회수한다. grant 발급이나 MCP 도구 등록 자체를 native 관측·readiness 증거로 삼지 않는다.

## 갱신과 종료

`ClaudeOwnerRenewalController`는 인증된 private exchange와 종료 callback을 주입받는다. 실제 `start()`는 timer를 실행하고 연속 시각으로 5분 due를 확인한다. `tick()`은 같은 로직을 가짜 시계나 명시적 wake 관측으로 검사하는 진입점이다. 설치 launcher는 나중에 이 controller에 자신의 연결·자식 관측을 전달한다.

- 서버 lease는 현재 연속 시각부터 60분이다. 갱신 sequence는 증가하지만 authority epoch와 역할 자격은 유지한다.
- 서버는 직전 성공 sequence의 중복에 동일 receipt를 반환하며 추가로 기한을 늘리지 않는다. controller는 응답 유실 시 자동 재전송·재등록을 하지 않는다.
- owner만 갱신한다. Hook·MCP heartbeat·채널 nonce ACK는 세션 lease를 연장하지 않는다.
- 수면 복귀는 기존 lease의 실제 남은 시간을 기준으로 검사한다. 이미 만료된 연결은 새 owner 메시지로 되살리지 않는다.
- `end(reason:)`, owner EOF, 유효한 SessionEnd와 서비스 종료는 해당 scope를 회수한다. 다른 세션이나 native Claude 프로세스를 일괄 종료하지 않는다.
- stop/end 이후 늦은 성공 응답은 controller 상태를 되살리지 않는다. exchange는 caller가 제한 시간 안에 끝내야 하고, 종료 callback은 소유한 socket을 shutdown해 진행 중 I/O를 해제해야 한다.

private endpoint는 제어 callback 반환 뒤에도 peer·연결 생존을 확인한다. callback 실행 중 도착한 EOF의 처리는 callback 반환까지 지연될 수 있다. registry control에는 짧은 권한 갱신·회수와 응답 생성만 두며 metadata/core I/O를 넣지 않는다.

5분 readiness·5초 heartbeat·공통 카드 TTL은 owner lease와 독립이다. 제품 readiness는 연속 시각으로 판정하며, owner가 24시간 살아 있어도 nonce 수신 확인이 자동으로 갱신되지는 않는다. heartbeat가 끊기면 미claim 카드·Stop 관측을 폐기하고 새 Hook·제안을 요구한다. heartbeat가 유지된 채 readiness만 만료된 경우에는 카드의 남은 TTL 동안 새 probe ACK로 확인을 갱신할 수 있다.

## 저장과 회수의 경합

scope 실행 잠금으로 native 요청과 활성 이력 조회를 직렬화한다. 전역 registry 잠금은 저장소 작업 동안 잡지 않는다. owner 종료는 scope 실행기나 metadata 잠금을 기다리지 않고 권한을 먼저 회수한다.

순서는 native/inner 입구 권한 확인 → metadata prepare → core 준비 → **SQLite 첫 COMMIT 직전 authority fence** → core freshness 정리 → metadata finalize다. journal wrapper는 진입을 검사하고, 실제 durable fence는 같은 authority를 주입한 `SQLiteJournal.appendCommitGate`에서 한 번 수행한다. native 전체에 authority 잠금을 잡아 내부에서 재진입하지 않는다.

`appendCommitGate`는 기본값이 `nil`인 선택적 생성자 인자다. 기존 Codex와 v1 journal은 기존 경로를 따른다. gate에 도달하기 전의 SQL 변경은 아직 transaction 내부이며, 그동안 만료·회수가 발생하면 COMMIT을 막고 rollback한다. 이미 외부 freshness가 pending이라면 metadata와 함께 해당 scope를 격리한다. core mutation을 다시 실행해 복구하지 않는다. COMMIT 이후 freshness finalize는 이미 확정된 기록을 마무리하는 단계다.

adapter가 오류를 JSON으로 반환할 때 metadata 경계는 실제 core checkpoint를 비교한다. 아무 core 변경도 없는 잘못된 제안은 일반 오류로 돌려주며 세션을 회수하지 않는다. 부분 commit·불명확한 checkpoint·저장 실패는 scope를 격리한다. core 변경이 확정된 뒤 권한이 회수되면 실행할 action이나 성공으로 오인할 결과를 반환하지 않는다.

## 검증

Claude 폴더에서 실행한다.

```sh
npm run test:product-lifetime
```

신규/기존 등록·owner Swift suite와 기존 ingress/native Node 회귀를 실행한 뒤 공통 adapter/native/계약 suite를 실행한다. private peer 주입과 in-memory freshness는 격리 fixture에만 사용한다. 가짜 시계의 24시간 통과는 실제 24시간 모델 사용이나 Mac 수면 시험과 구분한다.

최종 실행 결과와 파일 목록은 [작업 상태](TASK_STATUS.md)에 기록한다. [CP-04](SESSION_LIFECYCLE.md)에 compact·durable replay tombstone·누적 한도·제품 scheduler를 추가한다. CP-05의 설치 launcher, 실제 서명된 owner와 모델·설치 앱의 왕복은 별도 검증 대상이다.
