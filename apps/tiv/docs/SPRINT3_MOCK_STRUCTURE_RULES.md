# Sprint 3 Mock Structure Pipeline Rule Spec

문서 상태: Draft v0.1  
문서 목적: LLM 없이도 안정적인 70점짜리 구조화 결과를 만들기 위한 `MockStructureExtractor` 규칙과 출력 스키마를 정의한다.  
적용 범위: `CanonicalConversation`을 입력으로 받아 `Overview`, `Topic Flow`, `Preference Signals`, `Satisfaction Signals`, `Board`, `Evidence`, `Diagnostics`를 생성하는 Sprint 3 파이프라인.

---

## 0. 목표

Sprint 3의 목표는 **LLM 없이 70점짜리 구조화 결과를 안정적으로 만드는 것**이다.

이 규칙은 깊은 의미 이해보다 다음 기준을 우선한다.

```text
1. 보수적 판단
2. 근거 추적
3. 오판 방지
4. LLMExtractor 교체 가능성
```

장기적으로 `MockStructureExtractor`가 `LLMExtractor`로 교체되더라도 출력 스키마와 evidence 정책은 유지되어야 한다.

---

## 1. 전체 원칙

### 1.1 Clean Conversation First

분석의 중심은 항상 `Clean Conversation`이다.

우선순위:

```text
1. user messages
2. assistant final answers
3. Context Signals
4. Excluded/Internal
```

사용자의 의도, 선호, 만족도, 결정은 가능하면 `user message`에서만 확정한다.

`assistant final answer`는 다음에만 사용한다.

```text
- 어떤 답변이 제공됐는지 판단
- 다음 user reaction과 연결해 satisfaction 판단
- assistant가 제안한 action 후보 추출
- user가 assistant 제안을 수락했는지 판단
- topic flow에서 assistant 답변 구간 표시
```

### 1.2 MockExtractor는 보수적으로 판단한다

```text
명시적 표현이 있으면 추출한다.
암시적이면 낮은 confidence로 추출한다.
assistant 제안만 있으면 decision으로 확정하지 않는다.
user evidence가 없으면 주요 의도나 결정으로 쓰지 않는다.
```

예를 들어 assistant가 “웹 서비스로 시작하는 게 좋습니다”라고 했더라도, 사용자가 “좋아, 웹으로 가자”라고 말하지 않았다면 `decision`이 아니라 `assistant_suggestion` 또는 `open_question`으로 둔다.

### 1.3 모든 추출 결과에는 evidenceMessageIndexes가 있어야 한다

모든 구조화 항목에는 최소 하나 이상의 message index를 붙인다.

```ts
{
  type: "decision",
  title: "PDF 업로드는 후순위로 제외",
  evidenceMessageIndexes: [37],
  confidence: 0.94
}
```

근거가 없으면 결과에 포함하지 않거나 `weak_inference`로 표시한다.

### 1.4 Context Signals는 보조 근거다

`search query`, `opened source`, `clicked source`, `find pattern`, `citation/ref id`는 사용자 의도 자체가 아니라 assistant가 답변을 만들기 위해 사용한 작업 흔적이다.

Context Signals는 다음에만 사용한다.

```text
- assistant가 외부 정보 확인을 했는지
- 답변이 source-backed인지
- 특정 topic에서 research 단계가 있었는지
- citation 품질을 보조적으로 판단할 때
```

Context Signals만 보고 사용자 의도, 선호, 결정, 만족도를 확정하면 안 된다.

### 1.5 Excluded/Internal은 기본 분석에 넣지 않는다

다음 content는 사용자에게 실제로 보인 대화가 아니므로 semantic extraction에서 제외한다.

```text
- thoughts
- reasoning_recap
- model_editable_context
- system_context
```

예외적으로 diagnostics/debug metadata로만 사용할 수 있다.

---

## 2. 입력 그룹 정책

### 2.1 Clean Conversation

#### user message

가장 강한 evidence다.

추출 가능 항목:

```text
- user intent
- preference
- satisfaction
- decision
- open question
- requested action
- topic shift
- constraints
- rejection / exclusion
```

분석 대상:

```text
1. 질문
2. 요청
3. 수정 지시
4. 평가/반응
5. 선호 표현
6. 결정 표현
7. 보류/제외 표현
8. 다음 단계 지시
```

#### assistant final answer

사용자가 어떤 답변을 받았는지와 다음 user reaction을 판단하는 보조 근거다.

assistant answer만으로 다음을 확정하면 안 된다.

```text
- user preference
- user decision
- user satisfaction
- 최종 제품 방향
```

단, 사용자가 직후 “좋아”, “맞아”, “그걸로 하자”라고 반응하면 assistant answer의 내용을 accepted candidate로 승격할 수 있다.

### 2.2 짧은 반응 처리

#### 짧은 긍정 반응

키워드:

```text
좋아, 맞아, 응, 오케이, ok, ㅇㅋ, 그렇지, 좋네, 완료, 그걸로 하자
```

처리:

```text
1. 단독 topic을 만들지 않는다.
2. 바로 직전 assistant answer에 대한 satisfaction으로 처리한다.
3. “그걸로 하자”, “좋아 이걸로 가자”는 decision confirmation으로도 처리한다.
4. evidenceMessageIndexes는 [assistantIndex, userIndex]로 붙인다.
```

#### 짧은 부정 반응

키워드:

```text
아니, 아닌데, 그건 아니야, 별로야, 틀렸어, 다시, 그 방향은 아냐, 원하는 게 아니야, 그렇게 말고
```

처리:

```text
1. 직전 assistant answer에 대한 dissatisfied 또는 correction_requested로 처리한다.
2. “다시”, “그렇게 말고”가 있으면 correction_requested 우선.
3. 부정 뒤에 새 조건이 나오면 preference 또는 constraint로도 추출한다.
```

#### 단순 확인 메시지

예시:

```text
알겠어, 확인, 이해했어, 음, 그렇군
```

처리:

```text
1. satisfied로 처리할 수 있지만 confidence는 낮게 둔다.
2. decision으로 보지 않는다.
3. 다음 요청 없이 대화가 끝나면 resolved_likely에 반영할 수 있다.
```

권장 confidence:

```text
simple_ack_satisfaction = 0.65
```

### 2.3 중복/반복 메시지 처리

#### 시스템/복사로 인한 단순 중복

기준:

```text
- normalized text similarity >= 0.95
- 같은 role
- 인접하거나 매우 가까운 index
```

처리:

```text
- 첫 message만 primary evidence
- 나머지는 duplicateEvidenceIndexes에 저장
- preference 강화로 쓰지 않는다
```

#### 의도적 반복/강조

기준:

```text
- 유사한 요구가 2회 이상 등장
- 중간에 다른 topic이 있음
- 표현이 약간 다르지만 같은 조건을 말함
```

처리:

```text
preference.reinforced = true
confidence +0.08
evidenceMessageIndexes = [firstIndex, repeatedIndex]
```

---

## 3. Context Signals 사용 정책

### 3.1 search query

의미:

```text
- assistant가 외부 정보를 확인하려 했다.
- 해당 topic이 최신성/외부 근거를 필요로 했다.
- assistant answer가 research-backed일 가능성이 있다.
```

반영 가능:

```text
- topic.externalResearch = true
- answerQuality.sourceBacked 후보
- evidence.contextSignalRefs
```

금지:

```text
- user intent로 사용
- preference로 사용
- decision으로 사용
- satisfaction으로 사용
```

### 3.2 opened source / clicked source

반영 가능:

```text
- answerQuality.sourceBacked = true
- topic.externalResearch = true
- evidence.contextSignalRefs에 source id 추가
```

반영 금지:

```text
- user intent
- user preference
- user decision
- user satisfaction
```

### 3.3 find patterns

사용 규칙:

```text
1. topic keyword 보조로만 쓴다.
2. user가 그 키워드를 중요하게 여긴다고 판단하지 않는다.
3. final answer에 해당 키워드가 반복되면 topic label 후보로만 반영한다.
```

### 3.4 citations/ref ids

활용 가능:

```text
1. assistant answer가 source-backed인지 확인
2. 외부 정보 기반 claim인지 표시
3. answer quality metadata 생성
4. Context Signals와 final answer 연결
```

활용 불가:

```text
1. 사용자가 만족했다고 판단
2. 사용자가 해당 source를 원했다고 판단
3. decision evidence로 단독 사용
```

---

## 4. Excluded/Internal 제외 정책

다음 항목은 semantic extraction input에서 완전히 제외한다.

```text
- thoughts
- reasoning_recap
- model_editable_context
- system_context
```

제외 이유:

```text
1. 사용자에게 보인 대화가 아니다.
2. 사용자의 실제 의도나 만족도를 나타내지 않는다.
3. 내부 추론이 final answer와 다를 수 있다.
4. 제품 분석 결과에 노출되면 신뢰/보안 문제가 생긴다.
```

예외:

```text
- extractor 실행 환경 파악
- available tools metadata
- debug flag
- diagnostics count
```

예외 항목도 final evidence로 표시하지 않는다.

---

## 5. 추출 타입별 규칙

## 5.1 Preference Signal

Preference는 사용자가 원하는 답변 방식, 결과물 조건, 싫어하는 방향을 표현한 것이다.

공통 추출 대상:

```text
1. “~해줘”
2. “~로 만들어줘”
3. “~는 빼”
4. “~하지마”
5. “~중심으로”
6. “~형식으로”
7. “너무 ~하지 않게”
8. 반복적으로 요청한 조건
```

권장 타입:

```ts
type PreferenceSignal = {
  id: string;
  category:
    | "tone"
    | "length"
    | "language_expression"
    | "format"
    | "specificity_depth"
    | "avoidance"
    | "reinforced";
  polarity: "positive" | "negative";
  normalizedLabel: string;
  description: string;
  reinforced: boolean;
  evidenceMessageIndexes: number[];
  confidence: number;
  rulesMatched: string[];
};
```

### Preference categories

| category | 의미 | 예시 키워드 |
| --- | --- | --- |
| `tone` | 말투, 태도, 스타일 | 친근하게, 전문적으로, 명확하게, 직설적으로, 실무적으로 |
| `length` | 길이, 압축 정도 | 짧게, 핵심만, 자세히, 상세하게, 전체, 최종본 |
| `language_expression` | 언어, 표현 방식 | 한국어로, 쉬운 말로, 제품스럽게, 기획안스럽게 |
| `format` | 결과물 구조/파일 형식 | 표로, 리스트로, `.md`, markdown, JSON, schema, 기획안, 명세서 |
| `specificity_depth` | 구현 가능한 구체성 | 구체적으로, 세부 규칙, 현실적인, 바로 적용 가능한, TypeScript, MockExtractor |
| `avoidance` | 금지/회피 조건 | 빼자, 제외, 하지마, 필요 없어, 후순위, 추후, 말고 |
| `reinforced` | 반복 강화된 선호 | 같은 조건이 topic을 건너 다시 등장 |

## 5.2 Satisfaction Signal

Satisfaction은 `assistant final answer`와 다음 `user message`의 관계로 판단한다.

연결 규칙:

```text
각 assistant final answer A_i에 대해 다음 clean user message U_next를 찾는다.
중간의 Context Signals나 Internal은 건너뛴다.
```

상태:

```ts
type SatisfactionStatus =
  | "satisfied"
  | "partially_satisfied"
  | "dissatisfied"
  | "correction_requested"
  | "clarification_requested"
  | "continuing_without_clear_feedback";
```

상태 우선순위:

```text
1. correction_requested
2. dissatisfied
3. partially_satisfied
4. clarification_requested
5. satisfied
6. continuing_without_clear_feedback
```

### Satisfaction rules

| status | 키워드/패턴 | 기본 처리 |
| --- | --- | --- |
| `satisfied` | 좋아, 맞아, 오케이, 충분해, 그걸로 | positive only → confidence 0.75 |
| `partially_satisfied` | 좋은데, 맞는데, 다만, 근데, 하지만, 조금 더 | positive + contrast → partial |
| `dissatisfied` | 아니, 틀렸어, 별로, 원하는 게 아니야, 잘못 이해했어 | negative → dissatisfied |
| `correction_requested` | 다시, 수정, 고쳐, 바꿔, 빼고, 추가, 재정리 | correction keyword 우선 |
| `clarification_requested` | 무슨 뜻, 왜, 어떻게, 설명해줘, 차이가 뭐야 | question + no dissatisfaction |
| `continuing_without_clear_feedback` | 그렇다면, 그럼 이제, 다음으로, 이제 | transition + no clear feedback |

마지막 assistant answer 뒤에 user reaction이 없으면 만족 여부를 추론하지 않는다.

```text
status = continuing_without_clear_feedback
confidence = 0.3
```

## 5.3 Decision

Decision은 사용자가 방향을 확정, 제외, 보류, 채택한 것이다.

권장 타입:

```ts
type DecisionItem = {
  id: string;
  title: string;
  description: string;
  status: "confirmed" | "excluded" | "deferred";
  source: "explicit_user" | "assistant_suggestion_accepted" | "inferred";
  evidenceMessageIndexes: number[];
  confidence: number;
  rulesMatched: string[];
};
```

### Decision rules

| status | 키워드 | confidence |
| --- | --- | --- |
| `confirmed` | 이걸로 하자, 이 방향으로 가자, 확정, 채택, 진행하자, 메인으로 잡자 | >= 0.90 |
| `excluded` | 빼자, 제외, 안 할거야, 필요 없다, 넣지 말자, 탈락 | 0.85-0.95 |
| `deferred` | 보류, 나중에, 추후, 후순위, v0.2, v0.3, 지금은 하지 말자 | 0.85-0.95 |

assistant 제안은 기본적으로 decision이 아니다.

승격 조건:

```text
1. user가 “좋아”, “맞아”, “그걸로 하자”라고 수락
2. user가 이후 그 제안을 전제로 다음 작업 요청
3. user가 assistant 제안 중 일부를 수정 없이 채택
```

## 5.4 Open Question

질문이나 고민이 남아 있으면 Open Question으로 추출한다.

키워드:

```text
모르겠어, 고민, 어떻게, 어떤 방식, 가능할까, 정해야, 선택해야, 비교, 검토
```

처리:

```text
question/uncertainty keyword 있음 → open_question
직후 결정이 나오면 resolved로 업데이트
```

## 5.5 Action

Action은 사용자가 요청한 작업이거나, 다음에 해야 하는 실행 항목이다.

권장 타입:

```ts
type ActionItem = {
  id: string;
  title: string;
  description: string;
  actionType: "user_requested" | "team_next" | "assistant_suggested";
  assignee: "assistant" | "user" | "team" | "unknown";
  status: "requested" | "proposed" | "accepted" | "completed";
  evidenceMessageIndexes: number[];
  confidence: number;
  rulesMatched: string[];
};
```

### Action rules

| type | 의미 | 키워드/패턴 |
| --- | --- | --- |
| `user_requested` | 사용자가 assistant에게 직접 요청 | 정리해줘, 만들어줘, 작성해줘, 비교해줘, 분석해줘, 제안해줘, 파일로 |
| `team_next` | 앞으로 제품/팀이 해야 할 일 | 해야 한다, 해보자, 테스트, 검증, 구현, 설계, 확인, 추가 |
| `assistant_suggested` | assistant가 제안했으나 user 확인 없음 | assistant message only, confidence <= 0.60 |

완료 판단:

```text
user requested action at U
assistant final answer after U contains completion keyword or artifact link
→ action.status = completed
evidence = [U, A]
```

---

## 6. Topic Flow

Topic Flow는 시간축이 아니라 대화의 논점 이동이다.

### 6.1 topic 시작 기준

```text
1. 사용자가 새로운 질문을 함
2. 사용자가 범위를 바꿈
3. 사용자가 조건을 바꿈
4. 사용자가 결과물 형식을 바꿈
5. 사용자가 개발/기획/기술 등 관점을 전환함
6. 외부 정보 확인 단계로 이동함
7. artifact 생성 요청으로 이동함
8. 이전 답변에 대한 수정 요청이 큰 방향 전환을 포함함
```

### 6.2 topic shift 키워드

```text
그렇다면, 그럼, 이제, 다시, 최종본, 개발 얘기, 기술 얘기, 기획안, 명세서,
파일로, Codex, Sprint, MockExtractor, pdf말고, 링크로, 일단, 추후
```

영어:

```text
now, next, then, implementation, spec, plan, mock, extractor, sprint, rules, schema
```

### 6.3 changeReason enum

```ts
type TopicChangeReason =
  | "new_user_question"
  | "scope_changed"
  | "condition_changed"
  | "format_changed"
  | "perspective_changed"
  | "external_research_started"
  | "artifact_requested"
  | "correction_or_revision"
  | "implementation_phase_started"
  | "continuation";
```

### 6.4 종료 기준

```text
topic.startIndex = 시작 user message index
topic.endIndex = 다음 topic.startIndex - 1
마지막 topic은 마지막 clean message index에서 종료
```

### 6.5 label 생성 규칙

```text
1. user message 안의 명시적 객체명 추출
2. 동작 키워드 추출
3. 대상 + 동작 조합
4. 없으면 앞 20-30자 요약
```

예시:

```text
JARVIS MVP 아이디어 정리
구조화/가시화 방식 논의
Timeline 및 Ask 기능 제외
링크 기반 입력 방식 검토
ChatGPT Share Adapter 기술 명세
Codex 구현 지시서 작성
MockExtractor 규칙 설계
```

---

## 7. Overview

권장 타입:

```ts
type Overview = {
  title: string;
  mainSubject: string;
  userCoreIntent: string;
  currentStatus: "resolved" | "partially_resolved" | "in_progress" | "unclear";
  resolutionSummary: string;
  keyDecisionIds: string[];
  openQuestionIds: string[];
  actionIds: string[];
  dominantPreferenceIds: string[];
  satisfactionSummary: string;
  evidenceMessageIndexes: number[];
  confidence: number;
};
```

### 7.1 title

근거:

```text
- 첫 번째 의미 있는 user message
- 가장 반복되는 topic label
- 마지막 artifact request
```

### 7.2 mainSubject

근거:

```text
- conversation 전체 topic 중 가장 많이 등장한 대상
- user messages의 noun/keyword 빈도
```

예시:

```text
ChatGPT 공유 링크 대화를 분석해 사용자의 의도, 만족도, 결정, 액션을 구조화하는 제품
```

### 7.3 userCoreIntent

근거:

```text
- 첫 user message
- 반복된 요청
- 마지막 구체화 요청
- action requests
```

### 7.4 currentStatus

```text
resolved:
- 마지막 user request에 대해 assistant가 artifact/answer를 완료했고
- 이후 correction request가 없음

partially_resolved:
- 결과물이 나왔지만 사용자가 추가 수정/구체화 요청을 계속함

in_progress:
- 마지막 user message가 새 요청이고 assistant answer가 아직 없거나
- open questions/actions가 많음

unclear:
- 메시지가 너무 적거나 의도 파악 불가
```

### 7.5 satisfactionSummary

Mock 규칙:

```text
satisfied count 많음 + correction 많음
→ “수용하되 지속적으로 구체화”

dissatisfied 많음
→ “초기 답변에 불만족이 있었고 수정 요청이 많음”

continuing 많음
→ “명시적 피드백 없이 다음 단계로 진행”
```

---

## 8. Confidence / Evidence 정책

### 8.1 기본 confidence

| 근거 유형 | 기본 confidence |
| --- | ---: |
| user가 명시적으로 말함 | 0.90 |
| user가 명시적으로 반복함 | 0.95 |
| user가 assistant 제안을 수락함 | 0.85 |
| user의 짧은 긍정만 있음 | 0.70 |
| assistant가 제안했지만 user 확인 없음 | 0.55 |
| 문맥상 암시적 추론 | 0.45 |
| Context Signal만 있음 | 0.30 |
| 근거가 약하거나 예시 문장일 수 있음 | 0.25 |

### 8.2 보정 규칙

증가:

```text
+0.05: 같은 판단에 user evidence가 2개 이상
+0.08: 같은 preference가 반복 강화됨
+0.05: 명확한 decision keyword 있음
+0.05: assistant answer와 user acceptance가 연결됨
+0.03: context signal이 final answer citation과 연결됨
```

감소:

```text
-0.10: user message가 질문 형태임
-0.15: assistant-only claim임
-0.20: 예시 문장 내부에 있는 표현임
-0.15: quote/code block 내부에 있는 표현임
-0.10: 부정/긍정이 혼재됨
-0.20: evidence가 Context Signal뿐임
```

cap:

```text
assistant-only item max = 0.60
context-signal-only item max = 0.40
example-detected item max = 0.35
internal-source item = excluded
```

### 8.3 Evidence 기본 원칙

```text
1. user intent/preference/decision/action은 user message 우선
2. satisfaction은 assistant answer + next user message를 함께 사용
3. assistant 제안은 assistant message evidence 가능
4. user가 수락한 assistant 제안은 [assistantIndex, userIndex]
5. 여러 메시지에 걸친 판단은 모두 chronological order로 포함
```

Context Signal은 message index에 섞지 않고 별도 필드로 둔다.

```ts
type Evidence = {
  evidenceMessageIndexes: number[];
  contextSignalRefs?: string[];
};
```

---

## 9. Keyword Rule Table

### 9.1 전처리

```ts
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
```

권장 전처리:

```text
1. code block 제거 또는 별도 보관
2. quoted example 제거 또는 낮은 confidence 처리
3. markdown heading/list marker 제거
4. URL 제거
5. 반복 공백 정리
6. 한글/영문 대소문자 normalize
```

예시 문장 감지:

```regex
/(예:|예시|example|for example)/
```

code block:

```regex
/```[\s\S]*?```/
```

quote:

```regex
/^>\s+/m
```

### 9.2 핵심 규칙

| type | subtype | Korean regex | English regex | base |
| --- | --- | --- | --- | ---: |
| preference | tone | `/(친근|전문적|명확|직설|부드럽|딱딱하지|실무적|컨설턴트)/` | `/(tone|friendly|professional|direct|clear|casual|formal)/i` | 0.80 |
| preference | length_concise | `/(짧게|간단히|핵심만|요약|한 문장)/` | `/(short|brief|concise|summary|tl;dr)/i` | 0.82 |
| preference | length_detailed | `/(자세히|상세하게|충분히|길게|세부)/` | `/(detailed|in depth|comprehensive|thorough)/i` | 0.82 |
| preference | language | `/(한국어|영어|쉬운 말|표현|문장|제품스럽|기획안스럽)/` | `/(korean|english|plain language|wording|copy)/i` | 0.78 |
| preference | format | `/(\.md|markdown|json|schema|표로|리스트|불렛|문서|파일|기획안|명세서)/i` | `/(markdown|json|schema|table|list|doc|spec|plan|file)/i` | 0.86 |
| preference | depth | `/(구체적|세부 규칙|현실적|바로 적용|구현 가능|방법론|룰|regex|typescript)/i` | `/(specific|practical|implementation|rule|regex|typescript|mock)/i` | 0.88 |
| preference | avoidance | `/(빼|제외|하지마|안 할|필요 없|의미 없|말고|후순위|추후)/` | `/(exclude|remove|do not|don't|avoid|not needed|later|defer)/i` | 0.88 |
| satisfaction | satisfied | `/(좋아|좋습니다|맞아|맞습니다|오케이|괜찮|완료|충분|그걸로)/` | `/(good|great|ok|okay|works|correct|sounds good|enough)/i` | 0.75 |
| satisfaction | partial | `/(좋은데|맞는데|괜찮은데|방향은 맞|다만|근데|하지만|조금 더)/` | `/(good but|right but|however|but|partly|mostly)/i` | 0.78 |
| satisfaction | dissatisfied | `/(아니|아닌데|틀렸|별로|원하는 게 아니|잘못 이해|그게 아니)/` | `/(no|wrong|incorrect|not what i want|bad|missed)/i` | 0.86 |
| satisfaction | correction | `/(다시|수정|고쳐|바꿔|빼고|넣고|추가|제외|재정리)/` | `/(revise|fix|change|redo|rewrite|remove|add|update)/i` | 0.88 |
| satisfaction | clarification | `/(무슨 뜻|왜|어떻게|설명|이해가 안|차이가 뭐|가능한가|궁금)/` | `/(why|how|what do you mean|explain|clarify|possible)/i` | 0.76 |
| decision | confirmed | `/(이걸로 하자|방향으로 가자|확정|채택|진행하자|메인으로 잡자|기술로 잡자)/` | `/(let's go with|decide|confirmed|adopt|use this|proceed)/i` | 0.92 |
| decision | excluded | `/(빼자|제외|안 할거야|하지 않는다|필요 없다|넣지 말자|탈락)/` | `/(exclude|drop|remove|won't do|will not|not include)/i` | 0.90 |
| decision | deferred | `/(보류|나중에|추후|후순위|v0\.2|v0\.3|일단.*빼)/` | `/(defer|later|postpone|future|backlog|not now)/i` | 0.88 |
| open_question | uncertainty | `/(모르겠|고민|어떻게|가능할까|정해야|선택해야|편하려나|어때)/` | `/(not sure|wonder|how should|should we|which|whether)/i` | 0.72 |
| action | user_request | `/(정리해줘|만들어줘|작성해줘|비교해줘|분석해줘|제안해줘|뽑아줘|파일로|만들자)/` | `/(make|create|write|compare|analyze|suggest|generate|export)/i` | 0.88 |
| action | team_next | `/(해야 한다|해보자|테스트|검증|구현|설계|수집|확인|추가하자)/` | `/(need to|should|test|validate|implement|design|collect|check)/i` | 0.75 |
| topic_shift | transition | `/(그렇다면|그럼|이제|다시|최종본|개발 얘기|기술 얘기|기획안|명세서|파일|codex|sprint|mock)/i` | `/(now|next|then|implementation|spec|plan|sprint|mock|codex)/i` | 0.80 |
| artifact | file_request | `/(\.md|markdown 파일|파일로|다운로드|문서로)/i` | `/(md file|markdown file|download|export|document)/i` | 0.90 |

---

## 10. JSON Schema

```ts
type MockStructureResult = {
  extractor: {
    name: "MockStructureExtractor";
    version: string;
    mode: "rule_based";
  };
  overview: Overview;
  topicFlow: TopicFlowItem[];
  preferenceSignals: PreferenceSignal[];
  satisfactionSignals: SatisfactionSignal[];
  board: Board;
  evidence: EvidenceItem[];
  diagnostics: ExtractionDiagnostics;
};
```

```ts
type TopicFlowItem = {
  id: string;
  order: number;
  label: string;
  summary: string;
  startMessageIndex: number;
  endMessageIndex: number;
  changeReason: TopicChangeReason;
  evidenceMessageIndexes: number[];
  contextSignalRefs?: string[];
  confidence: number;
};
```

```ts
type Board = {
  decisions: DecisionItem[];
  openQuestions: OpenQuestionItem[];
  actions: ActionItem[];
};
```

```ts
type OpenQuestionItem = {
  id: string;
  question: string;
  description: string;
  status: "open" | "resolved" | "superseded";
  evidenceMessageIndexes: number[];
  resolvedByDecisionId?: string;
  confidence: number;
  rulesMatched: string[];
};
```

```ts
type EvidenceItem = {
  id: string;
  evidenceMessageIndexes: number[];
  contextSignalRefs?: string[];
  quote?: string;
  sourceType: "clean_conversation" | "context_signal" | "mixed";
  evidenceStrength:
    | "explicit_user_statement"
    | "explicit_assistant_statement"
    | "accepted_assistant_suggestion"
    | "paired_reaction"
    | "contextual_support"
    | "weak_inference";
};
```

```ts
type ExtractionDiagnostics = {
  analyzedMessageIndexes: number[];
  skippedMessageIndexes: number[];
  duplicateMessageIndexes: number[];
  excludedInternalCount: number;
  contextSignalCount: number;
  rulesFired: Record<string, number>;
  warnings: DiagnosticWarning[];
};
```

```ts
type DiagnosticWarning = {
  code:
    | "EXAMPLE_TEXT_DETECTED"
    | "CODE_BLOCK_SKIPPED"
    | "ASSISTANT_ONLY_DECISION_DOWNGRADED"
    | "CONTEXT_SIGNAL_ONLY_DOWNGRADED"
    | "DUPLICATE_MESSAGE_SKIPPED"
    | "LOW_CONFIDENCE_OUTPUT";
  message: string;
  messageIndexes?: number[];
};
```

---

## 11. 구현 단계

Sprint 3는 작업 추적을 위해 `Sprint 3A`, `Sprint 3B`, `Sprint 3C`로 나눈다.

```text
Sprint 3A = 최소 동작 구조화
Sprint 3B = 구조화 품질 개선
Sprint 3C = Context Signals 연결
```

각 단계는 기존 priority와 다음처럼 대응한다.

```text
Sprint 3A → Priority 0
Sprint 3B → Priority 1
Sprint 3C → Priority 2
```

### Sprint 3A — 최소 동작 구조화

목표:

```text
LLM 없이도 분석 결과 JSON과 화면이 항상 나오게 만든다.
정확도보다 안정적인 출력, evidenceMessageIndexes, confidence, 테스트 가능성을 우선한다.
```

포함 범위:

```text
1. structures.ts 스키마 정리
2. MockStructureExtractor 추가
3. Clean Conversation만 필터링
4. user message 기반 preference / decision / action 추출
5. assistant final answer → next user message satisfaction pairing
6. /api/analyses/[analysisId]/result 추가
7. 분석 화면에 Structure Result 섹션 표시
8. unit test 추가
```

완료 기준:

```text
- 공유 링크 분석 후 Structure Result가 화면에 표시된다.
- Overview, Board, Preference Signals, Satisfaction Signals, Topic Flow 초안이 생성된다.
- Context Signals와 Excluded/Internal은 semantic extraction에 섞이지 않는다.
- typecheck, test, build가 통과한다.
```

### Priority 0

#### 1. Clean message normalizer

```text
- Clean Conversation만 필터링
- user / assistant final answer 구분
- message index 유지
- internal/context signal 제외
```

완료 기준:

```text
input messages → cleanMessages[]
```

#### 2. Rule engine skeleton

```text
- keyword rule table
- regex match
- confidence base score
- evidenceMessageIndexes 부착
- rulesMatched 기록
```

완료 기준:

```text
message 하나를 넣으면 preference/action/decision 후보가 나옴
```

#### 3. Satisfaction pairer

```text
assistant final answer → next user message 연결
```

완료 기준:

```text
assistant-user pair별 satisfaction status 생성
```

#### 4. Decision / Action extractor

```text
user message 기반 decision/action 추출
assistant-only suggestion downgrade
```

완료 기준:

```text
Board.decisions / Board.actions 생성
```

### Sprint 3B — 구조화 품질 개선

목표:

```text
3A에서 나온 기본 결과의 품질을 높인다.
대화 흐름, 반복 선호, unresolved question, overview 상태 판단을 더 그럴듯하게 만든다.
```

포함 범위:

```text
5. Topic Flow segmenter
6. Preference aggregator
7. Open Question extractor
8. Overview builder
```

완료 기준:

```text
- Topic Flow가 단순 키워드 매칭보다 안정적으로 구간을 나눈다.
- 반복 선호는 reinforced로 병합된다.
- Open Question은 이후 decision으로 resolved 처리될 수 있다.
- Overview의 currentStatus / userCoreIntent / resolutionSummary가 실제 대화 상태를 더 잘 반영한다.
- example/code block/duplicate 오판 방지 로직이 테스트로 고정된다.
```

### Priority 1

```text
5. Topic Flow segmenter
6. Preference aggregator
7. Open Question extractor
8. Overview builder
```

### Sprint 3C — Context Signals 연결

목표:

```text
Context Signals를 사용자 의도 판단에는 쓰지 않되, research-backed 여부와 source-backed answer 품질 판단에 연결한다.
```

포함 범위:

```text
9. Context Signal enricher
10. Diagnostics
```

완료 기준:

```text
- search/open/click/find/citation 신호가 topic 또는 answer quality metadata에 보조로 연결된다.
- contextSignalRefs는 evidenceMessageIndexes와 분리된다.
- Context Signal만으로 preference/decision/satisfaction이 생성되지 않는다.
- diagnostics가 context signal count, internal count, weak inference warning을 표시한다.
```

### Priority 2

```text
9. Context Signal enricher
10. Diagnostics
```

---

## 12. 위험한 오판 케이스와 방지책

### 12.1 예시 문장을 실제 decision/action으로 오판

방지책:

```text
1. “예:”, “예시”, “example” 이후 block은 example zone으로 표시
2. code block / quote block 내부는 extraction 제외
3. example zone에서 match된 item은 confidence max 0.35
4. Board에는 기본 표시하지 않음
```

### 12.2 assistant 제안을 user decision으로 오판

방지책:

```text
assistant-only decision max confidence 0.60
user acceptance 없으면 Board.decisions가 아니라 assistant_suggested로 둠
```

### 12.3 “좋아, 근데...”를 fully satisfied로 오판

방지책:

```text
positive keyword + contrast keyword
→ partially_satisfied 우선
contrast 뒤 내용에서 correction/preference 추출
```

### 12.4 “어떻게 생각하냐?”를 decision으로 오판

방지책:

```text
question keyword가 있으면 open_question 또는 clarification_requested
decision keyword가 없으면 decision 금지
```

### 12.5 Context Signals를 user intent로 오판

방지책:

```text
Context Signal only → confidence max 0.40
preference/decision/satisfaction 생성 금지
```

### 12.6 Internal 데이터를 사용자 선호로 오판

방지책:

```text
Excluded/Internal은 semantic extraction input에서 완전 제외
diagnostics에 count만 기록
```

### 12.7 code block 안의 키워드 오판

방지책:

```text
code block은 keyword extraction에서 제외
단, 사용자가 “JSON schema로 만들어줘”라고 말한 본문은 format preference로 추출
```

### 12.8 단순 중복을 반복 선호로 오판

방지책:

```text
normalized text similarity >= 0.95 and near index
→ duplicate로 처리
→ reinforced preference로 쓰지 않음
```

### 12.9 “나중에 하자”를 open question으로만 처리

방지책:

```text
defer keyword가 있으면 deferred decision 우선
질문형 uncertainty가 있으면 open question
```

### 12.10 마지막 assistant answer의 satisfaction을 과하게 추론

방지책:

```text
no next user reaction
→ continuing_without_clear_feedback
confidence = 0.30
또는 unrated로 별도 처리
```

---

## 13. 최종 구현 방향

Sprint 3의 `MockStructureExtractor`는 다음 순서로 구현한다.

```text
1. Clean Conversation만 기본 분석한다.
2. user message를 가장 강한 evidence로 둔다.
3. assistant final answer는 user reaction과 연결해서만 satisfaction/accepted suggestion 판단에 쓴다.
4. Context Signals는 source-backed answer와 topic research metadata에만 쓴다.
5. Excluded/Internal은 semantic extraction에서 제외한다.
6. 모든 결과에는 evidenceMessageIndexes와 confidence를 붙인다.
7. example/code/internal/context-only match는 confidence를 강하게 낮춘다.
8. output schema는 LLMExtractor와 교체 가능하게 유지한다.
```

이 규칙이면 LLM 없이도 `Overview`, `Topic Flow`, `Preference Signals`, `Satisfaction Signals`, `Board`, `Evidence`를 안정적으로 생성할 수 있다.
