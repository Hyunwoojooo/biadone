---
name: blabee-decision
description: Codex 작업이 의미 있는 완료, 부분 완료, 실패, 차단 또는 다음 결정 경계에 도달했을 때만 Blabee Pet에 구조화된 다음 선택을 전달합니다. 설명, 구조, 상태 확인이나 일반 질문에는 사용하지 않습니다.
---

# Blabee 결정 제출

일반 답변은 평소 형식으로 작성한다. 모든 답변을 번호 선택지나 고정된 1~4 형식으로 바꾸지 않는다.

다음 중 하나에 해당하고 사용자의 다음 선택이 실제로 필요할 때만 번들 MCP의 `emit_decision`을 정확히 한 번 호출한다.

- 요청한 작업이 의미 있게 완료되거나 부분 완료되었다.
- 작업이 실패하거나 차단되어 다음 진행 방향을 정해야 한다.
- 현재 작업을 마치고 서로 다른 다음 행동 중 하나를 선택해야 한다.

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

실행하지 않은 테스트를 통과했다고 쓰거나, 확인하지 않은 위험 수준을 단정하거나, 검증되지 않은 롤백 가능성을 약속하지 않는다. 같은 결정 경계에서는 제출 성공 여부와 관계없이 자동으로 중복 호출하지 않는다.
