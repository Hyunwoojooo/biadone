# TIV Semantic Types Guide

## 1. 문서 목적

이 문서는 TIV가 ChatGPT 공유 대화에서 추출하는 `SemanticItem`의 타입과 판정 기준을 설명한다.

주요 목적은 다음과 같다.

- 각 Semantic Type이 어떤 의미인지 정의한다.
- 서로 비슷한 타입을 어떻게 구분하는지 설명한다.
- 실제 대화 문장을 이용해 구체적인 추출 예시를 제공한다.
- 현재 Hard Rule이 어떤 키워드와 문맥 조건으로 타입을 판별하는지 기록한다.
- Hard Rule과 LLM Shadow가 각각 어떤 범위까지 담당하는지 구분한다.
- 추출 결과를 모니터링할 때 확인해야 하는 오판 가능성을 정리한다.

이 문서는 2026-07-11 현재 구현을 기준으로 한다.

관련 소스:

- [`semantic.ts`](../src/core/types/semantic.ts): 공통 SemanticItem 스키마
- [`mockStructureExtractor.ts`](../src/core/extractors/mockStructureExtractor.ts): Sprint 3/4 Hard Rule
- [`ruleSemanticAdapter.ts`](../src/core/extractors/ruleSemanticAdapter.ts): Rule 결과를 공통 SemanticItem으로 변환
- [`llmShadowPrompt.ts`](../src/core/extractors/llmShadowPrompt.ts): Sprint 5A LLM 추출 지시
- [`evidenceVerifier.ts`](../src/core/validation/evidenceVerifier.ts): Sprint 5B 근거 검증

---

## 2. SemanticItem이란

`SemanticItem`은 대화의 특정 문장이 가진 의미를 정규화한 데이터다.

예를 들어 다음 사용자 메시지를 생각할 수 있다.

> PDF 업로드는 추후로 미루고, v0.1은 ChatGPT 공유 링크만 지원하자. 그리고 기술 명세서를 Markdown으로 만들어줘.

이 문장에는 하나가 아니라 여러 의미가 들어 있다.

```text
Decision
- PDF 업로드를 추후로 미룸: deferred
- v0.1은 공유 링크만 지원: confirmed

Action
- 기술 명세서 작성 요청

Preference
- Markdown 형식 선호

Entity
- PDF 업로드
- ChatGPT 공유 링크
- 기술 명세서
```

따라서 TIV는 메시지 하나를 하나의 분류로 제한하지 않는다. 서로 다른 의미가 명시되어 있다면 하나의 메시지에서 여러 SemanticItem이 생성될 수 있다.

### 2.1 공통 필드

```ts
type SemanticItem = {
  id: string;
  type: SemanticItemType;
  source: "rule" | "llm";
  sourceItemId: string | null;
  label: string;
  description: string;
  status: string | null;
  category: string | null;
  triggerPhrase: string | null;
  evidenceMessageIndexes: number[];
  confidence: number;
  reviewRequired: boolean;
};
```

각 필드의 의미는 다음과 같다.

| 필드                     | 의미                                                  |
| ------------------------ | ----------------------------------------------------- |
| `type`                   | 어떤 종류의 의미인지 나타내는 12개 타입 중 하나       |
| `source`                 | Hard Rule 결과인지 LLM 결과인지 구분                  |
| `label`                  | 사람이 빠르게 읽을 수 있는 짧은 이름                  |
| `description`            | 추출된 의미에 대한 보수적인 설명                      |
| `status`                 | confirmed, deferred, open, answered 등의 타입별 상태  |
| `category`               | format, architecture, task_failure 등의 세부 분류     |
| `triggerPhrase`          | 해당 판단을 일으킨 원문의 핵심 구절                   |
| `evidenceMessageIndexes` | 판단을 뒷받침하는 원문 메시지 번호                    |
| `confidence`             | 의미와 근거가 맞을 가능성에 대한 0.0~1.0 점수         |
| `reviewRequired`         | Main 결과로 확정하기 전에 사람의 검토가 필요한지 여부 |

---

## 3. 전체 타입 목록과 현재 Rule 지원 범위

현재 공통 스키마에는 12개 Semantic Type이 있다.

| Type                 | 핵심 질문                                      | Hard Rule 직접 생성     | LLM Shadow 생성 |
| -------------------- | ---------------------------------------------- | ----------------------- | --------------- |
| `intent`             | 사용자가 궁극적으로 무엇을 이루려는가?         | 지원, Overview에서 파생 | 지원            |
| `topic`              | 지금 어떤 대상을 논의하고 있는가?              | 지원                    | 지원            |
| `decision`           | 어떤 방향을 확정·보류·제외했는가?              | 지원                    | 지원            |
| `open_question`      | 아직 답이나 판단이 필요한 것은 무엇인가?       | 지원                    | 지원            |
| `action`             | 누가 무엇을 수행해야 하는가?                   | 지원                    | 지원            |
| `preference`         | 답변이나 결과물을 어떤 방식으로 받고 싶은가?   | 지원                    | 지원            |
| `content_constraint` | 결과물 내용에 무엇을 넣거나 빼야 하는가?       | 지원                    | 지원            |
| `problem_signal`     | 사용자가 겪는 문제·불편·실패는 무엇인가?       | 지원                    | 지원            |
| `satisfaction`       | 직전 답변에 사용자가 어떻게 반응했는가?        | 지원                    | 지원            |
| `change_event`       | 이전 방향에서 무엇이 바뀌었는가?               | 직접 생성하지 않음      | 지원            |
| `entity`             | 대화에서 기억해야 할 구체적인 대상은 무엇인가? | 직접 생성하지 않음      | 지원            |
| `relation`           | Entity 사이에 어떤 관계가 있는가?              | 직접 생성하지 않음      | 지원            |

중요한 현재 구현 상태:

```text
MockStructureExtractor
→ intent, topic, decision, open_question, action,
  preference, content_constraint, problem_signal, satisfaction

LLM Shadow
→ 위 9개 + change_event, entity, relation
```

Hard Rule의 Topic에는 `changeReason`이 있지만, 현재 `ruleSemanticAdapter`는 이것을 별도의 `change_event` SemanticItem으로 변환하지 않는다. 따라서 모니터링 화면에서 Rule 쪽 `change_event`, `entity`, `relation`이 비어 있는 것은 현재 구현상 정상이다.

---

## 4. Hard Rule 공통 판정 절차

각 타입의 개별 규칙보다 먼저 다음 공통 전처리와 방어 규칙이 적용된다.

### 4.1 Clean Conversation만 의미 분석

기본 의미 분석 입력은 다음 두 종류다.

```text
- user message
- assistant final answer
```

검색어, 도구 호출, bash/python 실행 로그 등의 `Context Signal`은 Topic의 외부 조사 여부를 보강하는 데만 사용한다. `thoughts`, `system_context` 등의 `Excluded/Internal`은 SemanticItem 근거로 사용하지 않는다.

### 4.2 User evidence 우선

다음 항목은 사용자 메시지가 가장 강한 근거다.

```text
- intent
- decision
- open_question
- action
- preference
- content_constraint
- problem_signal
```

assistant의 제안만으로 사용자 Decision을 확정하지 않는다. assistant 제안은 기본적으로 `candidate`이며, 다음 사용자가 짧은 수락 표현을 보이면 `confirmed`로 승격할 수 있다.

### 4.3 예시·코드·중복 방어

- 코드 블록은 키워드 추출 대상에서 제거한다.
- `예:`, `예시`, `example` 성격이 강한 메시지는 실제 선호나 결정으로 사용하지 않는다.
- 예시형 메시지에서는 기본적으로 `action`, `topic_shift`만 허용한다.
- 인접한 동일 role 메시지의 정규화된 텍스트가 같으면 뒤 메시지를 중복으로 제외한다.
- “좋아”, “확인”, “완료” 같은 짧은 반응은 독립 Topic이나 Preference로 만들지 않는다.

### 4.4 Confidence 보정

현재 기본 보정은 다음과 같다.

```text
질문 형태이면 기본 confidence -0.10
예시형이면 -0.20 후 최대 0.35로 제한
confidence < 0.75이면 기본적으로 Review 대상
assistant-only 제안은 최대 약 0.55 수준의 candidate
```

### 4.5 다중 타입 허용

한 문장이 여러 기능을 하면 여러 타입으로 추출할 수 있다.

> 지금 파싱 결과가 계속 오염돼. tool message는 빼고 다시 분석해줘.

가능한 결과:

```text
Problem Signal
- 파싱 결과가 계속 오염됨

Content Constraint
- tool message 제외

Action
- 다시 분석 요청

Satisfaction
- 직전 답변에 대한 correction_requested 또는 task_failed
```

다중 타입 자체는 오류가 아니다. 다만 같은 의미를 잘못된 타입 두 개로 중복 분류한 것인지는 Evidence Trace에서 확인해야 한다.

---

## 5. 타입별 상세 정의와 Hard Rule

### 5.1 `intent`

### 의미

사용자가 대화를 통해 궁극적으로 이루려는 목표, 원하는 결과, 해결하려는 핵심 과제다.

Intent는 단순한 한 번의 작업 요청보다 범위가 크다.

```text
Intent: ChatGPT 대화를 분석해 장기 기억으로 저장하고 싶다.
Action: Semantic Type 설명 문서를 만들어줘.
```

### 포함하는 것

- 제품이나 기능을 만들려는 최종 목적
- 해결하려는 핵심 사용자 문제
- 여러 메시지에 걸쳐 반복되는 목표
- 대화 전체를 시작하게 만든 핵심 질문

### 포함하지 않는 것

- 단순 파일 생성 요청
- 답변 형식 선호
- assistant가 제안했지만 사용자가 수락하지 않은 목표
- 마지막 메시지에만 등장한 국소적인 문서화 요청

### 구체적인 예시

#### 예시 A

> ChatGPT 공유 링크를 넣으면 사용자의 의도와 대화 맥락을 분석해서 장기 기억 후보로 만들고 싶어.

```json
{
  "type": "intent",
  "label": "공유 대화 기반 장기 기억 생성",
  "status": "in_progress",
  "triggerPhrase": "사용자의 의도와 대화 맥락을 분석해서 장기 기억 후보로 만들고 싶어"
}
```

#### 예시 B

> 내 Codex CLI 세션을 계속 모니터링해서 카카오톡으로 원격 제어하고 싶어.

```text
Intent: Codex CLI 세션의 카카오톡 원격 제어
Entity: Codex CLI, 카카오톡
Relation: Codex CLI 결과를 카카오톡으로 전달
```

### 현재 Hard Rule 판정

Hard Rule은 `intent` 전용 키워드 정규식으로 개별 문장을 바로 분류하지 않는다. 대신 전체 Rule 결과의 `Overview.userCoreIntent`를 하나의 Intent SemanticItem으로 변환한다.

Overview는 다음 신호를 가중 조합한다.

```text
1. 첫 번째 non-meta user intent
2. confidence가 높은 confirmed decision
3. 반복되는 topic label
4. 최신 non-meta topic
5. 마지막 검수·문서화·프롬프트 요청은 낮은 가중치
```

Hard Rule 결과 특성:

- 대화 전체에 대해 대표 Intent 1개가 주로 생성된다.
- 마지막 “파일 만들어줘” 요청이 전체 Intent를 덮지 않도록 한다.
- Overview evidence가 약하면 Evidence Verifier에서 Review 또는 Rejected가 될 수 있다.

---

### 5.2 `topic`

### 의미

대화가 현재 다루는 구체적인 논의 대상 또는 논점 구간이다. Topic Flow를 구성하는 기본 단위다.

Intent가 대화 전체의 목적이라면 Topic은 대화 중간중간 이동하는 논점이다.

### 구체적인 예시

```text
대화 전체 Intent
- ChatGPT 대화를 구조화해 장기 기억으로 만들기

Topic 1
- 공유 링크 Parser 수정

Topic 2
- Hard Rule Semantic Type 설계

Topic 3
- Gemini Shadow Mode 연결

Topic 4
- Evidence Verifier 검수
```

#### 예시 문장

> 이제 Parser 얘기는 마무리하고 Gemini API 연결을 진행하자.

가능한 결과:

```text
Topic: Gemini API 연결
Change reason: implementation_phase_started 또는 scope_changed
Decision: Gemini API 연결 진행
```

### 현재 Hard Rule 판정

새 Topic 시작 후보는 다음 조건으로 찾는다.

```text
- 첫 번째 의미 있는 user message
- 새로운 사용자 질문
- scope, condition, format, perspective 변경
- artifact 생성 요청
- correction 또는 revision
- implementation 단계 시작
- “이제”, “그럼”, “다시”, “최종본”, “개발 얘기”,
  “기술 얘기”, “기획안”, “명세서”, “Codex”, “Sprint” 등 전환어
```

주요 Rule ID:

```text
topic_shift.transition
```

명시적인 객체명이 있으면 Topic label에 우선 사용한다.

```text
MockExtractor
Context Signals
Clean Conversation
ChatGPT Share Adapter
Topic Flow
Overview
Board
PDF 업로드
Sprint 3
Codex
```

중복 메시지는 새 Topic으로 만들지 않고 이전 Topic의 `mergedMessageIndexes`에 합친다. 같은 label이 연속으로 만들어져도 이전 Topic에 병합한다.

Context Signal은 Topic 자체를 만들지 않지만 다음 metadata를 보강한다.

```text
externalResearch
sourceBacked
signalCount
signalTypes
citationCount
```

---

### 5.3 `decision`

### 의미

사용자가 제품, 작업, 기술, 범위 또는 우선순위에 관해 방향을 확정·제외·보류한 것이다.

### 주요 상태

| 상태        | 의미                                             |
| ----------- | ------------------------------------------------ |
| `confirmed` | 이 방향으로 진행하기로 확정                      |
| `deferred`  | 지금 하지 않고 이후로 미룸                       |
| `excluded`  | 범위에서 제외하거나 하지 않기로 함               |
| `candidate` | 제안 또는 가능성은 있지만 사용자가 확정하지 않음 |
| `replaced`  | 이후 다른 결정으로 대체됨                        |

### 구체적인 예시

#### 복합 결정

> PDF 업로드는 추후 기능으로 빼고, v0.1은 공유 링크만 지원하는 방향으로 가자.

올바른 분리:

```json
[
  {
    "type": "decision",
    "label": "PDF 업로드 후순위화",
    "status": "deferred",
    "triggerPhrase": "PDF 업로드는 추후 기능으로"
  },
  {
    "type": "decision",
    "label": "v0.1 공유 링크 입력 채택",
    "status": "confirmed",
    "triggerPhrase": "v0.1은 공유 링크만 지원하는 방향으로 가자"
  }
]
```

#### assistant 제안 수락

```text
assistant #20: PDF는 후순위로 두고 공유 링크부터 지원하는 게 좋습니다.
user #21: 좋아. 그걸로 하자.
```

결과:

```text
Decision status: confirmed
Source: assistant_suggestion_accepted
Evidence: [20, 21]
Confidence: 약 0.85
```

assistant #20만 있고 사용자 수락이 없다면 `candidate`이며 Main Board에 확정 Decision으로 표시하지 않는다.

### 현재 Hard Rule 판정

주요 Rule ID와 대표 패턴:

```text
decision.confirmed
- 이걸로 하자
- 그걸로 하자
- 이 방향으로 가자
- 확정, 채택, 결정, 고정
- 진행하자
- 메인으로 잡자, 기술로 잡자
- 링크로만

decision.deferred
- 보류, 나중에, 추후, 후순위
- v0.2, v0.3
- 일단 ... 빼
- later, postpone, backlog, not now

decision.excluded
- 빼자, 제외
- 안 할거야, 하지 않는다
- 필요 없다, 넣지 말자
- drop, remove, will not
```

최종 status 판정 우선순위는 대략 다음과 같다.

```text
추후/나중/후순위가 있으면 deferred
명시적인 폐기/영구 제외 표현이면 excluded
확정/진행/이 방향 표현이면 confirmed
그 외에는 candidate
```

현재 구현에서는 “결정 후보를 찾는 regex”와 “최종 status를 정하는 classifier”가 분리돼 있다. 따라서 `빼자`, `제외`처럼 짧은 표현은 `decision.excluded` Rule에는 일치하더라도, 최종 classifier가 영구 제외 표현으로 확정하지 못하면 `candidate`로 남을 수 있다. 이런 항목은 Review Queue에서 원문과 status를 확인해야 한다.

한 메시지에 여러 결정이 있으면 의미 절 단위 trigger phrase를 사용해 분리하려고 한다. 동일 evidence에서 상태가 충돌하면 우선순위가 높은 Decision을 남기고 diagnostics에 conflict를 기록한다.

---

### 5.4 `open_question`

### 의미

아직 답, 확인, 선택 또는 판단이 필요한 사용자 질문이다.

질문 문장이 등장했다고 항상 최종 상태가 `open`인 것은 아니다. 이후 assistant 답변이나 사용자 Decision에 따라 상태가 바뀐다.

### 주요 상태

| 상태                         | 의미                                                    |
| ---------------------------- | ------------------------------------------------------- |
| `open`                       | 아직 해결 근거가 없음                                   |
| `answered`                   | 이후 assistant가 답변함                                 |
| `resolved_by_user_decision`  | 이후 사용자가 직접 방향을 결정함                        |
| `superseded_by_scope_change` | 범위 제외·보류 등으로 질문 자체가 더 이상 유효하지 않음 |

### 구체적인 예시

#### 설명을 요구하는 질문

```text
user #10: Local Agent가 정확히 뭐야?
assistant #11: Local Agent는 로컬 머신에서 Codex CLI를 관찰하고 ...
```

```text
Open Question: Local Agent의 정의
Status: answered
Question evidence: #10
Resolved by assistant answer: #11
```

#### 선택이 필요한 질문

```text
user #20: 웹으로 만들지 크롬 익스텐션으로 만들지는 모르겠어.
user #30: 설치 부담을 줄이기 위해 웹으로 확정하자.
```

```text
Open Question: 웹과 익스텐션 중 구현 방식
Status: resolved_by_user_decision
Resolved by Decision: 웹 방식 confirmed
```

#### 범위 변경으로 사라진 질문

```text
user #40: PDF에서 이미지를 어떻게 추출할까?
user #44: PDF 업로드는 v0.2로 미루자.
```

```text
Open Question status: superseded_by_scope_change
Decision status: deferred
```

### 현재 Hard Rule 판정

1차 후보 패턴:

```text
?
모르겠, 고민
어떻게, 왜
가능할까, 맞을까, 좋을까
정해야, 선택해야
어때, 궁금해
되나, 되어있나
not sure, wonder, how should, should we, which, whether
```

주요 Rule ID:

```text
open_question.uncertainty
```

후보가 생긴 뒤 다음 guard를 통과해야 한다.

```text
- 실제 질문형 표현이 있어야 함
- 단순 Problem Statement이면 Open Question으로 만들지 않음
- “만들어줘”, “진행해줘” 같은 명령형 Action이면 Open Question보다 Action 우선
```

예시:

```text
“Parser를 어떻게 수정해야 돼?”
→ Open Question

“Parser를 수정해줘.”
→ Action

“Parser가 계속 실패하고 있어.”
→ Problem Signal
```

이후 같은 주제를 공유하는 Decision 또는 assistant 답변을 찾아 상태를 갱신한다. assistant 답변은 짧은 예고 문구보다 실제 내용을 가진 `partial` 또는 `full` 답변을 우선한다.

---

### 5.5 `action`

### 의미

사용자가 assistant에게 요청한 작업 또는 제품·팀이 다음에 수행해야 할 실행 항목이다.

Intent가 목표이고 Decision이 방향이라면 Action은 실제 수행 단위다.

### 주요 세부 타입

| `actionType`          | 의미                                               |
| --------------------- | -------------------------------------------------- |
| `user_requested`      | 사용자가 assistant에게 직접 요청한 작업            |
| `team_next`           | 팀이나 제품이 이후 수행해야 할 작업                |
| `assistant_suggested` | assistant가 제안했지만 사용자가 수락하지 않은 작업 |

### 구체적인 예시

#### 사용자 요청

> 실제 공유 링크 20개를 기준으로 Parser regression test를 만들어줘.

```json
{
  "type": "action",
  "label": "Parser regression test 작성",
  "category": "user_requested",
  "status": "requested",
  "triggerPhrase": "Parser regression test를 만들어줘"
}
```

#### 팀의 다음 작업

> 다음 작업은 Evidence Verifier의 false positive를 측정하는 것이다.

```text
Action type: team_next
Assignee: team
Status: requested 또는 proposed
```

#### Action이 아닌 문장

> Evidence Verifier가 필요한지 궁금해.

이 문장은 수행 명령이 아니라 판단을 요구하므로 `open_question`에 가깝다.

### 현재 Hard Rule 판정

`action.user_request` 대표 패턴:

```text
정리해줘, 만들어줘, 작성해줘
비교해줘, 분석해줘, 검수해줘
제안해줘, 제안해봐, 뽑아줘
진행해봐, 확인해봐
프롬프트 만들어줘
파일로, 문서로, 만들자
make, create, write, compare, analyze, generate, export
```

`action.team_next` 대표 패턴:

```text
우리가 해야 할 일
다음에 해야 할 것
팀은 ... 해야
개발해야 한다
구현해야 한다
테스트해야 한다
다음 작업은
need to, team should
```

현재 Hard Rule의 `user_requested`는 기본적으로 `assignee: assistant`, `status: requested`로 생성된다. 실제 완료 여부는 이후 assistant artifact 또는 완료 응답과의 연결이 필요하며, 공통 SemanticItem에서는 아직 항상 정교하게 갱신되는 것은 아니다.

---

### 5.6 `preference`

### 의미

사용자가 답변이나 산출물을 어떤 방식으로 받고 싶은지 나타내는 표현 선호다.

핵심은 결과물의 **내용 자체가 아니라 전달 방식과 표현 방식**이다.

### 주요 category

| Category              | 의미                  | 예시                                     |
| --------------------- | --------------------- | ---------------------------------------- |
| `tone`                | 말투와 태도           | 실무적으로, 친근하게, 명확하게           |
| `length`              | 답변 길이             | 핵심만 짧게, 상세하게                    |
| `language_expression` | 언어와 표현 수준      | 한국어로, 쉬운 말로                      |
| `format`              | 결과물 형식           | Markdown, JSON, 표, 리스트               |
| `specificity_depth`   | 구체성·구현 깊이      | TypeScript로 옮길 수 있게 구체적으로     |
| `avoidance`           | 피하고 싶은 답변 방식 | 너무 장황하지 않게, 개발자 용어는 피해서 |
| `reinforced`          | 반복해서 강화된 선호  | 여러 구간에서 같은 형식 요구 반복        |

### 구체적인 예시

#### 형식과 깊이 선호

> 팀원이 바로 구현할 수 있도록 TypeScript 기준으로 구체적으로 작성하고, 결과는 Markdown 파일로 만들어줘.

```text
Preference 1
- category: specificity_depth
- label: implementation_ready_depth
- trigger: TypeScript 기준으로 구체적으로

Preference 2
- category: format
- label: format
- trigger: Markdown 파일로

Action
- Markdown 문서 생성 요청
```

#### 길이와 표현 선호

> 핵심은 빠뜨리지 말고, 전문용어는 설명을 붙여서 쉽게 써줘.

```text
Preference: detailed
Preference: language_expression
```

### 현재 Hard Rule 판정

대표 Rule ID와 패턴:

```text
preference.tone
- 친근, 전문적, 명확, 직설, 부드럽, 실무적

preference.length.concise
- 짧게, 간단히, 핵심만, 요약, 한 문장

preference.length.detailed
- 자세히, 상세하게, 충분히, 길게, 세부

preference.language
- 한국어, 영어, 쉬운 말, 표현, 문장, 제품스럽, 기획안스럽

preference.format
- .md, md파일, markdown, JSON, schema, 표로, 리스트, 파일로, 문서로

preference.depth
- 구체적, 세부 규칙, 현실적, 바로 적용, 구현 가능, regex, TypeScript

preference.avoidance
- 빼, 제외, 하지마, 안 할, 필요 없, 말고, 후순위, 추후
```

동일 category의 유사한 선호가 여러 번 나오면 하나로 합치고 `reinforced: true`로 표시하며 confidence를 높인다.

### 주의할 현재 한계

`preference.avoidance` 패턴은 비교적 넓다. 따라서 다음 문장은 Preference와 Content Constraint가 동시에 잡힐 수 있다.

> 기술 구현 내용은 제외하고 기획 내용만 넣어줘.

의도상 올바른 핵심 결과는 다음과 같다.

```text
Content Constraint
- 기술 구현 내용 제외
- 기획 내용 포함
```

하지만 현재 Hard Rule에서는 `제외`가 avoidance Preference에도 일치할 수 있다. 이런 중복은 Rule/LLM 비교와 Review Queue에서 검토해야 한다.

---

### 5.7 `content_constraint`

### 의미

사용자가 요청한 결과물의 내용에 반드시 포함하거나 제외해야 하는 정보, 대상, 조건 또는 기준이다.

Preference가 **어떻게 표현할지**라면 Content Constraint는 **무엇을 담을지**다.

### 주요 constraintType

| Type              | 의미                  | 예시                          |
| ----------------- | --------------------- | ----------------------------- |
| `include_content` | 특정 내용을 포함      | 비용 계산을 넣어줘            |
| `exclude_content` | 특정 내용을 제외      | 기술 구현 내용은 빼줘         |
| `audience`        | 결과물의 대상 독자    | 비개발자 팀원을 대상으로 작성 |
| `domain_point`    | 반드시 다룰 관점·이슈 | 외국인 사용자 관점을 포함     |
| `business_rule`   | 제품·운영 조건        | 월 구독료는 3만원 기준        |
| `source_material` | 참고해야 할 자료      | 첨부한 문서 내용을 반영       |

### 구체적인 예시

> 투자자용 기획안에 1만 명 기준 API 비용과 3만원 구독 모델을 넣고, 상세 소스코드는 제외해줘.

가능한 추출:

```json
[
  {
    "type": "content_constraint",
    "category": "audience",
    "label": "투자자용 기획안"
  },
  {
    "type": "content_constraint",
    "category": "include_content",
    "label": "1만 명 기준 API 비용 포함"
  },
  {
    "type": "content_constraint",
    "category": "business_rule",
    "label": "월 3만원 구독 모델 반영"
  },
  {
    "type": "content_constraint",
    "category": "exclude_content",
    "label": "상세 소스코드 제외"
  }
]
```

### 현재 Hard Rule 판정

메시지를 의미 있는 절로 나누고 각 절에서 다음 패턴을 찾는다.

```text
content_constraint.include_content
- 내용 넣, 넣고, 포함해서, 포함해줘, 반영해서, 추가해줘, 중심으로

content_constraint.exclude_content
- 내용은 빼, 내용 제외, 빼고, 제외하고, 넣지 말고

content_constraint.audience
- 대상은, 사용자층, 고객층, 타겟, audience, persona

content_constraint.domain_point
- 포인트, 관점, 이슈, 문제, pain point, insight

content_constraint.business_rule
- 조건은, 기준은, 정책, 룰은, 규칙은, 제약

content_constraint.source_material
- 첨부한, 위 내용, 이 내용, 이 포인트, 자료, reference
```

한 절에서 여러 패턴이 겹치면 다음 우선순위를 사용한다.

```text
exclude_content
→ audience
→ business_rule
→ source_material
→ domain_point
→ include_content
```

다음 절은 Content Constraint 후보에서 제외한다.

```text
- Problem Statement
- Decision 또는 Open Question 성격이 강한 절
- .md, JSON, 표, 파일로 등의 순수 Format Preference
```

---

### 5.8 `problem_signal`

### 의미

사용자가 겪는 문제, 불편, 실패, 위험 또는 작업 방해 요소다.

Problem Signal은 질문이나 작업 지시가 아니라 현재 상태에 대한 문제 진술이다.

### 주요 category

| Category            | 의미                | 예시                               |
| ------------------- | ------------------- | ---------------------------------- |
| `task_failure`      | 기능이나 작업 실패  | 이미지 붙여넣기가 안 돼            |
| `workflow_friction` | 반복·복잡성·불편    | 매번 수동으로 다시 분석해서 불편해 |
| `product_problem`   | 제품 기능상의 문제  | 결과 화면이 팀원이 이해하기 어려워 |
| `pain_point`        | 그 밖의 명시적 문제 | 문맥이 제대로 이어지지 않아        |

### 구체적인 예시

#### 실패 문제

> 공유 링크를 넣었는데 NO_MESSAGES_FOUND가 발생했어.

```text
Problem Signal
- category: task_failure
- trigger: NO_MESSAGES_FOUND가 발생했어
```

#### 워크플로 불편

> 분석 결과에서 근거 메시지를 찾으려면 계속 위아래로 이동해야 해서 불편해.

```text
Problem Signal
- category: workflow_friction
- trigger: 계속 위아래로 이동해야 해서 불편해
```

#### Problem과 Open Question의 차이

```text
“Parser가 계속 실패하고 있어.”
→ Problem Signal

“Parser가 왜 계속 실패하는 거야?”
→ Open Question
```

### 현재 Hard Rule 판정

문제 후보 패턴:

```text
어려움, 불편, 반복, 문제
페인 포인트, 힘들
복잡해, 복잡해진
실패
```

단, 같은 절에 다음과 같은 명시적 질문 패턴이 있으면 Problem Signal보다 Open Question으로 본다.

```text
?, 어떻게, 왜, 무엇, 뭐야, 가능할까, 할까, 되나, 궁금해
```

category는 trigger phrase의 키워드로 정한다.

```text
실패, 안 돼, 안 보여, 작동 안
→ task_failure

반복, 복잡, 불편, 흐름, 과정
→ workflow_friction

제품, 서비스, 기능
→ product_problem

그 외
→ pain_point
```

---

### 5.9 `satisfaction`

### 의미

assistant 최종 답변과 그 다음 사용자 반응을 연결해, 사용자가 답변을 수용했는지·수정을 원하는지 판단한 신호다.

Satisfaction은 사용자 메시지 하나만 보는 타입이 아니다.

```text
assistant final answer A
→ next clean user reaction U
→ [A, U] pair 분석
```

### 주요 상태

```text
satisfied
partially_satisfied
dissatisfied
correction_requested
clarification_requested
task_failed
direction_changed
alternative_proposed
meta_request
continuing_without_clear_feedback
```

### 구체적인 예시

#### 만족

```text
assistant #10: Rule과 LLM 결과를 비교하는 화면을 만들었습니다.
user #11: 좋아. 이 방향으로 가자.
```

```text
Satisfaction: satisfied
Decision: confirmed
Evidence: [10, 11]
```

#### 부분 만족과 수정 요청

```text
assistant #20: 기획안 초안을 작성했습니다.
user #21: 방향은 맞는데 기술 구현 설명은 줄이고 예시를 더 넣어줘.
```

```text
Primary Satisfaction: partially_satisfied 또는 correction_requested
Secondary status: correction_requested
Content Constraint: 기술 구현 설명 축소, 예시 추가
Action: 기획안 수정
```

#### 불만족

```text
assistant #30: 모든 assistant 메시지를 최종 답변으로 분류했습니다.
user #31: 아니, tool call이 아직 섞여 있잖아.
```

```text
Satisfaction: dissatisfied
Problem Signal: tool call 오염
```

### 현재 Hard Rule 판정

대표 패턴:

```text
satisfaction.task_failed
- 안 보여, 안 돼, 못 만들, 반영이 안, 작동 안, 실패

satisfaction.direction_changed
- 그냥 웹으로, 실제 웹으로, 방향을 바꾸자, 전환하는 게

satisfaction.alternative_proposed
- 이 방식은 어때, 대신 ... 하면, 다른 방식, 이렇게 하면

satisfaction.correction
- 다시, 수정, 고쳐, 바꿔, 빼고, 넣고, 추가, 제외, 재정리

satisfaction.dissatisfied
- 아니, 아닌데, 틀렸어, 별로, 원하는 게 아니야, 잘못 이해

satisfaction.partial
- 좋은데, 맞는데, 방향은 맞아, 다만, 근데, 하지만, 조금 더

satisfaction.clarification
- 무슨 뜻, 왜, 어떻게, 설명, 이해가 안 돼, 차이가 뭐야

satisfaction.satisfied
- 좋아, 맞아, 오케이, 괜찮아, 완료, 충분해, 그걸로
```

처리 시 다음 guard가 적용된다.

- Clean Conversation에 assistant 메시지가 여러 개 연속되면 다음 user 바로 앞의 assistant를 반응 대상으로 사용한다.
- “이제 다음 작업으로 가자” 같은 순수 Topic 전환은 불만족으로 보지 않는다.
- Rule Spec 또는 검수용 대형 예시 메시지는 `meta_request`와 낮은 confidence로 처리한다.
- 마지막 assistant 답변 뒤에 user reaction이 없으면 만족 여부를 확정하지 않고 낮은 confidence로 둔다.
- 여러 상태가 동시에 잡히면 secondary status를 보관하고 Review 대상으로 보낼 수 있다.

---

### 5.10 `change_event`

### 의미

대화 중 이전 방향, 범위, 조건, 형식 또는 구현 단계가 다른 상태로 바뀐 사건이다.

Decision이 **새로 확정된 상태**를 기록한다면 Change Event는 **무엇에서 무엇으로 바뀌었는지**를 기록한다.

### 구체적인 예시

#### 기술 변경

> Qwen 연결은 중단하고 Gemini Shadow Mode로 바꾸자.

```text
Decision
- Gemini Shadow Mode 채택: confirmed
- Qwen 연결 중단: excluded 또는 replaced

Change Event
- from: Qwen
- to: Gemini
- reason/context: API 사용 가능성 또는 운영 조건 변경
```

#### 입력 범위 변경

> 처음에는 PDF 업로드도 넣으려고 했지만, v0.1은 공유 링크만 지원하자.

```text
Change Event: PDF + Share Link 범위에서 Share Link only로 축소
Decision: PDF deferred, Share Link confirmed
```

#### 구현 단계 전환

> Parser 검수는 끝났으니 이제 LLM Shadow Mode 구현으로 넘어가자.

```text
Change Event: Parser 검수 단계 → LLM 구현 단계
Topic: LLM Shadow Mode 구현
```

### 현재 Hard Rule 판정

현재 Hard Rule은 Topic의 `changeReason`으로 다음 변화 신호를 기록한다.

```text
scope_changed
condition_changed
format_changed
perspective_changed
artifact_requested
correction_or_revision
implementation_phase_started
```

하지만 `ruleSemanticAdapter`는 이를 독립 `change_event` SemanticItem으로 변환하지 않는다. 따라서 현재 모니터링 화면에서는 다음처럼 보일 수 있다.

```text
Rule: 없음
LLM: Qwen에서 Gemini로 전환
Verdict: LLM only
```

이는 현재 설계상 예상되는 결과다. 향후 Rule 쪽에서 Change Event를 직접 지원하려면 최소한 `from`, `to`, `changeReason`, evidence를 갖는 별도 추출 규칙이 필요하다.

---

### 5.11 `entity`

### 의미

대화의 맥락과 장기 기억에서 독립적으로 식별할 가치가 있는 사람, 제품, 기술, 기능, 문서, 조직, 개념 또는 데이터 소스다.

단순히 문장에 등장한 모든 명사를 Entity로 만들면 안 된다. 이후 검색·연결·기억에 유용한 구체적인 대상이어야 한다.

### 대표 category 예시

```text
product
feature
technology
problem
goal
document
person
organization
concept
data_source
```

### 구체적인 예시

> TIV는 ChatGPTShareAdapter로 공유 HTML을 가져오고 Gemini를 Shadow Extractor로 사용한다.

가능한 Entity:

```text
TIV
- category: product

ChatGPTShareAdapter
- category: technology 또는 feature

ChatGPT 공유 HTML
- category: data_source

Gemini
- category: technology

Shadow Extractor
- category: feature 또는 concept
```

다음은 보통 Entity로 만들 필요가 없다.

```text
“결과”, “내용”, “방식”, “이것”, “저것”처럼 독립 식별성이 없는 일반 명사
```

### 현재 Hard Rule 판정

현재 Hard Rule에는 Entity SemanticItem 생성기가 없다. `TOPIC_ENTITY_PATTERNS`라는 이름의 패턴이 있지만 이것은 Topic label을 더 구체적으로 만들기 위한 것이며 Entity 항목을 생성하지 않는다.

현재 Entity는 Sprint 5A LLM Shadow가 다음 원칙으로 생성한다.

```text
- 이름이 있거나 명확히 식별 가능한 대상
- 대화 이해에 실제로 유용한 대상
- 원문 evidence와 trigger phrase가 있는 대상
- 일반 명사를 과도하게 Entity로 만들지 않음
```

따라서 현재 Rule/LLM 비교에서는 Entity가 대부분 `LLM only`로 나타난다.

---

### 5.12 `relation`

### 의미

두 개 이상의 Entity가 어떤 방식으로 연결되는지 나타내는 명시적 관계다.

Entity가 기억의 노드라면 Relation은 노드를 연결하는 엣지다.

### 대표 관계 예시

```text
USES
REQUIRES
EXCLUDES
REPLACES
ALTERNATIVE_TO
CAUSES
SOLVES
PART_OF
SUPPORTED_BY
NEXT
```

### 구체적인 예시

#### 기술 사용 관계

> TIV는 Gemini API를 LLM Shadow Extractor로 사용한다.

```text
Source Entity: TIV
Relation: USES
Target Entity: Gemini API
Evidence: 해당 사용자 또는 확정된 설계 문장
```

#### 대체 관계

> Qwen 대신 Gemini를 사용하자.

```text
Source Entity: Gemini
Relation: REPLACES
Target Entity: Qwen
```

#### 구조 관계

> Evidence Verifier는 Hybrid Extraction Pipeline의 일부다.

```text
Source Entity: Evidence Verifier
Relation: PART_OF
Target Entity: Hybrid Extraction Pipeline
```

### 현재 Hard Rule 판정

현재 Hard Rule은 Relation SemanticItem을 직접 생성하지 않는다. Sprint 5A LLM Shadow에만 다음 지시가 있다.

```text
include only named objects and explicit relationships useful for understanding the conversation
```

따라서 다음 기준이 중요하다.

- 두 Entity가 실제로 식별되어야 한다.
- 원문에 관계가 명시되거나 강하게 지지되어야 한다.
- assistant의 제안만으로 사용자의 제품 관계를 확정하면 안 된다.
- 단순히 같은 문장에 함께 등장했다는 이유만으로 Relation을 만들면 안 된다.

현재 Rule/LLM 비교에서는 Relation도 대부분 `LLM only`로 나타나는 것이 정상이다.

---

## 6. 서로 헷갈리기 쉬운 타입 구분

### 6.1 Intent vs Action

```text
“사용자 대화를 장기 기억으로 만들고 싶다.”
→ Intent

“장기 기억 스키마 문서를 만들어줘.”
→ Action
```

Intent는 최종 목적이고 Action은 수행 단위다.

### 6.2 Decision vs Action

```text
“Gemini를 사용하기로 확정하자.”
→ Decision

“Gemini Provider 코드를 구현해줘.”
→ Action
```

“진행하자”는 문맥에 따라 Decision과 Action이 함께 생성될 수 있다. 무엇을 선택하는 문장이면 Decision, 실제 작업 지시면 Action 비중이 크다.

### 6.3 Preference vs Content Constraint

```text
“Markdown 표로 작성해줘.”
→ Preference: format

“표 안에 비용과 토큰 수를 넣어줘.”
→ Content Constraint: include_content
```

판단 질문:

```text
어떻게 보여줄 것인가?
→ Preference

무엇을 담을 것인가?
→ Content Constraint
```

### 6.4 Problem Signal vs Satisfaction

```text
“현재 Parser가 긴 대화에서 실패해.”
→ Problem Signal

assistant 답변 직후 “아니, 아직 Parser가 실패하잖아.”
→ Satisfaction: dissatisfied 또는 task_failed
→ Problem Signal도 동시에 가능
```

Satisfaction은 반드시 앞 assistant 답변과의 관계가 필요하다.

### 6.5 Open Question vs Problem Signal

```text
“배포 라우팅이 끊겼어.”
→ Problem Signal

“왜 배포 라우팅이 끊긴 거야?”
→ Open Question
```

### 6.6 Topic vs Change Event

```text
Topic
- 현재 Gemini API 비용을 논의함

Change Event
- Qwen 비용 검토에서 Gemini 비용 검토로 방향이 바뀜
```

Topic은 현재 논점이고 Change Event는 이전 상태와 비교한 변화다.

### 6.7 Entity vs Topic

```text
Topic
- Gemini API 연결 방식 검토

Entity
- Gemini API
- TIV
- LLM Shadow Extractor
```

Topic은 대화 구간이고 Entity는 그 구간에 등장하는 기억 대상이다.

### 6.8 Entity vs Relation

```text
Entity
- TIV
- Gemini

Relation
- TIV USES Gemini
```

---

## 7. 종합 추출 예시

다음 메시지를 전체적으로 분석해 본다.

> 지금 Rule 결과만으로는 팀원이 사용자의 의도를 이해하기 어려워. Qwen은 일단 제외하고 Gemini를 Shadow Mode로 사용하자. Rule과 LLM 결과를 한 화면에서 비교하고, 각 판단 옆에 근거 문장을 반드시 보여줘. 화면은 너무 장황하지 않게 만들고, 먼저 모니터링 UI 구현 계획을 Markdown으로 작성해줘.

가능한 SemanticItem:

### Intent

```text
Rule과 LLM 결과를 팀이 이해하고 검수할 수 있는 모니터링 환경 구축
```

### Problem Signal

```text
Rule 결과만으로 팀원이 사용자 의도를 이해하기 어려움
category: product_problem 또는 workflow_friction
```

### Decision

```text
Qwen 제외
status: excluded

Gemini Shadow Mode 채택
status: confirmed
```

### Change Event

```text
Qwen 기반 검토 → Gemini Shadow Mode 기반 검토
```

### Content Constraint

```text
Rule과 LLM 결과를 한 화면에서 비교
각 판단 옆에 근거 문장을 반드시 표시
```

### Preference

```text
너무 장황하지 않게
category: avoidance 또는 length

Markdown 형식
category: format
```

### Action

```text
모니터링 UI 구현 계획 작성
status: requested
assignee: assistant
```

### Entity

```text
Rule Extractor
Qwen
Gemini
Shadow Mode
모니터링 UI
```

### Relation

```text
Gemini USED_AS Shadow Extractor
Gemini REPLACES Qwen
Monitoring UI COMPARES Rule Extractor and LLM Extractor
```

이 예시에서 `Open Question`과 `Satisfaction`은 반드시 생성할 필요가 없다. 질문이 없고, 직전 assistant 답변에 대한 반응이라는 정보도 없기 때문이다. 모든 타입을 억지로 채우는 것보다 근거가 없는 타입을 생성하지 않는 것이 중요하다.

---

## 8. Evidence Verifier가 추가로 확인하는 것

Semantic Type이 분류됐다고 바로 확정 결과가 되는 것은 아니다. Sprint 5B Evidence Verifier가 다음을 확인한다.

```text
1. evidenceMessageIndexes가 실제 존재하는가
2. evidence가 Clean Conversation인가
3. triggerPhrase가 인용한 메시지 안에 실제로 존재하는가
4. Intent, Decision, Preference 등 user-backed 타입에 사용자 근거가 있는가
5. Satisfaction이 assistant final answer와 다음 user reaction을 함께 인용했는가
6. Decision에 명시적인 결정 표현이 있는가
7. Open Question에 실제 질문 표현이 있는가
8. Action에 실제 요청 표현이 있는가
9. confidence가 지나치게 낮지 않은가
```

검증 결과:

```text
Verified
- 근거가 직접 확인됨

Review
- 의미는 가능하지만 trigger phrase 불일치, 낮은 confidence,
  암시적 근거 등의 문제가 있음

Rejected
- assistant-only 사용자 판단, Satisfaction pair 누락,
  존재하지 않는 evidence 등으로 확정할 수 없음
```

---

## 9. 모니터링 화면에서 확인할 기준

각 SemanticItem을 검수할 때 다음 순서로 확인한다.

### 9.1 Type이 맞는가

```text
- 목표인가, 작업인가?
- 표현 방식인가, 내용 조건인가?
- 문제 진술인가, 답변 반응인가?
- 현재 주제인가, 방향 변화인가?
```

### 9.2 Trigger phrase가 직접적인가

좋은 trigger phrase:

```text
“PDF 업로드는 추후 기능으로”
“링크로만 대화 내용을 파악”
“Markdown 파일로 만들어줘”
```

나쁜 trigger phrase:

```text
- 메시지 전체를 그대로 복사한 매우 긴 문장
- 원문에 존재하지 않는 LLM의 요약 문장
- tool call 또는 system context에서 가져온 문장
```

### 9.3 Source가 적절한가

```text
Rule only
- 키워드가 우연히 일치한 것은 아닌지 확인

LLM only
- 현재 Hard Rule 미지원 타입인지 확인
- assistant 제안을 사용자 사실로 바꾼 것은 아닌지 확인

Conflict
- status, evidence, 의미 절 분리가 다른 이유 확인
```

### 9.4 현재 구현상 예상되는 LLM only

다음 타입은 현재 Rule이 직접 생성하지 않으므로 `LLM only`가 자주 발생한다.

```text
change_event
entity
relation
```

따라서 `LLM only`라는 이유만으로 잘못된 결과는 아니다. Evidence Verifier 결과와 원문 관계를 함께 봐야 한다.

---

## 10. 현재 Hard Rule의 알려진 한계

1. Intent는 개별 의미 후보가 아니라 Overview에서 대표 항목 하나로 파생된다.
2. `change_event`, `entity`, `relation`은 Rule SemanticItem으로 생성되지 않는다.
3. `preference.avoidance`가 넓어서 Content Constraint와 중복될 수 있다.
4. Topic label은 제한된 명시 객체 패턴과 키워드 조합에 의존한다.
5. Open Question의 `answered` 판정은 답변 길이와 형식 기반 휴리스틱을 포함한다.
6. Action의 실제 완료 여부는 모든 경우에 정교하게 갱신되지 않는다.
7. 짧은 표현은 앞 assistant 문맥 없이는 의미를 정확히 확정하기 어렵다.
8. 동일한 단어가 문맥에 따라 다른 타입이 될 수 있으므로 regex만으로 완전한 구분은 어렵다.

이 때문에 TIV는 다음 구조를 사용한다.

```text
Hard Rule
→ 빠르고 재현 가능한 후보

LLM Shadow
→ 의미 절 분리와 문맥 해석 후보

Evidence Verifier
→ 원문 근거 검증

Rule/LLM Comparison + Review Queue
→ 사람이 충돌과 약한 근거 검수
```

---

## 11. 최종 요약

12개 Semantic Type은 다음 네 그룹으로 이해할 수 있다.

### 사용자 목적과 상태

```text
intent
preference
problem_signal
satisfaction
```

### 대화 흐름과 미해결 상태

```text
topic
open_question
change_event
```

### 결정과 실행 조건

```text
decision
action
content_constraint
```

### 장기 기억 그래프

```text
entity
relation
```

가장 중요한 원칙은 다음과 같다.

```text
Semantic Type은 문장에 키워드가 있다는 이유만으로 확정하지 않는다.

사용자가 실제로 말한 의미,
앞뒤 대화에서의 기능,
직접 인용 가능한 evidence,
Rule과 LLM의 일치 여부,
Evidence Verifier 결과를 함께 확인해야 한다.
```
