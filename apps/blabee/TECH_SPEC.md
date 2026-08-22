# Blabee Codex 우선 MVP 기술 명세

상태: M0 연동 계약 조건부 승인, T-006 v1 계약 확정
날짜: 2026-08-21
제품 원문: `blabase_decision_layer_product_plan_ko.md`

## 1. 제품 정의

Blabee는 Codex를 위한 macOS 상시형 제어 레이어다. 코딩 턴이 의미 있는 결정 지점에 도달했을 때만 눈에 띄게 나타나며, 사용자가 터미널로 돌아가지 않고도 현재 상황에 맞는 권장 작업, 대안 작업, 보류, 롤백을 선택할 수 있게 한다.

Blabee는 Codex의 모든 답변을 반고정 결정 카드로 바꾸는 포매터가 **아니다**.

MVP의 성공 루프는 다음과 같다.

```text
Codex 작업
  → 의미 있는 체크포인트 도달 또는 작업 차단
  → Pet이 검증된 요약과 실행 가능한 동작 표시
  → 사용자가 Pet에서 선택
  → 정확히 같은 Codex 세션이 안전하게 계속 진행
```

내부 사용 목표는 터미널을 다시 열지 않고 저위험 루프를 연속 세 번 완료하는 것이다.

## 2. v0.1에서 확정한 결정

1. MVP에서 지원하는 에이전트는 Codex뿐이다.
2. MVP에서 지원하는 UI 플랫폼은 macOS뿐이다.
3. 범용 MVP 통합 방식은 Skill, 로컬 MCP, 수명 주기 Hook으로 구성된 Codex Plugin이다. 임시 최종 메시지 센티널은 M0의 격리된 1회성 실험에만 사용하고, 공개 경로는 로컬 MCP 보조 채널을 사용한다.
4. `AGENTS.md`는 선택적 호환성 안내이며, 주 설치 또는 전송 메커니즘이 아니다.
5. Codex app-server는 공개 v0.1 이후의 완전 제어 경로와 별도 조사 대상이며, Hook-first MVP의 숨은 의존성이나 출시 선행 조건이 아니다.
6. 결정 카드의 슬롯은 **반고정**이다. `1`은 현재 패킷의 권장 다음 작업, `2`는 현재 패킷의 대안 다음 작업으로 내용이 바뀌며, `3`은 보류, `4`는 롤백으로 의미가 고정된다. 안전하고 의미 있는 대안이 없으면 2번은 비활성화하고 다른 의미로 재사용하지 않는다.
7. Pet은 `"1"` 같은 숫자 문자열만 보내지 않는다. `packet_id`, `revision`, `option_id`와 선택한 작업의 목표·제약·완료 기준 전체를 확인한다. Codex `0.148.0`의 Hook-first 경로에서는 이 내용을 새 사용자 프롬프트로 주입하지 않고, 대기 중인 `Stop`을 해제해 같은 턴의 연속 진행 지시로 전달한다. 이 지시는 현재 작업 에피소드에 귀속된다.
8. 롤백은 `episode_root_prompt_id`에 해당하는 **직전 사람이 입력한 작업 프롬프트 직전**의 `episode_baseline_checkpoint_id`로 복원한다. 모델 프롬프트가 롤백 구현이 되어서는 안 된다.
9. 공개 v0.1의 롤백 범위는 깨끗한 작업 트리에서 시작한 사람의 프롬프트 에피소드 한 개뿐이다. Pet의 1·2 연속 선택은 새 롤백 기준선을 만들지 않는다.
10. 공개 v0.1에서 네이티브 권한 요청은 Pet 알림과 권한 요청 화면으로 돌아가기 위한 best-effort 앱 복귀만 지원한다. Hook 요청에는 원래 PID/창 identity가 없으며 Pet이 허용/거부를 중계하지 않는다.
11. Blabee MVP는 별도의 LLM API 키나 추론 서비스를 추가하지 않는다.
12. 모든 영속 제품 데이터는 로컬 우선으로 저장한다.
13. 알파 기준 Codex `0.148.0`을 고정하고, 공개 배포에서는 지원 버전 허용 목록, `blabee doctor`, 주간·신규 버전·릴리스 전 호환성 점검을 함께 운영한다.
14. 여러 Hook 세션은 대기열에 둘 수 있지만 전역 단축키는 명시적으로 선택한 전면 카드 하나에만 적용한다. 새 카드가 전면 대상을 자동으로 바꾸지 않는다.

## 3. 상호작용 유형

모든 Codex 턴은 다음 세 가지 제품 상호작용 중 하나로 분류된다.

| 상호작용 | 예시 | Pet 동작 |
|---|---|---|
| `informational` | 이 아키텍처를 설명하거나, 모듈을 요약하거나, 질문에 답한다 | 반고정 결정 카드 없이 필요할 때만 조용한 완료 표시를 보여 준다 |
| `blabee_decision` | 의미 있는 지점에서 작업이 완료, 부분 완료, 실패 또는 차단되었다 | 동적인 권장·대안 작업과 고정된 보류·롤백 슬롯으로 구성된 반고정 카드를 보여 준다 |
| `native_request` | 권한 요청 또는 Codex가 제공한 질문과 선택지다 | Blabee 결정 카드로 재해석하지 않는다. 공개 Hook v0.1은 감지 가능한 요청의 알림과 best-effort 앱 복귀만 제공하며, 원래 PID/창 identity와 원문·선택지 전체 미러링은 관리형 app-server 단계로 둔다 |

분류가 불확실하면 `informational`을 안전한 기본값으로 사용한다. 일반 Codex 결과를 보여 주고 단일 키 동작은 실행하지 않는다.

## 4. MVP 아키텍처

```text
모든 터미널 또는 Codex 지원 환경
                    │
                    ▼
                기본 Codex CLI
                    │
        Blabee Codex Plugin 수명 주기
      ├─ SessionStart: 조건부 컨텍스트
      ├─ UserPromptSubmit: 사람이 입력한 프롬프트 에피소드 기준선
      ├─ Pre/PostToolUse: 근거 및 변경 신호
      ├─ PermissionRequest: 네이티브 요청 알림과 원래 UI 연결
      └─ Stop: 결정 대기, 같은 턴 연속 진행 및 수명 주기 종료 관찰
                    │
           로컬 MCP emit_decision 도구
                    │
                    ▼
             Blabee 로컬 코디네이터
      ├─ 세션 레지스트리 및 이벤트 저널
      ├─ 제안 및 패킷 검증기
      ├─ 근거 및 결정론적 위험 엔진
      ├─ 체크포인트 관리자
      ├─ 결정 실행기
      └─ SQLite 결정 원장
                    │
                    ▼
       macOS Pet (SwiftUI + AppKit NSPanel)
```

Blabee는 Codex Plugin/Hook 레이어에서 통합되므로 어떤 터미널 호스트를 사용하는지는 중요하지 않다. 앱은 OCR, AppleScript 터미널 자동화, 합성 터미널 키 입력을 핵심 경로로 사용해서는 안 된다.

### T-011 구현 경계

현재 `Plugin/blabee/`는 Codex Plugin v0.1.0의 Skill, `SessionStart`·`UserPromptSubmit`·`Stop`·`PermissionRequest` Hook과 로컬 MCP 설정을 소유한다. Skill은 완료·부분 완료·실패·차단처럼 다음 선택이 필요한 의미 있는 작업 경계에서만 `emit_decision`을 호출하며, 설명·구조·상태 확인·일반 질문과 Codex 네이티브 권한 요청은 평소 응답 경로에 남긴다. Pre/PostToolUse 근거 수집은 이 T-011 구현에 포함하지 않았다.

`blabee-coordinator daemon`은 `CoordinatorOperationalApplication` 하나를 UDS에 연결한다. 외부 allowlist는 프로젝트 활성화, 세션 시작, 사람 프롬프트, 결정 제안, Stop, 권한 알림, Pet 상태 조회, 명시적 전면 카드 선택과 full selection으로 한정한다. Pet은 먼저 14개 identity 필드의 `blabee_pet_focus_request`를 보내 현재 `waiting` 카드와 exact 일치하는 전면 대상을 설정한다. 이어지는 선택은 숫자가 아니라 v1 `blabee_selection_request`의 16개 필드를 모두 받아 현재 packet·revision·option과 9-field binding을 byte-exact로 검증하며, `select` 요청 자체는 전면 대상을 변경할 수 없다. 저수준 journal append, direct semantic selection과 token consume은 운영 UDS에서 호출할 수 없다.

UDS runtime directory는 `0700`, socket과 lease는 `0600`이고 양방향 peer effective UID가 현재 사용자와 같아야 한다. 한 줄 요청은 1 MiB 미만, 동시 연결은 64개로 제한한다. 활성 socket은 회수하지 않고 같은 UID의 stale socket만 교체하며 종료 때 소유한 inode만 제거한다. socket 경로와 독립된 저장소 singleton은 정규화한 절대 DB 경로의 domain-separated SHA-256 identity로 `~/Library/Application Support/Blabee/runtime/authority/`에서 획득한다. 같은 DB·다른 socket의 두 번째 coordinator도 storage 초기화 전에 거부한다. 서로 다른 경로가 hard link 또는 특수 볼륨 alias로 같은 inode를 가리키는 경우는 현재 path identity가 합치지 못하는 잔여 위험이다.

사람 프롬프트 correlation token은 지정된 `UserPromptSubmit` `additionalContext`에 한 번 제공하고 MCP proposal의 지정 필드로만 되돌려 받는다. exact binding 뒤에는 같은 값을 proposal free text에 복사한 입력을 journal write 전에 거부하며 MCP·Pet·UDS 공개 응답과 로그에 다시 노출하지 않는다. action continuation의 원문 token은 `route_consume_pet_action` 성공 뒤 폐기하고 Stop block reason에는 non-secret continuation ID·binding·봉인 action만 포함한다. Stop 원문 메시지는 저장하지 않고 process-local HMAC observation digest와 request generation으로 delivery, replay와 후속 completion을 구분한다.

운영 application은 open/seal, 선택, transport completion/close와 scheduler terminal append의 pre-commit 실패 및 commit 뒤 응답 유실을 authoritative journal replay로 재조정한다. open→seal은 journal에서 인접하게 기록하고 최초 seal 시도의 연속 단조 anchor를 재시도에도 유지한다. 선택 commit 여부를 즉시 확인할 수 없으면 250 ms backoff로 authority를 다시 읽되 원문 continuation token을 복원하거나 재발급하지 않는다. durable selection이 확인되면 action은 `continuation_dispatch_failed_closed`, pause는 `paused`로 waiter를 해제하며, 미커밋이면 기존 pending 선택을 그대로 재시도할 수 있다. expiry·timeout·close와 staged promotion은 정확한 terminal binding을 사용해 한 번만 적용한다.

## 5. Plugin 계약

### SessionStart

Hook은 현재 `cwd`에서 Blabee가 활성화되어 있는지 로컬 코디네이터에 묻는다. 활성화되어 있다면 다음과 같은 간결한 개발자 컨텍스트를 반환한다.

- 설명, 조사, 상태에 관한 질문에는 평소처럼 답한다.
- 의미 있는 작업 경계에 도달했거나 프로젝트 방향 결정이 필요할 때만 로컬 `emit_decision` 도구를 호출한다.
- Codex 네이티브 권한 요청이나 질문을 Blabee의 반고정 결정 슬롯으로 변환하지 않는다.
- 근거 없이 테스트, 체크포인트 범위, 위험, 가역성을 주장하지 않는다.

앱을 사용할 수 없거나 프로젝트가 비활성화되어 있으면 Hook은 컨텍스트를 반환하지 않으며 Codex는 평소처럼 동작한다.

### UserPromptSubmit

모델이 사람이 제출한 새 프롬프트를 받기 전에 Blabee는 프롬프트 경계를 기록한다.

- 모든 프롬프트: `session_id`, `source_turn_id`, `source_prompt_id`, `prompt_origin`, `cwd`, 프롬프트 해시
- 사람이 직접 입력한 새 작업 프롬프트: 새 `episode_id`, `episode_root_prompt_id`, Git 루트·브랜치·HEAD·인덱스/작업 트리 상태, `episode_baseline_checkpoint_id`
- 개발자 컨텍스트로 주입되는 수명이 짧은 상관관계 토큰

Codex `0.148.0`에서 Pet의 1·2 선택은 새 `UserPromptSubmit`을 만들지 않는다. `Stop`의 `decision: "block"` 응답으로 같은 턴이 계속되고 후속 `Stop`이 `stop_hook_active: true`로 재진입한다. 따라서 사람이 직접 입력한 새 프롬프트에만 새 에피소드와 기준선을 만들며, Pet 연속 진행이나 Hook 내부 기계적 재시도는 기존 에피소드와 기준선을 유지한다. 변경을 만들지 않은 정보 제공 에피소드에서는 내용이 없는 체크포인트를 폐기한다.

`pet_action`은 `same_turn_stop` 전용이며 `UserPromptSubmit`으로 제출할 수 없다. 두 경로를 동시에 허용하면 같은 선택을 중복 실행할 수 있으므로 명시적으로 거부한다. `UserPromptSubmit`의 예약 `blabee_episode_continuation` 봉투는 `internal_format_repair` 전용이다. M0는 이 봉투의 검증 계약만 확인했으며 운영 전달 어댑터는 후속 구현 대상이다. 유효한 토큰과 전체 바인딩이 없거나 `pet_action`을 주장하는 예약 봉투는 사람의 새 프롬프트로 오인하지 않고 거부한다.

### 로컬 MCP 도구

`blabee.emit_decision`은 원래 Codex 턴이 진행되는 동안 구조화된 **Codex 결정 제안**을 코디네이터에 전달한다. 이는 보조 채널이며, 일반적인 최종 답변은 여전히 사람이 읽을 수 있는 문장으로 남는다.

결정 제안은 로컬 근거, 위험 또는 롤백 가능성에 대한 권위 있는 기록이 아니다.

### PermissionRequest

공개 v0.1의 Hook은 네이티브 승인 요청을 별도 알림으로 보여 주고 권한 요청 화면으로 돌아가기 위한 best-effort 앱 복귀만 제공한다. Hook 요청에는 원래 PID/창 identity가 없으므로 정확한 창 복귀를 약속하지 않는다. 허용/거부 응답의 소유권은 원래 Codex UI에 남긴다. Hook 자체의 승인 중계 가능성은 격리된 계약 실험에서 측정할 수 있지만 공개 기능으로 노출하지 않는다.

### Stop

- Hook이 로컬 코디네이터에 2초 안에 연결되지 않으면 Blabee 자동 동작을 비활성화하고 성공 상태로 종료해 일반 Codex 사용을 막지 않는다.
- 현재 턴에 유효한 결정 제안이 없으면 성공 상태로 종료하고 턴이 정상적으로 끝나게 한다.
- 결정 제안이 있으면 코디네이터에 Pet 활성화를 요청하고 기다린다. 60초가 지나면 한 번 알리고, 120초가 지나면 패킷을 만료시킨다.
- `권장 작업` 또는 `대안 작업`: 선택 요청의 프로젝트·세션·턴·에피소드·상호작용·패킷·리비전·옵션 바인딩 전체를 검증하고 활성 패킷을 원자적으로 선점한다. 코디네이터는 봉인된 작업 의미 전체와 일회성 연속 진행 토큰을 물질화한다. T-011 제품 adapter는 원문 토큰을 process-local secret corpus에 등록한 뒤 `route_consume_pet_action`으로 즉시 한 번 소비하고, 그 성공 뒤에만 대기 중인 `Stop`에 `decision: "block"`과 봉인된 작업·비민감 binding을 반환한다. 원문 토큰은 Hook·MCP·Pet·UDS 출력에 넣지 않는다.
- Blabee는 Pet 선택을 사람이 제출한 `UserPromptSubmit`으로 보내지 않는다. Codex 공식 문서상 Stop Hook의 `reason`은 모델에게 새 사용자 프롬프트처럼 작동하는 continuation prompt다. 지원 판정한 CLI에서는 같은 turn lineage가 유지되는지 exact-version 계약으로 검증한다. 작업 후 발생하는 `stop_hook_active: true` 후속 `Stop`은 이미 소비된 정확한 세션·턴의 연속 진행에 대해 **전송 수명 주기 종료**만 한 번 기록한다. 이는 선택한 작업의 성공 판정이 아니며 성공·실패는 별도 outcome/evidence로 판단한다. 잘못된 세션·턴·플래그, 전달 관찰과 같은 Stop 재전달, 이미 본 중복 Stop은 상태를 다시 바꾸지 않는다.
- 120초 만료는 Pet 선택 전의 대기 패킷에 적용한다. T-006/B1은 dispatch 이후 `pet_action`의 `in_flight_deadline_at`과 timeout 결과 계약을 고정했고, B2는 coordinator-owned 120초 Pet·형식 보정 token과 300초 in-flight window를 연속 단조 시계로 실행한다. token consume/claim과 transport completion 시각은 외부 입력 대신 logical monotonic time으로 덮어쓴다. deadline을 넘기면 결과를 `unknown`으로 남기고 취소·실패를 추론하거나 자동 재시도하지 않는다. 절전 경과는 포함하고 wall clock 변경은 권한 판정에 사용하지 않으며, 재시작으로 monotonic anchor를 증명할 수 없으면 fail-closed한다.
- `보류`: 재개 캡슐을 저장하고 턴 종료를 허용한다.
- `롤백`: 검증된 로컬 복원을 수행하고 현재 에피소드를 종료한다. 새 작업을 자동 시작하지 않으며, 다음 재개 시 복원 결과를 같은 세션 컨텍스트에 동기화한다.
- 120초 만료 시 자동으로 선택하지 않고 재개 캡슐을 저장한 뒤 턴 종료를 허용한다. 만료 후 도착한 단축키는 거부한다.
- 데몬 실패가 발생하면 일반 Codex 사용은 계속 허용하되, 자동 동작 실행은 차단한다.

60초·120초 판정에는 시스템 절전 시간을 포함하는 연속 단조 시계를 사용하고, 벽시계의 `expires_at`은 표시와 감사 기록에만 사용한다. 시스템 시계가 바뀌어도 대기 시간이 늘어나면 안 된다. 프로세스 재시작 후 경과 시간을 안전하게 증명할 수 없으면 해당 패킷을 만료 처리한다.

`decision: "block"` 뒤 같은 턴 재진입은 Codex `0.148.0`에서 실제 CLI 계약 픽스처로 확인한 동작이다. Hook과 MCP 자체는 안정화된 Codex 기능을 사용하지만 이 세부 전이는 버전 호환성 계약 테스트 대상으로 취급하며, 지원 버전마다 다시 검증한다. 참고: [Codex Hooks](https://learn.chatgpt.com/docs/hooks), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## 6. 결정 계약

모델과 로컬 엔진은 서로 다른 기록을 소유한다.

이 절의 규범적 원본은 [`Contracts/v1/manifest.json`](Contracts/v1/manifest.json)과 그 매니페스트가 열거하는 JSON Schema 10개다. 실행 가능한 예시는 [`Fixtures/v1/manifest.json`](Fixtures/v1/manifest.json)에 있으며, 아래 JSON은 같은 필드 구조를 설명하기 위한 대표 예시다. 문서와 스키마가 다르면 `Contracts/v1`을 따른다.

### Codex 결정 제안

Codex가 생성한다.

```json
{
  "schema_version": "1.0",
  "interaction_kind": "blabee_decision",
  "proposal_id": "proposal_oauth_001",
  "correlation_token": "turn_token_oauth_0001",
  "project_id": "project_oauth",
  "session_id": "codex_session_oauth",
  "source_turn_id": "codex_turn_oauth_01",
  "source_prompt_id": "prompt_oauth_01",
  "episode_id": "episode_oauth_01",
  "episode_root_prompt_id": "prompt_oauth_01",
  "episode_baseline_checkpoint_id": "cp_before_oauth_prompt",
  "decision_boundary_id": "boundary_oauth_01",
  "boundary_sequence": 1,
  "task_goal": "OAuth 콜백 구현",
  "outcome": {
    "status": "completed",
    "summary": "OAuth 콜백 구현 완료"
  },
  "recommended_next": {
    "title": "리프레시 토큰 로테이션 구현",
    "objective": "기존 콜백 위에 토큰 로테이션을 구현",
    "constraints": ["DB 스키마 유지"],
    "done_when": ["관련 테스트 통과"]
  },
  "alternative_next": {
    "title": "전체 세션 호환성 검사",
    "objective": "구현을 확장하기 전에 저장 구조 호환성을 검증",
    "constraints": ["제품 코드 변경 금지"],
    "done_when": ["지원 범위와 실패 사례 문서화"]
  },
  "pause_capsule": {
    "resume_first": "기존 사용자 세션 호환성 검사"
  },
  "reported_side_effects": []
}
```

### 결정 패킷

로컬 코디네이터가 조립하고 봉인한다.

```json
{
  "schema_version": "1.0",
  "kind": "blabee_decision_packet",
  "interaction_id": "interaction_oauth_01",
  "packet_id": "packet_oauth_01",
  "revision": 1,
  "project_id": "project_oauth",
  "session_id": "codex_session_oauth",
  "source_turn_id": "codex_turn_oauth_01",
  "source_prompt_id": "prompt_oauth_01",
  "episode_id": "episode_oauth_01",
  "episode_root_prompt_id": "prompt_oauth_01",
  "episode_baseline_checkpoint_id": "cp_before_oauth_prompt",
  "decision_boundary_id": "boundary_oauth_01",
  "boundary_sequence": 1,
  "valid_after_event_sequence": 184,
  "sealed_at": "2026-08-20T12:00:00Z",
  "expires_at": "2026-08-20T12:02:00Z",
  "summary": "OAuth 콜백 구현 완료",
  "evidence": [
    {
      "evidence_id": "evidence_oauth_tests",
      "kind": "test",
      "status": "passed",
      "summary": "18/18 통과",
      "source": "local_verified"
    }
  ],
  "risk": {
    "level": "low",
    "reasons": []
  },
  "checkpoint": {
    "id": "cp_before_oauth_prompt",
    "coverage": "contract_only"
  },
  "choices": [
    {
      "slot": 1,
      "kind": "recommended_action",
      "enabled": true,
      "disabled_reason": null,
      "option_id": "opt_recommended",
      "action_id": "act_recommended",
      "action": {
        "title": "리프레시 토큰 로테이션 구현",
        "objective": "기존 콜백 위에 토큰 로테이션을 구현",
        "constraints": ["DB 스키마 유지"],
        "done_when": ["관련 테스트 통과"]
      }
    },
    {
      "slot": 2,
      "kind": "alternative_action",
      "enabled": true,
      "disabled_reason": null,
      "option_id": "opt_alternative",
      "action_id": "act_alternative",
      "action": {
        "title": "전체 세션 호환성 검사",
        "objective": "구현을 확장하기 전에 저장 구조 호환성을 검증",
        "constraints": ["제품 코드 변경 금지"],
        "done_when": ["지원 범위와 실패 사례 문서화"]
      }
    },
    {
      "slot": 3,
      "kind": "pause",
      "enabled": true,
      "disabled_reason": null,
      "option_id": "opt_pause",
      "action_id": "act_pause"
    },
    {
      "slot": 4,
      "kind": "rollback",
      "enabled": false,
      "disabled_reason": "rollback_not_enabled_in_build",
      "option_id": "opt_rollback",
      "action_id": null
    }
  ]
}
```

안전하고 의미 있는 대안이 없을 때 슬롯 2는 다음처럼 비활성화한다. 비활성 슬롯도 카드 리비전 안에서 추적할 `option_id`는 가지지만 실행할 `action_id`와 작업 본문은 갖지 않는다. `disabled_reason`은 Pet이 그대로 설명할 수 있는 안정적인 사유 코드다.

```json
{
  "slot": 2,
  "kind": "alternative_action",
  "enabled": false,
  "disabled_reason": "no_safe_meaningful_alternative",
  "option_id": "opt_alternative_disabled",
  "action_id": null
}
```

v0.1의 대표적인 `disabled_reason` 코드는 다음과 같다.

- 대안 슬롯: `no_safe_meaningful_alternative`, `insufficient_evidence`, `policy_blocked`
- 롤백 슬롯: `rollback_not_enabled_in_build`, `not_a_git_repository`, `baseline_dirty`, `checkpoint_partial`, `concurrent_edit`, `head_changed`, `excluded_path_changed`, `external_side_effect`, `size_limit_exceeded`, `retention_capacity_exhausted`

T-006/M1 계약 단계에서는 실제 사용자 저장소 복원을 시작하지 않으므로 슬롯 4를 `rollback_not_enabled_in_build`로 비활성화한다. 스키마가 미래의 활성 롤백 형태를 표현하는 것은 현재 빌드에서 실행을 허용한다는 뜻이 아니다.

### 연속 진행 봉투와 같은 턴 전달

연속 진행 봉투는 `continuation_origin`으로 구분되는 두 종류다. `pet_action`은 사용자가 선택한 1·2 작업을 운반하고, `internal_format_repair`는 잘못된 결정 제안을 같은 에피소드에서 한 번만 고치도록 요청한다.

Pet은 선택 시 선택·프로젝트·세션·턴·프롬프트·에피소드·결정 경계·패킷·리비전·옵션 식별자만 코디네이터에 제출한다. 코디네이터가 활성 패킷을 원자적으로 선점하고 봉인된 작업 내용을 다시 조회한 뒤 다음 `pet_action` 봉투를 만든다. Pet이 슬롯 번호, `action_id`, 작업 본문, 토큰을 직접 조립하지 않는다.

```json
{
  "schema_version": "1.0",
  "kind": "blabee_selection_request",
  "selection_id": "selection_oauth_01",
  "interaction_id": "interaction_oauth_01",
  "project_id": "project_oauth",
  "session_id": "codex_session_oauth",
  "source_turn_id": "codex_turn_oauth_01",
  "source_prompt_id": "prompt_oauth_01",
  "episode_id": "episode_oauth_01",
  "episode_root_prompt_id": "prompt_oauth_01",
  "episode_baseline_checkpoint_id": "cp_before_oauth_prompt",
  "decision_boundary_id": "boundary_oauth_01",
  "boundary_sequence": 1,
  "packet_id": "packet_oauth_01",
  "revision": 1,
  "option_id": "opt_recommended"
}
```

코디네이터는 이 식별자들이 현재 전면 카드와 모두 일치할 때만 선택을 선점한다. `action_id`와 작업 본문은 Pet 요청을 신뢰하지 않고 봉인된 패킷에서 다시 읽는다.

```json
{
  "schema_version": "1.0",
  "kind": "blabee_episode_continuation",
  "continuation_origin": "pet_action",
  "dispatch_mode": "same_turn_stop",
  "continuation_id": "continuation_oauth_01",
  "continuation_token": "opaque_one_time_token_oauth_01",
  "interaction_id": "interaction_oauth_01",
  "project_id": "project_oauth",
  "session_id": "codex_session_oauth",
  "source_turn_id": "codex_turn_oauth_01",
  "source_prompt_id": "prompt_oauth_01",
  "episode_id": "episode_oauth_01",
  "episode_root_prompt_id": "prompt_oauth_01",
  "episode_baseline_checkpoint_id": "cp_before_oauth_prompt",
  "decision_boundary_id": "boundary_oauth_01",
  "boundary_sequence": 1,
  "packet_id": "packet_oauth_01",
  "revision": 1,
  "option_id": "opt_recommended",
  "action_id": "act_recommended",
  "action": {
    "title": "리프레시 토큰 로테이션 구현",
    "objective": "기존 콜백 위에 토큰 로테이션을 구현",
    "constraints": ["DB 스키마 유지"],
    "done_when": ["관련 테스트 통과"]
  },
  "issued_at": "2026-08-20T12:00:30Z",
  "expires_at": "2026-08-20T12:02:00Z",
  "in_flight_deadline_at": "2026-08-20T12:05:00Z"
}
```

내부 형식 보정에는 패킷·옵션·작업이 없으므로 다음처럼 별도 필드를 사용한다.

```json
{
  "schema_version": "1.0",
  "kind": "blabee_episode_continuation",
  "continuation_origin": "internal_format_repair",
  "dispatch_mode": "submitted_envelope",
  "continuation_id": "repair_continuation_oauth_01",
  "continuation_token": "opaque_repair_token_oauth_01",
  "project_id": "project_oauth",
  "session_id": "codex_session_oauth",
  "source_turn_id": "codex_turn_oauth_01",
  "source_prompt_id": "prompt_oauth_01",
  "episode_id": "episode_oauth_01",
  "episode_root_prompt_id": "prompt_oauth_01",
  "episode_baseline_checkpoint_id": "cp_before_oauth_prompt",
  "decision_boundary_id": "boundary_oauth_01",
  "boundary_sequence": 1,
  "repair_request_id": "repair_request_oauth_01",
  "repair_kind": "decision_proposal_schema",
  "repair_attempt": 1,
  "max_repair_attempts": 1,
  "issued_at": "2026-08-20T12:00:30Z",
  "expires_at": "2026-08-20T12:02:00Z"
}
```

코디네이터는 토큰 원문 대신 검증용 fingerprint만 저장한다. 토큰은 CSPRNG로 최소 128-bit 엔트로피를 사용해 발급하고, durable journal에는 SHA-256 또는 HMAC-SHA-256 fingerprint만 기록하며 비교는 constant-time으로 수행한다. JSON Schema의 문자열 길이는 엔트로피를 증명하지 않으므로 T-007a 참조 코어가 생성·비교 의미를 구현했다. T-007b-A는 외부 32-byte 키와 영속 sidecar HMAC을, T-007b-A2는 OS Keychain freshness CAS를 구현했다. 키 회전과 일반 운영자 복구 정책은 후속 안전 게이트다.

Codex `0.148.0` 주 경로에서는 전체 선택 바인딩을 검증한 뒤 원문 토큰을 process-local로만 보유해 즉시 한 번 소비하고, 소비가 성공한 봉투의 작업 의미만 대기 중인 `Stop`의 차단 사유에 넣어 같은 턴으로 전달한다. 정확한 `stop_hook_active: true` 후속 `Stop`에서는 토큰을 다시 다루지 않고 전송 수명 주기의 종료만 기록한다. 이 전이는 `continuation_dispatched → continuation_consumed → Hook block 전달 → continuation_transport_completed` 순서를 가진다. `continuation_transport_completed`는 후속 Stop 관찰일 뿐 작업 성공이 아니다. 실제 성공·실패·취소·불명 결과는 별도 `work_outcome_recorded` 이벤트로 기록한다.

dispatch 뒤 `in_flight_deadline_at`까지 작업 결과를 확인하지 못하면 `continuation_transport_timed_out_unknown`을 기록한다. 이 상태는 `work_outcome_status = unknown`, `automatic_retry = false`, `cancellation_inferred = false`, `failure_inferred = false`이며 중복 실행 위험 때문에 자동으로 재시도하지 않는다.

제출 봉투 모드는 `internal_format_repair`에만 사용한다. 발급 시 `internal_format_repair_reserved`를 원자적으로 journal에 추가해 해당 결정 경계의 1회 보정 예산을 즉시 소비하고, 전체 바인딩과 token fingerprint 검증 뒤 `internal_format_repair_claimed`를 정확히 한 번 기록한다. 두 이벤트를 재생하면 프로세스 재시작 뒤에도 새 ID나 토큰으로 두 번째 보정을 발급할 수 없다. 별도 상태 테이블을 진실 원본으로 두지 않고 T-007 상태는 이 journal의 projection으로 만든다.

`UserPromptSubmit`은 프로젝트, 세션, 에피소드, 기준 체크포인트, `source_turn_id`, `source_prompt_id`, 결정 경계, 만료, `repair_request_id`, `repair_attempt`를 모두 확인한 뒤 기존 에피소드에 연결한다. 동일한 결정 경계에서 최대 한 번만 허용하며 두 번째 실패 뒤에는 일반 결과를 보여 주고 단일 키 실행을 비활성화한다. `pet_action` 제출 봉투, 토큰 누락·만료·재사용 또는 다른 프로젝트·세션·에피소드의 봉투는 사람의 새 프롬프트로 추정하지 않고 자동 진행을 거부한다.

`option_id`는 특정 `packet_id`와 `revision` 안에서 사용자가 누른 선택 인스턴스를 식별한다. `action_id`는 그 선택이 가리키는 의미 있는 작업을 식별하며, 비활성 슬롯에서는 `null`이다. `pet_action` 봉투의 `revision`은 원본 결정 패킷의 `revision`을 그대로 복사한 값이다.

불변 조건:

- 선택 요청과 continuation은 자신이 가리키는 봉인 패킷의 ID와 리비전을 바꿀 수 없다.
- 한 결정 경계의 첫 봉인은 `revision = 1`이다. 선택 전 수정은 같은 `interaction_id`·`packet_id`에서 리비전을 정확히 1씩 올릴 때만 허용하며, 선택·만료·종료 뒤에는 다시 봉인할 수 없다. 선택은 항상 최신 봉인 리비전만 claim한다.
- 선택 동작은 활성 패킷에 대한 권한 획득을 원자적으로 수행해야 한다.
- 더 새로운 턴, 이벤트 시퀀스 또는 패킷이 생기면 기존 패킷은 무효가 된다.
- 슬롯 1과 2의 표시 문구와 실행 내용은 현재 패킷에 종속된다. 슬롯 2에 안전하고 의미 있는 대안이 없으면 비활성화하며, 재설계 등 다른 의미로 바꾸지 않는다.
- `enabled`가 `false`이면 `disabled_reason`이 필수이고 `action_id`는 `null`이며 실행 본문은 없어야 한다. `enabled`가 `true`이면 `disabled_reason`은 `null`이어야 한다.
- 한 패킷 안의 네 `option_id`는 모두 유일해야 하며, `null`이 아닌 `action_id`도 서로 달라야 한다. 중복 ID로 선택 의미를 모호하게 만들 수 없다.
- 슬롯 3은 보류, 슬롯 4는 롤백 이외의 의미로 사용할 수 없다.
- Codex 네이티브 질문과 권한 요청은 별도 상호작용 ID를 사용하며 이 `choices` 배열로 변환하지 않는다.
- 로컬 근거는 모델이 보고한 근거와 별도로 표시한다.
- 로컬 위험 엔진은 위험도를 높일 수 있지만, 더 강한 정책 결과보다 낮출 수는 없다.
- 실제 `episode_baseline_checkpoint_id`가 완전한 범위로 검증된 경우에만 롤백을 활성화한다.
- 패킷의 `episode_baseline_checkpoint_id`, `checkpoint.id`, 롤백 슬롯의 `target_checkpoint_id`는 정확히 같아야 한다. 하나라도 없거나 다르면 롤백을 비활성화한다.
- 슬롯 1이나 2를 실행할 때는 숫자가 아니라 패킷·리비전·옵션 ID와 제목·목표·제약·완료 기준 전체를 같은 세션·턴에 전달한다.
- 슬롯 1이나 2에서 발급하는 `continuation_token`은 현재 프로젝트·세션·턴·패킷·에피소드·옵션에 묶인 일회성 값이며 `same_turn_stop`에서만 소비해야 한다. `UserPromptSubmit`으로의 전환, 재사용과 교차 바인딩을 거부한다.
- 한 번 선점한 선택에서는 continuation ID나 토큰을 바꾸더라도 두 번째 dispatch를 만들 수 없고, 하나의 continuation은 한 번만 소비할 수 있다.
- `issued_at < expires_at <= in_flight_deadline_at`을 만족해야 한다. RFC 3339의 1~9자리 소수초를 exact epoch-nanosecond로 비교하며, deadline 이전 timeout, 실재하지 않는 달력 날짜, 종료된 결정 경계의 후속 이벤트는 거부한다.
- 내부 형식 보정 봉투는 선택 봉투로 가장할 수 없다. `internal_format_repair_reserved`가 결정 경계당 한 번의 보정 예산을 소비하는 유일한 진실 원본이며 새 continuation ID·토큰·repair request ID를 쓰거나 재시작해도 `repair_attempt = 1` 한 번만 허용한다.

## 7. 반고정 슬롯의 의미

### 1 — 권장 다음 작업

현재 결정 패킷이 권장하는 다음 작업을 실행한다. Blabee는 `packet_id`, `revision`, `option_id`, 제목, 목표, 제약 조건, 완료 기준과 일회성 `continuation_token`을 포함한 연속 진행 지시를 대기 중인 `Stop`을 통해 같은 Codex 세션·턴에 전달한다. 숫자 `1`이나 모호한 `continue` 문자열만 전송하지 않는다. 이 지시는 현재 `episode_id`에 추가되며 새 롤백 기준 체크포인트를 만들지 않는다.

### 2 — 대안 다음 작업

현재 결정 패킷이 제안하는 안전하고 의미 있는 대안 작업을 실행한다. 같은 턴 전달 계약과 기존 에피소드 유지 규칙은 1번과 같다. 대안이 없으면 이 슬롯을 비활성화하고 `재설계`, `검토`, `질문` 같은 다른 동작으로 재사용하지 않는다.

재설계가 필요하면 현재 맥락에 맞는 구체적인 재설계 작업을 1번 또는 2번의 동적 작업으로 제안할 수 있다. 공개 v0.1에는 별도의 재설계 상호작용 종류를 추가하지 않는다.

### 3 — 보류

Blabee는 턴을 종료하고 완료된 작업, 해결되지 않은 불확실성, 보류 이유, 체크포인트, 세션, 재개 시 처음 수행하도록 권장할 동작을 저장한다. 보류에는 Codex로 보내는 모호한 프롬프트가 필요하지 않다.

### 4 — 롤백

Blabee는 결정 패킷의 `episode_root_prompt_id`가 Codex에 전달되기 직전에 만든 `episode_baseline_checkpoint_id`를 복원한다. 즉, 사람이 입력한 그 작업 프롬프트에서 비롯된 도구 호출, 하위 에이전트 작업, 재시도와 Pet의 1·2 연속 진행을 포함한 활성 프롬프트 에피소드 하나 전체가 대상이다. Codex에 “한 작업을 되돌려라”라는 뜻을 해석하도록 요청하지 않는다.

## 8. 상태 머신

```text
IDLE
  │ 사람이 입력한 UserPromptSubmit + 에피소드 기준선
  ▼
WORKING
  ├─ 네이티브 권한 요청 ──────────────> NATIVE_REQUEST_NOTICE
  │                                         └─ best-effort 앱 복귀 후 Codex UI에서 응답 ─> WORKING
  ├─ 일반 Stop, 제안 없음 ────────────> IDLE
  └─ Stop 시 유효한 제안 ─────────────> DECISION_READY
                                            ├─ 1 권장 작업 ─┐
                                            ├─ 2 대안 작업 ─┴> MATERIALIZING_CONTINUATION
                                            │                    └─ HELD_STOP_RESOLVED
                                            │                         └─ 같은 TURN·EPISODE ─> WORKING
                                            │                              └─ 후속 Stop 수명 주기 종료 관찰 ─> IDLE 또는 다음 DECISION_READY
                                            ├─ 3 보류 ───────────────────> PAUSED
                                            ├─ 4 롤백 ───> RESTORING ─────> IDLE
                                                                  └──────> RECOVERY_REQUIRED
                                            └─ 60초 ─────> REMINDER
                                                 └─ 120초 ─> EXPIRED ─────> PAUSED
```

MVP에서는 세션마다 대기 중인 활성 상호작용을 최대 하나만 허용하되 여러 Codex 세션의 대기 요청은 로컬 코디네이터가 함께 보관할 수 있다. Pet이 전역 단축키를 연결하는 **전면 카드(foreground interaction)**는 시스템 전체에서 하나뿐이다. 새 세션의 카드가 도착해도 이미 보이는 전면 카드를 자동으로 빼앗지 않으며, 추가 카드는 프로젝트·경로·세션 식별자를 표시한 대기열에 넣는다.

전면 카드가 없거나 대상이 모호하면 1·2·3·4 단축키를 모두 비활성화한다. 사용자가 Pet에서 카드를 명시적으로 전면으로 선택한 뒤에만 상호작용 ID, 프로젝트 ID, 세션 ID, 에피소드 ID, 패킷 리비전, 옵션 ID와 예상 상태가 모두 일치하는 입력을 받는다. 각 대기 패킷의 만료 시계는 독립적으로 흐르며, 만료된 패킷에 대한 늦은 단축키는 어떤 세션의 상태도 바꾸지 않는다. 이는 app-server의 다중 스레드 큐와 별개인 Hook MVP의 로컬 라우팅 계약이다.

## 9. 프롬프트 에피소드와 기존 프로젝트

Blabee는 프로젝트를 생성할 때 전체 작업 그래프를 요구하지 않는다. 대신 **순환 결정 범위**를 사용한다.

도메인 계층:

```text
프로젝트 (Project)
  → Codex 세션 (Codex Session)
    → 프롬프트 에피소드 (Prompt-bounded Episode)
      → Codex 턴과 런타임 이벤트 (Turn and Runtime Events)
        → 결정 제안 (Decision Proposal)
          → 결정 패킷 (Decision Packet)
            → 사용자 결정 (User Decision)
              → 결과 (Outcome)
```

프롬프트 에피소드는 사람이 새 작업 프롬프트를 Codex에 제출하기 직전에 시작한다. 다음 결정 카드에서 Pet의 1번 또는 2번을 선택하면 Codex `0.148.0`에서는 대기 중인 `Stop`이 해제되어 새 `UserPromptSubmit` 없이 같은 턴이 이어진다. 해당 연속 진행은 일회성 `continuation_token`으로 기존 에피소드에 귀속되며 기준선은 바뀌지 않는다. 도구 호출, 하위 에이전트, Stop Hook의 기계적 재시도와 형식 보정도 같은 에피소드에 속한다.

에피소드는 사용자가 새 텍스트 프롬프트를 직접 제출하거나, 롤백·명시적 완료를 선택할 때 닫힌다. 보류 또는 시간 초과 시에는 재개 캡슐과 함께 일시 정지한다. 나중에 명시적으로 재개할 때 저장소 상태와 기준선을 다시 검증해 같은 에피소드를 이어 가며, 상태가 달라졌다면 기존 롤백은 비활성화하고 새 에피소드로 시작한다.

```text
사람이 작업 프롬프트 A 입력 ──> 기준선 A 생성
  └─ Pet 1 선택 ──> 같은 턴·에피소드에서 권장 작업 진행
       └─ 다음 결정에서 Pet 2 선택 ──> 해당 턴·같은 에피소드에서 대안 작업 진행
            └─ Pet 4 선택 ──> 기준선 A로 전체 복원

사람이 새 작업 프롬프트 B 입력 ──> 에피소드 A 종료, 새 기준선 B 판단
```

`source_prompt_id`와 `source_turn_id`는 현재 결정을 직접 만든 최신 프롬프트와 턴을 가리키고, `episode_root_prompt_id`는 사람이 입력해 에피소드를 연 프롬프트를 가리킨다. 공개 v0.1의 롤백은 활성 패킷의 `episode_id`, `episode_root_prompt_id`, `episode_baseline_checkpoint_id`가 모두 일치하는 **활성 프롬프트 에피소드 한 개**만 복원한다. 대화 텍스트나 “직전 작업”이라는 자연어 추정으로 경계를 결정하지 않는다.

진행 중인 프로젝트에 도입하는 절차:

1. 변경을 가하지 않고 Git 루트, 브랜치, HEAD, 스테이징된 변경, 스테이징되지 않은 변경, 미추적 파일 상태를 읽는다.
2. 세션 시작 후 Hook을 설치했다면 새 실행을 통해 저장된 동일 Codex 세션을 재개한다.
3. 현재 상태를 도입 기준선으로 저장한다.
4. 선택적으로 Codex에 읽기 전용 프로젝트 캡슐을 요청한다. 현재 목표, 완료한 작업, 진행 중인 작업, 제약 조건, 불확실성, 다음 프롬프트 에피소드 하나를 포함한다.
5. 새로 관리하는 프롬프트 에피소드에 대해서만 Blabee 체크포인트를 시작한다.
6. 도입 전에 이루어진 작업을 롤백할 수 있다고 주장하지 않는다.

변경 사항이 있는 프로젝트에서도 권장 작업, 대안 작업, 보류는 사용할 수 있다. 공개 v0.1에서는 사용자 프롬프트 입력 전에 작업 트리나 인덱스에 기존 변경이 있으면 해당 에피소드의 롤백을 비활성화한다.

## 10. 체크포인트와 롤백 정책

체크포인트 기록에는 다음 항목이 포함된다.

- `source_prompt_id`, `source_turn_id`, `episode_id`, `episode_root_prompt_id`, `episode_baseline_checkpoint_id`
- 저장소/작업 트리 식별 정보, 브랜치, HEAD
- 인덱스 상태와 추적 중인 작업 트리의 변경분
- 에피소드에서 생성된 크기 제한 내의 미추적 파일
- Git이 추적하는 실행 비트와 심볼릭 링크. `0644 → 0600`처럼 Git이 추적하지 않는 POSIX 모드 변화는 지원 범위가 아니며 감지 시 롤백을 비활성화한다.
- 에피소드 시작 프롬프트 입력 직전 해시와 각 결정 경계에서 봉인한 사후 해시
- 무시된 파일, 루트 밖 파일, 대용량 파일, 하위 모듈, 외부 효과에 관한 제외 사항
- 범위: `complete`, `partial`, `unavailable`

공개 v0.1의 정책은 다음과 같다.

- 사람이 에피소드를 시작하는 프롬프트를 입력하기 직전 Git 작업 트리와 인덱스가 깨끗한 경우에만 롤백 후보를 만든다.
- Pet의 1·2 연속 진행에서는 기준선을 다시 만들거나 clean-worktree 게이트를 다시 적용하지 않는다. 복원 범위는 활성 패킷이 가리키는 사람의 프롬프트 에피소드 한 개다.
- 파일 하나는 최대 16 MiB, 체크포인트 하나는 최대 128 MiB, 프로젝트별 보관 총량은 최대 1 GiB로 제한한다. 한도를 넘으면 범위를 `partial` 또는 `unavailable`로 표시하고 롤백을 비활성화한다.
- 프로젝트 보관량이 1 GiB에 가까워지면 종료된 에피소드의 오래된 체크포인트부터 정리한다. 활성·보류 에피소드의 기준선, 대기 중인 패킷이 참조하는 기준선, 최신 롤백 직전 복구 스냅샷은 정리하지 않는다. 보호 대상을 유지한 채 한도 아래로 내릴 수 없으면 새 롤백 기준선을 만들지 않고 이유를 표시한다.
- 무시된 파일, 하위 모듈, Git LFS 객체, 저장소 루트 밖 경로, 네트워크·배포·데이터베이스 등 외부 부수 효과는 캡처하지 않는다. 에피소드가 이를 변경했거나 변경하지 않았음을 입증할 수 없으면 롤백을 비활성화한다.
- 기준선 이후 브랜치나 HEAD가 바뀌었거나 동시 편집이 감지되면 롤백을 비활성화한다.
- 실제 작업공간에서는 저장소 전체에 적용되는 배타 잠금을 획득하고, 잠금 직전과 복원 직전에 상태를 다시 읽어 TOCTOU를 차단해야 한다. M0의 `ownedPaths`만으로 같은 경로에 대한 사람의 동시 편집 부재를 증명할 수 있다고 간주하지 않는다.
- sparse checkout, `skip-worktree`, `assume-unchanged` 인덱스 상태는 `unsupported_index_state`, `core.filemode = false`는 `unsupported_git_configuration`, Git이 추적하지 않는 POSIX 메타데이터 변화는 `unsupported_file_metadata`로 fail-closed한다.
- ignored/submodule/LFS/outside-root/external-effect 다섯 hazard attestation 중 하나라도 누락되거나 `unknown`이면 `hazard_attestation_missing`으로 fail-closed한다.
- Git 저장소가 아닌 프로젝트에서도 권장 작업, 대안 작업, 보류는 사용할 수 있지만 공개 v0.1의 롤백은 항상 비활성화하고 `not_a_git_repository` 사유를 표시한다.

롤백 흐름:

1. 저장소 전체 배타 잠금을 획득하고 기준선 이후 상태를 다시 검증한다.
2. 현재 상태의 복구 스냅샷을 생성한다.
3. 현재 해시, 브랜치와 HEAD를 봉인된 에피소드 종료 후 상태와 비교한다.
4. 동시 편집이 있으면 덮어쓰지 않고 중단한다.
5. `episode_baseline_checkpoint_id`의 파일과 인덱스 상태를 복원한다.
6. 해시, 인덱스와 Git 실행 비트를 검증한다. 그 밖의 POSIX 모드 변화는 복원하지 않고 unsupported로 중단한다.
7. 보상 결과를 기록하고 복원 사실을 Codex 세션 컨텍스트에 동기화한다.

롤백 직전의 복구 스냅샷은 복원 실패 시 수동 복구를 위한 안전 장치이며, 사용자에게 숨겨진 다중 단계 롤백 기능이 아니다. 공개 롤백 전에는 복구 스냅샷을 실제로 재적용하는 테스트와 복원 중 실패 주입 테스트가 통과해야 한다. 범위가 부분적이거나, 동시 작성자가 감지되거나, 브랜치/HEAD가 달라졌거나, 제외 경로가 변경되었거나, 스냅샷 한도를 초과했거나, 되돌릴 수 없는 외부 효과가 발생한 경우에는 롤백을 사용할 수 없다.

Codex app-server의 폐기 예정인 `thread/rollback`을 파일 체크포인트로 취급해서는 안 된다.

## 11. app-server 완전 제어 모드

Hook MVP 이후 Blabee는 다음과 같은 관리형 모드를 추가할 수 있다.

```text
공식 Codex TUI
      ↕
Blabee JSON-RPC 브로커
      ↕
codex app-server
      ↕
Blabee Pet
```

이 모드는 `requestUserInput`, 명령/파일/권한 승인, 턴 이벤트, 정확한 스레드 라우팅을 보존하고 중계할 수 있다. 이 모드를 사용하려면 `blabee codex` 또는 다른 관리형 실행 경로가 필요할 가능성이 높다. 서로 독립적으로 실행되는 임의의 TUI 프로세스에 수동으로 연결할 수 있다는 보장은 문서화되어 있지 않다.

일반 `requestUserInput`과 권한 응답은 이 모드가 검증될 때까지 원래 Codex UI에 남겨 둔다. 공개 Hook MVP는 Pet 알림과 polling 시점의 frontmost 외부 앱으로 돌아가는 best-effort 동작만 지원한다. Pet에서 허용/거부를 반환하는 기능은 관리형 모드 또는 별도 릴리스 게이트를 통과한 후에만 검토한다.

## 12. macOS 앱과 패키징

제품은 서명과 공증을 마친 DMG로 배포하며, 다음 항목을 포함한다.

- `Blabee.app`
- 항상 최상단에 표시되는 네이티브 SwiftUI/AppKit Pet
- 로컬 코디네이터/헬퍼와 결정 원장
- Blabee Codex Plugin 마켓플레이스 페이로드
- 진단과 향후 관리형 모드를 위한 선택적 `blabee` CLI
- 설치 프로그램, 업데이트 프로그램, 제거 프로그램, `blabee doctor`

첫 실행 시 다음 동작에는 명시적 동의가 필요하다.

- Codex 바이너리/버전과 인증 준비 상태 감지
- Blabee Plugin 등록 및 설치
- 번들 Hook 검토 및 신뢰
- 로컬에서 프로젝트 활성화
- 선택적으로 CLI와 로그인 항목 설치

앱은 사용자의 `codex` 실행 파일을 덮어쓰거나 셸 시작 파일을 몰래 편집해서는 안 된다. Plugin과 선택적 AGENTS 변경 사항은 미리 볼 수 있어야 하며, 멱등성을 갖고 버전이 지정되며 제거할 수 있어야 한다.

## 13. 로컬 저장소

권장 위치: `~/Library/Application Support/Blabee/`.

SQLite에는 다음 항목을 저장한다.

- 프로젝트와 활성화된 경로
- 세션, 턴, 상관관계 기록
- 결정 제안, 패킷, 결정, 결과
- 근거 관찰 기록
- 체크포인트 메타데이터와 블롭 참조
- 재개 캡슐과 Plugin/지침 버전

`decision_packet_sealed` 이벤트에 없는 전체 패킷 본문과 `continuation_dispatched` 이벤트에 없는 token fingerprint는 각각 불변 packet document·verification sidecar로 같은 트랜잭션에 저장한다. T-007b-A는 SQLite 밖의 32-byte 키로 두 sidecar의 exact row identity와 packet/seal/selection/action/verification binding을 HMAC 인증한다. 런타임 이벤트는 이전 MAC·sequence·row identity를 결합한 MAC chain과 인증된 head anchor로 보호하고, 손상·교체·중간/마지막 행 삭제·orphan/missing artifact를 재시작 시 fail-closed한다.

T-007b-A는 low-level persistence kernel이고 T-007b-B1이 그 앞의 제품 의미 경계를 구현한다. B1은 T-007a의 12개 이벤트 replay/projection과 11개 command, latest revision·stale·expiry·rollback-disabled·reseal 판정을 Swift로 포팅했다. 실행 순서는 `load → replay → decide → candidate replay → atomic append`이며 CAS 충돌은 최대 2회만 재시도한다. 토큰은 retry 전에 한 번 생성하고 append 성공 전에는 effect를 반환하지 않는다. 제품 NDJSON은 `execute_command`만 허용하며 low-level `append`는 test-harness compile flag에서만 존재한다.

식별자는 의미 계층에서 저장 전에 NFC를 요구한다. 저장된 ID를 가리키는 선택·continuation·packet/checkpoint 참조는 Swift의 canonical-equivalence `String ==`가 아니라 UTF-8 byte-exact로 비교한다. 이 규칙은 고정된 Contracts/v1 JSON Schema를 바꾸지 않는다. JSON 숫자 wire gate는 모든 v1 숫자를 exact Int64 정수로 제한한다. 일반 정수 lexeme는 Int64 전체 범위를 허용하고, Foundation이 Double로 해석하는 decimal/exponent 표기는 정확성이 보장되는 ±2^53까지만 허용한다. SQLite text는 명시적 UTF-8 byte length로 bind/read해 embedded NUL을 보존한다.

키 파일은 `0600`, 상위 디렉터리는 `0700`이어야 하고 `openat` 기반 경로 검사로 symlink를 거부한다. 이 경계는 다른 UID에 대한 파일 권한 보호이며 같은 UID 프로세스의 키 읽기를 막지 않는다. T-007b-A2는 OS Keychain에 strict canonical `initializing`/`committed`/`pending` freshness record를 두고 SQLite metadata의 불변 `database_id`, generation, event sequence와 head MAC을 결합한다. Keychain item의 `kSecAttrGeneric`에는 canonical record digest를 저장해 compare-and-swap하며, append 전체 전이는 process mutex와 키 디렉터리의 `0600` `flock` 안에서 실행한다.

새 저장소는 DB·키·anchor가 모두 없을 때만 만든다. 먼저 Keychain `initializing` identity를 기록하고 그 identity로 키와 DB 생성을 재개한다. 기존 DB 또는 키가 있는데 anchor가 없으면 pre-A2 상태를 자동 migration/adoption하지 않고 `freshness_anchor_missing`으로 차단한다. anchor가 남은 상태에서 DB·키가 없거나 DB가 0-byte이면 lock 파일을 만들기 전의 무변경 preflight와 lock 뒤 recheck에서 `freshness_storage_missing`으로 차단한다.

append의 freshness 순서는 다음과 같다.

```text
DB와 Keychain committed checkpoint 비교
→ SQLite BEGIN IMMEDIATE 및 batch 적용
→ Keychain pending(from, to, canonical batch digest) CAS/read-back
→ SQLite COMMIT
→ 전체 authenticated replay
→ Keychain committed(to) CAS/read-back
→ 성공 응답
```

`pending + target DB`는 전체 replay가 성공한 뒤에만 committed로 승격한다. `pending + source DB`는 COMMIT 전 종료와 COMMIT 뒤 과거 DB 복원을 구분할 수 없으므로 자동 취소하지 않고 정확히 같은 canonical batch digest의 append 재시도만 허용한다. Keychain보다 오래되거나 같은 sequence에서 head가 다른 authentic DB는 첫 event를 반환하기 전에 `freshness_rollback_detected`로 차단한다. crash injection은 pending 뒤/SQLite commit 전, SQLite commit 뒤/freshness finalize 전, committed read-back 뒤를 각각 85/87/88/86 exit로 검증한다.

Keychain `errSecDecode`와 `errSecInvalidKeychain`은 anchor 손상, 잠금·interaction 불가 등은 unavailable로 fail-closed한다. 현재 unsigned CLI는 Data Protection Keychain 사용 시 `errSecMissingEntitlement(-34018)`가 발생해 legacy login Keychain을 사용하며 UI 차단에 deprecated `kSecUseAuthenticationUIFail` 경고가 남아 있다. signed wrapper, provisioning/access group, `LAContext`, code-signing ACL과 deprecated API 교체는 T-012 범위다. 같은 UID 공격자의 Keychain item 삭제·교체와 DB·키·anchor 동시 제거는 A2만으로 구분하지 못하며, exact batch가 없는 `pending + source DB`에는 운영자 복구가 필요하다.

runtime-known secret corpus 검사는 현재 프로세스가 관찰·등록한 원문 token/correlation 값을 DB·WAL·SHM·로그에서 찾는 방어선이다. 재시작하면 다시 등록하며, 런타임이 본 적 없는 임의 secret 전체의 비유출을 증명하는 장치로 해석하지 않는다.

소스 내용과 체크포인트 블롭은 로컬에 둔다. MVP에는 Blabee 클라우드 추론 백엔드가 없다.

## 14. 안전 경계

- Codex 네이티브 승인 정책을 최우선으로 따른다.
- Pet의 1·2 선택은 다음 작업에 대한 사용자 지시일 뿐 명령·파일·네트워크 권한 승인이 아니다. Codex가 요구하는 네이티브 승인은 항상 원래 Codex UI가 별도로 소유한다.
- 위험도가 `high` 또는 `critical`이면 1·2 전역 단축키를 비활성화하고 Pet의 펼친 위험 확인을 거쳐야만 작업 지시를 보낼 수 있다. 이 확인도 Codex 네이티브 승인을 대신하지 않는다.
- 공개 v0.1에서는 전역 단축키로 어떤 네이티브 권한 요청도 승인하거나 거부하지 않는다.
- 모든 네이티브 권한 요청은 원래 Codex 안전 UI에 응답 소유권을 남긴다.
- Hook 실패 시 일반 Codex 사용은 계속 허용하되, 자동 실행은 차단한다.
- 로컬 코디네이터 Unix domain socket은 listen 직후 소유자만 읽고 쓸 수 있는 `0600`으로 제한한다.
- 패킷이 없거나 잘못된 형식이면 원본 결과를 보여 주고 단일 키 실행을 비활성화한다.
- 의미 있는 대안이 없거나 대안의 안전성이 검증되지 않으면 2번을 비활성화한다.
- 만료되었거나 패킷·리비전·옵션 ID가 일치하지 않는 입력은 실행하지 않는다.
- 전역 단축키는 화면에서 명시적으로 전면 선택된 프로젝트·세션·에피소드의 활성 패킷 하나에만 적용한다. 다른 세션에서 새 카드가 도착해도 전면 대상을 자동 변경하지 않는다.
- 외부 부수 효과에는 가짜 롤백 동작을 제공하지 않는다.
- 프로젝트/세션 연결이 모호하면 사용자 확인을 요구한다.

## 15. 인수 기준

- 설명, 아키텍처, 상태에 관한 프롬프트는 반고정 결정 카드를 열지 않는다.
- 조건에 맞는 작업 턴이 완료되면 해당 세션과 턴에 연결된 유효한 패킷 하나를 생성한다.
- 1번은 현재 패킷의 권장 작업 전체를 대기 중인 `Stop`을 통해 같은 세션·턴의 연속 진행 지시로 전달하고 현재 에피소드와 기준선을 유지한다.
- 2번은 현재 패킷의 대안 작업 전체를 같은 방식으로 전달한다. 의미 있는 대안이 없으면 비활성화하고 다른 동작으로 재사용하지 않는다.
- 비활성 슬롯은 안정적인 `disabled_reason`을 표시하고 `action_id`는 `null`이며 실행 본문을 갖지 않는다.
- `pet_action`은 same-turn Stop 전용으로 교차 바인딩과 중복 종료를 거부한다. `internal_format_repair` 제출 토큰은 재사용·만료·다른 프로젝트·세션·에피소드 사용, `source_turn_id`·`source_prompt_id` 불일치를 거부하며 사람의 새 프롬프트로 오인하지 않는다. dispatch 후 deadline 초과는 작업 결과 `unknown`과 자동 재시도 금지로 처리한다.
- 내부 형식 보정은 같은 결정 경계에서 최대 한 번만 시도하고, 다시 실패하면 일반 결과만 보여 주며 단일 키 실행을 끈다.
- Codex 네이티브 선택지는 Blabee의 1·2·3·4로 재해석하지 않는다. 공개 Hook v0.1에서는 원래 Codex UI가 표시·응답을 소유하고 Pet은 감지 가능한 요청의 알림과 best-effort 앱 복귀만 제공한다.
- 보류는 다른 턴을 시작하지 않고 완전한 재개 캡슐을 저장한다.
- 검증된 체크포인트가 없으면 롤백을 절대 활성화하지 않는다.
- 공개 v0.1에서 사람이 에피소드를 시작한 프롬프트 입력 직전 작업 트리나 인덱스가 깨끗하지 않으면 롤백이 비활성화된다.
- Git 저장소가 아닌 프로젝트에서는 1·2·3을 유지하고 4만 `not_a_git_repository` 사유와 함께 비활성화한다.
- Pet의 1·2 선택은 같은 `episode_id`와 `episode_baseline_checkpoint_id`를 유지한다. 사람이 새 작업 프롬프트를 직접 제출할 때만 새 에피소드 기준선을 만든다.
- 롤백은 활성 패킷의 `episode_root_prompt_id`가 시작되기 직전으로 활성 프롬프트 에피소드 한 개를 복원하며, 최초 프롬프트와 Pet 연속 진행에서 생긴 지원 범위의 변경이 바이트·Git 실행 비트·인덱스 단위로 사라졌음을 검증한다. 그 밖의 POSIX 모드 변화는 롤백을 비활성화한다.
- 제외 경로, 크기 한도 초과, 동시 편집, 브랜치/HEAD 변경 또는 외부 부수 효과가 있으면 롤백이 비활성화된다.
- 오래되었거나 중복된 단축키 입력으로 동작이 두 번 실행될 수 없다.
- 두 Codex 세션이 동시에 결정을 기다려도 전면 선택하지 않은 카드에 단축키가 전달되거나 다른 프로젝트가 롤백되지 않는다.
- `high`·`critical` 위험 작업은 전역 숫자 단축키로 시작할 수 없고, Pet의 위험 확인과 이후 Codex 네이티브 승인을 서로 대체하지 않는다.
- 60초에는 알림만 표시하고, 120초에는 자동 선택 없이 패킷을 만료하고 재개 캡슐을 저장하며 늦은 입력을 거부한다.
- 로컬 코디네이터 연결이 2초 안에 성립하지 않으면 Hook은 fail-open하고 어떤 자동 선택이나 롤백도 실행하지 않는다.
- Keychain freshness checkpoint보다 오래되거나 같은 sequence/head가 다른 authentic DB, DB·키 loss, anchor 누락/손상에서는 event를 반환하거나 저장 파일을 자동 생성하지 않는다.
- freshness `pending + target DB`는 전체 authenticated replay 뒤에만 finalize하고, `pending + source DB`는 정확히 같은 canonical batch 재시도 외에는 자동 취소·진행하지 않는다.
- 공개 v0.1의 네이티브 권한 알림에서는 polling 시점의 frontmost 외부 앱으로 best-effort 복귀할 수 있고 허용/거부는 전송되지 않는다.
- 기본 CLI는 동일한 Plugin 경로를 통해 Terminal, iTerm, VS Code 터미널, Orca에서 동작한다.
- 터미널에 다시 진입하지 않고 저위험 결정 루프를 연속 세 번 완료한다.
- 별도의 Blabee LLM API 자격 증명이 필요하지 않다.

## 16. 확정된 운영 기본값과 남은 증거 게이트

다음 항목은 v0.1 기본값으로 확정한다.

1. 임시 최종 메시지 센티널은 M0의 격리된 1회성 실험에만 사용한다. 운영 결정 제안 채널은 번들 로컬 MCP 도구다.
2. 체크포인트 한도는 파일당 16 MiB, 체크포인트당 128 MiB, 프로젝트당 1 GiB다. 종료된 에피소드부터 정리하고 활성·보류 기준선, 대기 패킷 참조, 최신 복구 스냅샷은 보호한다. 무시 파일, 하위 모듈, LFS, 저장소 밖 경로와 외부 부수 효과는 공개 v0.1 복원 범위에서 제외한다.
3. 공개 v0.1의 네이티브 권한 요청은 알림과 best-effort 앱 복귀만 제공하며 정확한 원래 창 복귀를 약속하지 않는다.
4. 알파는 Codex `0.148.0`에 고정한다. 공개 배포는 지원 버전 허용 목록과 `blabee doctor` 검사를 사용하고, 주간·새 Codex 버전 발견 시·Blabee 릴리스 전에 계약 검사를 실행한다.
5. Stop 대기 중 60초에 한 번 알리고 120초에 패킷을 만료한다. 자동 선택은 하지 않으며 재개 캡슐을 저장하고 늦은 입력을 거부한다.
6. 여러 Hook 세션의 패킷은 각각 만료 시간을 갖는 대기열에 보관하고, 전역 단축키는 명시적으로 선택된 전면 카드 하나에만 연결한다.

M0에서 실제 Codex CLI `0.148.0`과 임시 Git 프로젝트를 사용해 다음을 확인했다.

- `.codex/hooks.json`과 프로젝트의 `.codex/config.toml`만으로 `SessionStart → UserPromptSubmit → MCP emit_decision → Stop 대기 → Pet 선택 → 같은 턴 연속 진행 → 수명 주기 종료 관찰`이 성공했다. MCP 검색을 위해 별도의 직접 `-c` 서버 주입은 필요하지 않았다.
- 실제 결과의 `mcp_config_source`는 `project_config_only`, `final_assistant_message`는 정확히 `M0_CONTINUED`, `terminal_input_injection`과 `separate_llm_api_key`는 모두 `false`였다.
- 설명 전용 음성 계약도 실제 CLI에서 통과했다. `--explanation-only` 실행은 `project_enabled`, `session_started`, `human_episode_started`만 기록했고 `decision_proposal_received`와 `decision_wait_started`는 0건, `result.txt`는 생성되지 않았으며 `final_assistant_message`는 정확히 `M0_EXPLAINED`였다.
- 이 역사적 `0.148.0` M0 결과는 **결정 한 번 → 연속 진행 한 번**의 사이클만 입증한다. `0.148.0` 반복 두 사이클은 아직 미검증이다.
- 선택은 전체 패킷 바인딩을 검증했고, 터미널 키 입력이나 별도 LLM API 키를 사용하지 않았다.
- Hook 해시 검토는 타당성 픽스처에서만 `--dangerously-bypass-hook-trust`로 우회했다. T-011에서 격리한 `CODEX_HOME`과 로컬 marketplace를 사용한 Plugin 설치·cache-buster 업데이트·제거는 실제 Codex CLI `0.149.0`으로 통과했다. 번들 코디네이터 자동 시작, 사용자 Hook 신뢰 검토와 제품 패키징은 아직 검증하지 않았다. [Codex 플러그인 만들기](https://developers.openai.com/plugins/build/plugins)
- 롤백 검증은 운영체제 임시 디렉터리 아래 합성 Git 픽스처에만 적용했다. 실제 사용자 작업공간에서 롤백을 활성화하지 않았다.

이 M0 결과는 연동 타당성에 대한 조건부 승인이다. T-005는 Node와 Swift의 공통 NDJSON·durable append/replay·partial-tail·지속 부하·단조 대기 probe·진단·ad-hoc 서명·측정용 DMG를 비교해 **Swift 네이티브 헬퍼를 제품 런타임으로 선택**했다. Node는 계약 참조, C는 정식 JSON parser가 없는 health 전용 성능 기준선이다.

T-007a는 런타임 중립 JavaScript 참조 코어에서 순수 `decide`/`reduce`/`replay`, 같은 턴 경계 1→2, CAS 선택 선점, 패킷·sidecar 결합, CSPRNG/fingerprint, 형식 보정과 timeout `unknown`을 구현해 독립 QA를 통과했다.

T-007b-A는 Swift 저수준 제품 영속 커널에서 strict ingress 4개 타입과 manifest fixture 20개, SQLite WAL/FULL/FK, 프로세스 간 CAS, crash·SIGKILL·commit 후 replay, runtime event MAC chain/head anchor, packet/verification row-bound HMAC을 구현했다. T-007b-A2는 strict Keychain freshness state, immutable DB checkpoint, digest CAS, secure process lock, storage preflight/recheck와 rollback/loss/crash reconciliation을 추가했다. T-007b-B1은 Swift 의미 state/application과 제품 semantic 경계를 추가해 low-level append의 제품 노출을 차단했다. B2는 atomic same-session pending, multi-session queue, explicit foreground/no-steal, exact selection, routed Pet token consume, fixed-window format-repair claim과 continuous deadline scheduler를 추가하고 direct B1 selection/token-consume/scheduler command를 제품 API에서 차단했다. 진단 가림 회귀 추가 직전 Swift package 62/62, T-007a 33/33, persistence 40/40과 전체 `npm test` 247/247이 통과했다. 가림 회귀 추가 뒤 M0는 55/55가 통과했고 실제 Codex 두 사이클도 재통과했지만, 최신 전 범위 248개 중 2개는 macOS Keychain `security` 조회 환경 timeout으로 남았다.

T-007b-C에서는 실제 Codex CLI `0.149.0`과 M0 fake coordinator의 격리 픽스처가 같은 session·turn·episode lineage로 `boundary_sequence` 1→2, 결정 두 사이클, `M0_CONTINUED_TWICE`를 통과했다. 별도 Swift 제품 게이트는 같은 lineage에서 각 경계의 선택·dispatch·consume·전송 종료·작업 결과·경계 종료를 포함한 16개 이벤트를 영속화하고 재시작 후 재생했다. T-011은 이 의미를 실제 제품 Hook/MCP CLI, Pet API용 UDS test client와 고수준 Swift application/UDS에 옮겼다. T-010은 같은 UDS에 SwiftUI/AppKit 네이티브 Pet을 연결하고 코드·headless 안전 게이트를 통과했다.

따라서 실제 사용자 작업공간이나 공개 MVP 사용 승인은 아니다. T-011의 고수준 adapter·단일 daemon/UDS ownership·full selection·원문 continuation token 비노출과 T-010 Pet 코드는 구현됐지만 실제 사용자 Hook 신뢰, 로그인 Keychain 제품 daemon, WindowServer·다중 디스플레이·Spaces·실제 단축키·호스트 복귀 qualification이 남아 있다. 실제 장시간 macOS sleep 운영 검증, 운영 롤백 안전 게이트, Developer ID 서명·공증 패키징과 signed Data Protection Keychain도 후속 범위다. 같은 UID anchor 삭제·교체, DB·키·anchor 동시 제거와 exact batch가 없는 pending-source 복구도 현재 범위 밖이다.
