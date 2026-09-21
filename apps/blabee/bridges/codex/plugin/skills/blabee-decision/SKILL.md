---
name: blabee-decision
description: 현재 Hook의 suggestion_mode 정책에 따라 Codex 작업 결과나 유용한 후속 질문을 Blabee Pet의 구조화된 다음 선택으로 전달합니다.
---

# Blabee 후속 제안 제출

일반 답변은 평소 형식으로 작성한다. 모든 답변을 번호 선택지나 고정된 1~4 형식으로 바꾸지 않는다.

현재 Hook 컨텍스트의 `suggestion_mode`를 먼저 확인하고 아래 정책을 적용한다. 이전 Hook 캐시처럼 이 필드만 없고 나머지 현재 바인딩이 완전하면 `action_only`로 취급한다.

## 호출 정책

### `action_only`

사용자의 요청이 실제 작업을 수행하는 action-type 요청이고 결과가 다음 중 하나에 해당하면 번들 MCP의 `emit_decision`을 정확히 한 번 호출한다. 결과가 짧거나 텍스트 산출물뿐이어도 생략하지 않는다.

- 요청한 작업이 의미 있게 완료되거나 부분 완료되었다.
- 작업이 실패하거나 차단되어 다음 진행 방향을 정해야 한다.
- 현재 작업을 마치고 다음 행동으로 이어갈 수 있다.

프로젝트 설명, 코드 구조 설명, 상태 확인, 일반 질문, 짧은 확인 답변과 잡담에는 호출하지 않는다.

### `smart`

`action_only`의 action-type 규칙은 그대로 적용한다. 추가로, 충분한 내용을 가진 설명·분석·일반 질문 답변이 끝났고 사용자가 자연스럽게 이어갈 수 있는 **서로 다른 유용한 후속 질문 또는 작업이 둘 이상**이면 `emit_decision`을 정확히 한 번 호출한다.

이 **두 개 이상 기준은 설명·분석·일반 질문 응답에만 적용**하며, 위의 기존 action-type 필수 제출 규칙을 약화하지 않는다. 단순 상태 확인, 짧은 확인 답변, 잡담, 의미 있는 후속 항목이 둘 미만인 informational 답변에는 호출하지 않는다. 개수를 맞추기 위한 선택지는 만들지 않는다.

### `always`

현재 메인 에이전트가 사용자에게 보내는 모든 적격 최종 응답에서 `emit_decision`을 정확히 한 번 호출하고, 서로 다른 유용한 후속 질문 또는 작업을 2~4개 제공한다. 설명, 상태 확인, 일반 질문도 포함한다.

다만 실제로 제안할 수 있는 후속 항목이 둘 미만이면 선택지를 꾸며내지 말고 호출하지 않는다.

## 공통 제외 조건

Codex가 직접 표시하는 권한 승인이나 네이티브 질문을 Blabee 제안으로 바꾸지 않는다. 하위 에이전트의 내부 보고, 사용자에게 전달되지 않는 중간 상태, Hook 바인딩이 없는 응답에도 호출하지 않는다. 사용자가 도구 호출이나 부수 효과를 명시적으로 금지한 요청도 그 지시를 우선한다. 정확한 출력 하나, 명령의 정확히 한 번 실행 또는 추가 작업 금지를 요구한 요청은 추가 제안 도구 호출을 금지한 것으로 취급한다. 모드와 관계없이 모델이 유용한 후속 항목을 발명해서는 안 된다.

## 제출 계약

현재 Hook 컨텍스트가 제공한 `project_id`, `session_id`, `source_turn_id`, `source_prompt_id`, `episode_id`, `correlation_token`의 정확한 현재 값을 사용한다. 값을 추측하거나 생성하거나 이전 경계에서 재사용하지 않는다. 하나라도 없으면 도구를 호출하지 않고 일반 답변만 제공한다.

도구 인자는 다음 구조를 모두 포함한다.

```json
{
  "project_id": "<current>",
  "session_id": "<current>",
  "source_turn_id": "<current>",
  "source_prompt_id": "<current>",
  "episode_id": "<current>",
  "correlation_token": "<current>",
  "proposal": {
    "schema_version": "1.0",
    "proposal_id": "<new identifier for this boundary>",
    "correlation_token": "<same current token>",
    "interaction_kind": "blabee_decision",
    "task_goal": "<the task actually handled>",
    "outcome": {
      "status": "completed | partial | blocked | failed",
      "summary": "<observed outcome>"
    },
    "next_actions": [
      {
        "title": "<most recommended action>",
        "objective": "<complete objective>",
        "constraints": ["<real constraint>"],
        "done_when": ["<verifiable completion condition>"]
      },
      {
        "title": "<second-best action>",
        "objective": "<complete alternative objective>",
        "constraints": ["<real constraint>"],
        "done_when": ["<verifiable completion condition>"]
      }
    ],
    "reported_side_effects": []
  }
}
```

`next_actions`에는 서로 구분되는 의미 있는 다음 작업이나 후속 질문을 2~4개 넣는다. 첫 항목이 가장 권장하는 항목이고 배열 뒤로 갈수록 현재 목표에 대한 차선이다. 보류나 롤백을 이 배열에 넣지 않고, 개수를 맞추기 위한 모호하거나 중복된 항목도 만들지 않는다. 각 항목은 독립적으로 실행할 수 있는 완전한 `title`, `objective`, `constraints`, `done_when`을 가진다. 후속 질문도 선택되면 같은 Codex 세션의 새 사용자 턴으로 실행할 수 있는 완전한 요청이어야 한다. `reported_side_effects`에는 실제로 발생한 영향만 `{ "kind", "summary", "reversibility" }` 형태로 기록한다.

설명·분석 후속 제안도 기존 `schema_version: 1.0`, `interaction_kind: blabee_decision`을 그대로 사용한다. `suggestion_kind` 같은 새 필드를 추가하지 않는다.

실행하지 않은 테스트를 통과했다고 쓰거나, 확인하지 않은 위험 수준을 단정하거나, 검증되지 않은 롤백 가능성을 약속하지 않는다.

도구가 성공하면 같은 결정 경계에서 다시 호출하지 않는다. 실패한 경우에도 원칙적으로 다시 호출하지 않는다. 단, 실패 결과의 `structuredContent.error_code`가 정확히 `proposal_source_prompt_mismatch`이고, 방금 제출한 `source_prompt_id`만 현재 Hook 컨텍스트와 다르며 나머지 5개 값은 모두 동일할 때만 보정 재시도를 한 번 허용한다.

보정 재시도에서는 Hook 컨텍스트를 다시 읽어 `source_prompt_id`만 정확히 고친다. 나머지 wrapper 값, 같은 `proposal_id`, 안팎의 `correlation_token`, proposal 전체 내용은 변경하지 않는다. 두 번째 호출이 실패하거나, prompt 이외의 값도 다르거나, 기존 제출값과 Hook 값의 차이를 확인할 수 없거나, 다른 오류 코드이면 일반 답변으로 실패를 알리고 더 호출하지 않는다.
