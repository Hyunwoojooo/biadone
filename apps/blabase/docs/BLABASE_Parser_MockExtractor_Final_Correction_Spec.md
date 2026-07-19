# blabase Parser / MockExtractor 최종 수정 명세

> 대상: ChatGPT 공유 대화를 파싱·구조화하는 blabase Sprint 4.5~5
> 기준 샘플: JARVIS Context Mapper 대화, RouteLog/Figma 대화, 최신 GPT Audit 결과  
> 목적: 규칙 기반 MockExtractor의 반복 오판을 제거하고, LLMExtractor 도입 전 안정적인 80점대 구조화 결과를 만든다.

---

## 0. 최종 결론

현재 blabase는 다음 영역까지는 의미 있는 개선이 이루어졌다.

- Search query, pointer, open, bash 실행을 Context Signal로 분리
- artifact 전달형 assistant final answer를 Clean Conversation에 유지
- 중복 user message와 중복 topic 일부 병합
- low-confidence satisfaction을 Main Board에서 제외
- 복합 발화에서 일부 confirmed decision과 action을 분리

그러나 다음 문제는 실제 제품 신뢰도를 직접 훼손하므로 Sprint 4.5에서 반드시 수정해야 한다.

1. 같은 문장이 `deferred`와 `excluded` decision으로 동시에 생성됨
2. pain point·설명문이 Open Question으로 추출됨
3. Preference evidence가 관련 없는 메시지까지 합쳐져 confidence가 과대 계산됨
4. 명시적 user action이 누락되거나 `team_next`로 오분류됨
5. assistant의 짧은 전환 문장이 질문의 해결 답변으로 연결됨
6. Overview가 첫 사용자 의도 대신 중간·마지막 요청에 끌림
7. tool/plugin 실행 로그와 실제 assistant final answer 분리가 샘플별로 흔들림
8. example/rule-spec 메시지에서 preference·decision·satisfaction이 과잉 추출됨

최종 목표 구조는 다음과 같다.

```text
Source Adapter
→ Canonical Message Normalizer
→ Rule-based Guardrail
→ Clause / Speech-Act Extractor
→ Conflict & Evidence Validator
→ Main Board / Review Queue
→ GPT Audit Export
```

---

# 1. 최종 수정 우선순위

## P0 — Sprint 4.5 필수 수정

### P0-1. Clean Conversation hard filtering

Clean Conversation에는 아래만 남긴다.

```text
- 실제 user message
- 사용자에게 노출된 assistant final answer
- 사용자에게 노출된 artifact 전달 완료 답변
```

아래는 모두 Context Signal 또는 Excluded/Internal로 보낸다.

```text
- search/open/click/find/pointer JSON
- bash/python/file write 로그
- 전체 HTML/Markdown 생성 코드
- connector discovery call
- skill:// read call
- plugin redacted result
- 내부 reasoning placeholder
```

### P0-2. assistant final answer 복구

아래 메시지는 tool 흔적이 아니라 Clean Conversation의 assistant final answer다.

```text
완료했습니다. 파일은 여기서 받을 수 있습니다.
시작은 가능합니다. 다만 ...
수정 반영해서 새 HTML 파일로 만들었습니다.
실제 웹 MVP로 전환하는 방향이 더 낫습니다.
```

`sandbox:/mnt/data/...` 링크가 포함되어 있다는 이유만으로 Context Signal로 보내면 안 된다.

### P0-3. Decision 충돌 제거

같은 `triggerPhrase + evidenceMessageIndexes`에서 여러 status가 생성되면 충돌 해소 규칙을 적용한다.

우선순위:

```text
deferred marker 존재 → deferred
명시적 영구 제외 marker 존재 → excluded
명시적 확정 marker 존재 → confirmed
그 외 → candidate
```

대표 정답:

```text
“PDF 업로드는 일단 추후 기능으로 빼자”
→ deferred

“PDF 업로드는 아예 넣지 말자”
→ excluded
```

### P0-4. false Open Question 제거

다음은 질문이 아니다.

```text
내가 이전 대화에 궁금한 게 있어서 또 프롬프트를 입력했는데...
html 파일을 봤는데 수정해야 할 부분이 있겠다.
개발 구현 범위가 너무 크다.
```

각각 다음으로 분류한다.

```text
pain point / problem signal
correction request + action
background / problem statement
```

### P0-5. Preference evidence span 검증

Preference는 해당 rule이 실제 매칭된 메시지만 evidence로 인정한다.

예:

```text
“.md파일로 만들어줘”
→ format preference

“만든 .md 파일 2개만 있어도 개발 가능하겠지?”
→ artifact reference, format preference 아님

“curl로 HTML을 내려받고...”
→ format preference 아님
```

### P0-6. 명시적 Action 누락·오분류 수정

다음은 반드시 `user_requested / assistant` action이다.

```text
다시 기획안 최종본을 만들어봐.
figma 화면 설계 진행해봐.
연결됐는지 확인해봐.
다시 HTML 파일 만들어줘.
개발 프롬프트 만들어줘.
```

다음은 action이 아니다.

```text
그래 그렇게 해보자.
그렇다면 이제 개발 얘기를 해보자.
개발 구현 범위가 너무 크다.
```

### P0-7. resolvedBy는 실제 상세 답변에 연결

질문 직후의 짧은 preamble이 아니라, 질문을 실질적으로 해결한 assistant final answer를 연결한다.

예:

```text
#44: PDF 읽기·파싱·맥락·그래프 기술 질문
#45: “좋습니다. 나눠 보겠습니다.” → preamble
#54: 상세 기술 답변 → resolvedBy 대상
```

### P0-8. Overview root intent 복구

첫 번째 실제 제품 아이디어/문제 정의 메시지를 meta로 제외하면 안 된다.

예:

```text
#1: JARVIS 전체 대신 GPT 대화 구조화 MVP를 만들고 싶다는 제품 출발점
→ root intent

#99: MockExtractor 룰과 출력 형식 요청
→ latest meta request
```

---

## P1 — Sprint 5 구조 개선

1. `ProblemSignal` 타입 신설
2. `ContentConstraint` 타입 세분화
3. Decision `conflictGroup` / `mutuallyExclusiveGroup` 도입
4. Overview 다중 근거 가중치 적용
5. Action 완료 여부 검증기 추가
6. Topic label 생성기 개선
7. GPT Audit Export에 rule trace와 conflict diagnostics 추가

---

## P2 — LLMExtractor 이후 처리

1. 긴 사용자 발화의 핵심 의도 요약
2. Preference / Content Constraint / Problem Signal 의미 구분
3. Satisfaction nuance 분류
4. 자연스러운 Topic label 생성
5. 복합 발화의 의미 기반 clause segmentation
6. Evidence가 실제 추출 내용을 지지하는지 검증
7. 대화 간 반복 선호와 장기 패턴 병합

---

# 2. Parser / Canonical Normalizer 최종 규칙

## 2.1 Canonical Message Schema

```ts
type CanonicalMessage = {
  messageIndex: number;

  role:
    | "user"
    | "assistant"
    | "tool"
    | "system"
    | "internal";

  category:
    | "clean_conversation"
    | "context_signal"
    | "excluded_internal";

  visibility:
    | "user_visible"
    | "not_user_visible"
    | "unknown";

  contentType:
    | "plain_text"
    | "markdown"
    | "json_tool_call"
    | "bash"
    | "python"
    | "html_code"
    | "artifact_delivery"
    | "connector_call"
    | "connector_result"
    | "redacted_plugin_result"
    | "internal";

  assistantMessageType?:
    | "final_answer"
    | "transition"
    | "final_answer_with_artifact"
    | "tool_operation"
    | "tool_result";

  semanticAnalyzable: boolean;
  text: string;

  sourceRefs?: Array<{
    type: "citation" | "sandbox_file" | "url" | "connector";
    value: string;
  }>;

  warnings?: string[];
};
```

## 2.2 Clean Conversation 포함 기준

```ts
function shouldIncludeInClean(message: CanonicalMessage): boolean {
  if (message.role === "user" && message.visibility === "user_visible") {
    return true;
  }

  if (
    message.role === "assistant" &&
    message.visibility === "user_visible" &&
    ["final_answer", "final_answer_with_artifact"].includes(
      message.assistantMessageType ?? ""
    )
  ) {
    return true;
  }

  return false;
}
```

## 2.3 Hard Exclude 패턴

```ts
const HARD_EXCLUDE_FROM_CLEAN = [
  /^bash -lc/,
  /^python(?:3)?\b/,
  /^from pathlib import Path/,
  /^html\s*=\s*r?'''/,
  /^cat\s*>\s*\/mnt\/data/,
  /^ls\s+-(?:la|R)/,

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

분류:

```ts
{
  category: "context_signal",
  semanticAnalyzable: false
}
```

## 2.4 Context Signal 타입

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
  | "skill_read";
```

`other_tool_call`은 폐기하고 가능한 한 위 타입으로 세분화한다.

## 2.5 assistant final answer 복구

```ts
const FINAL_ANSWER_MARKERS = [
  /완료했습니다/,
  /완성했습니다/,
  /만들었습니다/,
  /만들었어/,
  /정리했습니다/,
  /시작은 가능합니다/,
  /수정 반영/,
  /파일 다운로드/,
  /ZIP 다운로드/,
  /다운로드/,
  /실행 방법/,
  /이번 버전/,
  /다음 작업/
];

function restoreAssistantFinalAnswer(text: string): boolean {
  return (
    FINAL_ANSWER_MARKERS.some((r) => r.test(text)) &&
    !HARD_EXCLUDE_FROM_CLEAN.some((r) => r.test(text))
  );
}
```

---

# 3. Clause / Speech Act 분리

하나의 user message 안에서 다음 기능을 별도 clause로 나눈다.

```text
- decision
- action
- preference
- content constraint
- problem signal
- open question
- acceptance
```

## 3.1 대표 복합 발화

입력:

```text
PDF 업로드는 일단 추후 기능으로 빼자.
링크로만 대화 내용을 파악하는 것으로 기술 방향을 잡고,
서비스 전체 기술 명세서를 만들어줘.
```

출력:

```json
[
  {
    "type": "decision",
    "status": "deferred",
    "triggerPhrase": "PDF 업로드는 일단 추후 기능으로 빼자"
  },
  {
    "type": "decision",
    "status": "confirmed",
    "triggerPhrase": "링크로만 대화 내용을 파악하는 것으로 기술 방향을 잡고"
  },
  {
    "type": "action",
    "actionType": "user_requested",
    "triggerPhrase": "서비스 전체 기술 명세서를 만들어줘"
  }
]
```

## 3.2 여행 기획 복합 발화

입력:

```text
외국인 포인트 넣고,
이 포인트들을 반영해서 기획안 다시 만들어줘.
노션에 넣을 수 있는 md 파일로 만들어줘.
```

출력:

```json
[
  {
    "type": "content_constraint",
    "constraintType": "include_requirement",
    "triggerPhrase": "외국인 포인트 넣고"
  },
  {
    "type": "action",
    "actionType": "user_requested",
    "triggerPhrase": "기획안 다시 만들어줘"
  },
  {
    "type": "preference",
    "category": "format",
    "triggerPhrase": "노션에 넣을 수 있는 md 파일로 만들어줘"
  }
]
```

---

# 4. Decision 최종 규칙

## 4.1 상태 정의

```ts
type DecisionStatus =
  | "confirmed"
  | "deferred"
  | "excluded"
  | "candidate"
  | "replaced";
```

## 4.2 status 우선순위

```ts
function classifyDecisionStatus(text: string): DecisionStatus {
  if (/추후|나중|후순위|later|v2|다음 버전/.test(text)) {
    return "deferred";
  }

  if (/아예 제외|영구 제외|하지 않기로|안 넣기로|폐기|제거/.test(text)) {
    return "excluded";
  }

  if (
    /이걸로 하자|그걸로 하자|이 방향으로 가자|확정|고정|기술로 잡고|링크로만|웹으로 전환/.test(
      text
    )
  ) {
    return "confirmed";
  }

  return "candidate";
}
```

`빼자`만으로 excluded를 만들지 않는다. `추후 + 빼자`는 deferred다.

## 4.3 Decision dedupe / conflict rule

```ts
const decisionDedupeKey = [
  normalizedTriggerPhrase,
  ...evidenceMessageIndexes
].join(":");
```

동일 key에서 여러 status가 발생하면:

```text
1. status priority rule 재적용
2. 하나만 Main Board에 유지
3. 나머지는 제거하거나 conflict diagnostic으로 기록
```

## 4.4 assistant suggestion 처리

```ts
if (
  decision.source === "assistant_suggestion" &&
  !hasExplicitUserAcceptance
) {
  decision.status = "candidate";
  decision.reviewRequired = true;
  decision.includeInMainBoard = false;
  decision.includeInKeyDecisionIds = false;
}
```

## 4.5 Acceptance phrase

```ts
const ACCEPTANCE_PATTERNS = [
  /^좋아/,
  /^맞아/,
  /^응/,
  /^오케이/,
  /^ok\b/i,
  /그걸로 하자/,
  /그렇게 하자/,
  /그래 그렇게 해보자/
];
```

직전 assistant가 방향을 제안했고 user가 수락하면:

```json
{
  "status": "confirmed",
  "source": "accepted_assistant_suggestion",
  "evidenceMessageIndexes": [
    "previousAssistantIndex",
    "userIndex"
  ]
}
```

수락 표현 자체는 Action으로 만들지 않는다.

---

# 5. Action 최종 규칙

## 5.1 user_requested

```ts
const USER_REQUESTED_ACTION_PATTERNS = [
  /정리해줘/,
  /만들어줘/,
  /작성해줘/,
  /비교해줘/,
  /분석해줘/,
  /검수해줘/,
  /제안해봐/,
  /채워넣어/,
  /진행해봐/,
  /확인해봐/,
  /다시 .* 만들어/,
  /내용 만들어봐/,
  /프롬프트 만들어줘/,
  /설계 진행해봐/
];
```

## 5.2 team_next

```ts
const TEAM_NEXT_PATTERNS = [
  /우리가 다음에 해야 할/,
  /팀은 .* 해야/,
  /개발팀이 .* 구현/,
  /다음 Sprint에서/,
  /이후 구현해야/,
  /테스트해야 한다/
];
```

사용자가 assistant에게 직접 명령하면 `team_next`가 아니다.

## 5.3 Action 누락 방지 fixture

다음 메시지는 반드시 action으로 생성되어야 한다.

```text
#24 다시 기획안 최종본을 만들어봐.
→ user_requested / assistant

#31 기획단에 필요한 내용만 .md 파일로 만들어줘.
→ user_requested / assistant

#63 Figma 화면 설계 진행해봐.
→ user_requested / assistant

#116 연결됐는지 확인해봐.
→ user_requested / assistant

#173 다시 HTML 파일 만들어줘.
→ user_requested / assistant
```

## 5.4 Action dedupe

같은 evidence + triggerPhrase에서 `user_requested`와 `team_next`가 모두 나오면 `user_requested`만 유지한다.

---

# 6. Open Question / Problem Signal 최종 규칙

## 6.1 Open Question 조건

다음 중 하나 이상을 충족해야 한다.

```text
- 명시적 물음표
- 어떻게/왜/무엇/가능할까/할까/되나
- 불확실성에 대한 직접 질문
```

## 6.2 false positive 방지

```ts
const PAIN_POINT_PATTERNS = [
  /어려움/,
  /불편/,
  /반복/,
  /문제/,
  /페인 포인트/,
  /힘들/,
  /복잡해/
];

const QUESTION_PATTERNS = [
  /\?/,
  /어떻게/,
  /왜/,
  /무엇/,
  /가능할까/,
  /할까/,
  /되나/,
  /생각하냐/
];

if (
  PAIN_POINT_PATTERNS.some((r) => r.test(text)) &&
  !QUESTION_PATTERNS.some((r) => r.test(text))
) {
  classifyAs = "problem_signal";
}
```

## 6.3 ProblemSignal Schema

```ts
type ProblemSignal = {
  id: string;
  title: string;

  category:
    | "pain_point"
    | "workflow_friction"
    | "product_problem"
    | "task_failure";

  triggerPhrase: string;
  evidenceMessageIndexes: number[];
  confidence: number;
};
```

예:

```text
“이전 대화가 궁금해서 다시 질문하면 대화가 더 쌓이고 복잡해진다”
→ workflow_friction

“왜 안 보여지지?”
→ task_failure / problem_reported
```

## 6.4 resolvedBy 상세 답변 선택

```ts
type AnswerStrength =
  | "preamble"
  | "partial"
  | "full";
```

선택 우선순위:

```text
full answer > partial answer > preamble
```

preamble 판정 예:

```text
좋습니다. 이제 나눠 보겠습니다.
확인해 보겠습니다.
다음 구조로 정리하겠습니다.
```

이런 메시지는 단독 resolvedBy로 사용하지 않는다.

## 6.5 Open Question 상태

```ts
type OpenQuestionStatus =
  | "open"
  | "answered"
  | "resolved_by_user_decision"
  | "superseded_by_scope_change";
```

---

# 7. Preference / Content Constraint 최종 규칙

## 7.1 Preference 정의

Preference는 “답변이나 결과물을 어떤 방식으로 받고 싶은지”를 나타낸다.

```text
- format
- length
- tone
- language_expression
- specificity_depth
- avoidance
```

제품 기능, 입력 방식, 기술 방향은 Preference가 아니라 Decision 또는 Content Constraint다.

## 7.2 Format Preference

```ts
const FORMAT_PREFERENCE_PATTERNS = [
  /\.md/,
  /markdown/i,
  /마크다운/,
  /노션에 넣을/,
  /표로/,
  /JSON으로/,
  /문서로/,
  /파일로/,
  /코드블록으로/
];
```

## 7.3 evidence 검증

```ts
function acceptsPreferenceEvidence(
  message: CanonicalMessage,
  matchedRegex: RegExp
): boolean {
  return matchedRegex.test(message.text);
}
```

evidence에 포함된 모든 message는 해당 regex를 실제로 포함해야 한다.

## 7.4 triggerPhrase

```ts
triggerPhrase = exactMatchedSpan;
```

필요 시 문맥은 최대 좌우 20자로 제한한다.

잘못된 예:

```text
format triggerPhrase:
“지금 우리 팀에는 문서처리”
```

올바른 예:

```text
“.md파일로 만들어줘”
“노션에 넣을 수 있는 md 파일로 만들어줘”
```

## 7.5 ContentConstraint 세분화

```ts
type ContentConstraintType =
  | "include_requirement"
  | "exclude_requirement"
  | "output_scope"
  | "domain_requirement"
  | "implementation_constraint";
```

예:

```text
“외국인 포인트 넣고”
→ include_requirement

“어떻게 만드는지는 빼고 기획단에 필요한 내용만”
→ exclude_requirement + output_scope

“실제 웹 서비스처럼”
→ implementation_constraint / output_quality_constraint
```

pain point는 Content Constraint로 보내지 않고 ProblemSignal로 보낸다.

---

# 8. Satisfaction 최종 규칙

## 8.1 pairing 기준

```text
assistant의 가장 가까운 user-visible final answer
→ 바로 다음 user message
```

중간 tool operation, search, connector result는 pairing 대상에서 제외한다.

## 8.2 상태

```ts
type SatisfactionStatus =
  | "satisfied"
  | "partially_satisfied"
  | "dissatisfied"
  | "correction_requested"
  | "clarification_requested"
  | "alternative_proposed"
  | "new_requirement_added"
  | "problem_reported"
  | "task_failed"
  | "direction_changed"
  | "topic_shift"
  | "meta_request"
  | "continuing_without_clear_feedback";
```

## 8.3 주요 패턴

```ts
const SATISFIED = [
  /좋아/,
  /오케이/,
  /^ok\b/i,
  /맞아/,
  /그렇게 하자/
];

const PARTIAL_OR_CORRECTION = [
  /좋은데/,
  /다만/,
  /근데/,
  /그런데/,
  /수정/,
  /다시/
];

const TASK_FAILED = [
  /왜 안보여/,
  /못만드냐/,
  /뭐하냐/,
  /안 돼/,
  /반영이 안/,
  /작동 안/
];

const DIRECTION_CHANGED = [
  /그냥 웹으로/,
  /실제 웹으로/,
  /이렇게 만드는 것보다/,
  /나을 수도/,
  /방향을 바꾸/
];
```

## 8.4 multi-status 처리

```ts
if ((secondaryStatuses?.length ?? 0) >= 2) {
  confidence = Math.min(confidence, 0.4);
  reviewRequired = true;
  includeInMainBoard = false;
  excludeFromSummary = true;
}
```

---

# 9. Topic Flow 최종 규칙

## 9.1 label 생성

```text
핵심 객체 + 발화 기능
```

예:

```text
JARVIS Context Mapper 초기 MVP 구상
Timeline / Ask 기능 제외 검토
기획용 Markdown 문서 작성
PDF vs 공유 링크 입력 방식 검토
공유 링크 HTML payload 복원 검토
링크 기반 v0.1 범위 확정
Codex 개발 가능성 검토
MockExtractor 세부 룰 설계
Figma 화면 설계 진행
Figma 반영 실패 확인
웹 MVP 전환 검토
```

## 9.2 금지 label

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

## 9.3 meta topic 처리

meta/rule-spec 요청은 별도 topic으로 생성할 수 있지만:

```text
- 전체 Overview를 덮어쓰지 않음
- root intent로 사용하지 않음
- preference/decision/satisfaction 추출은 제한
```

---

# 10. Overview 최종 규칙

## 10.1 source weighting

```ts
const OVERVIEW_WEIGHTS = {
  rootUserIntent: 0.35,
  confirmedDecisions: 0.30,
  recurringTopics: 0.20,
  latestNonMetaTopic: 0.10,
  latestMetaRequest: 0.05
};
```

## 10.2 rootUserIntent

첫 번째 `non-meta + semanticAnalyzable user message`를 기준으로 한다.

다음은 meta가 아니다.

```text
- 제품 아이디어 설명
- 문제 정의
- 페인포인트
- 사용 목표
- 초기 프로젝트 구상
```

다음은 meta다.

```text
- 분석 규칙을 만들어달라는 요청
- JSON schema 출력 지시
- 예시 문장 목록
- 평가 기준/검수 프롬프트
```

## 10.3 Overview 출력 예시

```json
{
  "mainSubject": "ChatGPT 대화 기반 JARVIS Context Mapper MVP 설계",
  "userCoreIntent": "긴 ChatGPT 대화를 사고 흐름·결정·보류·액션·핵심 개념으로 구조화하고 시각화하는 제품을 설계하며, v0.1 입력 방식은 공유 링크 기반으로 확정하려는 것",
  "currentStatus": "링크 기반 v0.1 기술 방향과 개발 문서화가 정리되었으며 MockExtractor 보정 중"
}
```

## 10.4 Satisfaction summary

low-confidence와 Review Queue 항목은 summary에서 제외한다.

권장 문장:

```text
사용자는 주요 답변을 바탕으로 다음 단계로 진행했으며, 일부 구간에서 범위와 산출물 조건을 수정했다. 명확한 불만족보다는 후속 요청과 방향 조정이 중심이다.
```

---

# 11. Schema 최종 변경

## 11.1 Decision

```ts
type Decision = {
  id: string;
  title: string;
  description: string;

  status:
    | "confirmed"
    | "deferred"
    | "excluded"
    | "candidate"
    | "replaced";

  source:
    | "explicit_user"
    | "accepted_assistant_suggestion"
    | "assistant_suggestion"
    | "inferred";

  triggerPhrase: string;
  evidenceMessageIndexes: number[];

  conflictGroup?: string;
  replacesDecisionId?: string;

  confidence: number;
  reviewRequired: boolean;
  includeInMainBoard: boolean;
  includeInKeyDecisionIds: boolean;

  rulesMatched: string[];
};
```

## 11.2 Action

```ts
type Action = {
  id: string;
  title: string;
  description: string;

  actionType:
    | "user_requested"
    | "assistant_suggested_next_step"
    | "team_next";

  assignee:
    | "assistant"
    | "user"
    | "team"
    | "unknown";

  status:
    | "requested"
    | "answered"
    | "artifact_generated"
    | "completed"
    | "blocked"
    | "suggested";

  triggerPhrase: string;
  evidenceMessageIndexes: number[];

  completedByMessageIndex?: number;
  artifactRefs?: string[];

  confidence: number;
  reviewRequired: boolean;
  includeInMainBoard: boolean;
};
```

## 11.3 Open Question

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
    | {
        type: "assistant_answer";
        messageIndex: number;
        answerStrength: "partial" | "full";
      }
    | {
        type: "user_decision";
        decisionId: string;
      }
    | {
        type: "superseded_by_scope_change";
        decisionId: string;
      };

  confidence: number;
  reviewRequired: boolean;
  includeInMainBoard: boolean;
};
```

## 11.4 Preference

```ts
type PreferenceSignal = {
  id: string;

  category:
    | "format"
    | "length"
    | "tone"
    | "language_expression"
    | "specificity_depth"
    | "avoidance";

  normalizedLabel: string;
  triggerPhrase: string;
  matchedRegexSpan: string;

  evidenceMessageIndexes: number[];
  rejectedEvidence?: Array<{
    messageIndex: number;
    reason: string;
  }>;

  reinforced: boolean;
  confidence: number;
  reviewRequired: boolean;
};
```

---

# 12. UI / Review Queue 최종 정책

## 12.1 Main Board

다음 조건을 모두 충족한 항목만 표시한다.

```ts
confidence >= 0.75
reviewRequired === false
includeInMainBoard === true
not example-derived
not duplicate/conflict item
```

## 12.2 Review Queue

다음 항목을 자동 이동한다.

```text
- confidence < 0.75
- candidate decision
- unaccepted assistant suggestion
- example-derived semantic item
- multi-status satisfaction
- 같은 triggerPhrase의 decision status 충돌
- evidence가 실제 matched rule을 포함하지 않는 preference
- resolvedBy가 preamble인 open question
- tool/context signal만 근거인 semantic item
```

## 12.3 표시 필드

```text
Item type
Title
Status
Trigger phrase
Evidence message index
Source
Confidence
Matched rule
Review reason
Conflict item
```

---

# 13. GPT Audit Export 최종 수정

## 13.1 Rule Trace

```json
{
  "matchedRule": "decision.excluded",
  "matchedSpan": "빼자",
  "sourceSentence": "PDF 업로드는 일단 추후 기능으로 빼자",
  "overriddenByRule": "decision.deferred.priority"
}
```

## 13.2 Conflict Diagnostics

```json
{
  "issueType": "duplicate_decision_conflict",
  "itemIds": ["dec_002", "dec_003"],
  "evidenceMessageIndexes": [70],
  "triggerPhrase": "PDF 업로드는 일단 추후 기능으로 빼자",
  "resolution": "keep_deferred_remove_excluded"
}
```

## 13.3 Preference Evidence Audit

```json
{
  "matchedRegexSpan": ".md파일로 만들어줘",
  "acceptedEvidenceIndexes": [31, 78],
  "rejectedEvidenceIndexes": [
    {
      "messageIndex": 63,
      "reason": "format marker 없음"
    },
    {
      "messageIndex": 82,
      "reason": "이미 생성된 artifact 참조"
    },
    {
      "messageIndex": 87,
      "reason": "파일명과 action이며 안정적 format preference 아님"
    }
  ]
}
```

## 13.4 resolvedBy 후보 기록

```json
{
  "questionMessageIndex": 44,
  "answerCandidates": [
    {
      "messageIndex": 45,
      "strength": "preamble",
      "selected": false
    },
    {
      "messageIndex": 54,
      "strength": "full",
      "selected": true
    }
  ]
}
```

---

# 14. Sprint 분류

## Sprint 4.5 — 반드시 완료

```text
[ ] Clean hard exclude 최종 적용
[ ] assistant final answer 복구
[ ] other_tool_call 세분화
[ ] deferred/excluded 충돌 제거
[ ] decision 동일 trigger/evidence dedupe
[ ] false Open Question 제거
[ ] Preference exact span evidence 검증
[ ] #24 유형 action 누락 보강
[ ] user_requested / team_next 재분류
[ ] acceptance phrase action 생성 방지
[ ] resolvedBy full answer 선택
[ ] #1 유형 root intent meta 제외 방지
[ ] example-like 메시지에서 action/topic만 허용
[ ] low-confidence Main Board 차단
```

## Sprint 5 — 구조 및 UX 확장

```text
[ ] ProblemSignal schema
[ ] ContentConstraint 세분화
[ ] Decision conflictGroup
[ ] Action completion verifier
[ ] Overview weighted summarizer
[ ] Topic label generator
[ ] Rule trace audit export
[ ] Main Board / Review Queue UI 분리
[ ] 오류 비교 리포트
```

## LLMExtractor 이후

```text
[ ] 의미 기반 clause segmentation
[ ] root intent 요약
[ ] Preference / Constraint / Problem 의미 구분
[ ] Satisfaction nuance
[ ] 자연어 Topic label
[ ] Evidence entailment verifier
[ ] 대화 간 장기 선호 병합
```

---

# 15. 필수 Regression Test Fixtures

## Fixture A — 복합 Decision

입력:

```text
PDF 업로드는 일단 추후 기능으로 빼자.
링크로만 분석하는 것으로 기술 방향을 잡고,
기술 명세서를 만들어줘.
```

기대 결과:

```text
1 deferred decision
1 confirmed decision
1 user_requested action
0 excluded duplicate
```

## Fixture B — Pain Point vs Open Question

입력:

```text
이전 대화가 궁금해서 또 질문하면 대화가 더 쌓여 복잡해진다.
```

기대 결과:

```text
1 ProblemSignal
0 OpenQuestion
```

## Fixture C — Preference Evidence

입력:

```text
노션에 넣을 수 있는 md 파일로 만들어줘.
만든 md 파일 2개면 충분하겠지?
```

기대 결과:

```text
첫 메시지만 format preference evidence
두 번째 메시지는 artifact reference
```

## Fixture D — Acceptance

입력:

```text
assistant: HTML 대신 실제 웹 MVP로 전환하는 게 낫습니다.
user: 그래 그렇게 해보자.
```

기대 결과:

```text
satisfied
confirmed decision from accepted_assistant_suggestion
0 action
```

## Fixture E — Task Failure

입력:

```text
assistant: 완료했습니다.
user: 왜 안 보여지지?
```

기대 결과:

```text
problem_reported or task_failed
not clarification_only
```

## Fixture F — Meta / Example Message

입력:

```text
아래 예시 문장별로 Preference 룰을 만들어줘.
예: “짧게 써줘”, “자세히 써줘”
```

기대 결과:

```text
1 user_requested action
1 meta topic
0 actual user preference from examples
```

## Fixture G — resolvedBy

입력 흐름:

```text
user: PDF를 어떻게 읽고 파싱하고 그래프화할지 알려줘.
assistant: 좋습니다. 나눠서 보겠습니다.
assistant: [상세 기술 답변]
```

기대 결과:

```text
OpenQuestion answered
resolvedBy = 상세 기술 답변
not preamble
```

---

# 16. Definition of Done

Sprint 4.5는 다음 조건을 모두 통과해야 완료로 본다.

```text
1. Clean Conversation에 순수 tool/plugin 실행 메시지가 0개
2. 사용자-visible assistant final answer 누락 0개
3. 동일 triggerPhrase decision status 충돌 0개
4. “추후 + 빼자”가 excluded로 분류되는 사례 0개
5. pain point가 Open Question으로 생성되는 사례 0개
6. user_requested action이 team_next로 오분류되는 사례 0개
7. 수락 표현이 action으로 생성되는 사례 0개
8. Preference evidence의 100%가 실제 matched span을 포함
9. resolvedBy가 transition/preamble만 가리키는 사례 0개
10. example-derived preference/decision/satisfaction의 Main Board 노출 0개
11. confidence < 0.75 항목의 Main Board 노출 0개
12. Overview root intent가 첫 제품 아이디어/문제 정의를 반영
```

---

# 17. 최종 권장 구현 순서

```text
1. CanonicalMessage 분류기 수정
2. Clean / Context / Internal regression test
3. Clause splitter 추가
4. Decision conflict resolver
5. Speech-act classifier
6. Preference evidence validator
7. OpenQuestion resolver
8. Overview weighting 수정
9. Review Queue 적용
10. GPT Audit trace 확장
11. 전체 샘플 재실행
12. golden fixture와 diff 비교
```

핵심 원칙은 다음과 같다.

> **룰 기반 MockExtractor는 많이 추출하는 시스템이 아니라, 근거가 명확한 것만 보수적으로 확정하는 시스템이어야 한다.**

> **의미가 애매한 항목은 Main Board에 억지로 넣지 말고 Review Queue로 보내는 것이 정답이다.**
