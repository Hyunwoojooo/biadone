# 일반 MCP와 Hook을 사용하는 Claude 공개 연결

2026-09-27 사용자 선택: Codex·Claude 통합 앱을 일반 MCP·Hook으로 공개 배포한다.
VM 전체 시험 대신 아래 필수 동작을 확인한다. 구현 계약과 실제 확인한 범위를 구분해 기록한다.
실행 중인 앱·세션·인증정보는 유지하고 새 테스트 세션과 임시 저장소만 사용한다.

## 변경 경계

- 공통 Engine의 MAC, freshness, durable 단일 claim, 완료 기록은 유지한다.
- 제품 Claude 연결에서 개발 Channels 옵션·capability·notification을 제거한다.
- 일반 MCP 도구로 연결을 확인하고, 실제 `Stop` command Hook의 `asyncRewake`로 선택을 알린다.
- 변경된 wire 응답을 이전 클라이언트가 오해하지 않도록 `blabee.claude-session.v3`로 구분한다.
  내부 Swift 모듈명과 기존 `session-v2-*` 소스 파일명은 이번 작업에서 이동하지 않는다.
- Hook 출력은 선택 알림이다. 실행 권한은 같은 native 세션의 MCP claim 검증 후에만 반환한다.
- source·모의 시험·native 시험·서명·공증·배포 완료를 각각 보고한다.

## 연결 확인과 선택 전달

1. 기존 role capability와 여섯 UUID authority, canonical cwd로 Hook·MCP를 각각 인증한다.
2. `readiness.begin`의 **bridge 응답에만** probe ID·nonce·기존 만료를 반환하고
   그 bridge에 배송한 상태를 기록한다. 모델의 명시적 `readiness.ack`를 계속 요구한다.
   Pet/selector 응답에 nonce를 노출하지 않는다. 자동 probe는 다음 MCP 검사로 이어지며
   Channel 알림이나 모델의 주기적 호출을 만들지 않는다.
   Pet에서 다시 검사할 때 아직 유효한 이전 readiness는 원래 만료까지만 유지한다.
3. `bridge.poll`은 기존 연결 heartbeat를 유지하고 `event:null`만 반환한다.
   제품 MCP에 `experimental.claude/channel`이나 Channel notification이 없어야 한다.
4. 최신 prompt와 일치하는 실제 idle `Stop`에서 카드가 있을 때 서버가 waiter를 발급한다.
   Hook 결과에 `waiter:null|{generation,prompt_id,boundary_id,expires_at_nanoseconds}`를 넣는다.
5. Hook 프로세스는 다음 `hook.poll`을 500ms 간격, 한 번에 한 요청으로 호출한다.
   서버 lock/actor 안에서는 대기하지 않는다. 카드·세션 만료를 넘겨 기다리지 않는다.
   Stop 응답만으로 선택 권한을 열지 않는다. 5초 안에 첫 poll이 도착해야 waiter를 활성화하고,
   배송 전에는 마지막 Hook poll의 5초 생존 기한도 확인한다. MCP heartbeat만으로 연장하지 않는다.
6. 선택이 있으면 서버가 배송을 먼저 소비하고, 기존 selection ID·delivery token·sequence·만료를
   한 번 반환한다. Hook이 exit 2와 제한된 알림을 출력하면 native Claude가 같은 세션을 깨운다.
7. Claude 2.1.282는 재개 알림에도 새 prompt ID의 실제 `UserPromptSubmit`을 보낸다.
   서버는 배송한 알림과 검증한 native wrapper 전체의 SHA-256이 정확히 일치할 때만 이를
   한 번 선택 continuation으로 인정한다. 원래 Stop binding을 유지하면서 새 실제 prompt ID를
   별도로 묶는다. 접두사·부분 문자열만으로 판단하거나 Hook 입력을 합성하지 않는다.
8. MCP claim은 그 token 외에도 검증된 continuation의 새 prompt ID, live bridge,
   같은 waiter generation·원 Stop prompt·현재 boundary·만료를 확인한다.
   실제 continuation 입력 관측 전 claim은 거절한다. 기존 core의 선소비·durable 단일 claim 후에만
   작업을 반환한다. 배송 후에는 종료된 Hook의 heartbeat 대신 원래 만료와 나머지 권한을 확인한다.

Hook 전용 요청:

```text
hook.poll / hook.cancel
{ native_session_id, cwd, prompt_id, waiter_generation }

hook.poll -> { status: waiting|closed|delivered, event: null|selectionEvent }
hook.cancel -> { cancelled: Boolean }
```

generation과 authority UUID는 기존의 닫힌 UUID 형식, timestamp/sequence는 기존 UInt64 문자열
형식을 사용한다. `hook.cancel`은 정확히 일치하는 세대만 취소한다. 이전 세대의 늦은 요청이 새
waiter를 취소하지 못한다. 모델에는 waiter generation이나 장기 Hook capability를 전달하지 않는다.

## 취소와 실패

- 위 배송과 정확히 결합한 native continuation 이외의 새 실제 UserPromptSubmit,
  새 Stop 세대, compact, StopFailure, SessionEnd,
  bridge/authority 상실, 취소, 만료는 이전 waiter와 unclaimed 배송을 폐기한다.
- 이미 claim한 작업의 원래 완료 보고 권한은 해당 authority가 살아 있는 동안 보존한다.
  SessionEnd·authority 철회 이후까지 완료 권한을 유지한다는 뜻은 아니다.
- 선택 가능 여부는 MCP 연결과 살아 있는 waiter를 모두 요구한다.
- 전달 결과가 불명확하거나 stdout/stderr 출력이 실패하면 재출력·자동 실행하지 않는다.
- 일반 Hook 알림을 `<channel>`로 포장하거나 UserPromptSubmit으로 합성하지 않는다.
- native의 background/cron 관측이 불명확하면 idle로 간주하지 않는다. 전체 background 목록을
  무시하는 예외를 만들지 않는다. 자체 async Hook의 목록 등재는 실제 관측으로 확인한다.
- `stop_hook_active` 하나로 반복을 판정하지 않는다. 새 boundary에서 사용자가 새로 선택한
  작업만 다음 waiter/claim으로 이어질 수 있다.
- readiness·카드·continuation의 기존 만료를 늘려 시험을 통과시키지 않는다.

## 필수 검증

- 자동: 새 wire 계약의 Swift/Node/JSON Schema 일치, 잘못된 role/세션/세대 거절,
  중복·만료·새 입력·취소·연결 단절, poll의 저장소 쓰기 없음, 늦은 결과의 재출력 없음.
- native wrapper 전체가 달라지거나 아직 관측되지 않았으면 claim을 거절한다.
  같은 알림을 다른 새 prompt ID로 반복해도 기존 선택 권한을 다시 만들지 않는다.
- native: 고정 Claude 2.1.282의 새 interactive 세션에서 idle wake와 같은 세션
  claim/완료 1회; 다음 대기 중 새 사용자 입력으로 이전 선택 취소.
- native 인증은 별도 `CLAUDE_CONFIG_DIR`와 plugin cache를 사용한다. 기존 인증을 복사하지
  않고 사용자가 허용한 임시 로그인으로 진행한다. 도구·설정 출처와 실제 Hook 입력을 확인한다.
- 위 검사가 끝난 새 코드에서 Developer ID 앱·DMG를 생성하고 공증·stapling·최종 checksum을 확인한다.
  기존 개발 Channels 산출물을 공개용으로 다시 이름 붙이지 않는다.

근거: [공식 async Hook](https://code.claude.com/docs/en/hooks#run-hooks-in-the-background),
[공식 Stop asyncRewake 예제](https://github.com/anthropics/claude-code/blob/main/plugins/security-guidance/hooks/hooks.json),
[인증 프로필 분리](https://code.claude.com/docs/en/authentication#credential-management).
버전 검사의 하한 후보는 2.1.282다. 다른 버전의 동작까지 검증했다고 간주하지 않는다.

## 2026-09-27 native 알림 관측

사용자가 로그인한 별도 프로필에서 Claude 2.1.282의 interactive 세션 두 개를 순서대로 실행했다.
각각 5초 대기 후 Stop Hook의 exit 2가 같은 세션을 재개했고, 도구 실행 없이 지정한 ACK를
응답했다. 두 번째 검사에서는 실제 Hook 입력 전체의 digest로 native wrapper 일치를 확인했다.

- 최초 Stop: `stop_hook_active:false`, `background_tasks:[]`, `session_crons:[]`.
- 재개 시 실제 UserPromptSubmit: 같은 native session, 새로운 prompt ID.
- 다음 Stop: `stop_hook_active:true`, background/cron 목록은 여전히 비어 있었다.
- 화면에는 `Stop hook feedback`이 표시됐다. 이 알림 검사는 제품 카드 claim·완료의 증명이 아니다.
- 두 테스트 세션은 정상 종료했다. 기존 사용자 세션은 사용하지 않았다.

로컬 근거: `/private/tmp/blabee-public-hook-20260927-Kp83iicu/p1-wake-binding/events.jsonl`.
로그에는 원문 프롬프트나 인증정보 대신 digest와 관측 결과만 남긴다.

## 자동 검사 기록

| 검사 | 2026-09-27 결과 |
| --- | --- |
| P1 도구의 모델 없는 검사 | 40개 통과 |
| 제품 wire JSON Schema와 공용 fixture | 195개 통과 |
| 선택 continuation·권한·취소·만료·wire Swift 회귀 | 83개, 5개 suite 통과 |
| 앱 런처·Pet registry·runtime·실제 로컬 IPC | 70개, 6개 suite 통과 |

Swift는 기존 직렬 잠금을 사용했다. 테스트 저장소와 freshness는 임시/메모리 구현을 사용했다.
최소 검사 범위에 맞춰 500회 lifecycle, 1,000회 prompt, 100,000회 poll 스트레스 검사는 제외했다.
처음 넓게 실행한 검사는 1,000회 prompt 중 테스트 소유 프로세스만 종료했고, 위 최종 통과 기록에는
완주한 제한 범위 검사만 포함한다. 로컬 IPC 검사의 Claude 자식은 fixture이며 실제 모델 검증과 다르다.

근거 로그 디렉터리: `/private/tmp/blabee-public-hook-20260927-Kp83iicu/`.

## 실제 제품 연결 검사

Claude 2.1.282의 새 interactive 세션에서 다음 검사를 2026-09-27 통과했다.
Pet 화면을 직접 클릭한 검사가 아니라 동일한 제품 selector와 정확한 카드 binding을 이용한 검사다.
별도 로그인 프로필, 임시 registry/UDS, 메모리 freshness를 사용했다. 도구는 Blabee의 MCP 5개만
허용했고 파일·셸·브라우저 작업은 수행하지 않았다.

| 관측 | 결과 |
| --- | --- |
| 실제 MCP 연결 검사·명시적 ACK | 각각 2회 성공 |
| 실제 모델의 카드 발행 | 2회 성공 |
| 첫 카드의 Hook 배송·claim·완료 기록 | 각각 정확히 1회 |
| 같은 native 세션·정확한 선택·검증된 새 UPS ID | 모두 일치 |
| 실제 assistant 응답 | claim 이후 `BLABEE_NATIVE_SELECTION_DONE` 포함 |
| 두 번째 카드 대기 중 새 사용자 입력 | 이전 카드의 select 거절, claim·완료 수 증가 없음 |
| 정상 종료 | exit 0, 테스트 자식과 해당 process group 부재 확인 |

Swift 결과는 1개 native 검사 통과(41.467초)다. 모델 응답 시간과 저장소 성능은 별도로 측정하지
않았으며 이 총 시간을 엔진 성능으로 해석하지 않는다.

근거: `/private/tmp/bph-native-48ad7a34-e/evidence/result.json`, `driver.json`,
`pty-redacted.txt` 및 `native-product-test-5.log`.
앞선 시작 화면 검사들은 모델 입력 전에 실패/중단됐다. ANSI 화면 판독과 초기 입력 타이밍,
안전한 기록·종료 처리를 검사 도구에서 수정한 뒤 새 세션으로 검증했다.
현재 설치 앱의 UI 클릭이나 다른 Mac/Claude 버전의 검증은 이 결과에 포함하지 않는다.
