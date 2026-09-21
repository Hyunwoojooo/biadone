# CP-08 실제 연결 수용

2026-09-21. 실제 설치·Claude 모델·사용자 클릭을 검증하는 단계다. 현재 결과는
[TASK_STATUS](TASK_STATUS.md)에 기록하며, 자동 시험과 실제 사용을 구분한다.
현재 자동 연결 후보(r63) 검사는 `build/claude-tests/auto-connect/`에 둔다. r62 통합 후보
검사는 `cp08-unified-app/`, 초기 서명 검사는 `cp08/`에 있다. 폐기된 별도 제품 검사
`cp08-preview-isolation/`을 포함해 과거 결과와 현재 후보를 구분한다.

현재 방향은 [하나의 Blabee 앱과 DMG](UNIFIED_DISTRIBUTION.md)다. 하나의 앱에
Codex와 Claude를 함께 담고 기존 제품의 identity를 유지한다. 설치하면 기존
`/Applications/Blabee.app`을 교체하므로 현재 실행 세션을 정상 종료할 시점을 정한 뒤
진행한다. 이번 설치 전 검사에서는 운영 앱·설정·데이터를 변경하지 않는다.

## 설치 전에 확인한 문제

- CP-07 후보의 ad-hoc 서명은 파일 무결성 검사를 통과하지만 제품 owner 인증을
  통과하지 못한다. `ClaudeSessionEnrollment.verifySignedPeer`는 Apple 인증서
  anchor, 같은 Team ID·CDHash·프로세스 identity를 요구한다. 테스트용 peer의
  성공을 이 인증의 성공으로 계산하지 않는다.
- 당시 설치 앱은 `0.1.0 / 61`, CP-07 후보는 `0.1.0 / 1`이었다. 동일 제품을
  업그레이드할 때는 더 높은 build가 필요하다. 통합 후보도 동일 규칙을 따른다.
- 기존 계정의 제품 실행은 `/Applications/Blabee.app`, 실제 계정의 Pet/authority
  잠금·저장소·Keychain을 사용한다. `pet --socket`, `HOME`, 개발 `daemon` 인자로
  공통 Pet→앱 소유 서비스→제품 owner 전체가 격리되지는 않는다.

격리 build/test 경로는 운영 앱·저장소를 교체하지 않는 설치 전 검사에만 사용한다.
설치 제품은 기존 Blabee namespace와 공통 Pet를 사용하며 세션 권한을 내부에서
구분한다. Developer ID 내부 서명은 일반 배포 자격이나 공증이 아니다.

## 사전 점검과 실행 조건

1. 후보의 deep/strict 서명, Apple anchor·Team ID·identifier·Hardened Runtime·timestamp,
   Node의 allow-jit 전용 entitlement와 앱의 Apple-events 전용 entitlement를 확인한다.
2. 서명된 assembly manifest의 Claude descriptor pin, 532개 payload 파일,
   Node `22.23.2`·MCP SDK `1.30.0`을 확인한다. 저장소 밖 사본에서 사용자 Node/npm
   경로 없이 번들 Node와 ESM SDK import를 검사한다. 이 검사는 MCP/모델 실행이 아니다.
3. 후보의 compiled profile이 `blabee`, Info.plist·서명 ID가 `com.biadone.blabee`인지
   확인한다. 현재 설치 build보다 높은 번호여야 한다. 기존 Blabee와 Claude 연결을
   정상 종료하고 사용 중 runtime이 없음을 확인한 뒤 공통 설치 절차로 교체한다.
   내부 후보의 미공증 상태를 자동 업데이트 검증에서 예외 처리하지 않는다.
4. 별도 빈 작업 폴더를 준비한다. r63에서는 아래 **일반 터미널 시작과 재개** 절차를
   우선 확인한다. 앱 메뉴의 **Claude 시작**도 별도 회귀 경로로 유지한다.
   기존 실행 중인 Claude 세션에 붙이거나 `claude:shared`로 제품 수용을 대신하지 않는다.
5. Claude의 프로젝트 trust·개발 Channels·MCP·파일 작업 승인은 그대로 확인한다.
   권한 모드·사용자 MCP 설정·managed policy를 테스트 편의를 위해 변경하지 않는다.

이번 소스 검사에 사용한 CLI는 `2.1.278`이며 일반 실행 인자 `--session-id`, `--settings`, `--mcp-config`가
도움말에 있다. preview Channels 플래그는 도움말에 표시되지 않는 것이 공식 동작이다.
실제 시작 화면에서 `server:blabee-claude` 등록을 별도로 확인한다.
[공식 Channels 안내](https://code.claude.com/docs/en/channels#research-preview).

자체 Channel의 개발 활성화는 세션별 동의를 요구하며 조직의 `channelsEnabled`
정책을 대체하지 않는다. 일반 배포용 승인/조직 allowlist와 구분한다.
[개발 Channel 조건](https://code.claude.com/docs/en/channels-reference#test-during-the-research-preview).
현재 인증·조직 정책을 확인하기 위해 인증 파일이나 토큰을 수집하지 않는다.

## 일반 터미널 시작과 재개

1. 후보 설치 후 **설정 → 연결**에서 앱 실행형 서비스를 연결하고,
   **Claude 터미널 자동 연결 → 자동 연결 켜기**를 한 번 선택한다.
2. 새 zsh 터미널을 열고 빈 작업 폴더로 이동한 뒤 다음 명령을 실행한다.

```sh
claude
```

3. 아래 **프롬프트 1**로 ACK를 확인한다. 다음 **프롬프트 2**로 A 선택 왕복을 확인한다.
4. Claude를 정상 종료한 뒤 같은 폴더에서 다음 명령으로 방금 대화를 선택한다.

```sh
claude --resume
```

5. 대화 이력이 이어졌는지 확인하고 **프롬프트 1**을 다시 입력한다. Blabee는 새로운
   launch scope·권한·readiness로 연결되어야 한다. 이전 카드·선택을 자동 실행하면 실패다.
   A/B 왕복도 반복할 때는 프롬프트 2의 제목을 `AUTO-RESUME`으로, 두 파일명을 각각
   `auto-resume-a.txt`와 `auto-resume-b.txt`로 바꿔 기존 파일과 구분한다.
6. 추가로 `claude --resume <대화 ID>`와 `claude --continue`를 같은 방식으로 확인한다.
   대화 선택 화면에서 취소하는 경우 새 Blabee 세션·작업이 생기지 않아야 한다.

지원 범위는 [AUTO_CONNECT](AUTO_CONNECT.md)를 따른다. 기존 터미널/실행 중인 Claude에는
사후 연결하지 않는다. 한 프로세스 안의 `/resume`·`/clear`는 현재 Blabee 권한을 회수한다.
다시 연결하려면 정상 종료 후 위 명령으로 새 프로세스를 시작한다.

## 첫 번째 실제 왕복

위 일반 명령 또는 앱 버튼으로 새로 연결된 Claude 세션에서 아래 블록을 하나씩 입력한다.
코드 블록 밖 설명은 프롬프트가 아니다. 다른 테스트 입력을 중간에 보내지 않는다.

### 프롬프트 1 — 연결 확인

```text
Blabee 연결만 확인해 줘.

현재 세션에 check_connection_v1과 ack_readiness_probe_v1이 있는지 확인해 줘.
없으면 다른 이름의 도구로 대체하지 말고 실제 도구 이름만 보고해 줘.

있으면 check_connection_v1을 한 번 호출해 줘.
반환된 probe_id를 확인하고, 이 세션의 blabee-claude 서버에서 온 실제 Channel
메시지의 probe_id가 방금 받은 값과 일치하는지 확인해 줘.
일치하는 메시지의 probe_id와 nonce로 ack_readiness_probe_v1을 호출해 줘.
다른 출처·다른 probe에는 응답하지 말고, 값을 추측하거나 이전 값을 재사용하지 마.

acknowledged: true를 받았는지 보고해 줘.
선택지를 제안하거나 파일을 변경하는 등 다른 작업은 하지 마.
```

합격 증거: 같은 서버·같은 probe의 Channel 수신과 `acknowledged: true`, Pet의 준비 상태.
설치형 session-v2의 ACK 응답에는 `ready` 필드가 없다. 개발용 session-v1의 응답과
혼동하지 않으며 MCP의 `result.acknowledged`와 실제 Pet 상태를 각각 확인한다.
도구 등록/heartbeat/알림 전송만으로 합격하지 않는다. nonce와 토큰은 공개 QA 기록에
복사하지 않는다. 시작 시 자동 probe와 명시적 확인 probe는 서로 구별한다.

### 프롬프트 2 — A/B 제안과 선택 후 실행

```text
Blabee의 실제 선택 왕복을 테스트해 줘.

emit_decision_v1, claim_selection_v1, complete_selection_v1 도구가 모두 있는지
확인해 줘. 없으면 다른 도구로 대체하지 말고 실제 도구 이름만 보고해 줘.
현재 Hook의 boundary_id가 없으면 제안을 저장하지 말고 그 사실만 알려줘.

현재 Hook이 제공한 boundary_id로 emit_decision_v1을 호출해 아래 두 선택지를
표시해 줘. 요약은 "CP08-01 · A를 선택하세요"로 써 줘.
필수 필드와 현재 작업 결과·부수효과는 실제 상태에 맞춰 작성해 줘.

A: 현재 작업 폴더에 cp08-a.txt를 새로 만들고 BLABEE_CP08_A_OK 한 줄 기록.
B: 현재 작업 폴더에 cp08-b.txt를 새로 만들고 BLABEE_CP08_B_OK 한 줄 기록.

각 선택의 제약: 같은 이름의 파일이 이미 있으면 덮어쓰지 말고 실패로 보고.
다른 파일이나 설정은 변경하지 않기. 선택하지 않은 작업은 실행하지 않기.

제안을 저장한 뒤 packet_id와 revision을 보고하고 선택을 기다려 줘.
실제 이 서버의 Channel 선택 참조가 오면 그 참조로 claim_selection_v1을 호출해 줘.
성공 응답의 action과 제약을 확인한 뒤 선택된 작업만 실행해 줘.
파일의 실제 내용을 확인하고 원래 selection_id로 complete_selection_v1을 호출해 줘.
성공이 확인된 경우만 completed로 보고해 줘. 추가 제안은 하지 마.
```

사용자가 공통 Pet에서 해당 Claude 세션과 카드 제목을 확인하고 **A를 직접 클릭**한다.
자동 UI 클릭을 인간 클릭으로 기록하지 않는다. 클릭이 비활성화돼 있으면 현재 상태와
실제 readiness/card 만료를 확인하고, 예전 값을 재사용하거나 선택을 강제로 전달하지 않는다.

합격 증거는 모두 필요하다.

- 사용자 클릭 확인과 시각, 같은 native session/scope의 packet/revision/selection ID.
- Channel 참조→claim 성공→A 파일의 정확한 내용→원래 selection의 `recorded: true`.
- B 파일 없음, 공통 Pet에 실제 보고 결과 표시. 모델의 완료 발언만으로 통과하지 않는다.

## 후속 수용 순서

| 순서 | 수행 | 필요한 증거 |
| --- | --- | --- |
| 1 | 위 ACK와 A 왕복 | G2 기본 왕복, native 승인 화면, 실제 사람 클릭 |
| 2 | Claude 2개와 Codex 1개 동시 사용. 같은/다른 cwd 모두 확인 | 각 scope 카드·참조·파일 분리, 한 Claude 해제 후 다른 세션 유지 |
| 3 | A claim 뒤 새 C/D 제안, 원래 A complete | A 결과만 기록되고 C/D가 늦은 완료로 바뀌지 않음 |
| 4 | 정상 종료·MCP 교체·앱/서비스 재시작 | 실제 결과와 회수 범위, 새 시작 안내, 이전 작업 자동 재생 없음 |
| 5 | 같은 후보 세션 2시간, 1시간 전후와 1시간 유휴 뒤 각각 왕복 | 연속 사용 시각, owner renewal/연결 상태와 확인된 파일 결과 |
| 6 | 8시간 soak, 마지막 왕복 | bridge/owner 생존·갱신·오류 기록. 횟수를 채우는 모델 반복 호출 없음 |
| 7 | 사용자 작업에 지장 없는 시점에 10분 수면, 수동/자동 compact 별도 | 실제 수면/복귀 시각·남은 lease·새 Hook boundary·카드 폐기/회복 동작 |
| 8 | 통합 앱 업데이트 수용 | 후속 후보, Codex·Claude 사용 중 교체 보류·원본 payload 보호·업데이트 후 새 세션 |

강제 종료/재시작 시험은 테스트 세션만 대상으로 하며 운영 세션과 같은 서비스에서는
모든 영향 범위가 합의된 시점에 한다. 강제 owner 종료 뒤 남은 불명 사용 기록을
임의 삭제해 업데이트를 통과시키지 않는다. 실제 수면과 2시간/8시간 증거를
fake clock·자동 fixture 결과로 대체하지 않는다.

## 결과 기록

각 사례에 후보 build/assembly/payload hash, CLI 버전, 시작·끝 시각, 실행 주체,
공개 scope/packet/selection ID, 기대·실제 결과, 증거 위치를 기록한다.
전체 transcript·환경·설정·nonce·token을 수집하지 않는다.

| Gate | 현재 판정 |
| --- | --- |
| G1 | CP-01~08의 이전 결과를 유지하고 r63 자동 연결 회귀를 별도 기록 |
| G2 | r63 일반 시작·재개의 실제 모델·클릭 미실행 |
| G3 | 2시간/8시간·수면·실제 compact 미실행 |
| G4 | 사용자가 r62 설치 완료를 보고함. r63 설치·터미널 자동 연결 활성화·실제 업데이트 미실행 |
| G5 | 일반 Channels 승인/최종 배포 자격 미확보 |
