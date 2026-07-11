# TIV Semantic Core v1

> 대화 안에서 직접 확인 가능한 의미 구조를 원문 근거와 함께 기록하기 위한 1차 정리 제품의 핵심 계약

| 항목        | 값                             |
| ----------- | ------------------------------ |
| 문서 상태   | Draft v1.0                     |
| 기준일      | 2026-07-11                     |
| 제품 범위   | 사용자용 대화 정리 1차 출시    |
| 입력        | Canonical Clean Conversation   |
| 내부 출력   | 7-Type Semantic Core Snapshot  |
| 사용자 출력 | 별도 Public Summary Projection |

---

## 1. 문서 목적

이 문서는 TIV의 1차 사용자 제품이 대화를 정리할 때 사용하는 내부 의미 모델을 정의한다.

TIV Semantic Core v1은 다음 7개 타입만 사용한다.

```text
intent
topic
content_constraint
problem_signal
change_event
entity
relation
```

이 문서의 목적은 다음과 같다.

- 7개 타입이 각각 무엇을 의미하는지 고정한다.
- 대화 분석에서 말하는 `객관적`의 의미를 정의한다.
- 각 타입의 포함·제외 기준과 서로의 경계를 정한다.
- 모든 항목이 원문으로 역추적되도록 Evidence 계약을 정의한다.
- LLM 후보, 검증 결과, 사용자용 정리 결과를 서로 분리한다.
- 구현과 테스트가 따라야 할 공통 스키마와 불변 조건을 정의한다.

이 문서는 기존 12-Type 모니터링 모델을 설명하는 문서가 아니다. 기존 구현은 비교와 마이그레이션을 위해 유지할 수 있지만, 사용자용 1차 정리 제품의 목표 계약은 이 문서를 기준으로 한다.

---

## 2. 핵심 제품 결정

TIV의 1차 제품은 사용자의 숨은 의도를 추론하거나 다음 행동을 제안하지 않는다.

핵심 약속은 다음과 같다.

> **TIV는 대화 안에서 실제로 표현된 목적, 주제, 조건, 문제, 변화, 대상, 관계를 원문 근거와 함께 정리한다.**

7개 타입은 다음 세 묶음으로 이해한다.

### 2.1 대화의 방향

```text
intent
topic
```

### 2.2 대화의 조건과 변화

```text
content_constraint
problem_signal
change_event
```

### 2.3 대화의 지식 구조

```text
entity
relation
```

### 2.4 빠른 판정표

| Type                 | 한 문장 판정 질문                                 | 최소 근거                              |
| -------------------- | ------------------------------------------------- | -------------------------------------- |
| `intent`             | 사용자가 명시적으로 이루려는 결과는 무엇인가?     | 사용자 목표 표현 또는 명확한 수락 문맥 |
| `topic`              | 이 대화 구간은 무엇을 논의하는가?                 | 실제 논의 메시지 범위                  |
| `content_constraint` | 무엇이 반드시 포함·제외·제한돼야 하는가?          | 규범적인 포함·제외·제한 표현           |
| `problem_signal`     | 무엇이 어렵고, 실패했고, 불편하거나 위험한가?     | 명시적인 문제 진술                     |
| `change_event`       | 무엇이 이전 상태에서 이후 상태로 바뀌었는가?      | before, after, 전환 표현               |
| `entity`             | 다른 구간에서도 동일 대상으로 다시 가리킬 만한가? | 이름 또는 고유 식별 표현               |
| `relation`           | 두 Entity 사이의 어떤 연결이 명시됐는가?          | 두 endpoint와 관계 표현                |

이 7개는 객관적으로 관찰 가능한 대화 정보 전체를 완전하게 분류하려는 온톨로지가 아니다. 1차 정리 제품에서 보존하기로 선택한 7개의 관찰 축이다.

따라서 근거가 있더라도 다음 정보는 별도 타입으로 정규화하지 않는다.

```text
decision
open_question
action
preference
satisfaction
```

해당 정보를 다른 7개 타입에 강제로 매핑하지 않는다.

- 이전 상태가 없는 정적 결정은 `change_event`가 아니다.
- 단기 작업 요청은 자동으로 대화 전체 `intent`가 아니다.
- 질문은 Topic 형성에 기여할 수 있지만 `open_question` 상태를 별도로 보존하지 않는다.
- 형식·길이·톤 선호는 `content_constraint`에 암묵적으로 포함하지 않는다.
- 짧은 긍정·부정 반응은 독립 `satisfaction` 항목이 아니라 문맥 수락 여부를 판단하는 Evidence가 될 수 있다.

이로 인한 정보 손실은 v1의 의도적인 범위다. 후속 버전에서 필요성이 검증되면 별도 계약으로 확장한다.

---

## 3. `객관적 분석`의 정의

TIV에서 `객관적`이라는 말은 외부 세계에서 사실임을 보증한다는 뜻이 아니다.

TIV가 보증하는 것은 다음이다.

> **그 의미가 실제 대화 안에서 누가 말한 내용으로 근거화되는가.**

예를 들어 사용자가 다음과 같이 말했다고 가정한다.

> 시장 규모는 10조 원이야.

TIV가 기록할 수 있는 것은 다음과 같다.

```text
사용자가 시장 규모를 10조 원이라고 언급했다.
```

TIV가 검증하지 않은 채 기록해서는 안 되는 것은 다음이다.

```text
실제 시장 규모는 10조 원이다.
```

즉, Semantic Item은 현실 세계의 사실 레코드가 아니라 원문으로 역추적 가능한 의미 인덱스다.

### 3.1 v1에서 허용하는 근거 수준

| Support Type       | 의미                                                      | Core Snapshot 포함 |
| ------------------ | --------------------------------------------------------- | ------------------ |
| `explicit`         | 인용한 문장에 의미가 직접 표현됨                          | 허용               |
| `accepted_context` | 앞선 단일 제안을 사용자가 명시적으로 수락해 문맥이 확정됨 | 조건부 허용        |
| `inferred`         | 여러 표현을 종합해야만 의미를 추정할 수 있음              | 제외, Review 전용  |
| `unsupported`      | 인용 근거가 없거나 의미를 지지하지 않음                   | 제외, Rejected     |

사용자용 정리 결과는 `verified` 상태의 `explicit`과 엄격히 검증된 `accepted_context`만 사용한다.

### 3.2 Confidence의 의미

`confidence`는 외부 사실의 참일 확률이 아니다.

다음 두 요소에 대한 추출기의 확신을 나타낸다.

```text
1. 이 항목의 Semantic Type 판정이 맞는가
2. 인용한 Evidence가 그 의미를 충분히 지지하는가
```

v1 기본 정책에서는 `confidence < 0.75`인 후보를 `review_required`로 보낸다. 정확한 임계값은 평가 데이터에 따라 조정할 수 있지만, 임계값 변경은 verifier 버전에 기록해야 한다.

---

## 4. 범위와 비범위

### 4.1 v1 범위

- 단일 대화 안에서 7개 의미 타입 추출
- Clean Conversation 기반 분석
- 원문 인용과 문자 위치 검증
- 사용자 발화와 assistant 발화의 귀속 구분
- Topic 구간화와 순서 복원
- 같은 대화 안에서 Entity 별칭 정규화
- 명시적인 Entity 간 Relation 생성
- 검증된 Semantic Core에서 사용자용 정리 결과 생성
- 항목 단위 수정·삭제·누락 추가 피드백 연결

### 4.2 v1 비범위

- 숨은 동기, 심리 상태, 잠재 Intent 추론
- 사용자 성향·프로필 자동 생성
- 다음 행동 추천 또는 우선순위 추천
- 현실 세계의 사실 검증
- 감정 분석과 만족도 분류
- Task 상태 관리와 완료 추적
- 모든 질문의 open/resolved 상태 추적
- 형식·톤·길이 Preference 보존
- 여러 대화 사이의 자동 Entity 병합
- 근거 없는 인과관계 추론
- 대화에 없는 결론이나 이유 생성

---

## 5. 전체 처리 구조

```text
ChatGPT Share
→ CanonicalConversation
→ Clean Conversation 필터
→ Topic Segmentation
→ 7-Type Semantic Candidate Extraction
→ Evidence Verification
→ Normalization and Deduplication
→ Verified Semantic Core Snapshot
→ Public Summary Projection
→ 사용자 결과 페이지
```

각 단계의 책임은 분리한다.

| 단계                      | 책임                                      |
| ------------------------- | ----------------------------------------- |
| CanonicalConversation     | 원본 메시지 순서와 role 보존              |
| Candidate Extraction      | 가능한 7-Type 후보 생성                   |
| Evidence Verification     | 인용문, role, span, 타입별 근거 정책 검증 |
| Normalization             | Topic·Entity 중복 병합, 안정적 ID 생성    |
| Core Snapshot             | 검증된 의미 데이터의 불변 버전 저장       |
| Public Summary Projection | 내부 타입을 읽기 좋은 사용자 구조로 변환  |

Public Summary는 LLM의 원시 후보나 `review_required`, `rejected` 항목을 직접 사용하지 않는다.

---

## 6. 공통 추출 원칙

### 6.1 Clean Conversation만 분석한다

기본 의미 분석 근거는 다음 두 종류다.

```text
- user message
- assistant final answer
```

다음 정보는 Semantic Item의 직접 근거로 사용하지 않는다.

```text
- tool call
- search query
- bash/python 실행 로그
- thoughts/reasoning
- system context
- 중간 transition/update 메시지
- 사용자에게 보이지 않은 내부 payload
```

Context Signal은 외부 조사 여부 같은 보조 metadata로 사용할 수 있지만, 사용자 Intent·Constraint·Problem으로 승격할 수 없다.

### 6.2 Evidence를 먼저 확인한다

모든 후보는 최소 한 개 이상의 Evidence를 가져야 한다.

- `messageIndex`가 실제 대화에 존재해야 한다.
- 인용한 메시지가 Clean Conversation이어야 한다.
- `quote`는 원문에서 그대로 복사해야 한다.
- `startChar`와 `endChar`가 실제 문자 위치와 일치해야 한다.
- 요약문이나 의역을 `quote`로 사용하면 안 된다.
- 여러 메시지가 함께 의미를 완성한다면 모두 Evidence로 저장한다.

### 6.3 의미의 귀속을 보존한다

assistant가 말한 내용을 사용자의 목적이나 문제로 바꾸지 않는다.

각 항목은 의미의 귀속을 가진다.

```text
user
assistant
conversation
```

- `user`: 사용자가 직접 표현했거나 명시적으로 수락한 내용
- `assistant`: assistant가 말했지만 사용자가 수락하지 않은 내용
- `conversation`: Topic처럼 대화 구간 자체를 설명하는 구조 정보

사용자용 목적·조건·문제·변화에는 원칙적으로 `user` 귀속만 사용한다.

### 6.4 assistant 명제와 사용자 확인을 엄격히 구분한다

다음 경우에만 `accepted_context`를 허용한다.

이 정책은 타입별 Support 표에서 `accepted_context`가 허용된 타입에만 적용한다. 특히 `intent`와 `problem_signal`은 목적 또는 문제 내용이 user span에 직접 있어야 하므로 `accepted_context`로 생성하지 않는다.

1. assistant가 하나의 명확한 semantic proposition을 제시했다. proposition은 Constraint 제안, 변화 제안, 관계 진술 또는 서로 경쟁하지 않는 하나의 결합된 범위 패키지일 수 있다.
2. 그 뒤의 첫 번째 substantive Clean user message가 해당 proposition을 명시적으로 수락하거나 사실이라고 확인했다.
3. 중간에 다른 assistant final answer, 사용자 거절 또는 수정이 없다.
4. 사용자의 지시 대상이 다른 후보 없이 하나로 확정된다.
5. assistant proposition과 사용자 acceptance 메시지를 모두 Evidence로 저장한다.

예시:

```text
[12 assistant] 1차에서는 정리만 제공하고 행동 제안은 빼는 건 어때요?
[13 user] 좋아, 그 범위로 가자.
```

가능:

```text
supportType: accepted_context
evidenceRefs:
- message #12: proposition
- message #13: acceptance
```

불가능:

```text
[12 assistant] 정리만 제공할까요? 행동 제안도 넣을까요?
[13 user] 좋아.
```

여러 후보 중 무엇을 수락했는지 불명확하므로 `review_required` 또는 미추출이 맞다. 한 패키지에 포함된 여러 비경쟁 clause는 같은 acceptance Evidence를 공유할 수 있다. 사용자가 패키지 일부를 수정하거나 거절하면 수정된 내용만 별도 direct evidence로 판정하고, 원래 패키지 전체를 수락한 것으로 처리하지 않는다.

### 6.5 근거가 없으면 빈 배열이 정답이다

모든 대화가 7개 타입을 모두 포함하지 않는다.

- 변화가 없다면 `change_event`는 비어 있어야 한다.
- 독립 식별 가능한 대상이 없다면 `entity`는 비어 있을 수 있다.
- 명시적인 관계가 없다면 `relation`은 비어 있어야 한다.
- 사용자가 명시한 목적이 없다면 `intent`를 추측해서 채우지 않는다.

Coverage를 높이기 위해 근거 없는 항목을 생성하지 않는다.

### 6.6 한 의미절에서 여러 타입을 허용한다

7개 타입은 상호 배타적인 문장 분류가 아니라 서로 다른 관찰 렌즈다.

> 1차 목표는 정리 기능을 출시하는 것이고, 데이터가 부족해 의도 검증이 어려우니 행동 제안은 범위에서 제외한다.

가능한 결과:

```text
Intent
- 1차 정리 기능 우선 출시

Content Constraint
- 행동 제안 제외

Problem Signal
- 사용자 데이터 부족
- 의도 검증의 어려움
```

동일 Evidence를 여러 타입이 공유할 수 있다. 다만 같은 의미를 이름만 바꿔 중복 생성해서는 안 된다.

### 6.7 예시·가정·인용·코드를 실제 상태로 오인하지 않는다

다음 표현 안의 내용은 기본적으로 실제 사용자 상태로 사용하지 않는다.

```text
예:
예를 들면
가령
만약
if
example
코드 블록
인용된 템플릿
```

> 예: PDF를 빼자.

위 문장은 실제 Constraint나 Change Event가 아니라 예시일 가능성이 높다.

### 6.8 부정·조건·미래 표현을 보존한다

다음 세 문장은 서로 다른 의미다.

```text
TIV는 Gemini를 사용한다.
TIV는 Gemini를 사용하지 않는다.
TIV가 Gemini를 사용한다면 비용을 확인해야 한다.
```

두 번째 문장을 긍정 `USES` Relation으로 반전해서는 안 된다. Relation으로 보존한다면 `predicate = USES`, `polarity = negated`여야 한다. 세 번째 조건문은 현재 관계로 확정하지 않고 v1 Core Relation에서 제외한다.

---

## 7. 공통 데이터 계약

### 7.1 Core Snapshot

```ts
type SemanticCoreSnapshotV1 = {
  schemaVersion: "tiv-semantic-core.v1";
  snapshotId: string;
  snapshotVersion: string;
  analysisId: string;
  conversationId: string;
  conversationRevision: string;
  createdAt: string;
  extractorVersion: string;
  verifierVersion: string;
  normalizerVersion: string;
  items: CoreSemanticItemV1[];
  evidence: EvidenceAnchorV1[];
};
```

`conversationRevision`은 Evidence span이 어느 불변 원문을 기준으로 계산됐는지 확인할 수 있는 hash 또는 revision ID다.

Snapshot은 한 번 생성된 분석 결과를 재현할 수 있도록 불변 데이터로 저장한다. 재분석 시 기존 Snapshot을 덮어쓰지 않고 새 버전을 만든다.

### 7.2 공통 Semantic Item

```ts
type CoreSemanticTypeV1 =
  | "intent"
  | "topic"
  | "content_constraint"
  | "problem_signal"
  | "change_event"
  | "entity"
  | "relation";

type SemanticEvidenceRefV1 = {
  evidenceId: string;
  role: "direct_support" | "proposition" | "acceptance";
};

type CoreSemanticItemBaseV1 = {
  id: string;
  type: CoreSemanticTypeV1;
  label: string;
  description: string;
  attribution: "user" | "assistant" | "conversation";
  topicIds: string[];
  evidenceRefs: SemanticEvidenceRefV1[];
  supportType: "explicit" | "accepted_context";
  confidence: number;
  canonicalKey: string;
  source: {
    extractor: "rule" | "llm" | "human";
    extractorVersion: string;
    runId: string;
  };
};

type CoreSemanticItemV1 =
  | IntentItemV1
  | TopicItemV1
  | ContentConstraintItemV1
  | ProblemSignalItemV1
  | ChangeEventItemV1
  | EntityItemV1
  | RelationItemV1;
```

타입별 의미를 자유 문자열 `status`나 `category`에 맡기지 않는다. 각 타입은 닫힌 enum을 가진 discriminated union으로 검증한다.

### 7.3 Evidence Anchor

```ts
type EvidenceAnchorV1 = {
  id: string;
  messageId: string;
  messageIndex: number;
  role: "user" | "assistant";
  quote: string;
  startChar: number; // zero-based, inclusive
  endChar: number; // zero-based, exclusive
};
```

하나의 Evidence Anchor는 하나의 실제 원문 span을 가리킨다. 같은 span을 여러 Semantic Item이 참조할 수 있다.

- `explicit` Item의 Evidence Ref는 `direct_support`다.
- `accepted_context` Item은 최소 하나의 `proposition` Ref와 그 뒤의 `acceptance` Ref를 모두 가져야 한다.
- Evidence Anchor는 공유 가능한 원문 span이고, `SemanticEvidenceRefV1.role`은 그 span이 특정 Item에서 수행하는 역할이다.
- Item 전체의 근거 수준은 `CoreSemanticItemBaseV1.supportType`이 결정한다.

구현 JSON Schema는 원칙적으로 `additionalProperties: false`를 사용한다. 선택값은 Structured Output의 안정성을 위해 필드 생략보다 명시적인 `null`을 우선한다.

### 7.4 Candidate와 Verified Core의 분리

LLM이 만든 원시 후보는 바로 `CoreSemanticItemV1`이 아니다.

```ts
type SemanticCandidateV1 = {
  candidate: unknown;
  validationStatus: "pending" | "verified" | "review_required" | "rejected";
  supportType: "explicit" | "accepted_context" | "inferred" | "unsupported";
  reviewReasons: VerificationReasonV1[];
};
```

`verified`가 아닌 후보는 Core Snapshot의 `items`에 포함하지 않는다.

### 7.5 타입별 Support 허용 범위

| Type                 | `explicit` | `accepted_context` | 추가 조건                                 |
| -------------------- | ---------- | ------------------ | ----------------------------------------- |
| `intent`             | 허용       | 금지               | 목적 내용이 user span에 직접 있어야 함    |
| `topic`              | 허용       | 미사용             | 실제 논의 구간 자체로 검증                |
| `content_constraint` | 허용       | 조건부 허용        | 제안과 수락을 모두 인용                   |
| `problem_signal`     | 허용       | 금지               | 문제 내용이 user span에 직접 있어야 함    |
| `change_event`       | 허용       | 조건부 허용        | before, after, 변화 신호와 수락 근거 필요 |
| `entity`             | 허용       | 미사용             | 이름 또는 식별 가능한 원문 표현 필요      |
| `relation`           | 허용       | 조건부 허용        | 관계 제안과 사용자 수락을 모두 인용       |

`accepted_context`는 숨은 의미를 추론하는 방식이 아니다. assistant가 명시한 하나의 semantic proposition 또는 서로 경쟁하지 않는 하나의 결합된 패키지를 사용자가 분명하게 수락·확인했을 때만 앞 문장의 내용을 문맥적으로 복원하는 방식이다.

Public Summary에서 사용하는 기본 attribution은 다음과 같다.

| Type                 | Public Summary 기본 attribution                                       |
| -------------------- | --------------------------------------------------------------------- |
| `intent`             | `user`                                                                |
| `topic`              | `conversation`                                                        |
| `content_constraint` | `user`                                                                |
| `problem_signal`     | `user`                                                                |
| `change_event`       | `user`                                                                |
| `entity`             | `user`, `assistant`, `conversation` 모두 가능                         |
| `relation`           | `user` 또는 `conversation`; `assistant`는 사용자 사실로 표시하지 않음 |

### 7.6 공통 Verification Reason

최소한 다음 reason code를 지원한다.

```ts
type VerificationReasonV1 =
  | "DUPLICATE_ITEM_ID"
  | "MISSING_EVIDENCE"
  | "OUT_OF_RANGE_MESSAGE_INDEX"
  | "NON_CLEAN_EVIDENCE"
  | "MISSING_QUOTE"
  | "QUOTE_NOT_FOUND"
  | "QUOTE_SPAN_MISMATCH"
  | "ATTRIBUTION_MISMATCH"
  | "ASSISTANT_ONLY_USER_CLAIM"
  | "LOW_CONFIDENCE"
  | "INFERRED_SUPPORT"
  | "EXAMPLE_OR_HYPOTHETICAL"
  | "AMBIGUOUS_ACCEPTANCE"
  | "DANGLING_TOPIC_REFERENCE"
  | "DANGLING_ENTITY_REFERENCE"
  | "REFERENCE_CYCLE"
  | "TOPIC_RANGE_INVALID"
  | "CHANGE_ENDPOINT_MISSING"
  | "ENTITY_NOT_IDENTIFIABLE"
  | "RELATION_ENDPOINT_MISSING"
  | "RELATION_PREDICATE_UNSUPPORTED"
  | "RELATION_NOT_EXPLICIT"
  | "RELATION_CO_OCCURRENCE_ONLY"
  | "RELATION_CONDITIONAL_ONLY";
```

---

## 8. 타입별 계약

### 8.1 `intent`

#### 정의

사용자가 대화를 통해 명시적으로 이루려는 목표 또는 원하는 결과다.

Intent는 숨은 동기나 심리 상태가 아니라 대화에 직접 표현된 목적이다.

#### 판정 질문

> 화자가 이 대화를 통해 명시적으로 이루려는 결과는 무엇인가?

#### 포함

- 제품이나 기능을 만들려는 명시적 목표
- 해결하려는 핵심 과제
- 대화 전체 또는 Topic 구간의 원하는 결과
- 여러 메시지에서 반복되며 원문으로 확인되는 목적

#### 제외

- 모델이 추측한 심리적 동기
- assistant가 제안했지만 사용자가 수락하지 않은 목표
- 단순 파일 생성이나 일회성 작업 요청
- 형식·톤·길이 선호
- 질문 문장이라는 이유만으로 만든 목적

#### 타입별 필드

```ts
type IntentItemV1 = CoreSemanticItemBaseV1 & {
  type: "intent";
  attribution: "user";
  supportType: "explicit";
  intentKind: "goal" | "desired_outcome";
  scope: "conversation" | "topic";
  targetEntityIds: string[];
};
```

#### 허용 예시

> GPT 대화를 다시 읽지 않아도 이해할 수 있는 정리 서비스로 만들고 싶어.

```text
Intent
- GPT 대화를 다시 읽지 않아도 이해할 수 있는 정리 서비스 구축
```

#### 금지 예시

> 먼저 정리 기능만 출시할 거야.

```text
금지된 추론
- 실패가 두려워 작은 기능부터 출시하려는 것
```

원문에 없는 감정이나 이유이므로 Intent로 만들지 않는다.

#### 검증 규칙

- `attribution`은 반드시 `user`다.
- `supportType`은 반드시 `explicit`이며, 목적 내용 자체가 user quote 안에 있어야 한다.
- 짧은 수락이나 assistant proposition만으로 Intent를 생성하지 않는다.
- 대화 전체 Intent는 마지막 국소 작업 요청 하나로 덮어쓰지 않는다.
- 명확한 목적이 없으면 빈 배열을 허용한다.

---

### 8.2 `topic`

#### 정의

대화가 특정 구간에서 다루는 구체적인 논의 대상 또는 논점이다.

Intent가 대화의 목적이라면 Topic은 대화가 실제로 전개되는 내용의 단위다.

#### 판정 질문

> 이 대화 구간은 무엇을 논의하는가?

#### 포함

- 새로운 사용자 질문으로 시작된 논점
- 범위·조건·관점·구현 단계가 달라진 논의 구간
- 여러 메시지에 걸쳐 유지되는 구체적인 대상
- 사용자가 다시 찾을 가치가 있는 대화 섹션

#### 제외

- “좋아”, “확인”, “완료” 같은 짧은 반응
- 전환어만 있고 실제 논점이 없는 문장
- 단순히 등장한 제품명이나 사람명
- tool/search 로그만으로 만들어진 주제
- 연속된 같은 논점을 불필요하게 분할한 Topic

#### 타입별 필드

```ts
type TopicItemCommonV1 = CoreSemanticItemBaseV1 & {
  type: "topic";
  attribution: "conversation";
  supportType: "explicit";
  order: number;
  summary: string;
  startMessageIndex: number;
  endMessageIndex: number;
};

type TopicItemV1 = TopicItemCommonV1 &
  (
    | {
        level: "main";
        parentTopicId: null;
      }
    | {
        level: "subtopic";
        parentTopicId: string;
      }
  );
```

#### 허용 예시

> 이제 Parser 얘기는 마무리하고 Gemini API 비용을 검토하자.

```text
Topic
- Gemini API 비용 검토
```

#### 검증 규칙

- `startMessageIndex <= endMessageIndex`여야 한다.
- `order`, `startMessageIndex`, `endMessageIndex`는 음수가 아닌 정수여야 한다.
- `main` Topic의 `parentTopicId`는 `null`, `subtopic`의 `parentTopicId`는 같은 Snapshot의 유효한 Topic ID여야 한다.
- Topic parent는 자기 자신을 가리킬 수 없고 cycle을 만들 수 없다.
- Topic Item 자체의 공통 `topicIds`는 항상 빈 배열이다. 계층은 `parentTopicId`로만 표현한다.
- Topic의 모든 주요 주장은 해당 구간의 Evidence로 지지되어야 한다.
- Topic summary는 의역할 수 있지만 원문에 없는 결론이나 이유를 추가할 수 없다.
- 연속된 동일 Topic은 병합한다.
- Topic은 `conversation` attribution을 기본으로 한다.

---

### 8.3 `content_constraint`

#### 정의

사용자가 요청한 결과물이나 논의 대상의 내용에 반드시 포함·제외·반영해야 하는 정보, 대상, 범위 또는 기준이다.

#### 판정 질문

> 무엇이 반드시 포함·제외·제한되어야 하는가?

#### 포함

- 포함해야 할 내용
- 제외해야 할 내용
- 대상 독자
- 반드시 다룰 관점이나 domain point
- 제품·비즈니스 규칙
- 참조해야 할 source material
- 명시적인 제품 또는 출시 범위 제한

#### 제외

- “Markdown으로”, “표로” 같은 순수 형식 선호
- “짧게”, “친근하게” 같은 길이·톤 선호
- 현재 발생한 문제의 진술
- 단순 작업 요청
- 모델이 추측한 암묵적 제약

형식·길이·톤까지 보존하려면 별도의 Preference 타입을 추가하거나 v2에서 Constraint 계약을 명시적으로 확장해야 한다. v1에서는 암묵적으로 섞지 않는다.

정적 범위 문장에서 Constraint를 추출하더라도 “결정됨”, “후보”, “보류됨” 같은 Decision 상태를 보존하는 것은 아니다. v1은 문장에 독립적으로 명시되고 사용자에게 채택된 유효 범위만 기록한다. 질문형 후보, 서로 경쟁하는 선택지, 수락되지 않은 assistant 제안은 Constraint로 확정하지 않는다.

#### 타입별 필드

```ts
type ContentConstraintItemV1 = CoreSemanticItemBaseV1 & {
  type: "content_constraint";
  attribution: "user";
  supportType: "explicit" | "accepted_context";
  constraintKind:
    | "include_content"
    | "exclude_content"
    | "audience"
    | "domain_point"
    | "business_rule"
    | "source_material"
    | "scope_limit";
  polarity: "include" | "exclude" | "limit" | "require";
  targetEntityIds: string[];
};
```

#### 허용 예시

> 1차 버전에는 대화 정리만 포함하고 행동 제안은 제외해.

```text
Content Constraint
- 대화 정리 포함
- 행동 제안 제외
```

#### 검증 규칙

- 규범적인 포함·제외·제한 표현이 있어야 한다.
- 현재 문제 진술만 있는 경우 해결 조건을 임의로 만들지 않는다.
- 하나의 절에 여러 독립 조건이 있으면 분리한다.
- user evidence 또는 엄격한 accepted context가 필요하다.

---

### 8.4 `problem_signal`

#### 정의

사용자가 명시적으로 말한 문제, 불편, 실패, 위험 또는 작업 방해 요소다.

Problem Signal은 사용자의 감정이나 숨은 불안을 추정하는 타입이 아니다.

#### 판정 질문

> 무엇이 어렵고, 실패했고, 불편하거나 위험하다고 명시됐는가?

#### 포함

- 기능 또는 작업 실패
- 반복·복잡성·불편
- 제품 기능상의 문제
- 명시적인 blocker
- 발생 가능성이 명시된 risk
- 불확실성 자체가 작업 방해나 위험이라고 명시된 경우

#### 제외

- 단순 질문
- 작업 지시
- assistant가 추측한 사용자 문제
- 사용자 발화에 없는 감정·두려움·압박
- 문제처럼 보이지만 실제로는 예시나 가정인 문장

#### 타입별 필드

```ts
type ProblemSignalItemV1 = CoreSemanticItemBaseV1 & {
  type: "problem_signal";
  attribution: "user";
  supportType: "explicit";
  problemKind:
    | "pain_point"
    | "workflow_friction"
    | "product_problem"
    | "task_failure"
    | "blocker"
    | "risk";
  state: "open" | "mitigated" | "resolved" | "unclear";
  affectedEntityIds: string[];
};
```

#### 허용 예시

> 처음부터 의도 파악까지 구현하려니 사용자 데이터를 모으기 어렵고 허들이 높아.

```text
Problem Signal
- 초기 사용자 데이터 수집의 어려움
- 의도 파악 기능의 높은 구현 허들
```

#### 질문문 처리

```text
“Parser가 왜 계속 실패하지?”
→ 실패가 현재 사실로 전제되므로 Problem Signal 가능

“Parser가 실패할까?”
→ 가능성을 묻는 질문만으로 현재 실패를 확정할 수 없으므로 미추출
```

#### 검증 규칙

- 문제 상태가 실제 문장에 명시되어야 한다.
- 질문형이라도 문제의 발생이 전제됐는지 확인한다.
- “무엇을 선택할지 모르겠다” 같은 미결 질문이나 선택 상태를 Problem Signal로 바꾸지 않는다. 불확실성이 작업 방해나 위험이라고 직접 표현된 경우에만 `blocker` 또는 `risk`로 기록한다.
- 상태가 해결됐다고 표시하려면 별도 해결 근거가 필요하다.
- 문제 내용 자체가 포함된 explicit user evidence가 필요하다.

---

### 8.5 `change_event`

#### 정의

대화 중 이전 상태가 이후 상태로 바뀌었다고 명시된 사건이다.

Topic 전환이나 새로운 정적 결정을 모두 Change Event로 취급하지 않는다.

#### 판정 질문

> 무엇이 이전 상태에서 이후 상태로 바뀌었는가?

#### 포함

- 범위 축소 또는 확대
- 조건 변경
- 접근 방식 교체
- 구현 단계 전환
- 한 대상에서 다른 대상으로의 교체

#### 제외

- 이전 상태가 없는 최초 결정
- “이제”, “다시” 같은 전환어만 있는 문장
- 순서상 Topic만 달라진 경우
- assistant가 제안했지만 사용자가 수락하지 않은 변화
- before/after를 복원할 수 없는 모호한 수정
- assistant의 오기, Entity 이름, 요약 표현만 바로잡는 표현 교정

#### 타입별 필드

```ts
type ChangeEventItemV1 = CoreSemanticItemBaseV1 & {
  type: "change_event";
  attribution: "user";
  supportType: "explicit" | "accepted_context";
  changeKind: "scope" | "condition" | "approach" | "phase" | "replacement";
  subjectEntityIds: string[];
  before: string;
  after: string;
  reasonText: string | null;
};
```

#### 허용 예시

> 처음에는 PDF와 공유 링크를 모두 지원하려 했지만, 이제 공유 링크만 지원하자.

```text
Change Event
- before: PDF + 공유 링크
- after: 공유 링크 only
- changeKind: scope
```

#### 금지 예시

> v0.1은 공유 링크만 지원하자.

이 문장만으로는 이전 상태를 알 수 없으므로 `content_constraint`는 가능하지만 `change_event`는 생성하지 않는다.

#### 검증 규칙

- `before`와 `after`가 모두 비어 있지 않아야 한다.
- 두 상태를 연결하는 변화 표현이나 문맥 근거가 있어야 한다.
- `reasonText`는 이유가 원문에 명시된 경우에만 기록한다.
- 상태 변화와 단순 Topic 이동을 구분한다.
- 표현·라벨·오타 교정은 실제 사용자 계획이나 대상 상태의 변화와 구분하고 Change Event로 만들지 않는다.
- user evidence 또는 엄격한 accepted context가 필요하다.

---

### 8.6 `entity`

#### 정의

대화 안에서 독립적으로 식별할 수 있고, 다른 Topic에서도 같은 대상으로 다시 가리킬 가치가 있는 사람, 제품, 기술, 기능, 문서, 조직, 개념 또는 데이터 소스다.

#### 판정 질문

> 다른 대화 구간에서도 동일 대상으로 다시 가리킬 만한가?

#### 포함

- 이름이 있는 제품·서비스
- 특정 기능이나 시스템 컴포넌트
- 기술·API·프레임워크
- 문서·파일·데이터 소스
- 사람·조직
- 대화에서 일관되게 식별되는 핵심 개념

#### 제외

- “결과”, “내용”, “방식”, “문제” 같은 일반명사
- “이것”, “저것”, “그거” 같은 대명사
- 한 번 등장했지만 독립적인 식별 가치가 없는 표현
- 예시나 코드 안에만 등장한 이름
- 모델이 새로 만든 개념명

#### 타입별 필드

```ts
type EntityItemV1 = CoreSemanticItemBaseV1 & {
  type: "entity";
  attribution: "user" | "assistant" | "conversation";
  supportType: "explicit";
  entityKind:
    | "product"
    | "feature"
    | "technology"
    | "document"
    | "person"
    | "organization"
    | "concept"
    | "data_source";
  canonicalName: string;
  aliases: string[];
};
```

#### 허용 예시

> TIV는 ChatGPT 공유 링크를 입력으로 사용하고 Gemini로 의미를 추출한다.

```text
Entity
- TIV
- ChatGPT 공유 링크
- Gemini
```

#### 정규화 규칙

- 같은 대화 안에서 명백한 별칭만 병합한다.
- `Gemini`, `Gemini API`처럼 문맥상 같은 대상이면 하나의 canonical entity 후보로 만들 수 있다.
- 동명이인, 약칭 충돌, 생략 주어가 모호하면 자동 병합하지 않는다.
- 원문 alias와 Evidence를 모두 보존한다.
- v1에서는 여러 대화 사이의 자동 Entity 병합을 하지 않는다.
- 다른 Topic에서 동일 대상을 다시 식별할 수 없는 일반 개념 명사구는 생성하지 않는다.
- Relation endpoint가 필요하다는 이유만으로 명사구를 Entity로 승격하지 않는다. 두 endpoint는 Relation을 고려하기 전에도 각각 Entity 기준을 통과해야 한다.
- enum에 맞지 않는 대상을 편의를 위해 범용 `other`로 밀어 넣지 않는다. 반복되는 미분류 대상이 확인되면 schema version을 올려 category를 추가한다.

---

### 8.7 `relation`

#### 정의

식별된 두 Entity 사이에 원문으로 확인되는 typed edge다. 모든 Relation은 ordered endpoint를 가지지만, `ALTERNATIVE_TO`처럼 의미상 대칭인 predicate도 있다.

Entity가 노드라면 Relation은 Evidence가 있는 엣지다.

#### 판정 질문

> 두 Entity 사이의 어떤 연결이 원문에 명시되어 있는가?

#### 포함

- 사용 관계
- 필요·의존 관계
- 포함·제외 관계
- 대체·대안 관계
- 명시적인 원인·해결 관계
- 부분·소속 관계

#### 제외

- 같은 문장이나 Topic에 함께 등장했다는 이유만으로 만든 관계
- 원문에 없는 인과관계
- 조건문이나 가정에서만 성립하는 관계를 현재 사실로 만든 것
- 부정문을 긍정 관계로 뒤집은 것
- endpoint Entity가 존재하지 않는 관계
- “다음에 해야 할 일”을 Entity 간 Relation으로 바꾼 것

#### 타입별 필드

```ts
type RelationItemV1 = CoreSemanticItemBaseV1 & {
  type: "relation";
  attribution: "user" | "assistant" | "conversation";
  supportType: "explicit" | "accepted_context";
  sourceEntityId: string;
  polarity: "affirmed" | "negated";
  modality: "asserted" | "planned" | "proposed";
  predicate:
    | "USES"
    | "REQUIRES"
    | "INCLUDES"
    | "EXCLUDES"
    | "REPLACES"
    | "ALTERNATIVE_TO"
    | "CAUSES"
    | "SOLVES"
    | "PART_OF"
    | "SUPPORTS";
  targetEntityId: string;
};
```

v1 Relation의 endpoint는 `Entity ↔ Entity`로 제한한다. Topic, Message, 다른 Semantic Item을 endpoint로 연결하는 generic graph는 후속 버전의 별도 계약으로 다룬다.

| Predicate        | canonical 방향                         | 비고                                                |
| ---------------- | -------------------------------------- | --------------------------------------------------- |
| `USES`           | 사용자 → 사용 대상                     | 부정문은 `polarity = negated`                       |
| `REQUIRES`       | 필요로 하는 대상 → 필요한 대상         | 명시적인 필요 표현 필수                             |
| `INCLUDES`       | 전체 → 포함 대상                       | `PART_OF`의 역방향 의미                             |
| `EXCLUDES`       | 범위 주체 → 제외 대상                  | 명시적인 제외 표현 필수                             |
| `REPLACES`       | 새 대상 → 이전 대상                    | 방향 반전 금지                                      |
| `ALTERNATIVE_TO` | canonical ID가 작은 Entity → 큰 Entity | 대칭 관계, 한 번만 저장                             |
| `CAUSES`         | 원인 → 결과                            | 명시적 인과 표지 필수                               |
| `SOLVES`         | 해결 수단 → 문제 대상                  | 해결 관계가 직접 표현돼야 함                        |
| `PART_OF`        | 부분 → 전체                            | `INCLUDES`와 inverse duplicate를 동시에 만들지 않음 |
| `SUPPORTS`       | 지원 주체 → 지원 대상                  | 단순 동시 등장 금지                                 |

#### 허용 예시

> TIV는 Gemini API를 의미 추출기로 사용한다.

```text
Relation
- TIV USES Gemini API
```

> Qwen 대신 Gemini로 바꾸자.

```text
Relation
- Gemini REPLACES Qwen
```

#### 금지 예시

> Parser와 Gemini를 검토했다.

두 Entity의 공동 등장만으로는 방향성 Relation을 만들 수 없다.

> TIV가 Gemini를 사용한다면 비용을 확인해야 한다.

조건문만으로 현재 `TIV USES Gemini`를 확정할 수 없다.

#### 검증 규칙

- `sourceEntityId`와 `targetEntityId`가 같은 Snapshot에 존재해야 한다.
- 두 endpoint는 Relation이 없어도 각각 독립적으로 Entity 기준을 통과해야 한다.
- predicate는 whitelist 안에 있어야 한다.
- 관계 자체를 지지하는 동사 또는 구문이 Evidence에 있어야 한다.
- 방향성을 반대로 저장하지 않는다.
- 대칭 predicate는 canonical Entity ID 순서로 저장해 중복을 제거한다.
- 부정 관계는 `polarity = negated`로 보존하고 긍정 관계로 반전하지 않는다.
- 조건·가정 관계는 v1 Core Relation으로 생성하지 않는다.
- `CAUSES`, `SOLVES`는 특히 보수적으로 판정한다.

---

## 9. 타입 경계

### 9.1 Intent vs Topic

```text
“GPT 대화를 다시 꺼내 쓸 수 있는 서비스로 만들고 싶다.”
→ Intent: 다시 사용할 수 있는 대화 정리 서비스 구축

“이제 Entity와 Relation 추출 방식을 논의하자.”
→ Topic: Entity와 Relation 추출 방식
```

Intent는 도달하려는 결과이고, Topic은 현재 논의하는 내용이다.

### 9.2 Intent vs Content Constraint

```text
“1차 목표는 정리 기능을 출시하는 것이고, 범위에는 정리 기능만 포함할 거야.”
→ Intent: 정리 기능 우선 출시
→ Content Constraint: 1차 범위를 정리 기능으로 제한
```

같은 문장이 명시적인 목표 표현과 독립적인 범위 조건을 동시에 가지면 두 타입을 모두 허용한다. “정리 기능만 넣자”처럼 선택·결정만 표현한 문장을 목표 Intent로 자동 승격하지 않는다.

### 9.3 Topic vs Entity

```text
Topic
- Gemini API 비용 검토

Entity
- Gemini API
```

Topic은 논점 또는 구간이고 Entity는 여러 구간에서 다시 참조할 수 있는 대상이다.

### 9.4 Content Constraint vs Problem Signal

> 현재 요약에 원문에 없는 의도가 섞여 있어. 앞으로 원문에 없는 내용은 넣지 마.

```text
Problem Signal
- 현재 요약에 원문에 없는 의도가 포함됨

Content Constraint
- 원문에 없는 내용 제외
```

Problem은 현재 상태에 대한 서술이고 Constraint는 앞으로 지켜야 할 규칙이다.

### 9.5 Topic vs Change Event

```text
“이제 Gemini 비용을 논의하자.”
→ Topic 전환

“Qwen 비용 검토를 중단하고 Gemini 비용 검토로 바꾸자.”
→ Topic 전환 + Change Event
```

순서상 다음 Topic으로 이동했다는 사실만으로 상태 변화를 만들지 않는다.

### 9.6 Change Event vs Relation

```text
“Gemini는 Qwen의 대안이다.”
→ Relation: Gemini ALTERNATIVE_TO Qwen
→ Change Event 없음

“Qwen 대신 Gemini로 바꾸자.”
→ Relation: Gemini REPLACES Qwen
→ Change Event: Qwen → Gemini
```

Change Event는 시간축의 상태 전환이고 Relation은 Entity 사이의 구조적 연결이다.

### 9.7 Entity vs Relation

```text
Entity
- TIV
- Gemini

Relation
- TIV USES Gemini
```

Entity는 독립 대상이고 Relation은 두 대상 사이의 Evidence-backed edge다.

---

## 10. 종합 예시

다음 사용자 메시지를 분석한다.

> 처음에는 TIV v0.1을 대화 정리와 행동 제안을 함께 제공하는 형태로 출시하려 했지만, 의도 검증에는 사용자 데이터가 필요한데 아직 데이터가 부족해 검증이 어려워서 이제는 ChatGPT 대화 정리만 지원하는 버전으로 출시하고 행동 제안은 제외할 거야.

### 10.1 Intent

```text
TIV v0.1을 ChatGPT 대화 정리 중심으로 출시
```

### 10.2 Topic

```text
TIV v0.1 출시 범위 조정
```

### 10.3 Content Constraint

```text
ChatGPT 대화 정리 포함
행동 제안 제외
```

### 10.4 Problem Signal

```text
사용자 데이터 부족
의도 검증의 어려움
```

### 10.5 Change Event

```text
before: 대화 정리 + 행동 제안
after: ChatGPT 대화 정리 only
changeKind: scope
reasonText: 사용자 데이터 부족으로 의도 검증이 어려움
```

### 10.6 Entity

```text
TIV v0.1
ChatGPT 대화 정리
행동 제안
사용자 데이터
의도 검증
```

### 10.7 Relation

```text
TIV v0.1 SUPPORTS ChatGPT 대화 정리
TIV v0.1 EXCLUDES 행동 제안
의도 검증 REQUIRES 사용자 데이터
```

마지막 Relation은 “의도 검증에는 사용자 데이터가 필요하다”라는 필요 관계가 원문에 직접 표현됐기 때문에 허용한다. 단순히 사용자 데이터와 의도 검증이 함께 등장하거나, 두 문장이 나란히 배치됐다는 이유만으로 생성하지 않는다.

### 10.8 금지되는 추가 해석

```text
사용자가 실패를 두려워한다.
사용자가 리스크 최소화를 최우선으로 생각한다.
정리 기능만 출시하면 반드시 성공한다.
```

어느 문장도 원문에 직접 표현되지 않았으므로 v1 Core에 포함할 수 없다.

---

## 11. Evidence Verification 정책

### 11.1 검증 순서

1. Evidence index가 실제로 존재하는지 확인한다.
2. Evidence가 Clean Conversation인지 확인한다.
3. quote가 해당 메시지에 실제로 존재하는지 확인한다.
4. start/end span이 quote 위치와 일치하는지 확인한다.
5. attribution, supportType, Evidence Ref role의 조합이 유효한지 확인한다. `explicit` user Item은 user `direct_support`가 필요하고, `accepted_context` user Item은 assistant `proposition`과 그 뒤의 user `acceptance`가 모두 필요하다.
6. 예시·가정·인용·코드 여부를 확인한다.
7. 타입별 필수 표현과 필드를 확인한다.
8. confidence threshold를 확인한다.
9. 중복과 충돌을 확인한다.
10. Core Snapshot 포함 여부를 결정한다.

### 11.2 검증 결과

```text
verified
- 직접 근거 또는 엄격한 accepted context가 확인됨

review_required
- 의미는 가능하지만 암시적이거나 acceptance가 모호함
- 낮은 confidence
- Entity alias 또는 Relation 방향 검토 필요

rejected
- 존재하지 않는 Evidence
- Non-Clean Evidence
- quote 또는 span 불일치
- assistant-only 사용자 주장
- 예시·가정·코드 오염
- Relation endpoint 누락
- before/after 없는 Change Event
```

### 11.3 공개 결과 포함 조건

Public Summary에 포함되는 모든 항목은 다음 조건을 만족해야 한다.

```text
validationStatus = verified
supportType ∈ {explicit, accepted_context}
evidenceRefs.length >= 1
모든 Evidence span 유효
타입별 필수 필드 유효
타입별 Public Summary attribution 정책 충족
accepted_context라면 proposition과 acceptance Evidence Ref가 모두 존재하고 순서가 유효
```

특히 `intent`, `content_constraint`, `problem_signal`, `change_event`는 `attribution = user`인 항목만 사용자 사실로 노출한다. `assistant` attribution의 Entity나 Relation을 사용해야 한다면 “assistant가 설명한 내용”임을 문장에 명시하고 사용자 입장으로 승격하지 않는다.

---

## 12. 정규화와 중복 처리

### 12.1 안정적 ID

사용자 피드백과 재분석 결과를 연결할 수 있도록 안정적인 ID를 사용한다.

권장 입력:

```text
conversationId
type
canonicalKey
firstEvidenceMessageIndex
```

### 12.2 Topic 병합

- 연속된 동일 Topic은 하나로 병합한다.
- 같은 label이라도 멀리 떨어진 구간에서 다시 등장하면 Evidence 범위에 따라 별도 Topic을 유지할 수 있다.
- parent/subtopic 관계는 근거가 명확할 때만 생성한다.

### 12.3 Entity 병합

- 같은 대화 안의 명백한 별칭만 병합한다.
- canonicalName은 원문에서 가장 명확하고 구체적인 표현을 우선한다.
- alias가 모호하면 자동 병합하지 않는다.

### 12.4 Semantic Item 중복

다음이 모두 같으면 중복 병합 후보로 본다.

```text
type
canonicalKey
attribution
동일하거나 겹치는 Evidence
```

병합 시 Evidence를 합치되, 서로 다른 상태나 의미를 한 항목으로 뭉개지 않는다.

### 12.5 Relation 무결성

- dangling endpoint를 허용하지 않는다.
- Entity가 병합되면 Relation endpoint를 canonical Entity ID로 치환한다.
- source와 target이 뒤바뀐 중복 Relation을 별도 의미로 오인하지 않는다.

### 12.6 공통 참조와 숫자 불변 조건

- Snapshot의 Item ID와 Evidence ID는 각각 비어 있지 않고 유일해야 한다.
- 모든 Core Item은 한 개 이상의 `evidenceRefs`를 가져야 한다.
- 모든 `evidenceRef.evidenceId`는 같은 Snapshot의 Evidence Anchor를 가리켜야 한다.
- Snapshot에 저장된 Evidence Anchor는 최소 한 개 이상의 Item에서 참조되어야 한다.
- 일반 Item의 `topicIds`는 같은 Snapshot의 Topic ID만 가리킬 수 있다.
- `targetEntityIds`, `affectedEntityIds`, `subjectEntityIds`는 같은 Snapshot의 Entity ID만 가리킬 수 있다.
- `parentTopicId`는 같은 Snapshot의 다른 Topic을 가리켜야 하며 self-reference와 cycle을 허용하지 않는다.
- `confidence`는 finite number이고 `0 <= confidence <= 1`이어야 한다.
- message index, Topic order, span index는 정수여야 한다.
- `startChar >= 0`, `endChar > startChar`이며 message text 범위를 벗어날 수 없다.
- 높은 confidence는 Evidence 또는 참조 무결성 오류를 무효화하지 못한다.

---

## 13. Public Summary Projection 계약

사용자 화면은 7개 타입 이름을 그대로 나열하지 않는다.

검증된 Core Snapshot을 읽기 좋은 구조로 변환한다.

```ts
type ProjectedClaimV1 = {
  id: string;
  text: string;
  sourceItemIds: string[];
  evidenceIds: string[];
};

type ProjectedEntityV1 = {
  id: string;
  name: string;
  kind: EntityItemV1["entityKind"];
  relationSummaries: ProjectedClaimV1[];
  sourceItemIds: string[];
  evidenceIds: string[];
};

type PublicSummaryV1 = {
  schemaVersion: "tiv-public-summary.v1";
  analysisId: string;
  sourceSnapshotId: string;
  projectionVersion: string;
  generatedAt: string;
  title: ProjectedClaimV1;
  overview: {
    purpose: ProjectedClaimV1 | null;
    summary: ProjectedClaimV1[];
  };
  topicSections: Array<{
    id: string;
    title: ProjectedClaimV1;
    summary: ProjectedClaimV1[];
    keyPoints: ProjectedClaimV1[];
  }>;
  conditions: ProjectedClaimV1[];
  problems: ProjectedClaimV1[];
  changes: ProjectedClaimV1[];
  keyEntities: ProjectedEntityV1[];
};
```

사용자에게 보이는 제목, 요약 문장, key point, Relation 설명은 각각 독립 `ProjectedClaimV1`이어야 한다. 섹션 전체에 source ID 집합 하나만 붙이지 않고 문장 단위로 `sourceItemIds`와 `evidenceIds`를 보존한다.

### 13.1 기본 Projection 규칙

- 대표 Intent → `overview.purpose`
- Topic 순서와 summary → `topicSections`
- Content Constraint → `conditions`
- Problem Signal → `problems`
- Change Event → `changes`
- Entity와 Relation → 명칭 정규화, 관련 항목 연결, 자연어 설명 보강

### 13.2 Projection 금지 사항

- Core Snapshot에 없는 새로운 목적을 추가하지 않는다.
- Problem Signal에서 임의의 해결책을 생성하지 않는다.
- Relation이 없는 Entity 사이를 자연어로 연결하지 않는다.
- `review_required`나 `rejected` 후보를 사용자 문장에 섞지 않는다.
- 원문에 없는 확정 상태, 원인, 우선순위를 추가하지 않는다.

초기 Projection은 결정론적인 규칙으로 구현한다. 이후 LLM으로 문장을 다듬더라도 모든 문장에 `sourceItemIds`를 반환하게 하고 다시 검증한다.

---

## 14. Golden Set과 평가 기준

### 14.1 초기 Golden Set

최소 10개의 대표 대화를 사람이 직접 라벨링한다.

반드시 포함할 사례:

- 명확한 Intent가 있는 대화
- 명확한 Intent가 없는 대화
- 여러 Topic이 섞인 긴 대화
- 중간에 방향이 바뀐 대화
- Constraint와 Problem이 한 문장에 함께 있는 대화
- assistant 제안을 사용자가 수락한 대화
- assistant 제안에 사용자 반응이 없는 대화
- Entity 별칭이 반복되는 대화
- 공동 등장만 있고 Relation이 없는 대화
- 예시·가정·코드가 포함된 대화

각 Golden Fixture는 다음을 포함한다.

```text
canonical conversation
expected semantic items
expected evidence spans
expected rejected candidates
expected public summary skeleton
annotation notes
```

### 14.2 품질 지표

| 지표                   | 의미                                       |
| ---------------------- | ------------------------------------------ |
| Type precision         | 생성한 항목의 타입이 맞는 비율             |
| Type recall            | 사람이 표시한 핵심 항목을 놓치지 않은 비율 |
| Evidence precision     | 인용문이 실제 의미를 지지하는 비율         |
| Unsupported claim rate | 원문에 없는 의미를 생성한 비율             |
| Duplicate rate         | 같은 의미를 중복 생성한 비율               |
| Relation validity      | endpoint와 predicate가 모두 유효한 비율    |
| User edit rate         | 사용자가 의미를 수정한 비율                |
| User delete rate       | 사용자가 잘못된 항목을 삭제한 비율         |
| Missing item rate      | 사용자가 누락 항목을 추가한 비율           |

v1 초기 최적화 우선순위는 Recall보다 Precision과 Evidence 정확도다. 누락된 항목은 사용자 피드백으로 보완할 수 있지만, 원문에 없는 해석은 제품 신뢰를 직접 훼손한다.

### 14.3 최소 Release Gate

- 공개되는 모든 항목이 verified Evidence를 가진다.
- 존재하지 않는 Evidence index가 0건이다.
- quote/span 불일치가 0건이다.
- assistant-only 내용을 사용자 주장으로 표시한 사례가 0건이다.
- accepted context Item에서 proposition/acceptance Evidence Ref 누락이 0건이다.
- Change Event의 before/after 누락이 0건이다.
- Relation의 dangling endpoint가 0건이다.
- 7개 외 타입이 Core Snapshot에 포함되지 않는다.
- 같은 입력과 같은 모델 버전에서 결과 계약이 재현 가능하다.

### 14.4 필수 판정 테스트

| ID      | 입력 또는 상황                                                     | 기대 결과                                               |
| ------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| `EV-01` | quote와 `[startChar, endChar)`가 원문과 정확히 일치                | Verified 가능                                           |
| `EV-02` | quote가 없거나 span이 한 글자 어긋남                               | `QUOTE_NOT_FOUND` 또는 `QUOTE_SPAN_MISMATCH`            |
| `EV-03` | tool/system message를 Evidence로 사용                              | `NON_CLEAN_EVIDENCE`                                    |
| `IN-01` | “1차 목표는 대화 정리 기능을 출시하는 것이야.”                     | explicit user Intent                                    |
| `IN-02` | 위 문장으로부터 “실패가 두렵다” 생성                               | `INFERRED_SUPPORT`, Core 제외                           |
| `TP-01` | Parser 논의 뒤 “이제 결과 화면을 보자.”                            | 두 Topic 구간 생성                                      |
| `CC-01` | “원문에 없는 의도는 넣지 마.”                                      | `exclude_content` Constraint                            |
| `CC-02` | “Markdown으로 정리해줘.”                                           | v1 Content Constraint 미생성                            |
| `PS-01` | “데이터를 모으기 어려워.”                                          | Problem Signal                                          |
| `PS-02` | “데이터가 부족할까?”                                               | 현재 문제로 확정하지 않음                               |
| `CE-01` | “처음에는 정리와 행동 제안을 모두 넣으려 했지만 이제 정리만 넣자.” | before/after가 있는 Change Event                        |
| `CE-02` | “정리 기능부터 출시하자.”만 존재                                   | Change Event 미생성                                     |
| `EN-01` | “결과”, “내용”, “이것”                                             | Entity 미생성                                           |
| `RL-01` | “TIV는 Gemini API를 사용한다.”                                     | `TIV USES Gemini API`                                   |
| `RL-02` | “TIV와 Gemini API를 검토했다.”                                     | `USES` Relation 미생성                                  |
| `RL-03` | “의도 검증에는 사용자 데이터가 필요하다.”                          | `의도 검증 REQUIRES 사용자 데이터`                      |
| `RL-04` | “데이터가 부족하다. 의도 검증이 어렵다.”                           | 명시적 관계가 없으므로 Relation 미생성                  |
| `RL-05` | Relation target Entity가 Snapshot에 없음                           | `RELATION_ENDPOINT_MISSING`                             |
| `RL-06` | “TIV가 Gemini를 사용한다면”                                        | 조건부 관계이므로 Relation 미생성                       |
| `RL-07` | “TIV는 Gemini를 사용하지 않는다.”                                  | `USES`, `polarity = negated`                            |
| `AC-01` | 단일 범위 패키지 제안 뒤 “좋아, 그 범위로 가자.”                   | proposition+acceptance를 가진 verified accepted context |
| `AC-02` | 복수 대안 제시 뒤 “좋아.”                                          | `AMBIGUOUS_ACCEPTANCE`                                  |
| `AC-03` | assistant 제안 뒤 사용자 무응답                                    | user Item 미생성                                        |
| `AC-04` | “좋아, 하지만 행동 제안도 넣자.”                                   | 원 패키지 전체 수락 금지, 수정된 user 내용만 판정       |
| `AC-05` | assistant 제안 뒤 “알겠어. 다음으로 넘어가자.”                     | 수락으로 처리하지 않음                                  |
| `AC-06` | assistant가 문제를 진술하고 user가 “맞아.”라고만 반응              | Problem Signal 미생성; user span에 문제 내용 필요       |
| `MT-01` | “1차 목표는 정리 기능을 출시하는 것이고 행동 제안은 제외할 거야.”  | Intent와 Constraint 동시 생성 가능                      |
| `NF-01` | Relation 근거가 전혀 없는 대화                                     | Relation 0개가 정상 결과                                |

---

## 15. 사용자 피드백 계약

사용자 피드백은 원본 Snapshot을 덮어쓰지 않고 append-only event로 저장한다.

```ts
type SemanticFeedbackEventV1 = {
  id: string;
  analysisId: string;
  snapshotId: string;
  snapshotVersion: string;
  semanticItemId: string | null;
  action:
    | "accept"
    | "edit"
    | "delete"
    | "add_missing"
    | "wrong_evidence"
    | "change_importance";
  editedValue: unknown | null;
  evidenceIds: string[];
  createdAt: string;
};
```

학습 데이터로 사용할 때는 다음을 분리한다.

```text
모델 최초 출력
검증 결과
사용자 수정 결과
사용자 삭제 결과
사용자가 직접 추가한 항목
추출기/프롬프트/검증기 버전
```

원본 대화 저장 동의와 모델 개선용 학습 동의는 별도로 관리한다.

---

## 16. 개인정보와 보존 정책

Entity에는 사람 이름, 조직명, 문서명 등 민감한 정보가 포함될 수 있다.

v1 구현은 최소한 다음 원칙을 따른다.

- 분석 목적과 보존 기간을 사용자에게 명확히 알린다.
- 원본 대화 삭제 시 파생 Snapshot과 Evidence도 함께 삭제할 수 있어야 한다.
- 학습 비동의 데이터를 모델 개선 데이터셋에 포함하지 않는다.
- 여러 대화 사이에서 사람 Entity를 자동 병합하지 않는다.
- 사용자용 API에 내부 rejected 후보나 diagnostics를 노출하지 않는다.
- 로그에 원문 전체나 민감한 Evidence를 불필요하게 남기지 않는다.

---

## 17. 버전 관리

다음 버전은 독립적으로 기록한다.

```text
schemaVersion
extractorVersion
verifierVersion
normalizerVersion
projectionVersion
```

다음 변경은 breaking change로 본다.

- 7개 타입의 추가·삭제·이름 변경
- 타입별 enum 의미 변경
- Evidence 필수 조건 완화 또는 강화
- Relation endpoint 범위 변경
- accepted_context 정책 변경
- Public Summary 필드의 의미 변경

breaking change는 기존 v1 Snapshot을 덮어쓰지 않고 새 schema version으로 생성한다.

---

## 18. 현재 구현과의 관계

현재 코드의 공통 `SemanticItem`은 12개 타입을 사용한다.

```text
intent
topic
decision
open_question
action
preference
content_constraint
problem_signal
satisfaction
change_event
entity
relation
```

TIV Semantic Core v1은 이를 즉시 삭제하거나 교체하지 않는다.

권장 전환 순서:

1. 기존 12-Type 계약을 legacy monitoring 모델로 고정한다.
2. 별도 `CoreSemanticItemV1` 7-Type 스키마를 추가한다.
3. 7-Type 전용 extractor와 verifier를 병렬 실행한다.
4. Golden Set에서 두 결과를 비교한다.
5. 검증된 7-Type Snapshot으로 Public Summary를 생성한다.
6. 사용자 페이지는 Public Summary API만 사용한다.
7. 충분한 운영 데이터가 쌓인 뒤 legacy 제거 여부를 결정한다.

기존 12개 타입을 7개로 기계적으로 변환하는 adapter는 임시 비교 도구로만 사용할 수 있다. 의미가 정확히 대응되지 않는 항목은 변환하지 않아야 한다.

---

## 19. 구현 우선순위

### Milestone 1. Semantic Contract

- 이 문서 팀 검토 및 승인
- 7-Type Zod discriminated union 작성
- Evidence Anchor 스키마 작성
- Verification Reason enum 작성

### Milestone 2. Golden Set

- 대표 대화 10개 선정
- 사람이 7-Type 정답 라벨링
- expected Evidence span 작성
- 예상 Public Summary skeleton 작성

### Milestone 3. Extraction and Verification

- 7-Type 전용 LLM prompt
- Candidate schema validation
- Evidence span verifier
- 타입별 정책 검증
- Topic/Entity normalizer
- Relation endpoint validator

### Milestone 4. Public Summary

- 결정론적 Summary Projector
- 사용자용 Summary API
- `/results/[analysisId]` 결과 페이지
- 원문 Evidence 패널

### Milestone 5. Feedback and Persistence

- 항목 수정·삭제·누락 추가
- append-only feedback event 저장
- 영속 저장소 연결
- 개인정보·삭제·학습 동의 정책 적용

---

## 20. 완료 기준

TIV Semantic Core v1은 다음 조건을 만족하면 구현 가능한 계약으로 간주한다.

1. 팀원이 같은 대화를 보고 7개 타입을 비슷하게 라벨링할 수 있다.
2. 모든 Core Item이 실제 원문 Evidence로 역추적된다.
3. 숨은 Intent, 감정, 인과관계를 근거 없이 생성하지 않는다.
4. 타입이 없는 경우 빈 배열을 정답으로 허용한다.
5. Topic과 Entity, Constraint와 Problem, Change와 Relation의 경계가 테스트로 고정된다.
6. Public Summary의 모든 문장이 Core Item과 Evidence로 역추적된다.
7. 사용자 수정 결과를 원본 출력과 분리해 저장할 수 있다.
8. schema와 extractor 버전이 달라져도 이전 결과를 재현할 수 있다.

최종 원칙은 다음과 같다.

> **분류할 수 있어서 생성하는 것이 아니라, 대화 안의 직접 근거로 검증할 수 있을 때만 생성한다.**
