# T.I.V

ChatGPT 공유 링크의 대화를 복원하고 구조화하는 Next.js 애플리케이션입니다.

## Sprint 5A LLM Shadow Mode

LLM Shadow Mode는 기존 RuleExtractor 결과를 대체하지 않습니다. 같은 Clean Conversation을 LLM으로 별도 분석하고, Rule/LLM 공통 `SemanticItem` 결과를 분석 레코드와 GPT Audit 파일에 함께 저장합니다.

```text
TIV_LLM_SHADOW_ENABLED=true
TIV_LLM_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.1-flash-lite
```

- `TIV_LLM_SHADOW_ENABLED`가 `true`가 아니면 API를 호출하지 않습니다.
- `TIV_LLM_PROVIDER`는 `gemini`, `qwen`, `openai`를 지원하며 기본값은 `openai`입니다.
- Gemini는 `GEMINI_API_KEY`, Qwen은 `DASHSCOPE_API_KEY`, OpenAI는 `OPENAI_API_KEY`를 사용합니다.
- Gemini는 기본적으로 `https://generativelanguage.googleapis.com/v1/interactions`를 사용하며 `GEMINI_BASE_URL`로 재정의할 수 있습니다.
- Qwen의 `QWEN_BASE_URL`은 API 키를 발급받은 리전에 맞게 설정해야 합니다.
- Gemini는 stateless `store=false`, minimal thinking, JSON Schema Structured Output으로 호출합니다.
- Qwen JSON mode를 위해 non-thinking 모드로 호출하고 반환값을 공통 Zod schema로 다시 검증합니다.
- LLM 호출 또는 schema 검증이 실패해도 Rule 결과와 기존 UI는 정상 유지됩니다.
- Shadow Mode를 활성화하면 Clean Conversation 내용이 선택한 외부 LLM API로 전송됩니다. 민감한 대화에는 사용하지 마세요.

### Sprint 5A-2 품질 보정

긴 대화를 한 번에 요약하지 않도록 RuleExtractor의 Topic Flow를 구간 힌트로 사용합니다. 기본적으로 구간당 28,000자, 최대 40개 메시지로 묶고 최대 12개 구간을 3개씩 병렬 분석합니다. 직전 assistant 메시지는 첫 user reaction의 satisfaction/acceptance 판단을 위한 context-only 메시지로만 겹쳐 전달합니다.

```text
TIV_LLM_SEGMENT_MAX_CHARS=28000
TIV_LLM_SEGMENT_MAX_MESSAGES=40
TIV_LLM_SEGMENT_MAX_COUNT=12
TIV_LLM_SEGMENT_CONCURRENCY=3
```

- 각 구간은 intent, topic, decision, open question, action, preference, content constraint, problem signal, satisfaction, change event, entity, relation을 독립적으로 점검합니다.
- 여러 구간에서 생성된 exact duplicate는 evidence와 trigger phrase 기준으로 병합합니다.
- 일부 구간만 실패하면 전체 상태를 `partial`로 기록하고 성공한 구간의 후보는 보존합니다.
- GPT Audit에는 구간별 상태, 토큰 사용량, 응답시간, semantic type coverage, evidence message coverage를 함께 기록합니다.

### Sprint 5B Evidence Verifier

LLM 후보를 원문과 다시 대조해 `verifiedItems`, `reviewQueue`, `rejectedItems`로 분리합니다. 검증기는 규칙 기반으로 실행되므로 추가 LLM API 호출이나 토큰 비용이 발생하지 않습니다.

- `triggerPhrase`가 인용한 Clean Conversation 메시지에 실제로 존재하는지 확인하고 정확한 `startChar/endChar`를 저장합니다.
- intent, preference, content constraint, problem signal, change event는 직접적인 user evidence가 있어야 검증됩니다.
- decision은 명시적인 user 결정 표현 또는 assistant 제안 직후의 user 수락 반응이 필요합니다.
- satisfaction은 assistant final answer와 그다음 user reaction이 함께 인용되고 상태 표현이 일치해야 합니다.
- 잘못된 index와 Context/Internal 근거는 `rejectedItems`, span 불일치·암시적 판단·낮은 confidence는 `reviewQueue`로 이동합니다.
- RuleExtractor와 Sprint 3/4 결과는 변경하지 않으며, Rule/LLM 충돌 해소는 Sprint 5C에서 수행합니다.
- 분석 결과 화면의 Sprint 5 탭에서 LLM 실행 지표, segment 상태, Rule/LLM 타입 분포와 Evidence 검증 결과를 확인할 수 있습니다.
