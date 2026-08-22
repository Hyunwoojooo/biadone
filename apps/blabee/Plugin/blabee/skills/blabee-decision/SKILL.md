---
name: blabee-decision
description: Codex 작업이 의미 있는 완료, 부분 완료, 실패, 차단 또는 다음 결정 경계에 도달했을 때만 Blabee Pet에 구조화된 다음 선택을 전달합니다. 설명, 구조, 상태 확인이나 일반 질문에는 사용하지 않습니다.
---

# Blabee 결정 제출

일반 답변은 평소 형식으로 작성한다. 모든 답변을 번호 선택지나 고정된 1~4 형식으로 바꾸지 않는다.

사용자의 요청이 실제 작업을 수행하는 action-type 요청이고 결과가 다음 중 하나에 해당하면 번들 MCP의 `emit_decision`을 반드시 기본적으로 한 번 호출한다. 결과가 짧거나 텍스트 산출물뿐이어도 생략하지 않는다.

- 요청한 작업이 의미 있게 완료되거나 부분 완료되었다.
- 작업이 실패하거나 차단되어 다음 진행 방향을 정해야 한다.
- 현재 작업을 마치고 다음 행동으로 이어갈 수 있다.

프로젝트 설명, 코드 구조 설명, 상태 확인, 일반 질문, 짧은 확인 답변에는 호출하지 않는다. Codex가 직접 표시하는 권한 승인이나 네이티브 질문을 Blabee 결정으로 바꾸지 않는다.

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
    "recommended_next": {
      "title": "<recommended action>",
      "objective": "<complete objective>",
      "constraints": ["<real constraint>"],
      "done_when": ["<verifiable completion condition>"]
    },
    "alternative_next": null,
    "pause_capsule": {
      "resume_first": "<first concrete resume action>"
    },
    "reported_side_effects": []
  }
}
```

`alternative_next`는 안전하고 의미 있는 대안이 있을 때만 `recommended_next`와 같은 완전한 행동 구조로 채우고, 아니면 `null`로 둔다. `reported_side_effects`에는 실제로 발생한 영향만 `{ "kind", "summary", "reversibility" }` 형태로 기록한다.

실행하지 않은 테스트를 통과했다고 쓰거나, 확인하지 않은 위험 수준을 단정하거나, 검증되지 않은 롤백 가능성을 약속하지 않는다.

도구가 성공하면 같은 결정 경계에서 다시 호출하지 않는다. 실패한 경우에도 원칙적으로 다시 호출하지 않는다. 단, 실패 결과의 `structuredContent.error_code`가 정확히 `proposal_source_prompt_mismatch`이고, 방금 제출한 `source_prompt_id`만 현재 Hook 컨텍스트와 다르며 나머지 5개 값은 모두 동일할 때만 보정 재시도를 한 번 허용한다.

보정 재시도에서는 Hook 컨텍스트를 다시 읽어 `source_prompt_id`만 정확히 고친다. 나머지 wrapper 값, 같은 `proposal_id`, 안팎의 `correlation_token`, proposal 전체 내용은 변경하지 않는다. 두 번째 호출이 실패하거나, prompt 이외의 값도 다르거나, 기존 제출값과 Hook 값의 차이를 확인할 수 없거나, 다른 오류 코드이면 일반 답변으로 실패를 알리고 더 호출하지 않는다.
