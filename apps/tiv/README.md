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
