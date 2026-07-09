# TIV Parser / MockExtractor 수정사항 정리

## 문서 목적

이 문서는 최근 TIV GPT Audit 샘플 검수에서 반복적으로 발견된 문제를 바탕으로, `Parser / Normalizer / MockExtractor / UI Review Queue`에 반영해야 할 수정사항을 정리한 문서다.

목표는 다음과 같다.

```text
1. Clean Conversation 오염 제거
2. assistant final answer 누락 방지
3. Decision / Action / Open Question 오분류 감소
4. Preference / Satisfaction 과잉 추출 방지
5. low-confidence / example-derived 항목을 기본 결과에서 제외
6. 사람이 검수 가능한 evidence-first 구조 강화
```

현재 가장 중요한 판단은 다음이다.

> **1순위는 Extractor 고도화가 아니라 Parser / Canonical Conversation Normalizer 안정화다.**

Clean Conversation이 오염되면 Topic Flow, Satisfaction, Decision, Action, Preference가 모두 연쇄적으로 흔들린다.

---

# 1. 반복 확인된 핵심 문제

## 1.1 Clean Conversation에 tool / plugin / execution 로그가 섞임

### 문제

Clean Conversation에는 실제 사용자 메시지와 assistant가 사용자에게 보여준 최종 답변만 남아야 한다.

하지만 샘플에서 다음 유형이 Clean Conversation에 남았다.

```text
- search query JSON
- open / click / pointer JSON
- bash 실행 로그
- python 실행 코드
- sandbox 파일 생성 코드
- Figma connector tool discovery JSON
- skill://... read call
- plugin redacted output
- HTML artifact generation code
```

예시 패턴:

```json
{"paths":["Figma"],"query":"create"}
{"uri":"skill://figma/figma-use/SKILL.md","start_line":1,"num_lines":120}
```

```text
The output of this plugin was redacted.
```

```python
from pathlib import Path
html = r'''<!DOCTYPE html>
...
```

이런 메시지는 의미 분석 대상이 아니다.

### 영향

```text
- Clean Conversation count가 과도하게 증가
- Topic Flow 범위가 tool execution 구간까지 늘어남
- Satisfaction pairing이 깨짐
- Action / Decision 추출이 tool 흔적에서 발생
- Preference triggerPhrase가 엉뚱한 문장으로 잡힘
```

---

## 1.2 assistant final answer가 Context Signal로 빠짐

### 문제

반대로, 실제 사용자에게 보인 assistant 최종 답변이 `context_signal / other_tool_call`로 빠지는 문제도 반복됐다.

예시 유형:

```text
완료했습니다. ... [Markdown 파일 다운로드](sandbox:/mnt/data/...)
시작은 가능합니다. 다만 ...
맞아. 지금 단계부터는 실제 웹 MVP로 개발하는 방향이 더 낫다.
수정 반영해서 새 HTML 파일로 다시 만들었어.
```

이런 메시지는 tool call이 아니라 assistant final answer다.

### 영향

```text
- 사용자가 어떤 답변을 받았는지 Clean Conversation에서 사라짐
- 다음 user reaction과 연결할 assistant answer가 없음
- Satisfaction이 잘못 계산됨
- Topic endMessageIndex가 비정상적으로 짧아짐
- Action completion 판단이 어려워짐
```

### 핵심 원칙

> **sandbox 링크나 파일 다운로드 링크가 있다고 Context Signal이 되는 것이 아니다. 사용자에게 보인 자연어 설명형 완료 응답이면 Clean Conversation assistant final answer다.**

---

## 1.3 복합 Decision에서 confirmed decision이 사라짐

### 문제

복합 문장 안에 여러 기능이 있는 경우, 일부 decision만 추출되고 핵심 confirmed decision이 누락된다.

대표 예시:

```text
pdf 업로드하는건 일단 추후에 사용될 기능으로 빼자.
일단 링크로만 대화 내용 파악하는걸로 기술로 잡고,
서비스 일련의 과정 전체 기술 명세서를 만들어줘봐.
```

현재 잘못된 추출:

```json
[
  {
    "status": "deferred",
    "title": "PDF 업로드는 후순위"
  },
  {
    "status": "excluded",
    "title": "PDF 업로드는 후순위"
  }
]
```

누락된 핵심 decision:

```json
{
  "status": "confirmed",
  "title": "v0.1은 링크 기반 대화 분석으로 진행"
}
```

정확한 분해:

```json
[
  {
    "type": "decision",
    "status": "deferred",
    "title": "PDF 업로드는 후순위 기능으로 분리",
    "triggerPhrase": "pdf 업로드하는건 일단 추후에 사용될 기능으로 빼자"
  },
  {
    "type": "decision",
    "status": "confirmed",
    "title": "v0.1은 링크 기반 대화 분석으로 진행",
    "triggerPhrase": "일단 링크로만 대화 내용 파악하는걸로 기술로 잡고"
  },
  {
    "type": "action",
    "actionType": "user_requested",
    "title": "서비스 전체 기술 명세서 작성",
    "triggerPhrase": "서비스 일련의 과정 전체 기술 명세서를 만들어줘봐"
  }
]
```

---

## 1.4 assistant_suggestion candidate decision 과잉 생성

### 문제

assistant 문서 본문, 표, 코드블록, 스키마 예시, 규칙 설명에서 candidate decision이 과도하게 생성된다.

잘못 잡힌 예시 유형:

```text
보류된 내용
최종 제품 방향은 다음과 같이 확정한다
decisionStatus: "confirmed" | "rejected" | "suggested"
결정은 가능하면 user message에서만 확정합니다
```

이들은 사용자 decision이 아니다.

### 영향

```text
- Board에 candidate decision이 대량 노출됨
- overview.keyDecisionIds에 후보 decision이 섞임
- 사용자가 확정한 것과 assistant가 설명한 것이 혼동됨
```

---

## 1.5 Action과 Open Question의 문장 기능 구분 실패

### 문제 A: 사용자 요청이 team_next로 오분류됨

예시:

```text
figma 화면 설계 진행해봐.
연결됐는지 확인해봐.
codex implementation plan.md 파일 만들자.
```

이들은 모두 사용자가 assistant에게 한 요청이다.

정답:

```json
{
  "actionType": "user_requested",
  "assignee": "assistant"
}
```

잘못된 결과:

```json
{
  "actionType": "team_next",
  "assignee": "team"
}
```

### 문제 B: acceptance phrase가 action으로 오분류됨

예시:

```text
그래 그렇게 해보자.
좋아 그걸로 하자.
오케이 그렇게.
```

이 문장은 단독 action이 아니라 직전 assistant 제안에 대한 수락이다.

정답:

```json
{
  "type": "decision",
  "status": "confirmed",
  "source": "accepted_assistant_suggestion",
  "evidenceMessageIndexes": [previousAssistantIndex, userIndex]
}
```

### 문제 C: 수정 요청이 open question으로 오분류됨

예시:

```text
html파일 잘 봤는데 수정해야될 부분이 있겠다.
실제 웹 서비스처럼. 다시 html 파일 만들어줘.
```

정답:

```json
{
  "type": "action",
  "actionType": "user_requested",
  "title": "실제 웹 서비스 플로우를 반영한 HTML 파일 재작성"
}
```

---

## 1.6 Satisfaction 판단이 단순 키워드에 과의존함

### 문제

다음과 같은 사용자 반응이 단순 clarification으로 분류됐다.

```text
뭐하냐 왜 못만드냐
왜 안보여지지?
```

실제 의미는 다음에 가깝다.

```text
- task_failed
- problem_reported
- dissatisfied
```

또 다음은 단순 continuing이 아니라 방향 변경이다.

```text
이걸 이렇게 만드는 것보다 그냥 웹으로 만드는게 좋을 수도 있겠다.
실제 웹으로 더 개발하는게 나을 수도 있겠다.
```

정답 상태:

```text
direction_changed
```

---

## 1.7 Topic label이 generic함

### 문제

다음 label은 의미 대표성이 낮다.

```text
구현
수정
문서화
검토
분석
공유 링크 분석
구조화 결과 구현
구조화 결과 수정
```

추천 label:

```text
JARVIS Context Mapper 초기 아이디어 정리
Timeline / Ask 기능 제외 검토
PDF vs 공유 링크 입력 방식 검토
공유 링크 HTML payload 복원 방식 검토
링크 기반 v0.1 범위 확정
MockExtractor 세부 룰 설계
Figma 화면 설계 진행
Figma 반영 실패 확인
웹 MVP 전환 검토
공공데이터 API 신청서 작성
```

---

## 1.8 Preference triggerPhrase가 부정확함

### 문제

`preference.format`인데 triggerPhrase가 다음처럼 잡힘.

```text
지금 우리 팀에는 문서처리
외국인 포인트 넣고 이 포인트들 반영해서 기획안 다시 만들어줘
```

이는 format preference가 아니다.

실제 format preference triggerPhrase는 다음이다.

```text
노션에 넣을 수 있는 md파일로 만들어줘
.md파일로 만들어줘
```

### 원칙

> **Preference triggerPhrase는 반드시 해당 preference rule이 실제 매칭된 span이어야 한다.**

---

## 1.9 low-confidence / example-derived 항목이 확정처럼 보임

### 문제

confidence가 낮거나 example-like로 감지된 항목이 기본 Board / Overview에 들어간다.

예시:

```text
confidence 0.35
source = assistant_suggestion
message has EXAMPLE_TEXT_DETECTED
secondaryStatuses 여러 개 충돌
```

이런 항목은 Main Board가 아니라 Review Queue로 보내야 한다.

---

# 2. 수정 우선순위

## P0. Parser / Normalizer 수정

가장 먼저 해야 한다.

```text
1. Clean Conversation hard exclude 강화
2. assistant final answer 복구 룰 추가
3. Context Signal type 세분화
4. artifact generation code와 artifact delivery final answer 분리
```

## P1. Board Extractor 수정

```text
1. 복합 decision clause splitter 추가
2. confirmed / deferred / excluded / candidate 상태 우선순위 수정
3. assistant_suggestion candidate 기본 Board 제외
4. Action / Open Question 문장 기능 분리
5. acceptance phrase 처리
```

## P2. Semantic 품질 개선

```text
1. Satisfaction 상태 확장
2. Topic label generator 개선
3. Preference triggerPhrase span 기반 추출
4. Overview가 마지막 meta request에 끌리지 않도록 가중치 수정
```

## P3. UI / Review Queue 개선

```text
1. low-confidence 항목 기본 숨김
2. candidate / assistant_suggestion / example-derived 항목 Review Queue 이동
3. Main Board와 Review Queue 분리
4. triggerPhrase + evidence quote를 UI에서 함께 노출
```

---

# 3. Parser / Normalizer 수정 규칙

## 3.1 Clean Conversation 포함 기준

Clean Conversation에는 다음만 포함한다.

```text
- 실제 user message
- 사용자에게 보인 assistant final answer
- assistant의 user-visible partial/final answer 중 의미 있는 자연어 응답
- assistant의 artifact delivery final answer
```

assistant final answer 예시:

```text
완료했습니다. ... 파일 다운로드
시작은 가능합니다. 다만 ...
맞아. 지금 단계부터는 실제 웹 MVP로 개발하는 방향이 더 낫다.
수정 반영해서 새 HTML 파일로 다시 만들었어.
```

---

## 3.2 Clean Conversation hard exclude 규칙

아래 패턴은 Clean Conversation에서 제외한다.

```ts
const HARD_EXCLUDE_FROM_CLEAN = [
  /^bash -lc/,
  /^python/,
  /^python3/,
  /^from pathlib import Path/,
  /^html = r'''/,
  /^cat > \/mnt\/data/,
  /^ls -la/,
  /^ls -R/,
  /^\{"queries":/,
  /^\{"query":/,
  /^\{"search_query":/,
  /^\{"system1_search_query":/,
  /^\{"open":/,
  /^\{"click":/,
  /^\{"find":/,
  /^\{"pointers":/,
  /^\{"paths":/,
  /^\{"uri":"skill:\/\//,
  /^The output of this plugin was redacted/,
  /Code executed with no return value/
];
```

분류 결과:

```ts
{
  category: "context_signal",
  semanticAnalyzable: false
}
```

---

## 3.3 Context Signal type 세분화

현재 `other_tool_call`이 너무 넓다. 다음처럼 세분화한다.

```ts
type ContextSignalType =
  | "search_query"
  | "opened_source"
  | "clicked_source"
  | "find_pattern"
  | "pointer_reference"
  | "bash_execution"
  | "python_execution"
  | "file_write_operation"
  | "artifact_generation_code"
  | "connector_tool_call"
  | "connector_tool_result"
  | "redacted_tool_result"
  | "skill_read"
  | "artifact_delivery_candidate";
```

주의:

```text
artifact_delivery_candidate는 최종적으로 clean_conversation으로 복구될 수 있는 후보 타입이다.
```

---

## 3.4 assistant final answer 복구 룰

다음 조건을 만족하면 Context Signal이 아니라 Clean Conversation으로 복구한다.

```ts
function isAssistantFinalAnswer(message: Message): boolean {
  return (
    message.role === "assistant" &&
    hasNaturalLanguage(message.text) &&
    (
      /완료했습니다|완성했습니다|만들었습니다|만들었어|정리했습니다|아래처럼|시작은 가능합니다|맞아|좋아|파일 다운로드|ZIP 다운로드|다운로드|실행은|구성은|이번 버전|다음 작업은/.test(message.text)
    ) &&
    !isPureToolOperation(message.text)
  );
}
```

분류:

```ts
{
  category: "clean_conversation",
  role: "assistant",
  assistantMessageType: "final_answer_with_artifact"
}
```

---

## 3.5 artifact generation code vs artifact delivery final answer

### artifact generation code

```text
- 파일 생성용 bash
- Python으로 HTML/MD 작성
- 전체 HTML 코드 생성
- cat > /mnt/data/...
```

분류:

```ts
category = "context_signal";
contextSignalType = "artifact_generation_code";
semanticAnalyzable = false;
```

### artifact delivery final answer

```text
- 사용자에게 완료 사실 설명
- 다운로드 링크 제공
- 포함 내용 요약
- 다음 작업 안내
```

분류:

```ts
category = "clean_conversation";
assistantMessageType = "final_answer_with_artifact";
semanticAnalyzable = true;
```

---

# 4. Decision Extractor 수정 규칙

## 4.1 Decision은 기본적으로 user evidence에서만 확정

```ts
if source === "explicit_user":
  canCreateConfirmedDecision = true

if source === "assistant_suggestion" and nextUserAccepts:
  canCreateConfirmedDecision = true

else:
  canCreateConfirmedDecision = false
```

---

## 4.2 confirmed decision 패턴

```ts
const CONFIRMED_DECISION_PATTERNS = [
  /이걸로 하자/,
  /이 방향으로 가자/,
  /그걸로 하자/,
  /그렇게 하자/,
  /그렇게 해보자/,
  /확정/,
  /결정/,
  /고정/,
  /잡고/,
  /링크로만/,
  /v0\.1은 .* 사용/,
  /웹으로 .* 가자/,
  /실제 웹으로 .* 개발/
];
```

---

## 4.3 deferred vs excluded 우선순위

`추후`, `나중`, `후순위`가 있으면 excluded보다 deferred를 우선한다.

```ts
function classifyDecisionStatus(text: string): DecisionStatus {
  if (/추후|나중|후순위|later|v2|다음 버전/.test(text)) {
    return "deferred";
  }

  if (/빼자|제외|하지 말자|안 넣자|drop|remove/.test(text)) {
    return "excluded";
  }

  if (/이걸로 하자|가자|확정|고정|잡고|링크로만/.test(text)) {
    return "confirmed";
  }

  return "candidate";
}
```

예시:

```text
"추후에 사용될 기능으로 빼자"
→ deferred

"아예 제외하자"
→ excluded
```

---

## 4.4 복합 decision clause splitter

복합 문장은 clause 단위로 쪼갠다.

```ts
const DECISION_CLAUSE_DELIMITERS = [
  ".",
  ",",
  "그리고",
  "일단",
  "대신",
  "그러면",
  "잡고",
  "빼자",
  "하고",
  "해서"
];
```

예시 입력:

```text
pdf 업로드하는건 일단 추후에 사용될 기능으로 빼자.
일단 링크로만 대화 내용 파악하는걸로 기술로 잡고,
서비스 일련의 과정 전체 기술 명세서를 만들어줘봐.
```

예시 출력:

```json
[
  {
    "type": "decision",
    "status": "deferred",
    "triggerPhrase": "pdf 업로드하는건 일단 추후에 사용될 기능으로 빼자"
  },
  {
    "type": "decision",
    "status": "confirmed",
    "triggerPhrase": "일단 링크로만 대화 내용 파악하는걸로 기술로 잡고"
  },
  {
    "type": "action",
    "actionType": "user_requested",
    "triggerPhrase": "서비스 일련의 과정 전체 기술 명세서를 만들어줘봐"
  }
]
```

---

## 4.5 assistant_suggestion candidate 처리

assistant_suggestion은 기본 Board에 넣지 않는다.

```ts
if decision.source === "assistant_suggestion" && !hasUserAcceptance(decision):
  decision.status = "candidate";
  decision.reviewRequired = true;
  decision.includeInDefaultBoard = false;
  decision.includeInKeyDecisionIds = false;
```

---

## 4.6 decision 추출 금지 영역

아래 영역에서는 decision 추출을 하지 않는다.

```ts
const IGNORE_DECISION_EXTRACTION_IN = [
  "code_block",
  "markdown_table",
  "json_schema",
  "typescript_type",
  "example_block",
  "rule_spec_document",
  "assistant_generated_artifact_body"
];
```

금지 예시:

```text
decisionStatus: "confirmed" | "rejected"
결정은 가능하면 user message에서만 확정합니다
보류된 내용
```

---

# 5. Action Extractor 수정 규칙

## 5.1 user_requested action 패턴

사용자가 assistant에게 직접 시킨 작업은 `user_requested`다.

```ts
const USER_REQUESTED_ACTION_PATTERNS = [
  /정리해줘/,
  /만들어줘/,
  /작성해줘/,
  /비교해줘/,
  /뽑아줘/,
  /분석해줘/,
  /검수해줘/,
  /제안해봐/,
  /채워넣어/,
  /진행해봐/,
  /확인해봐/,
  /다시 .* 만들어줘/,
  /내용 만들어봐/,
  /파일로 만들어/,
  /문서로 만들어/,
  /프롬프트 만들어줘/,
  /설계 진행해봐/
];
```

분류:

```ts
{
  actionType: "user_requested",
  assignee: "assistant"
}
```

---

## 5.2 team_next 패턴 강화

team_next는 사용자가 팀/프로젝트 차원의 다음 일을 말할 때만 생성한다.

```ts
const TEAM_NEXT_PATTERNS = [
  /우리가 해야 할 일/,
  /다음에 해야 할 것/,
  /팀은 .* 해야/,
  /개발해야 한다/,
  /구현해야 한다/,
  /테스트해야 한다/,
  /이후 구현은/,
  /다음 작업은/
];
```

단순 요청은 team_next가 아니다.

---

## 5.3 notAction 패턴

아래는 action으로 분류하지 않는다.

```ts
const NOT_ACTION_PATTERNS = [
  /범위가 너무 크다/,
  /궁금해/,
  /얘기를 해보자/,
  /가능한가/,
  /어때/,
  /모르겠어/,
  /생각한 아이디어는/,
  /그렇다면 이제/,
  /왜 안보여/,
  /뭐하냐/,
  /그렇게 해보자/
];
```

주의:

```text
"그래 그렇게 해보자"는 action이 아니라 acceptance phrase다.
```

---

## 5.4 action dedupe

동일 evidence + 동일 triggerPhrase면 하나만 남긴다.

```ts
const dedupeKey = `${evidenceMessageIndexes.join(",")}:${triggerPhrase}`;

if duplicate:
  prefer actionType = "user_requested" over "team_next";
```

예시:

```text
codex implementation plan.md 파일 만들자
```

잘못된 중복:

```json
[
  { "actionType": "user_requested" },
  { "actionType": "team_next" }
]
```

정답:

```json
[
  { "actionType": "user_requested" }
]
```

---

# 6. Acceptance Phrase 처리

## 6.1 수락 표현

```ts
const ACCEPTANCE_PATTERNS = [
  /좋아/,
  /맞아/,
  /응/,
  /오케이/,
  /ok/i,
  /ㅇㅋ/,
  /그걸로 하자/,
  /그렇게 하자/,
  /그래 그렇게 해보자/,
  /좋아 그렇게/,
  /맞아 그렇게/,
  /오케이 그렇게/
];
```

## 6.2 처리 규칙

```ts
if userMessage matches ACCEPTANCE_PATTERNS
  and previousAssistantMessage contains proposal:
    create satisfaction = "satisfied"
    create decision = {
      status: "confirmed",
      source: "accepted_assistant_suggestion",
      evidenceMessageIndexes: [previousAssistantIndex, userIndex]
    }
    do not create action from acceptance phrase itself
```

---

# 7. Open Question 수정 규칙

## 7.1 open question 패턴

```ts
const OPEN_QUESTION_PATTERNS = [
  /어떻게 .*까/,
  /가능할까/,
  /맞을까/,
  /좋을까/,
  /어때/,
  /의미가 없을 것 같은데/,
  /궁금해/,
  /되나/,
  /연동 되어있나/
];
```

---

## 7.2 correction/action 우선 규칙

수정 요청이나 작업 요청 패턴이 있으면 open question보다 우선한다.

```ts
const CORRECTION_OR_ACTION_PATTERNS = [
  /수정해야/,
  /바꿔야/,
  /고쳐줘/,
  /반영해서/,
  /다시 .* 만들어줘/,
  /실제 웹 서비스처럼/,
  /채워넣어/,
  /진행해봐/,
  /확인해봐/
];

if matches CORRECTION_OR_ACTION_PATTERNS:
  do not create openQuestion
```

---

## 7.3 resolved 상태 확장

`resolvedByDecisionId`만으로는 부족하다.

```ts
type OpenQuestionStatus =
  | "open"
  | "answered"
  | "resolved_by_user_decision"
  | "superseded_by_scope_change";
```

```ts
type OpenQuestionResolvedBy =
  | { type: "assistant_answer"; messageIndex: number }
  | { type: "user_decision"; decisionId: string }
  | { type: "superseded_by_scope_change"; decisionId: string };
```

예시:

```json
{
  "id": "oq_pdf_reading",
  "question": "PDF를 어떻게 잘 읽을지",
  "status": "superseded_by_scope_change",
  "resolvedBy": {
    "type": "superseded_by_scope_change",
    "decisionId": "pdf_upload_deferred"
  }
}
```

---

# 8. Satisfaction 수정 규칙

## 8.1 상태 확장

현재 상태:

```text
satisfied
partially_satisfied
dissatisfied
correction_requested
clarification_requested
continuing_without_clear_feedback
```

추가 필요 상태:

```ts
type SatisfactionStatus =
  | "satisfied"
  | "partially_satisfied"
  | "dissatisfied"
  | "correction_requested"
  | "clarification_requested"
  | "problem_reported"
  | "task_failed"
  | "direction_changed"
  | "alternative_proposed"
  | "new_requirement_added"
  | "meta_request"
  | "topic_shift"
  | "continuing_without_clear_feedback";
```

---

## 8.2 task_failed / problem_reported 패턴

```ts
const TASK_FAILED_PATTERNS = [
  /왜 안보여/,
  /안 보이/,
  /안 돼/,
  /못만드냐/,
  /뭐하냐/,
  /반영이 안/,
  /작동 안/,
  /실패/,
  /안 됨/
];
```

예시:

```text
뭐하냐 왜 못만드냐
→ task_failed + dissatisfied

왜 안보여지지?
→ problem_reported + task_failed
```

---

## 8.3 direction_changed 패턴

```ts
const DIRECTION_CHANGED_PATTERNS = [
  /그냥 웹으로/,
  /실제 웹으로/,
  /이렇게 만드는 것보다/,
  /전환하는게/,
  /나을 수도/,
  /방향을 바꾸자/
];
```

예시:

```text
실제 웹으로 더 개발하는게 나을 수도 있겠다.
→ direction_changed
```

---

## 8.4 alternative_proposed 패턴

```ts
const ALTERNATIVE_PROPOSED_PATTERNS = [
  /이 방식은 어때/,
  /이 구조로 .* 가능한가/,
  /대신 .* 하면/,
  /다른 방식/,
  /이렇게 하면/
];
```

예시:

```text
이 구조로 gpt의 공유하기로 얻은 링크를 가지고 대화 내용 분석도 가능한가봐. 이 방식을 쓰는건 어때?
→ alternative_proposed
```

---

## 8.5 conflicting satisfaction 처리

여러 status가 동시에 잡히면 기본 summary에 반영하지 않는다.

```ts
if secondaryStatuses.length >= 2:
  confidence = Math.min(confidence, 0.4)
  reviewRequired = true
  excludeFromSatisfactionSummary = true
```

---

# 9. Topic Flow 수정 규칙

## 9.1 topic label 생성 원칙

```ts
topicLabel = extractMainObject(userMessage) + extractSpeechAct(userMessage)
```

예시:

```text
"pdf말고 이렇게 링크로 주는게 분석하기가 더 편하려나?"
→ "PDF vs 공유 링크 입력 방식 검토"

"이 방식을 쓰는건 어때?"
→ "공유 링크 HTML payload 복원 방식 검토"

"세부 규칙을 만들어줘"
→ "MockExtractor 세부 룰 설계"

"figma 화면 설계 진행해봐"
→ "Figma 화면 설계 진행"

"왜 안보여지지?"
→ "Figma 반영 실패 확인"

"실제 웹으로 더 개발하는게 나을 수도 있겠다"
→ "웹 MVP 전환 검토"

"공공데이터 포털에 api 신청하려고"
→ "공공데이터 API 신청서 작성"
```

---

## 9.2 금지 fallback label

아래 label은 기본적으로 금지한다.

```text
구현
수정
문서화
검토
분석
진행
구조화 결과 구현
구조화 결과 수정
공유 링크 분석
```

이런 label은 fallback으로만 사용하고, 가능하면 구체 명사구를 포함해야 한다.

---

## 9.3 tool operation 구간 topic 분리 금지

tool operation만 연속되는 구간은 topic으로 만들지 않는다.

```ts
if topic contains only context_signal messages:
  do not create topic
```

---

# 10. Preference 수정 규칙

## 10.1 Preference는 답변/결과물 조건에 한정

Preference로 추출 가능한 것:

```text
- 답변 형식
- 문서 형식
- 길이/상세도
- 톤/표현
- 포함/제외 조건
- 반복적으로 강화된 결과물 조건
```

Preference로 추출하면 안 되는 것:

```text
- 제품 기능 결정
- 입력 방식 결정
- 기술 방향 결정
- 사용자가 제공한 예시 문장
- 문서 안의 샘플 문장
- action 요청 자체
```

---

## 10.2 format preference 패턴

```ts
const FORMAT_PREFERENCE_PATTERNS = [
  /\.md/,
  /markdown/i,
  /md파일/,
  /노션에 넣을/,
  /표로/,
  /JSON으로/,
  /문서로/,
  /파일로/,
  /코드블록으로/
];
```

정답 예시:

```text
노션에 넣을 수 있는 md파일로 만들어줘
.md파일로 만들어줘
```

---

## 10.3 depth preference 패턴

```ts
const DEPTH_PREFERENCE_PATTERNS = [
  /구체적으로/,
  /자세히/,
  /기술적으로/,
  /구분해줘/,
  /단계별/,
  /실행 가능하게/,
  /개발하기엔 문제가 없겠지/,
  /완료 기준/,
  /구현 순서/
];
```

---

## 10.4 avoidance preference 패턴

```ts
const AVOIDANCE_PREFERENCE_PATTERNS = [
  /빼고/,
  /제외/,
  /하지 말고/,
  /필요 없어/,
  /안할거야/,
  /말고/
];
```

주의:

```text
"pdf말고 링크로"는 preference라기보다 input method decision/change로 볼 가능성이 높다.
```

---

## 10.5 triggerPhrase span 원칙

```ts
triggerPhrase = matchedRegexSpan ± 20 chars
```

잘못된 예:

```text
format preference triggerPhrase = "지금 우리 팀에는 문서처리"
```

올바른 예:

```text
format preference triggerPhrase = "노션에 넣을 수 있는 md파일로 만들어줘"
```

---

## 10.6 clause split

하나의 user message에서 여러 기능을 분리한다.

예시:

```text
외국인 포인트 넣고
이 포인트들 반영해서
기획안 다시 만들어줘
노션에 넣을 수 있는 md파일로 만들어줘
```

분해:

```json
[
  {
    "type": "content_constraint",
    "triggerPhrase": "외국인 포인트 넣고"
  },
  {
    "type": "action",
    "triggerPhrase": "기획안 다시 만들어줘"
  },
  {
    "type": "preference",
    "category": "format",
    "triggerPhrase": "노션에 넣을 수 있는 md파일로 만들어줘"
  }
]
```

---

# 11. Overview 생성 수정 규칙

## 11.1 마지막 user message에 과도하게 끌리지 않기

현재 overview가 마지막 요청에 치우치는 문제가 있다.

특히 다음 메시지는 전체 overview의 core intent로 쓰면 안 된다.

```text
- example-like message
- rule spec request
- 긴 출력 형식 지시문
- 마지막 국소 요청
```

---

## 11.2 overview 가중치

```ts
overview.mainSubject =
  weightedSummary(
    firstUserIntent,
    highConfidenceConfirmedDecisions,
    recurringTopicLabels,
    latestNonMetaTopic
  )
```

가중치 예시:

```ts
const OVERVIEW_WEIGHTS = {
  firstUserIntent: 0.35,
  confirmedDecisions: 0.30,
  recurringTopics: 0.20,
  latestNonMetaTopic: 0.10,
  latestMetaRequest: 0.05
};
```

---

## 11.3 example-like / meta request 제외

```ts
if message.hasWarning("EXAMPLE_TEXT_DETECTED")
  or message.isMetaInstruction
  or message.containsManySectionLabels:
    do not use as overview.userCoreIntent
```

---

# 12. Review Queue / UI 정책

## 12.1 Main Board 포함 조건

Main Board에는 아래 조건을 만족하는 항목만 노출한다.

```ts
includeInMainBoard =
  confidence >= 0.75 &&
  source in ["explicit_user", "accepted_assistant_suggestion"] &&
  !reviewRequired &&
  !isExampleDerived;
```

---

## 12.2 Review Queue 이동 조건

아래 항목은 Review Queue로 보낸다.

```ts
if confidence < 0.7:
  reviewRequired = true

if source === "assistant_suggestion":
  reviewRequired = true

if status === "candidate":
  reviewRequired = true

if message.hasWarning("EXAMPLE_TEXT_DETECTED"):
  reviewRequired = true

if secondaryStatuses.length >= 2:
  reviewRequired = true

if evidence is context_signal only:
  reviewRequired = true

if triggerPhrase from code block/table/schema/example:
  reviewRequired = true
```

---

## 12.3 example-derived 정책

```ts
if message.hasWarning("EXAMPLE_TEXT_DETECTED"):
  allowTypes = ["user_requested_action", "topic"]
  blockTypes = ["preference", "decision", "satisfaction"]
  confidenceCap = 0.35
  includeInMainBoard = false
```

---

## 12.4 UI 표시 방식

Main Board:

```text
- confirmed decision
- deferred decision
- excluded decision
- user_requested action
- answered/open question
```

Review Queue:

```text
- candidate decision
- assistant_suggestion
- low-confidence item
- example-derived item
- multi-status satisfaction
- weak evidence item
```

각 항목에는 반드시 아래를 표시한다.

```text
- triggerPhrase
- evidenceMessageIndexes
- source type
- confidence
- reviewRequired reason
```

---

# 13. Canonical Message Schema 제안

```ts
type CanonicalMessage = {
  messageIndex: number;
  role: "user" | "assistant" | "tool" | "system" | "internal";
  category:
    | "clean_conversation"
    | "context_signal"
    | "excluded_internal";

  visibility: "user_visible" | "not_user_visible" | "unknown";

  contentType:
    | "plain_text"
    | "markdown"
    | "json_tool_call"
    | "bash"
    | "python"
    | "html_code"
    | "artifact_delivery"
    | "plugin_result"
    | "redacted_plugin_result"
    | "internal";

  semanticAnalyzable: boolean;

  assistantMessageType?:
    | "final_answer"
    | "partial_answer"
    | "final_answer_with_artifact"
    | "tool_operation"
    | "tool_result";

  contextSignalType?: ContextSignalType;

  text: string;

  sourceRefs?: {
    type: "citation" | "sandbox_file" | "url" | "connector";
    value: string;
  }[];

  warnings?: string[];
};
```

---

# 14. Board Item Schema 제안

## 14.1 Decision

```ts
type Decision = {
  id: string;
  title: string;
  description: string;
  status: "confirmed" | "deferred" | "excluded" | "candidate" | "replaced";
  source:
    | "explicit_user"
    | "accepted_assistant_suggestion"
    | "assistant_suggestion"
    | "inferred";

  triggerPhrase: string;
  evidenceMessageIndexes: number[];

  confidence: number;
  reviewRequired: boolean;
  includeInMainBoard: boolean;
  includeInKeyDecisionIds: boolean;

  replacesDecisionId?: string;
  relatedActionIds?: string[];
  relatedTopicIds?: string[];

  rulesMatched: string[];
};
```

## 14.2 Action

```ts
type Action = {
  id: string;
  title: string;
  description: string;

  actionType:
    | "user_requested"
    | "assistant_suggested_next_step"
    | "team_next";

  assignee: "assistant" | "user" | "team" | "unknown";
  status: "requested" | "completed" | "blocked" | "suggested";

  triggerPhrase: string;
  evidenceMessageIndexes: number[];

  confidence: number;
  reviewRequired: boolean;
  includeInMainBoard: boolean;

  rulesMatched: string[];
};
```

## 14.3 Open Question

```ts
type OpenQuestion = {
  id: string;
  question: string;
  description: string;

  status:
    | "open"
    | "answered"
    | "resolved_by_user_decision"
    | "superseded_by_scope_change";

  triggerPhrase: string;
  evidenceMessageIndexes: number[];

  resolvedBy?:
    | { type: "assistant_answer"; messageIndex: number }
    | { type: "user_decision"; decisionId: string }
    | { type: "superseded_by_scope_change"; decisionId: string };

  confidence: number;
  reviewRequired: boolean;
};
```

## 14.4 Satisfaction

```ts
type SatisfactionSignal = {
  id: string;

  assistantMessageIndex: number;
  userReactionMessageIndex: number | null;

  status: SatisfactionStatus;
  secondaryStatuses?: SatisfactionStatus[];

  rationale: string;
  evidenceMessageIndexes: number[];

  confidence: number;
  reviewRequired: boolean;
  excludeFromSummary: boolean;

  rulesMatched: string[];
};
```

---

# 15. Implementation Checklist

## Phase 1 — Parser / Normalizer

```text
[ ] HARD_EXCLUDE_FROM_CLEAN 적용
[ ] Figma connector tool call 감지
[ ] skill:// read call 감지
[ ] redacted plugin output 감지
[ ] bash/python/html artifact generation code 감지
[ ] assistant final answer with artifact 복구
[ ] contextSignalType 세분화
[ ] semanticAnalyzable 필드 추가
```

## Phase 2 — Decision / Action / Open Question

```text
[ ] clause splitter 추가
[ ] deferred vs excluded 우선순위 수정
[ ] confirmed decision explicit_user 우선 적용
[ ] accepted_assistant_suggestion 처리
[ ] assistant_suggestion candidate Main Board 제외
[ ] user_requested vs team_next 룰 수정
[ ] acceptance phrase action 생성 방지
[ ] open question answered/superseded 상태 추가
```

## Phase 3 — Satisfaction / Preference / Topic

```text
[ ] task_failed / problem_reported satisfaction 상태 추가
[ ] direction_changed 상태 추가
[ ] alternative_proposed 상태 추가
[ ] multi-status satisfaction Review Queue 이동
[ ] topic label generic fallback 금지
[ ] preference triggerPhrase span 기반 추출
[ ] content_constraint와 preference 분리
```

## Phase 4 — UI / Review Queue

```text
[ ] Main Board / Review Queue 분리
[ ] low-confidence 기본 숨김
[ ] example-derived 기본 숨김
[ ] candidate decision 기본 숨김
[ ] reviewRequiredReason 표시
[ ] triggerPhrase + evidence quote 함께 표시
```

---

# 16. Acceptance Criteria

## Parser Acceptance Criteria

```text
1. Clean Conversation에는 user message와 assistant final answer만 남아야 한다.
2. search/open/click/find/pointer JSON은 Context Signal로 분류된다.
3. bash/python/file write/HTML generation code는 Context Signal로 분류된다.
4. Figma connector tool call과 skill read는 Context Signal로 분류된다.
5. redacted plugin output은 Context Signal로 분류된다.
6. artifact delivery final answer는 Clean Conversation으로 복구된다.
```

## Extractor Acceptance Criteria

```text
1. #70 같은 복합 문장에서 deferred, confirmed, action이 모두 분리된다.
2. "추후에 사용될 기능으로 빼자"는 excluded가 아니라 deferred로 분류된다.
3. assistant_suggestion candidate는 기본 Board에 보이지 않는다.
4. "figma 화면 설계 진행해봐"는 user_requested action이다.
5. "그래 그렇게 해보자"는 action이 아니라 accepted decision이다.
6. "다시 html 파일 만들어줘"는 open question이 아니라 user_requested action이다.
7. "뭐하냐 왜 못만드냐"는 clarification이 아니라 task_failed/dissatisfied다.
8. "실제 웹으로 더 개발하는게 나을 수도 있겠다"는 direction_changed다.
9. Preference triggerPhrase는 실제 regex matched span이어야 한다.
10. low-confidence / example-derived 항목은 Review Queue로 이동한다.
```

---

# 17. 최종 개발 우선순위 요약

```text
1. Clean Conversation hard filter 수정
2. assistant final answer 복구 룰 추가
3. Context Signal type 세분화
4. 복합 decision clause splitter 추가
5. confirmed/deferred/excluded/candidate 상태 우선순위 수정
6. assistant_suggestion candidate 기본 Board 제외
7. user_requested / team_next / acceptance phrase 분리
8. Open Question answered/superseded 상태 추가
9. Satisfaction 상태 확장
10. Preference triggerPhrase span 기반 추출
11. Topic label generator 개선
12. Main Board / Review Queue 분리
```

---

# 18. 요약

현재 반복되는 문제의 본질은 다음이다.

```text
Parser가 user-visible conversation과 tool operation을 완전히 분리하지 못하고,
Extractor가 문장 기능을 보지 않고 keyword만 보고 decision/action/preference를 생성한다.
```

따라서 수정 방향은 명확하다.

```text
Rule 1. Clean Conversation은 더 엄격하게.
Rule 2. assistant final answer는 복구 가능하게.
Rule 3. 의미 추출은 clause 단위로.
Rule 4. decision은 user confirmation 중심으로.
Rule 5. action은 문장 기능 기준으로.
Rule 6. low-confidence는 Review Queue로.
```

이 수정이 적용되면 TIV의 Sprint 3 MockExtractor는 완벽한 의미 분석은 아니더라도, 검수 가능한 70점짜리 구조화 결과에 훨씬 가까워질 수 있다.
