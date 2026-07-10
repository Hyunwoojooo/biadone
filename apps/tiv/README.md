# T.I.V

ChatGPT 공유 링크의 대화를 복원하고 구조화하는 Next.js 애플리케이션입니다.

## Sprint 5A LLM Shadow Mode

LLM Shadow Mode는 기존 RuleExtractor 결과를 대체하지 않습니다. 같은 Clean Conversation을 LLM으로 별도 분석하고, Rule/LLM 공통 `SemanticItem` 결과를 분석 레코드와 GPT Audit 파일에 함께 저장합니다.

```text
TIV_LLM_SHADOW_ENABLED=true
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
```

- `TIV_LLM_SHADOW_ENABLED`가 `true`가 아니면 API를 호출하지 않습니다.
- `OPENAI_API_KEY`가 없으면 Shadow 결과는 `disabled`로 저장됩니다.
- LLM 호출 또는 schema 검증이 실패해도 Rule 결과와 기존 UI는 정상 유지됩니다.
- Shadow Mode를 활성화하면 Clean Conversation 내용이 OpenAI API로 전송됩니다. 민감한 대화에는 사용하지 마세요.
