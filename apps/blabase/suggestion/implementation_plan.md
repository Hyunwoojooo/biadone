# blabase Priority Suggestion Engine 구현 계획

## 1. 목적

blabase의 중심 결과를 “대화 내용을 잘 정리한 결과”에서 “사용자가 지금 가장 먼저 처리해야 할 일을 근거와 함께 제안하는 결과”로 확장한다.

첫 번째 목표는 **동일 사용자의 ChatGPT 대화 URL을 최소 3개** 받아 사용자의 반복 관심사, 미완료 업무, 약속, 막힘, 결정 대기 사항을 함께 파악하고 **가장 먼저 처리할 단 하나의 task**를 제안하는 것이다. 단순히 각 대화에 나온 action을 나열하거나 가장 최근 요청을 그대로 복사하는 기능은 목표가 아니다.

이 작업은 기존 `src/` 파이프라인을 수정하지 않고 `suggestion/` 안에서 독립 프로토타입으로 개발한다. 제안 품질과 계약이 검증된 뒤에만 기존 분석 API 및 UI와의 통합을 별도 변경으로 진행한다.

## 2. 제품 원칙

1. **먼저 다가간다.** 사용자가 목록을 다시 읽고 우선순위를 정하기 전에 blabase가 다음 행동을 제안한다.
2. **하나를 먼저 고른다.** 기본 화면의 핵심 결과는 우선순위 1위 task 한 개다. 나머지 후보는 설명과 검수용 보조 결과다.
3. **근거 없이 재촉하지 않는다.** 대화 근거가 부족하면 억지로 task를 만들지 않고 `insufficient_evidence`를 반환한다.
4. **사용자의 일과 agent의 일을 구분한다.** 사용자가 직접 해야 하는 task, AI가 대신 처리할 수 있는 task, 사람의 승인만 필요한 task를 분리한다.
5. **긴급함과 중요함을 구분한다.** 최근 언급됐다는 이유만으로 1위가 되지 않는다. 마감, 선행 의존성, 막힘 해소, 사용자 약속, 영향도를 함께 본다.
6. **설명 가능한 제안만 노출한다.** 추천 이유와 원문 evidence를 추적할 수 있어야 한다.
7. **제안과 실행 권한을 분리한다.** 초기 버전은 제안까지만 수행한다. 외부 메시지 전송, 일정 생성, 파일 변경 같은 실행은 사용자 확인과 별도 권한 계약 없이는 하지 않는다.

## 3. 현재 구조와 변경 방향

현재 LLM Shadow Mode는 intent, topic, decision, open question, action 등 모든 의미 후보를 빠짐없이 추출하는 **exhaustive extraction** 구조다. `action`에는 요청된 작업이나 수락된 다음 단계가 들어가지만, 다음 항목은 표현하지 못한다.

- 여러 task 중 무엇을 먼저 해야 하는지
- task가 아직 유효하고 미완료인지
- 누가 해야 하는지
- 마감 또는 시간 민감도가 있는지
- 다른 일을 막고 있는 선행 task인지
- AI가 대신 처리할 수 있는지
- 추천을 지금 보여줘도 될 만큼 근거가 충분한지

따라서 기존 추출 prompt를 단순히 “top task를 골라라”로 바꾸지 않는다. 다음과 같이 관심사를 분리한다.

```text
3+ ChatGPT Share URLs
        ↓
Conversation Restoration / Normalization
        ↓
Per-conversation Task Candidate Extraction
        ↓
Cross-conversation Identity / Task Lineage Merge
        ↓
Evidence / State Verification
        ↓
Deterministic Priority Scoring
        ↓
LLM Recommendation Synthesis
        ↓
Safety / Confidence Gate
        ↓
Top Suggestion + Alternatives + Abstention Reason
```

LLM은 후보 발견과 자연어 설명에 사용하고, 최종 순위의 핵심 요소와 차단 조건은 가능한 한 구조화하고 결정적으로 계산한다. 이 방식은 prompt 변경에 따른 순위 변동을 관찰하고 회귀 테스트하기 쉽다.

## 4. MVP 범위

### 포함

- 동일 사용자의 ChatGPT 공유 URL 최소 3개 입력
- MVP 입력 상한 10개와 URL별 복원 상태 표시
- 각 대화의 독립적인 복원·정규화
- 대화별 task 후보 추출과 대화 간 동일 task lineage 병합
- 여러 대화에서 반복되는 관심사, 막힘, 약속의 교차 신호 활용
- 사용자가 해야 할 미완료 task 후보 추출
- task 상태, 담당자, 근거, 마감 단서, 의존성, 영향도 추출
- 최우선 task 한 개와 최대 3개의 대안 후보 생성
- 왜 지금 해야 하는지에 대한 짧은 설명
- 5~15분 안에 시작할 수 있는 첫 행동 제안
- 근거 부족, 완료 여부 불명, 상충 신호에 대한 보류
- 실행 메타데이터, 토큰, 지연시간, 오류, 버전 기록
- 합성 fixture 기반 단위·통합 테스트와 작은 수동 평가셋

### 제외

- ChatGPT 외 서비스나 캘린더를 합친 전역 우선순위
- 서로 다른 사람의 대화를 자동으로 식별·분리하는 기능
- 실제 task 자동 실행
- 알림 발송 또는 백그라운드 스케줄링
- 사용자별 장기 선호 학습
- 기존 `src/` API, 저장소, 화면 수정
- 기존 Golden Dataset 수정

### 입력 성립 조건

- URL은 최소 3개, 최대 10개를 받는다.
- 중복 URL은 한 개로 계산한다.
- URL 형식 검증뿐 아니라 **복원에 성공한 고유 대화가 최소 3개**여야 제안 엔진을 실행한다.
- 일부 URL이 실패하더라도 성공한 대화가 3개 이상이면 계속 진행하고 실패 URL을 명확히 표시한다.
- 성공한 대화가 3개 미만이면 LLM 추천을 실행하지 않고 추가 URL 입력을 요청한다.
- MVP에서는 사용자가 입력한 URL들이 본인 또는 같은 대상 사용자의 대화라는 전제를 명시적으로 확인받는다. 대화 내용만으로 동일인 여부를 추론하지 않는다.
- 각 대화의 생성 시각이나 메시지 시각을 보존한다. 시각이 없으면 URL 입력 순서를 실제 대화 시간 순서로 간주하지 않는다.

## 4.1 최소 텍스트 UI

이번 MVP의 목적은 제안 품질 확인이므로 시각 디자인과 복잡한 탐색 UI는 만들지 않는다.

### 입력 화면

```text
가장 먼저 할 일을 찾아드릴게요.
같은 사용자의 ChatGPT 공유 URL을 3개 이상 입력하세요.

[ ChatGPT URL 1                                      ]
[ ChatGPT URL 2                                      ]
[ ChatGPT URL 3                                      ]
[ + URL 추가 ]

[ 제안 받기 ]
```

동작:

- 세 번째 URL이 입력되기 전에는 `제안 받기` 버튼을 비활성화한다.
- 중복, 잘못된 URL, 복원 실패를 해당 입력란 바로 아래에 텍스트로 표시한다.
- 분석 중에는 `3개 대화를 읽는 중 → 할 일 찾는 중 → 우선순위 정하는 중` 정도의 상태만 보여준다.

### 결과 화면

```text
지금 가장 먼저 할 일

{task title}
{why now}

첫 단계
{5~15분 안에 시작할 수 있는 행동}

근거: 3개 대화 중 2개에서 반복됨
[근거 보기]

다른 후보
1. ...
2. ...
```

추천할 근거가 부족하면 억지 결과 대신 다음과 같이 표시한다.

```text
아직 가장 먼저 할 일을 정하기 어려워요.
판단에 필요한 대화를 더 추가하거나, 현재 가장 중요한 목표를 알려주세요.
```

스타일은 단일 열, 기본 폰트, 최소 여백만 사용한다. 그래프, 대시보드, 카드 애니메이션, 복잡한 필터는 만들지 않는다.

## 5. 핵심 도메인 계약

### 5.0 분석 요청

```ts
type SuggestionAnalysisRequest = {
  shareUrls: [string, string, string, ...string[]];
  sameUserConfirmed: true;
};

type SuggestionConversationInput = {
  sourceId: string;
  sourceUrlHash: string;
  conversationId: string;
  title: string | null;
  createdAt: string | null;
  normalizedInputHash: string;
  messages: CanonicalMessage[];
};
```

원본 share URL은 private runtime record에서만 다루고, 제안 결과와 Git artifact에는 URL hash 및 안전한 source ID만 남긴다.

### 5.1 Task 후보

```ts
type TaskCandidate = {
  id: string;
  title: string;
  description: string;
  owner: "user" | "agent" | "shared" | "unknown";
  state:
    | "not_started"
    | "in_progress"
    | "blocked"
    | "waiting"
    | "completed"
    | "cancelled"
    | "unclear";
  origin:
    | "explicit_user_commitment"
    | "explicit_user_request"
    | "accepted_next_step"
    | "unresolved_blocker"
    | "open_question"
    | "inferred";
  executionMode:
    | "user_must_act"
    | "agent_can_prepare"
    | "agent_can_execute_with_approval"
    | "unknown";
  deadline: {
    value: string | null;
    precision: "exact" | "date" | "relative" | "none";
    sourceText: string | null;
  };
  dependencies: Array<{
    type: "blocks" | "blocked_by" | "requires_decision" | "waiting_on";
    target: string;
  }>;
  impact: "critical" | "high" | "medium" | "low" | "unknown";
  effort: "minutes" | "hours" | "days" | "unknown";
  sourceConversationIds: string[];
  recurrenceCount: number;
  evidence: Array<{
    conversationId: string;
    messageId: string;
    messageIndex: number;
    role: "user" | "assistant";
    quote: string;
    startChar: number;
    endChar: number;
    supportType: "explicit" | "accepted_context" | "inferred";
  }>;
  confidence: number;
};
```

완료·취소된 후보는 감사 기록에는 남기되 추천 대상에서는 제외한다. `owner: agent`인 항목은 “사용자가 해야 할 일” 1위로 올리지 않고, 사용자 승인 또는 입력이 필요한 부분이 있을 때만 별도의 handoff task로 변환한다.

### 5.2 우선순위 평가

```ts
type PriorityAssessment = {
  candidateId: string;
  eligibility: "eligible" | "review_required" | "ineligible";
  score: number;
  factors: {
    urgency: number;
    blockingPower: number;
    impact: number;
    commitmentStrength: number;
    crossConversationRecurrence: number;
    readiness: number;
    recency: number;
    uncertaintyPenalty: number;
    completionPenalty: number;
  };
  reasonCodes: string[];
};
```

초기 점수는 0~100으로 정규화한다.

```text
score =
  urgency × 0.20
  + blockingPower × 0.20
  + impact × 0.20
  + commitmentStrength × 0.15
  + crossConversationRecurrence × 0.10
  + readiness × 0.10
  + recency × 0.05
  - uncertaintyPenalty
  - completionPenalty
```

가중치는 제품 진실이 아니라 검증할 초기 가설이다. 평가셋 결과 없이 임의로 계속 조정하지 않는다.

필수 제외 조건:

- `state`가 `completed` 또는 `cancelled`
- user task인데 user evidence가 전혀 없음
- 예시, 인용문, 템플릿, 가상의 상황에서만 등장
- assistant가 일방적으로 제안했고 사용자가 수락하지 않음
- 최신 사용자 메시지에서 명시적으로 대체 또는 철회됨

### 5.3 최종 제안

```ts
type PrioritySuggestionResult = {
  schemaVersion: string;
  run: SuggestionRunRecord;
  status:
    | "suggested"
    | "insufficient_evidence"
    | "needs_clarification"
    | "failed";
  topSuggestion: {
    candidateId: string;
    title: string;
    whyNow: string;
    firstStep: string;
    owner: "user" | "shared";
    executionMode: TaskCandidate["executionMode"];
    confidence: number;
    evidenceRefs: string[];
  } | null;
  alternatives: Array<{
    candidateId: string;
    title: string;
    score: number;
  }>;
  candidates: TaskCandidate[];
  assessments: PriorityAssessment[];
  clarificationQuestion: string | null;
};
```

`firstStep`은 추상적인 “진행하기”가 아니라 즉시 시작 가능한 최소 행동이어야 한다. 예: “계약서를 처리하세요”보다 “계약서의 종료일 조항을 열어 갱신 여부를 확인하세요”가 적합하다.

## 6. 추천 결정 규칙

1. 추천 가능한 user/shared 후보만 남긴다.
2. 명시적 마감이 지났거나 임박한 후보를 우선한다.
3. 다른 여러 작업을 막는 후보를 다음으로 우선한다.
4. 사용자가 명시적으로 하겠다고 약속했거나 요청한 후보를 높인다.
5. 영향도가 같다면 지금 바로 시작 가능한 후보를 높인다.
6. 최신성은 보조 신호로만 사용한다.
7. 상위 두 후보의 점수 차가 작고 맥락상 선택 기준이 없으면 `needs_clarification`을 반환한다.
8. 상위 후보가 최소 confidence 또는 evidence 기준을 넘지 못하면 `insufficient_evidence`를 반환한다.
9. assistant-only 제안은 사용자의 수락 근거 없이는 top suggestion이 될 수 없다.
10. 시간 표현은 대화 생성 시각 또는 분석 기준 시각과 함께 해석하며, 기준 시각이 없으면 정확한 긴급도로 단정하지 않는다.
11. 여러 대화에서 반복된 task는 중요 신호지만, 반복 횟수만으로 명시적 마감이나 blocker보다 우선하지 않는다.
12. 한 대화의 오래된 미완료 task가 다른 대화에서 완료·취소·대체된 경우 최신의 명시적 상태를 적용한다.
13. 서로 다른 대화의 task는 제목 유사성만으로 병합하지 않는다. 대상, 목적, 산출물, evidence가 함께 맞아야 한다.

초기 gate 가설:

- 후보 confidence `0.70` 이상
- user의 직접 evidence 최소 1개
- verified evidence span 최소 1개
- 상위 후보와 2위 후보의 점수 차 `8` 이상 또는 명시적 마감 우위

이 수치는 초기 평가를 위한 설정값으로 두고 run record에 반드시 남긴다.

## 7. LLM 처리 설계

### 단계 A: 후보 추출

LLM은 각 대화를 독립적으로 처리하며 요약문이 아니라 구조화된 `TaskCandidate[]`를 반환한다. URL 3~10개의 전체 대화를 한 번의 거대한 prompt에 넣지 않는다.

Prompt 요구사항:

- 현재 시점에 미완료일 가능성이 있는 task만 후보화
- 사용자 task와 agent task 분리
- 명시적 약속, 요청, 막힘, 열린 결정에서 후보 생성
- 완료·취소·대체 신호도 함께 판정
- 예시·코드·인용문·assistant-only 제안 제외
- 모든 판단에 message index와 원문 trigger phrase 첨부
- 마감이 없으면 만들지 말고 `null`
- 한 문장에 여러 task가 있으면 분리
- 같은 task의 상태 변화는 중복 후보가 아니라 하나의 lineage로 병합

### 단계 A-2: 대화 간 task 병합

각 대화에서 나온 후보를 별도 resolver가 비교한다.

- 같은 대상, 목적, 산출물을 가진 task를 동일 lineage 후보로 연결
- conversation ID와 evidence는 병합 후에도 원본별로 보존
- 반복 언급 횟수와 서로 다른 대화 수를 구분
- 최신의 명시적 완료·취소·대체 신호를 상태에 반영
- 병합 확신이 낮으면 하나로 합치지 않고 `review_required`
- 서로 다른 프로젝트의 비슷한 task를 합치지 않도록 entity와 topic context 사용

### 단계 B: 결정적 검증과 점수화

코드에서 다음을 검증한다.

- message index 범위와 clean conversation 여부
- quote와 character span의 정확한 일치
- owner/state/origin 조합의 유효성
- user claim의 assistant-only evidence 여부
- completed/cancelled/replaced 상태
- 중복 task canonical key
- dependency 참조 무결성
- 점수 계산과 tie gate

### 단계 C: 제안 문구 합성

LLM은 이미 선택된 top candidate를 바꾸지 않는다. 선택된 후보와 검증된 evidence만 받아 `whyNow`와 `firstStep`을 간결하게 만든다. 출력이 schema를 통과하지 못하면 결정적 템플릿 문구로 fallback한다.

## 8. 제안 디렉터리 구조

모든 프로토타입 파일은 `suggestion/` 아래에 둔다.

```text
suggestion/
├── implementation_plan.md
├── README.md
├── package.json
├── tsconfig.json
├── app/
│   ├── page.tsx
│   └── api/suggestions/route.ts
├── src/
│   ├── requestSchema.ts
│   ├── restoreConversations.ts
│   ├── types.ts
│   ├── schema.ts
│   ├── versions.ts
│   ├── prompt.ts
│   ├── extractCandidates.ts
│   ├── verifyCandidates.ts
│   ├── mergeTaskLineage.ts
│   ├── scorePriority.ts
│   ├── selectSuggestion.ts
│   ├── synthesizeSuggestion.ts
│   ├── runSuggestionEngine.ts
│   └── runRecord.ts
├── tests/
│   ├── fixtures/
│   ├── schema.test.ts
│   ├── verifier.test.ts
│   ├── scoring.test.ts
│   ├── selection.test.ts
│   ├── pipeline.test.ts
│   ├── multiConversationMerge.test.ts
│   └── requestValidation.test.ts
├── eval/
│   ├── dataset.schema.ts
│   ├── metrics.ts
│   └── runEvaluation.ts
└── docs/
    ├── TASK_DEFINITION.md
    ├── EVALUATION_GUIDE.md
    └── ENGINE_CHANGE_RECORD.md
```

초기에는 기존 프로젝트 모듈을 import하지 않는 self-contained prototype을 권장한다. 이후 통합 시 검증된 계약만 `src/core/suggestions/`로 옮기거나 package 경계를 정한다.

## 9. 구현 단계

### Phase 0 — task 정의와 평가 계약 고정

- “사용자가 지금 해야 할 task”의 포함·제외 기준 작성
- owner, state, origin, deadline, dependency 정의 확정
- abstention과 clarification 기준 확정
- 합성·익명화된 대표 대화 묶음 20~30세트 작성
- 각 세트는 최소 3개 대화로 구성하고 top task, 허용 가능한 대안, 추천 금지 사유를 사람이 라벨링
- dataset version과 SHA-256 기록

완료 조건:

- 두 사람이 같은 대화를 보고 top task에 합의할 수 있는 명확한 rubric
- “추천 없음” 사례가 평가셋에 포함
- 민감한 실제 대화가 Git fixture에 없음

### Phase 1 — schema와 결정적 우선순위 엔진

- Zod 입력·출력 schema 구현
- URL 3~10개, 중복 URL, 복원 성공 대화 3개 gate 구현
- evidence verifier 구현
- task lineage 병합 구현
- 점수 함수와 eligibility rule 구현
- top-1, tie, abstention 선택기 구현
- 경계 사례 중심 단위 테스트 작성

완료 조건:

- 같은 입력과 설정에서 항상 같은 순위
- 완료·취소·assistant-only·가상 task가 top suggestion이 되지 않음
- factor별 점수와 reason code를 설명 가능

### Phase 2 — LLM 후보 추출

- provider와 분리된 prompt contract 작성
- structured output 및 Zod 재검증
- segmentation이 필요한 긴 대화 처리
- segment 간 동일 task와 상태 변화 병합
- partial failure와 retry 기록
- token, latency, model, prompt version 저장

완료 조건:

- candidate recall 목표 충족
- 대화별 실패가 다른 대화의 추출 결과를 훼손하지 않음
- evidence span 검증 통과율 측정
- LLM 실패 시 허위 추천을 반환하지 않음

### Phase 3 — 제안 합성과 UX용 결과

- 선택된 후보의 `whyNow` 및 `firstStep` 생성
- agent가 준비하거나 승인 후 실행 가능한 일 표시
- clarification 질문은 한 번에 하나만 생성
- 자연어 합성 실패 시 deterministic fallback

완료 조건:

- 합성 모델이 결정적 ranking을 변경하지 않음
- 설명이 실제 ranking factor와 evidence에 부합
- 첫 행동이 구체적이고 실행 가능

### Phase 4 — 평가와 보정

- 고정 dataset으로 baseline run 생성
- 후보 추출, 상태 판정, top-1, abstention을 분리 평가
- 오류를 missing task, wrong state, wrong owner, false urgency, wrong ranking, unsafe suggestion으로 분류
- 같은 dataset hash와 두 run ID로만 직접 비교
- 가중치와 prompt 변경마다 Engine Change Record 작성

완료 조건:

- 아래 MVP gate 충족
- 치명적 오류 사례를 regression dataset으로 승격
- 사람이 검수하지 않은 LLM judge 결과를 Gold로 취급하지 않음

### Phase 5 — 기존 blabase와의 통합 결정

프로토타입 평가를 통과한 뒤에만 별도 승인을 받아 진행한다.

- canonical conversation을 공통 입력으로 연결
- 기존 ChatGPT share restoration adapter를 URL별로 호출
- 기존 exhaustive semantic extraction의 verified item을 보조 입력으로 재사용할지 비교
- analysis store에 suggestion run을 별도 필드로 저장
- 기존 분석 API 실패와 suggestion 실패를 분리
- 화면 최상단에 top suggestion을 표시하고 evidence 상세를 접을 수 있게 제공
- 최소 3개 URL 입력과 URL별 오류를 처리하는 텍스트 UI 제공
- 사용자의 “완료”, “아님”, “나중에”, “AI가 해줘” 피드백 수집

이 단계는 기존 파일을 변경하므로 현재 작업 범위에는 포함하지 않는다.

## 10. 평가 지표와 MVP 품질 기준

### 핵심 지표

- **Top-1 Accuracy:** 사람 라벨의 최우선 task와 일치
- **Acceptable@1:** 사람이 허용한 대안 집합 안에 포함
- **Candidate Recall:** 실제 미완료 task를 후보로 발견
- **State Accuracy:** 완료·취소·진행·막힘 상태 판정
- **Owner Accuracy:** user/agent/shared 구분
- **Evidence Precision:** 제시한 quote가 판단을 직접 뒷받침
- **Abstention Precision:** 추천하지 말아야 할 때 올바르게 보류
- **False Urgency Rate:** 근거 없는 마감·긴급성 생성 비율
- **Actionability:** 첫 행동이 구체적이고 바로 시작 가능한 비율

### 초기 MVP gate

- Acceptable@1 ≥ 85%
- 명확한 단일 정답 사례 Top-1 Accuracy ≥ 75%
- Evidence Precision ≥ 95%
- 완료·취소 task 추천률 ≤ 2%
- assistant-only 미수락 제안 추천률 0%
- False Urgency Rate 0%
- 추천 없음 사례의 Abstention Precision ≥ 90%
- schema pass rate 100% 또는 안전한 abstention fallback 100%

작은 개발셋 수치는 제품 품질의 최종 주장으로 사용하지 않는다. release 전에는 별도의 locked holdout과 사람 검수가 필요하다.

## 11. 필수 테스트 시나리오

1. 하나의 명시적 미완료 사용자 task
2. 마감이 있는 task와 최근에 언급된 낮은 중요도 task의 경쟁
3. 여러 task를 막는 선행 task
4. 이미 완료된 task
5. 사용자가 취소하거나 다른 방향으로 대체한 task
6. assistant만 제안하고 사용자는 반응하지 않은 task
7. assistant 제안을 사용자가 명시적으로 수락한 task
8. agent가 해야 할 일만 있고 사용자가 할 일은 없는 대화
9. 사용자 승인 하나만 기다리는 shared task
10. 예시, 템플릿, 코드 안에 task 표현이 있는 대화
11. 상대 날짜가 있지만 대화 기준 시각이 없는 경우
12. 상위 두 task가 동률이라 clarification이 필요한 경우
13. 오래된 task가 최신 상태 변화로 완료된 경우
14. segment를 가로질러 같은 task가 반복되는 긴 대화
15. 상충하는 상태 또는 담당자 evidence
16. task로 볼 만한 근거가 전혀 없는 일반 질의응답
17. 민감하거나 고위험 영역에서 불확실한 task
18. 일부 LLM segment 실패
19. URL이 2개뿐이어서 실행을 차단하는 경우
20. 3개 중 1개 복원 실패로 성공 대화가 2개뿐인 경우
21. 4개 중 1개가 실패했지만 성공 대화 3개로 계속 진행하는 경우
22. 동일 URL을 여러 번 입력한 경우
23. 같은 task가 여러 대화에서 반복되는 경우
24. 비슷한 제목이지만 서로 다른 프로젝트의 task인 경우
25. 앞선 대화의 task가 이후 대화에서 완료·취소된 경우

## 12. 실행 및 기록 계약

제안 엔진의 모든 실행은 다음을 기록한다.

- `analysisId`, 각 `sessionId`, 전체 묶음의 `runId`
- `engineVersion`, `schemaVersion`, `promptVersion`
- `verifierVersion`, `scoringVersion`, `synthesisPromptVersion`
- provider와 정확한 model ID
- code commit SHA
- URL별 정규화 입력 hash, 정렬된 대화 묶음 hash, 출력 hash
- 요청 URL 수, 중복 제외 수, 복원 성공·실패 수
- segmentation 및 gate 설정
- 후보 수, eligible/review/ineligible 수
- top candidate와 score factor
- evidence 검증 상태와 reason code
- latency, retry, token usage, sanitized error
- privacy classification과 retention 정책

버전 초안:

```text
engineVersion: suggestion-engine-v0.1
schemaVersion: suggestion-schema-v0.1
promptVersion: task-candidate-prompt-v0.1
verifierVersion: task-evidence-verifier-v0.1
scoringVersion: priority-score-v0.1
synthesisPromptVersion: suggestion-copy-prompt-v0.1
```

실제 의미 동작을 바꾸면 가장 좁은 관련 버전을 올린다.

## 13. 개인정보와 안전

- raw conversation과 전체 LLM 응답은 `.local/` 또는 승인된 private store에만 둔다.
- Git fixture는 합성 데이터 또는 명시적으로 승인·익명화된 데이터만 사용한다.
- 원문 quote는 사용자 설명에 필요한 최소 범위만 유지한다.
- 외부 LLM 호출 전에 어떤 데이터가 전송되는지 명시한다.
- 의료, 법률, 금융, 보안 등 고위험 task는 높은 confidence만으로 자동 실행하지 않는다.
- 추천이 사용자의 명시적 목표와 충돌하거나 권한을 확대하면 보류한다.
- 피드백은 원래 추천을 덮어쓰지 않고 별도 correction record로 보존한다.

## 14. 예상 위험과 대응

| 위험 | 대응 |
|---|---|
| 최신 언급을 최우선으로 오판 | recency 가중치를 낮추고 deadline, blocking, impact를 분리 |
| 완료 task를 다시 추천 | 상태 변화 lineage와 completion exclusion gate |
| assistant 제안을 사용자 의무로 변환 | user acceptance evidence 없으면 ineligible |
| LLM이 마감을 생성 | deadline source text 필수, 없으면 `null` |
| 긴 대화에서 앞뒤 상태 단절 | segment 간 task canonical key와 상태 이벤트 병합 |
| 서로 다른 대화의 task를 잘못 병합 | 대상·목적·산출물·entity를 함께 비교하고 낮은 확신은 분리 |
| 반복 언급을 중요도로 과대평가 | recurrence는 보조 점수로만 사용하고 마감·blocker를 우선 |
| 서로 다른 사용자의 URL이 섞임 | MVP 입력 전에 동일 사용자 대화임을 확인받고 자동 동일인 추론 금지 |
| URL 일부가 복원되지 않음 | 성공한 고유 대화가 3개 이상일 때만 분석 계속 |
| 너무 많은 “추천 없음” | candidate recall과 abstention threshold를 별도 조정 |
| 항상 무언가를 추천하는 압력 | `insufficient_evidence`를 정상 제품 결과로 설계 |
| 점수는 높지만 이유가 부자연스러움 | ranking과 문구 합성을 분리하고 factor 기반 fallback 사용 |
| 평가셋 과적합 | regression/dev와 locked holdout 분리 |

## 15. 첫 구현 순서

다음 작업 세션에서는 아래 순서로 시작한다.

1. `TASK_DEFINITION.md`에 task 포함·제외 rubric 작성
2. 3~10개 URL 입력·중복·복원 성공 gate와 최소 텍스트 화면 구현
3. `schema.ts`, `types.ts`, `versions.ts` 구현
4. URL별 conversation 복원과 정규화 연결
5. `verifyCandidates.ts`와 evidence span 테스트 구현
6. `mergeTaskLineage.ts`로 대화 간 동일 task 병합 구현
7. `scorePriority.ts`, `selectSuggestion.ts`와 결정적 fixture 테스트 구현
8. 최소 3개 대화로 구성된 합성 평가 세트와 사람 라벨 schema 작성
9. 그 다음에만 LLM candidate prompt와 provider adapter 구현

이 순서를 따르면 LLM prompt가 제품 정의를 대신 결정하는 것을 막고, 추천 품질을 독립적으로 측정할 수 있다.

## 16. 이번 계획의 결정 사항

- 기존 파일은 수정하지 않는다.
- 프로토타입은 프로젝트 루트의 `suggestion/`에 격리한다.
- 동일 사용자의 ChatGPT 공유 URL 최소 3개를 필수 입력으로 받는다.
- 복원에 성공한 고유 대화가 3개 미만이면 추천을 실행하지 않는다.
- MVP UI는 URL 입력, 진행 상태, 최우선 제안과 근거를 보여주는 텍스트 화면으로 제한한다.
- 기존 summary/extraction 결과를 즉시 대체하지 않는다.
- “모든 action 추출”과 “가장 먼저 할 task 선택”을 별도 단계로 둔다.
- 기본 결과는 top suggestion 한 개다.
- 근거가 부족하면 추천하지 않는다.
- 추천과 실제 agent 실행은 별도 권한 단계로 둔다.
- 평가를 통과하기 전에는 기존 blabase API나 UI에 연결하지 않는다.
