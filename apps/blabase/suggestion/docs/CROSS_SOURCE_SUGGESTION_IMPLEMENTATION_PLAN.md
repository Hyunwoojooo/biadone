# blabase Cross-Source Suggestion Engine 구현 계획

> Notion, Google Calendar, GitHub, Codex와 기존 대화 신호를 이용해
> Codex 작업 진행을 가시화하고, 사용자가 지금 개입할 가치가 가장 큰 열린
> 루프 하나를 근거와 함께 제안하는 Execution Observability +
> Action/Recommendation Layer 계획

| 항목 | 값 |
|---|---|
| 문서 상태 | Draft v0.2 |
| 기준일 | 2026-07-26 |
| 대상 프로토타입 | `suggestion/` |
| 현재 엔진 | `suggestion-engine-v0.3` |
| 선행 계획 | `suggestion/implementation_plan.md` |
| 규범 문서 | `docs/ENGINE_DEVELOPMENT_RECORDS.md` |
| 구현 상태 | 계획 단계, 동작 변경 없음 |

---

## 1. 이 계획의 결론

Cross-source 엔진은 모든 도구의 항목을 같은 task 목록에 넣고 하나의 점수로
정렬하는 시스템으로 만들지 않는다.

제품의 역할은 다음과 같다.

> **연결되고 갱신된 범위에서 사용자의 주의나 행동이 필요한 열린 루프를
> 찾고, 지금 처리할 가치가 가장 큰 개입 하나를 근거와 함께
> 제안한다.**

따라서 전체 제품 모델은 `Work Cockpit + Attention Router`다. Work Cockpit은
정상 진행을 포함한 실행 현황을 보여주고, Attention Router는 그중 실제 개입이
필요한 예외와 열린 루프만 고른다. ranking component는 `Priority Task Scorer`가
아니다.

첫 구현의 핵심은 완벽한 가중치가 아니다.

1. 출처가 실제로 증명하는 사실을 보존한다.
2. 완료, 담당자, 마감, 대기 상태의 충돌을 안전하게 해결한다.
3. 추천하면 안 되는 후보를 먼저 제외한다.
4. 추천, clarification, no-action을 모두 정상 결과로 지원한다.
5. 같은 입력으로 정책 버전을 재생하고 비교할 수 있게 한다.
6. 평가 사례와 명시적 사용자 피드백으로 좁은 단계씩 개선한다.

Codex는 별도의 원칙을 적용한다. 정상적으로 진행 중인 실행은 추천 후보가
아니라 **가시적으로 보여줘야 하는 관찰 정보**다. 정체, 실패, 완료 후
후속조치 누락처럼 사용자의 실제 개입이 필요한 예외가 검증됐을 때만
AttentionItem으로 승격한다.

---

## 2. 기존 계획 및 Semantic Core와의 관계

### 2.1 기존 ChatGPT suggestion 엔진

`suggestion/implementation_plan.md`와 현재 v0.3 엔진은 동일 사용자의
ChatGPT 공유 대화 3~10개에서 다음 task 하나를 제안한다.

현재 흐름은 다음과 같다.

```text
ChatGPT Share URLs
→ Conversation Restoration
→ LLM Raw Task Candidate Extraction
→ Evidence Verification
→ Exact-key Task Lineage Merge
→ Deterministic Priority Score
→ Top Eligible Selection
```

이 구현에서 재사용할 가치가 높은 부분:

- LLM 후보 발견과 결정적 선택의 분리
- exact evidence quote와 span 검증
- user/agent/shared owner 구분
- 완료, 취소, 대체 task 제외
- assistant-only 제안을 사용자 의무로 만들지 않는 gate
- factor, reason code, run version 기록

Cross-source에서 교체하거나 확장해야 하는 부분:

- 3개 이상의 ChatGPT URL을 필수로 하는 입력 계약
- 대화 evidence만 표현할 수 있는 evidence 모델
- canonical key exact match 기반 lineage
- 모든 eligible 후보 중 하나를 항상 고르는 v0.3 선택 정책
- 실제 시각 대신 recurrence count에 의존하는 recency factor
- 마감과 영향이 불명확한 후보에도 주는 기본점
- connector freshness, truncation, permission 상태가 없는 run contract

기존 문서와 구현은 삭제하거나 덮어쓰지 않는다. Cross-source 평가가 통과할
때까지 별도의 계약과 실행 경로로 유지한다.

### 2.2 Semantic Core v1

`docs/BLABASE_SEMANTIC_CORE_V1.md`는 대화에서 직접 확인 가능한 의미를
근거와 함께 기록하는 계층이다. 다음 행동 추천과 task 상태 관리는 의도적으로
비범위다.

따라서 Cross-source 엔진은 Semantic Core 타입을 확장하거나 connector record를
가짜 conversation message로 변환하지 않는다.

권장 계층은 다음과 같다.

```text
Source Adapters / Semantic Core
              ↓
       Evidence-backed Signals
              ↓
 Observation + Action Layer
        ├──────────────┐
        ↓              ↓
Execution Overview  Recommendation Decision
        └──────┬───────┘
               ↓
         Work Cockpit UI
```

---

## 3. 제품 가설과 초기 사용자

### 3.1 핵심 사용자 문제

사용자는 할 일이 부족해서 어려운 것이 아니다.

다음 정보가 서로 다른 도구에 흩어져 있어 매번 맥락을 복구하고 다시 판단해야
하는 것이 문제다.

- 약속한 일
- 마감
- 다른 사람의 리뷰 요청
- 여러 Codex 작업의 현재 진행 단계
- 정체, 실패 또는 완료 후 닫히지 않은 Codex 작업
- 아직 끝나지 않은 내부 task
- 다음 일정까지 사용할 수 있는 시간
- 현재 가장 중요한 목표

사용자가 해결하려는 질문은 다음과 같다.

```text
지금 실제로 열려 있는 일은 무엇인가?
Codex 작업은 각각 어디까지 진행됐는가?
정상 진행과 내가 개입해야 하는 예외는 무엇인가?
그중 왜 이것을 먼저 봐야 하는가?
누가 또는 무엇이 나를 기다리고 있는가?
내가 해야 하는가, AI가 준비할 수 있는가?
지금 가진 시간 안에 어디서 시작하면 되는가?
추천이 틀렸다면 어떻게 바로잡는가?
```

### 3.2 초기 타깃 가설

첫 검증 사용자는 다음 조건에 가까운 1인 개발자, 메이커 또는 창업자로
제한하는 것을 초기 가설로 둔다.

- Notion으로 프로젝트나 task를 관리한다.
- Google Calendar로 개인 일정을 관리한다.
- GitHub issue, PR, review를 사용한다.
- Codex로 실제 개발 작업을 진행한다.
- 한 번에 여러 프로젝트를 오가며 context switching 비용을 겪는다.

이 타깃은 확정된 사용자 연구 결과가 아니다. 초기 dogfooding과 인터뷰로
검증해야 한다.

### 3.3 제품 표현 원칙

다음 표현은 사용하지 않는다.

```text
당신에게 가장 중요한 일
반드시 지금 해야 하는 일
AI가 당신의 우선순위를 정확히 파악함
```

대신 다음 범위로 표현한다.

```text
연결되고 방금 갱신된 범위에서는 이 항목을 먼저 확인하는 것이 좋습니다.
현재 확인된 마감, 실행 이상, 아직 닫히지 않은 후속 작업을 기준으로
이 항목이 먼저입니다.
두 후보의 우선순위를 정하려면 한 가지 확인이 필요합니다.
지금은 사용자가 직접 개입할 항목이 없습니다.
```

---

## 4. 고정할 계약과 실험할 가설

정답이 하나가 없는 추천 문제에서 구현 계획의 목적은 가중치를 미리 완성하는
것이 아니라 안전한 실험 경계를 만드는 것이다.

### 4.1 지금 고정할 계약

- 원본 source와 evidence lineage 보존
- source별 허용 scope와 freshness 표시
- 완료, 취소, 대체 항목 제외
- 사용자의 실제 개입이 필요한지 검증
- 정상 진행 중인 Codex 실행은 추천하지 않고 overview에만 표시
- Codex 승인·입력 요청의 발생, 해결, 만료 수명주기 검증
- 해결되거나 만료된 일시적 attention 신호 즉시 제외
- Codex 실행 완료와 GitHub/Notion task 완료를 분리
- 근거 없는 마감, 영향, 긴급성 생성 금지
- source claim 충돌을 덮어쓰지 않고 보존
- 낮은 확신의 cross-source fuzzy merge 금지
- `needs_clarification`, `no_action`, `insufficient_evidence` 지원
- 추천과 외부 쓰기 또는 자동 실행 권한 분리
- 원본 값과 사용자 correction 분리
- dataset, schema, normalizer, resolver, policy version 기록
- 같은 frozen input으로 run을 비교

### 4.2 평가로 바꿀 초기 가설

다음은 문서에 확정값으로 고정하지 않고 versioned configuration으로 둔다.

- attention lane의 세부 순서
- urgency, blocker, goal alignment 가중치
- 추천과 clarification 사이의 차이 기준
- source freshness TTL
- Codex에서 의미 있는 진전을 판정하는 규칙
- Codex 실행의 phase별 정체 threshold
- Codex failure 복구 관찰 window
- 짧은 승인·입력 대기 신호의 attention 승격 threshold
- 프로젝트별 완료 후 후속조치 정책과 grace period
- scope drift 탐지 기준
- recurrence와 recency 반영 정도
- Calendar free-block 적합성 계산
- first-step 예상 시간
- 사용자별 project 또는 action preference
- 추천 문구
- provisional release threshold

모든 초기 값에는 다음 의미를 붙인다.

```text
Initial hypothesis — frozen evaluation 결과에 따라 변경 가능
```

---

## 5. Cross-source MVP 범위

### 5.1 포함

- 사용자가 선택한 connector scope만 사용
- connector snapshot validity와 freshness 검사
- source별 `WorkSignal` 정규화
- GitHub review request와 assigned issue 후보
- Codex 실행별 진행 상태와 최근 의미 있는 진전 overview
- 검증된 Codex 정체, 실패, 완료 후 후속조치 누락 후보
- 오래 지속되고 아직 유효한 Codex 승인·입력 대기만 조건부 후보
- Google Calendar 기반 free-block과 실행 적합성
- 명시적으로 매핑된 Notion task database 후보
- 선택적인 기존 ChatGPT conversation candidate
- 사용자 입력 `이번 주 최우선 결과` 한 줄
- source-native ID, explicit link, user mapping 기반 lineage
- claim별 source authority와 conflict resolver
- hard eligibility gate
- attention lane과 lane 내부 결정적 ranking
- top suggestion 한 개와 최대 두 개의 alternatives
- 근거, freshness, why-now, first-step
- clarification 및 no-action 결과
- 명시적 correction과 feedback event
- versioned run record
- 합성 또는 승인된 익명 평가 dataset

### 5.2 제외

- Notion 일반 페이지 본문과 댓글 전체 수집
- Calendar 제목을 기본 task 의미로 해석
- GitHub 코드, issue/PR 본문, 댓글 전체 수집
- Codex prompt, response, command, output 전체 수집. 단, 로컬에서 최소화해
  파생한 execution state/progress metadata는 허용
- 제목 유사성만으로 자동 cross-source merge
- 모든 source raw data를 하나의 LLM prompt에 전달
- 자동 일정 생성, PR 처리, 메시지 전송
- background notification 전달. 단, connector에서 일시 알림의
  발생·해결 상태를 읽는 것은 포함
- 장기 성향 또는 심리 프로필 생성
- production 반응을 자동 Gold로 승격
- 학습형 개인화 ranker
- 기존 `gold-core-v0.1` 수정
- 기존 ChatGPT v0.3 실행 경로 즉시 제거

### 5.3 첫 vertical slice

첫 end-to-end 결과는 다음 데이터만으로 만든다.

```text
GitHub review/assigned issue
+ Codex execution progress/stall/failure/follow-through state
+ Google Calendar free-block
+ 사용자의 이번 주 목표 한 줄
→ Codex execution overview
→ top / clarification / no-action
```

Notion은 task DB property mapping이 구현된 후 직접 후보 소스로 추가한다.
Codex 승인·입력 요청은 overview에서 즉시 상태로 보여줄 수 있지만, 짧게
발생했다가 바로 해결되는 동안에는 ranking 후보로 만들지 않는다.

---

## 6. 추천 대상과 결과 상태

### 6.1 Attention intervention type

```ts
type AttentionIntervention =
  | "do"
  | "review"
  | "approve"
  | "decide"
  | "inspect"
  | "resume"
  | "close_loop"
  | "prepare"
  | "follow_up"
  | "clarify"
  | "wait"
  | "none";
```

| Type | 의미 | 예시 |
|---|---|---|
| `do` | 사용자가 직접 수행 | assigned issue의 다음 단계 |
| `review` | 검토와 피드백 | GitHub PR review request |
| `approve` | agent 또는 작업 승인 | 오래 지속된 유효한 승인 대기 |
| `decide` | 사용자 결정 필요 | 오래 지속된 구현 방향 입력 대기 |
| `inspect` | 상태 또는 실패 원인 확인 | 정체된 Codex 실행 로그 열기 |
| `resume` | 중단된 작업 재개 | 실패 원인을 확인한 실행 재개 |
| `close_loop` | 완료된 실행의 후속조치 | 변경 검토 또는 PR 생성 |
| `prepare` | 예정된 약속 전 준비 | 연결된 회의 전 검토 |
| `follow_up` | 외부 대기 상태 확인 | 응답 기한이 지난 명시적 follow-up |
| `clarify` | 추천 전에 사용자 확인 | 목표가 다른 동순위 후보 |
| `wait` | 지금 사용자 행동 없음 | 외부 응답 대기 |
| `none` | 열린 사용자 개입 없음 | agent가 진행 중이고 마감 없음 |

`approve`와 `decide`는 Codex 이벤트가 발생했다는 사실만으로 만들지 않는다.
현재도 미해결인지, 얼마나 지속됐는지, 실제 작업을 막는지 확인한 뒤
versioned escalation policy를 통과한 경우에만 추천 후보로 만든다.

### 6.2 결과 상태

```ts
type CrossSourceSuggestionStatus =
  | "suggested"
  | "needs_clarification"
  | "no_action"
  | "insufficient_evidence";
```

| 상태 | 의미 |
|---|---|
| `suggested` | 근거와 상태가 검증된 top intervention이 있음 |
| `needs_clarification` | 유효 후보는 있지만 목표 또는 충돌을 해결할 질문이 필요 |
| `no_action` | source가 정상이며 지금 사용자 개입이 필요하지 않음 |
| `insufficient_evidence` | source 실패, stale, truncation 또는 evidence 부족 |

`no_action`과 `insufficient_evidence`를 합치지 않는다. 사용자가 할 일이 없는
상태와 엔진이 모르는 상태는 제품적으로 다르다.

---

## 7. 전체 파이프라인

```text
Current + Prior Source Snapshots + Optional Conversation Candidates
                         ↓
           Snapshot Validity / Freshness Gate
                         ↓
               Source-specific Normalizers
                         ↓
                    WorkSignal[]
                         ↓
      Codex Timeline / Meaningful Progress / Request Lifecycle
                         ├──────────────→ Codex Execution Overview
                         ↓
       Project Mapping / Native Deduplication
                         ↓
       Attention Identity and Lineage Resolver
                         ↓
         Claim Authority and Conflict Resolver
                         ↓
           Candidate Intervention Derivation
                         ↓
                Hard Eligibility Gate
                         ↓
        Attention Lane → Within-lane Ranking
                         ↓
       Calendar Fit / Deterministic First Step
                         ↓
       Suggest / Clarify / No Action / Abstain
                         ↓
   Evidence + Execution Status Presentation / Feedback
```

`CodexExecutionOverview`는 candidate derivation보다 먼저 만든다. 모든 정상
실행과 최근 완료를 사용자에게 보여주되, overview에 있다는 이유로 ranking
점수를 얻지는 않는다. 같은 실행에서 검증된 예외가 있을 때만 별도의
AttentionItem을 파생한다.

Codex의 정체와 진전은 단일 snapshot으로 판단하지 않는다. 동일 execution의
순서가 보존된 현재·이전 snapshot window에서 `lastActivityAt`과
`lastMeaningfulProgressAt`을 분리해 계산한다. heartbeat, 동일 로그 반복,
단순 polling은 activity일 수 있지만 정체 시간을 초기화하는 meaningful
progress는 아니다. Codex 이외의 source signal은 이 분기를 통과해 그대로
resolver로 전달한다.

### 7.1 LLM 사용 위치

LLM을 허용하는 위치:

- 기존 conversation의 자유 텍스트에서 task fact 후보 발견
- 향후 opt-in Notion text에서 구조화 후보 발견
- 이미 선택된 top item의 검증된 필드만 이용한 문구 다듬기

LLM을 사용하지 않는 위치:

- connector의 native 상태 판정
- snapshot freshness 또는 completeness
- source authority
- 완료 상태 충돌 해결
- deadline 생성
- task identity의 최종 병합
- hard eligibility
- ranking과 top selection
- 외부 쓰기 권한 결정

LLM이 실패하면 결정적 후보와 템플릿 결과가 유지되어야 한다.

---

## 8. 핵심 도메인 계약

아래 타입은 방향을 고정하기 위한 초안이다. 실제 구현 전 별도 schema 파일과
Zod contract로 확정한다.

### 8.1 Snapshot envelope

```ts
type ConnectedSource =
  | "conversation"
  | "notion"
  | "google_calendar"
  | "github"
  | "codex";

type SnapshotEnvelope<T> = {
  source: ConnectedSource;
  schemaVersion: string;
  normalizerVersion: string;
  fetchedAt: string;
  scopeIds: string[];
  status: "fresh" | "stale" | "partial" | "failed";
  truncated: boolean;
  snapshotHash: string;
  data: T;
};

type SnapshotWindow<T> = {
  source: ConnectedSource;
  observationStartedAt: string;
  observationEndedAt: string;
  orderedSnapshots: SnapshotEnvelope<T>[];
};
```

정체, 복구, 완료 후 후속조치, 일시적 요청 해결 여부를 평가하는 Codex run은
단일 latest snapshot이 아니라 `SnapshotWindow`를 입력으로 기록한다.

### 8.2 Source evidence

Conversation evidence와 connector evidence를 같은 형태로 위장하지 않는다.

```ts
type SourceEvidence =
  | {
      type: "conversation_span";
      conversationId: string;
      messageId: string;
      messageIndex: number;
      role: "user" | "assistant";
      quote: string;
      startChar: number;
      endChar: number;
    }
  | {
      type: "connector_field";
      source: Exclude<ConnectedSource, "conversation">;
      nativeId: string;
      nativeField: string;
      valueHash: string;
      snapshotHash: string;
      observedAt: string;
      sourceUpdatedAt: string | null;
    };
```

### 8.3 Work signal

```ts
type WorkSignalKind =
  | "task_exists"
  | "task_state"
  | "ownership"
  | "deadline"
  | "review_requested"
  | "attention_required"
  | "scheduled_commitment"
  | "dependency"
  | "activity"
  | "execution_state"
  | "execution_progress"
  | "execution_exception"
  | "execution_completion"
  | "execution_output"
  | "handoff_state"
  | "scope_observation"
  | "transient_attention_lifecycle"
  | "user_correction";

type WorkSignal = {
  id: string;
  source: ConnectedSource;
  nativeId: string;
  projectId: string | null;
  subjectKey: string;
  kind: WorkSignalKind;
  value: unknown;
  observedAt: string;
  sourceUpdatedAt: string | null;
  validUntil: string | null;
  directness: "explicit" | "accepted_context" | "derived";
  completeness: "complete" | "truncated" | "unknown";
  evidence: SourceEvidence[];
};
```

`WorkSignal`은 관찰 사실이다. 이 단계에서 중요도나 최종 task state를 만들지
않는다. Codex 승인·입력 lifecycle signal의 `value`는
`CodexTransientAttentionLifecycle` schema를 통과해야 한다.

### 8.4 Codex execution overview

Codex의 진행 가시성은 추천 결과와 분리된 1급 출력으로 둔다.

```ts
type CodexExecutionState =
  | "queued"
  | "running"
  | "waiting"
  | "stalled"
  | "failed"
  | "completed"
  | "cancelled"
  | "idle"
  | "not_loaded"
  | "unknown";

type CodexTransientAttentionLifecycle =
  | {
      requestId: string;
      kind: "approval" | "user_input";
      state: "pending";
      requestedAt: string;
      resolvedAt: null;
      expiredAt: null;
      validUntil: string | null;
    }
  | {
      requestId: string;
      kind: "approval" | "user_input";
      state: "resolved";
      requestedAt: string;
      resolvedAt: string;
      expiredAt: null;
      validUntil: string | null;
    }
  | {
      requestId: string;
      kind: "approval" | "user_input";
      state: "expired";
      requestedAt: string;
      resolvedAt: null;
      expiredAt: string;
      validUntil: string | null;
    };

type CodexExecutionOverviewItem = {
  executionId: string;
  projectId: string | null;
  goalLabel: string | null;
  state: CodexExecutionState;
  phaseLabel: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastActivityAt: string | null;
  lastObservedAt: string;
  lastMeaningfulProgressAt: string | null;
  latestProgressSummary: string | null;
  exceptionReasonCodes: string[];
  failureState: "none" | "active" | "recovered" | "unknown";
  followThroughState: "not_expected" | "open" | "closed" | "unknown";
  scopeAssessment: "within_scope" | "possible_drift" | "unknown";
  expectedFollowThrough:
    | "review_changes"
    | "commit_changes"
    | "open_pull_request"
    | "request_review"
    | "none"
    | "unknown";
  pendingAttentionRequests: Array<{
    requestId: string;
    kind: "approval" | "user_input";
    requestedAt: string;
    validUntil: string | null;
  }>;
  safeOpenReference: string | null;
  linkedNativeRefs: string[];
  sourceSignalIds: string[];
};

type CodexExecutionOverview = {
  generatedAt: string;
  sourceStatus: "fresh" | "stale" | "partial" | "failed";
  counts: Record<CodexExecutionState, number>;
  items: CodexExecutionOverviewItem[];
};
```

`goalLabel`, `phaseLabel`, `latestProgressSummary`는 raw prompt나 command를
복사하지 않는다. connector가 로컬에서 만든 최소 요약 또는 사용자가 허용한
metadata만 사용하고, 각 값은 source signal로 역추적할 수 있어야 한다.

`expectedFollowThrough`는 Codex가 임의로 추론하지 않는다. 명시적인 GitHub
연결이나 사용자가 설정한 project workflow가 있을 때만 구체 값을 갖고,
그 외에는 `unknown`이다.

각 승인·입력 요청은 안정적인 `requestId`로 구분하고 lifecycle state 조합을
schema에서 강제한다. 해결 또는 만료 record는 lifecycle과 replay evidence에는
남기지만 현재 overview의 `pendingAttentionRequests`에서는 제외한다. 연속된
두 요청을 같은 요청으로 합치거나 과거 요청을 현재 attention처럼 표시하지
않는다.

### 8.5 Attention item

```ts
type AttentionItem = {
  id: string;
  projectId: string | null;
  title: string;
  intervention: AttentionIntervention;
  owner: "user" | "agent" | "shared" | "external" | "unknown";
  executionMode:
    | "user_must_act"
    | "agent_can_prepare"
    | "approval_required"
    | "wait"
    | "unknown";
  state:
    | "not_started"
    | "in_progress"
    | "blocked"
    | "stalled"
    | "failed"
    | "waiting"
    | "completed"
    | "cancelled"
    | "replaced"
    | "unclear";
  dueAt: string | null;
  dependencyItemIds: string[];
  goalIds: string[];
  sourceExecutionState: CodexExecutionState | null;
  sourceSignalIds: string[];
  conflicts: ClaimConflict[];
};
```

### 8.6 Claim conflict

```ts
type ClaimConflict = {
  id: string;
  field: "identity" | "state" | "owner" | "deadline" | "dependency";
  signalIds: string[];
  interpretations: Array<{
    value: unknown;
    source: ConnectedSource;
    authority: "authoritative" | "supporting" | "context_only";
  }>;
  resolution:
    | "resolved"
    | "review_required"
    | "unresolved";
  winningSignalId: string | null;
  reasonCode: string;
};
```

### 8.7 User focus context

```ts
type UserFocusContext = {
  capturedAt: string;
  primaryOutcome: string | null;
  activeProjectIds: string[];
  availableMinutes: number | null;
  preferredExecution:
    | "user_action"
    | "agent_prepare"
    | "either";
};
```

도구는 존재와 상태를 알려주지만 사용자의 실제 중요 목표를 완전히 알 수 없다.
초기에는 한 줄의 명시적 `primaryOutcome`을 받는다.

### 8.8 Recommendation decision

```ts
type RecommendationDecision = {
  decisionId: string;
  status: CrossSourceSuggestionStatus;
  decidedAt: string;
  topItemId: string | null;
  alternativeItemIds: string[];
  clarificationQuestion: string | null;
  noActionReason: string | null;
  reasonCodes: string[];
  firstStep: {
    text: string;
    estimatedMinutes: number | null;
    source: ConnectedSource;
    nativeId: string;
  } | null;
  coverage: {
    usedSources: ConnectedSource[];
    staleSources: ConnectedSource[];
    partialSources: ConnectedSource[];
    latestFetchedAt: string | null;
  };
  run: CrossSourceSuggestionRunRecord;
};
```

---

## 9. Source별 의미와 후보 생성

### 9.1 GitHub

직접 후보:

| Native signal | Intervention | 기본 의미 |
|---|---|---|
| `assigned_issue` | `do` | 사용자에게 배정된 열린 issue |
| `review_requested_pull_request` | `review` | 사용자의 리뷰가 요청됨 |
| `milestoneDueAt` | deadline claim | native milestone의 명시적 마감 |

조건부 후보:

- `authored_pull_request`는 열린 상태만으로 사용자 행동이 필요하다고 보지 않는다.
- requested changes, failed checks, merge conflict처럼 행동 필요성을 직접
  증명하는 필드가 추가된 후 후보로 승격한다.

추가로 필요한 최소 필드:

```text
isDraft
reviewDecision
requestedReviewers
checksStatus
mergeState
latestReviewAt
```

GitHub 항목이 다음 snapshot에서 보이지 않는다는 이유만으로 완료 처리하지 않는다.
명시적 closed/merged state, user correction 또는 검증된 상태 event가 필요하다.

### 9.2 Codex

Codex adapter는 source evidence가 붙은 `WorkSignal`만 만든다. 이후 observation
branch가 다음 두 출력을 만든다.

1. 모든 실행의 진행 상태를 보여주는 `CodexExecutionOverview`
2. 공통 resolver와 gate로 되돌려 보낼 검증된 exception `WorkSignal`

adapter나 exception detector가 `AttentionItem`을 직접 만들면 안 된다.
exception signal도 project mapping, relation resolution, claim authority,
eligibility를 통과한 뒤에만 공통 candidate derivation에서 AttentionItem이 된다.

정상 실행 상태:

- `queued`
- 의미 있는 진전이 계속 확인되는 `running`
- 정상적인 외부 작업을 기다리는 `waiting`
- 방금 완료됐고 추가 workflow가 설정되지 않은 `completed`
- `idle`
- `not_loaded`

이 상태들은 overview에 표시하지만 직접 후보로 만들지 않는다.

조건부 후보:

| Derived signal | Intervention | 후보가 되기 위한 추가 조건 |
|---|---|---|
| `execution_stalled` | `inspect` 또는 `resume` | fresh snapshot, 실행 지속 예상, phase별 threshold 초과, 의미 있는 진전 없음, 사용자 개입 가능 |
| `execution_failed` | `inspect` 또는 `resume` | 현재도 미복구, 안전한 open reference, 중요 작업 또는 downstream block과 연결 |
| `completed_follow_through_pending` | `close_loop` | 완료 evidence와 명시적 project workflow 또는 GitHub 연결에 따른 후속조치가 남음 |
| `scope_drift_detected` | `review` 또는 `clarify` | 원래 scope와 현재 변경 범위가 모두 검증되고 사용자 판단이 실제로 필요 |
| `waiting_on_approval` | `approve` | 아직 미해결이고 escalation threshold를 넘었으며 작업을 실제로 막음 |
| `waiting_on_user_input` | `decide` | 아직 미해결이고 escalation threshold를 넘었으며 작업을 실제로 막음 |

다음 규칙을 적용한다.

- session activity가 없다는 사실만으로 `stalled`를 만들지 않는다.
- 긴 명령, 테스트, build처럼 정상적으로 오래 걸릴 수 있는 phase는 별도
  threshold 또는 expected-next-event가 필요하다.
- `system_error`는 자동으로 사용자 task로 만들지 않는다. 사용자가 복구할 수
  있고 중요한 outcome 또는 downstream block과 연결될 때만 후보로 승격한다.
- Codex의 `completed`는 해당 실행의 종료일 뿐 GitHub issue, PR 또는 프로젝트
  완료 evidence가 아니다.
- 승인·입력 요청은 발생 즉시 overview 상태로는 보일 수 있지만, threshold
  이전에는 ranking 후보가 아니다.
- 다음 snapshot에서 해결됐거나 유효기간이 지난 승인·입력 요청은 즉시
  제거한다.

`completed_follow_through_pending`에서 Codex source execution state는
`completed`지만 파생된 AttentionItem의 state는 열린 후속조치의 상태인
`not_started`, `blocked` 또는 `waiting`이다. 두 상태를 하나로 합치지 않는다.

추가로 필요한 최소 필드:

```text
executionId
projectScopeId
goalLabel 또는 locally-derived safe summary
state
startedAt
lastActivityAt
lastObservedAt
progressMarkerId
progressMarkerKind
progressObservedAt
currentPhase
latestProgressSummary
expectedNextEvent
blockerKind
failureKind
failureObservedAt
failureClearedAt
retryCount
completionAt
expectedScopeBaselineHash
observedScopeSummary
changedArtifactCount와 privacy-safe references
linked GitHub issue/PR references
configured expected follow-through
attentionRequestId
attentionRequestType
requestedAt
resolvedAt
expiredAt
validUntil
safeOpenReference
```

connector는 관찰된 activity와 progress marker를 제공하고,
`lastMeaningfulProgressAt`, `stalled`, `recovered`는 versioned engine policy가
ordered snapshot window에서 파생한다. connector가 의미 있는 진전 여부를
미리 확정하지 않는다.

Codex content는 raw prompt, response, command, output을 저장하지 않는
`metadata_only`를 기본으로 유지한다. 진행 요약이 필요하면 connector가
로컬에서 최소 정보로 파생하고, opt-in·retention·evidence 계약을 별도로
적용한다.

### 9.3 Google Calendar

Calendar event는 기본적으로 task 후보가 아니다.

Calendar가 제공하는 것은 다음이다.

- 검증된 일정 시작과 종료
- 취소 상태
- 현재부터 다음 일정까지의 free block
- 선택된 first-step이 들어갈 수 있는 시간
- 동일 시간대의 충돌

Calendar 제목만으로 다음을 추론하지 않는다.

- 중요한 task
- 회의 준비 필요
- 완료해야 할 산출물
- 프로젝트 우선순위

회의 준비 후보는 다른 source의 AttentionItem이 동일 event와 명시적으로
연결됐을 때만 생성한다.

privacy 기본값은 free/busy다. 제목 기반 연결은 opt-in 정책으로 검토한다.

### 9.4 Notion

현재 snapshot의 page/data-source 제목과 수정 시각은 직접 task evidence가
아니다.

Notion을 직접 후보 소스로 사용하려면 사용자가 task database 하나 이상을
선택하고 property를 명시적으로 매핑해야 한다.

```text
title
status
assignee
due
priority
project
related GitHub URL 또는 relation
```

직접 후보의 최소 조건:

- mapped task database
- open 상태
- 사용자 또는 shared ownership
- title 존재
- snapshot fresh 및 not truncated

일반 페이지의 최근 수정은 project context signal로만 사용한다.

### 9.5 Conversation

기존 v0.3 candidate extractor를 optional WorkSignal producer로 감싼다.

- 기존 evidence span verification 유지
- 기존 owner/state/origin gate 유지
- connector evidence와 별도 source evidence 형태 유지
- connector-only run에는 3개 share URL gate를 적용하지 않음
- conversation candidates가 없더라도 connector 후보로 결정 가능

---

### 9.6 현재 connector와 다음 최소 계약

| Source | 현재 확인 가능한 필드 | 직접 추천 역할 | 다음 version에서 필요한 최소 보강 |
|---|---|---|---|
| GitHub | open assigned issue, review request, authored PR, label, milestone due | issue와 review 후보 | draft, review decision, checks, merge state, review 취소/변경 |
| Codex | `codex-snapshot-v2`의 session ID, project scope/label, optional task summary, created/updated time, activity state, approval/input attention | 제한된 activity overview, 직접 추천은 아직 보류 | phase와 raw progress marker/time, failure/blocker lifecycle, completion, privacy-safe progress summary, GitHub linkage, workflow 후속조치, request ID와 requested/resolved/expired time, 안전한 open reference |
| Calendar | primary calendar, -7일~+14일, event start/end/status/title, `Asia/Seoul` | 시간 constraint | 사용자 timezone, busy/transparency, 포함 calendar scope, free/busy 정책 |
| Notion | page/data-source title, created/edited time | context only | 선택 task DB와 status/assignee/due/priority/project property mapping |

새 normalizer는 현재 connector가 제공하지 않는 필드를 추론으로 채우지 않는다.
필드가 추가되기 전에는 해당 source의 역할을 위 표의 현재 범위로 제한한다.

따라서 현재 Codex snapshot만으로는 정체, 실패 복구, 완료 후 미정리,
scope drift를 안전하게 판단할 수 없다. Phase 2에서는 기존
`codex-snapshot-v2`를 덮어쓰지 않고 새 version의 observability contract와
합성 timeline fixture를 먼저 구현한다. connector가 최소 필드를 제공한 뒤
실제 overview와 exception detector를 활성화한다. 그전에는 session activity,
optional task summary와 일시 attention 상태를 제한적으로 보여주되 추천
후보로 승격하지 않는다.

현재 `attentionState`에는 안정적인 request ID와 requested/resolved/expired
시각이 없다. 여러 snapshot에 같은 값이 보인다는 사실만으로 “오래 미해결된
하나의 요청”이라고 판단하면 안 된다. lifecycle 필드가 추가되기 전에는
approval/input escalation을 비활성화한다.

---

## 10. 사용자 identity, project mapping과 item resolver

### 10.1 사용자 identity mapping

GitHub login, Notion assignee, Calendar의 self identity와 Codex local scope가
같은 사용자를 가리킨다는 사실을 이름이나 문자열 유사성만으로 추론하지 않는다.

```ts
type UserSourceIdentityMapping = {
  userId: string;
  githubLogin: string | null;
  notionPersonIds: string[];
  calendarAccountRefHash: string | null;
  codexInstallationRef: string | null;
  confirmedBy: "user";
  createdAt: string;
  updatedAt: string;
};
```

원본 email과 private local path는 mapping record에 저장하지 않는다. provider의
stable ID 또는 비가역 reference를 사용한다.

### 10.2 Project mapping

Cross-source task identity를 안정적으로 연결하려면 source scope를 project에
매핑해야 한다.

```ts
type ProjectSourceMapping = {
  projectId: string;
  notionDataSourceIds: string[];
  githubRepositoryIds: number[];
  codexScopeIds: string[];
  calendarLinkPolicy: "none" | "explicit_only" | "title_opt_in";
  createdBy: "user";
  updatedAt: string;
};
```

첫 버전에서는 자동 추론보다 사용자 매핑을 우선한다.

### 10.3 Item identity resolution 순서

1. 같은 source의 동일 native ID
2. 명시적인 URL 또는 native relation
3. 사용자가 확인한 project mapping
4. 같은 project 안에서 구체 entity와 deliverable 일치
5. 중간 확신은 merge하지 않고 `related_to`
6. 제목 유사성만 있는 경우 자동 merge 금지

Codex execution과 GitHub/Notion work item은 동일 item으로 자동 merge하지
않는다. 실행은 work item을 수행하거나 산출물을 만드는 process이므로
`executes`, `produces`, `related_to` 관계로 연결한다. Codex 실행 완료가
연결된 issue 또는 task의 완료 상태를 덮어쓰면 안 된다.

### 10.4 안정적 ID

ID는 다음 값의 versioned canonical representation으로 결정적으로 생성한다.

```text
projectId
+ primary native source
+ primary native ID
+ identity resolver version
```

문구 또는 LLM 출력만으로 stable ID를 만들지 않는다.

---

## 11. Claim authority와 conflict resolution

### 11.1 Claim별 기본 권위

| Claim | Authoritative source | 제한 |
|---|---|---|
| GitHub issue/PR state | GitHub | 내부 업무 priority에는 권위 없음 |
| GitHub review request | GitHub | 실제 cost of delay는 별도 근거 필요 |
| Notion mapped task state | Notion task DB | 일반 page에는 적용하지 않음 |
| Notion internal priority | Notion task DB 또는 사용자 | 외부 마감의 사실성은 별도 확인 |
| Calendar event time/cancel | Google Calendar | task 완료와 중요도에는 권위 없음 |
| Codex execution state/progress | Codex | 해당 실행 상태에는 권위가 있지만 GitHub·프로젝트 완료와 중요도에는 권위 없음 |
| 사용자 완료/틀림/지금 아님 | explicit feedback | 원본 source를 덮어쓰지 않음 |

### 11.2 Resolver 원칙

개념적 reliability는 다음 요소를 본다.

```text
source authority
× explicitness
× freshness
× completeness
```

실제 구현은 불투명한 곱셈 하나보다 field별 결정 규칙을 사용한다.

예:

```text
GitHub PR = merged
Notion mapped task = open
→ PR state는 completed
→ Notion claim은 stale/conflicting
→ 추천에서 제외
→ source conflict는 run record에 보존
→ Notion 원본은 수정하지 않음
```

최신 timestamp만으로 모든 충돌을 해결하지 않는다.

---

## 12. Hard eligibility gate

점수를 계산하기 전에 다음 조건을 검사한다.

### 12.1 Ineligible

- `AttentionItem.state`가 completed, cancelled 또는 replaced. 연결된
  `sourceExecutionState=completed`만으로는 제외하지 않음
- 사용자 또는 shared intervention 근거 없음
- agent가 독립적으로 진행 중이고 사용자 개입 불필요
- 정상적으로 진전 중인 Codex 실행
- 정체 조건이 검증되지 않은 Codex inactivity
- escalation threshold 전의 짧은 승인·입력 대기
- project workflow가 없는 완료 실행의 추정 후속조치
- assistant-only 또는 inferred obligation
- source evidence 없음
- 근거 없는 deadline 또는 consequence
- 다른 사람을 기다리는 것 외에 현재 가능한 intervention 없음
- native source에서 명시적으로 archived 또는 cancelled

### 12.2 Review required

- state 또는 owner conflict 미해결
- source snapshot stale
- 결과를 바꿀 수 있는 truncation
- identity resolver 확신 부족
- 상대 날짜의 기준 시각 불명확
- 정체 판정에 필요한 이전 Codex snapshot 또는 관찰 window 부족
- scope drift 후보를 판단할 expected scope baseline 부족
- failure가 자동 복구됐는지 판단할 최신 상태 부족
- high-risk domain
- first-step을 근거 내에서 만들 수 없음

### 12.3 Eligible

- fresh enough source
- direct evidence
- user/shared intervention
- actionable state
- Codex 예외는 current snapshot에서도 유효하고 사용자가 복구 또는
  후속조치할 수 있음
- 해결되지 않은 critical conflict 없음
- source-native destination 존재

```ts
type EligibilityAssessment = {
  itemId: string;
  status: "eligible" | "review_required" | "ineligible";
  reasonCodes: string[];
};
```

---

## 13. Attention lane과 ranking policy

### 13.1 Lane

```ts
type AttentionLane =
  | "must_now"
  | "unblock"
  | "close_loop"
  | "focus"
  | "clarify"
  | "none";
```

| Lane | 포함 기준 |
|---|---|
| `must_now` | 검증된 임박 마감, 곧 시작할 약속에 직접 연결된 준비, 검증된 즉시 consequence |
| `unblock` | 리뷰 요청, 외부 사람이 기다림, 중요한 outcome을 막는 정체·실패·오래 지속된 승인/입력 |
| `close_loop` | 실행은 완료됐지만 명시적 workflow의 검토·커밋·PR·리뷰 후속조치가 남음 |
| `focus` | 사용자 목표와 연결되고 현재 시작 가능한 task |
| `clarify` | 유효 후보가 있지만 목표 또는 conflict를 해결할 질문 필요 |
| `none` | 사용자가 지금 개입할 필요 없음 |

약한 신호 여러 개가 강한 deadline 또는 blocker 하나를 이기지 못하도록 lane을
가중치보다 먼저 적용한다.

### 13.2 Lane 내부 초기 ranking 가설

```text
score =
  goalAlignment × 0.30
  + costOfDelay × 0.25
  + blockingPower × 0.20
  + explicitObligation × 0.15
  + corroboration × 0.10
  - uncertaintyPenalty
  - stalenessPenalty
  - conflictPenalty
```

이 숫자는 제품 진실이 아니다. `ranking-policy-v0.1`의 초기 가설로만 기록한다.

규칙:

- 점수는 같은 lane 안에서만 비교
- deadline이 없으면 urgency 기본점을 주지 않음
- impact가 불명확하면 중간 impact 기본점을 주지 않음
- recency는 실제 timestamp로 계산
- recurrence는 작은 corroboration 신호
- source 중복은 recurrence로 중복 계산하지 않음
- Codex activity volume과 최근 실행 횟수는 중요도 점수가 아님
- 정상 `running` 상태는 ranking에 들어가지 않음
- 정체 시간만으로 높은 순위를 주지 않고 goal, consequence, blocking 근거를 요구
- 승인·입력 대기 시간은 escalation gate에만 사용하고 그 자체를 urgency로 사용하지 않음
- readiness와 Calendar fit은 중요도보다 first-step에 우선 사용
- deterministic tie-break는 재현성에만 사용하며 제품상 동점은 clarification 가능

### 13.3 Clarification 조건

다음 경우 한 번에 질문 하나만 반환한다.

- 서로 다른 primary goal에 속한 상위 후보가 비슷함
- state/owner conflict를 사용자가 해결할 수 있음
- 현재 목표가 없으면 ranking이 크게 바뀜
- top 후보를 고를 근거가 source에 없음

stable ID 순서만으로 사용자에게 top suggestion을 노출하지 않는다.

---

## 14. Calendar fit과 first-step

Calendar는 중요도를 결정하는 source가 아니라 실행 가능성을 조정하는
resource constraint다.

### 14.1 Free-block 계산

입력:

- 현재 시각
- confirmed/tentative event
- cancelled 제외
- all-day event 정책
- 사용자 timezone
- 최소 전환 buffer configuration

출력:

```ts
type CalendarAvailability = {
  calculatedAt: string;
  nextCommitmentAt: string | null;
  availableMinutes: number | null;
  conflicts: string[];
};
```

### 14.2 First-step 정책

중요한 task 전체가 free block에 들어가지 않는다는 이유로 낮은 중요도의
짧은 task를 선택하지 않는다.

대신 top item의 첫 단계를 줄인다.

```text
2시간짜리 PR 수정
→ requested changes 확인
→ 수정 범위 결정
→ Codex에 준비 요청
→ 첫 failing check 재현

Codex 실행 실패
→ 실패 상태와 마지막 성공 단계 열기
→ 반복 오류인지 확인
→ 복구 가능한 경우 실행 재개
```

first-step은 다음을 만족해야 한다.

- 2~15분 안에 시작 가능
- source-native destination 존재
- evidence에 없는 마감이나 긴급성 없음
- 사용자가 해야 할 행동과 agent가 준비할 행동 구분
- estimated minutes를 모르면 `null`

LLM 합성이 실패하면 intervention별 deterministic template을 사용한다.

---

## 15. 설명과 사용자 결과

### 15.1 Top suggestion

항상 다음 내용을 함께 제공한다.

- 무엇을 할지
- 왜 지금인지 reason code 1~2개
- 어떤 source의 어떤 상태가 근거인지
- 마지막 동기화 시각
- stale 또는 partial source
- 누가 해야 하는지
- AI가 준비할 수 있는지
- first-step
- alternatives

Codex-derived suggestion이면 추가로 다음을 표시한다.

- 마지막 의미 있는 진전 시각
- 검증된 정체, 실패, 후속조치 또는 scope-drift reason
- expected-next-event 또는 expected follow-through
- 연결된 GitHub/Notion work item과의 관계

내부 confidence 숫자는 사용자에게 직접 노출하지 않는 것을 기본으로 한다.

사용자용 grounding label:

```text
직접 확인됨
일부 불확실
확인 필요
```

### 15.2 Codex execution overview

추천 카드와 별도로 다음을 한눈에 보여준다.

- 실행 중, 정체, 실패, 완료 개수
- 각 실행의 목표 또는 안전한 label
- 현재 phase
- 마지막 의미 있는 진전
- 최근 진행 요약
- 실패 또는 정체 reason
- 완료 후 설정된 후속조치
- 안전한 원본 열기 링크

예:

```text
Codex 작업 현황

● 2개 진행 중
✓ 1개 완료
! 1개 테스트 실패
○ 1개 정체

지금 개입할 항목
결제 API 작업의 테스트 실패를 확인하세요.

근거
- 결제 기능 outcome과 연결됨
- 마지막 성공 단계 이후 같은 테스트가 반복 실패
- GitHub issue #38을 막고 있음
```

진행 중인 실행이 많다는 이유만으로 `지금 개입할 항목`을 만들지 않는다.
검증된 예외가 없으면 overview만 표시하고 recommendation은 `no_action`일 수 있다.

### 15.3 No-action

예:

```text
현재 연결된 범위에서는 사용자가 직접 개입할 항목이 없습니다.
Codex 작업 2개는 정상적으로 진행 중이고, GitHub 리뷰 요청과 임박한 마감은
확인되지 않았습니다.
```

### 15.4 Insufficient evidence

예:

```text
GitHub와 Notion 상태가 오래되어 안전한 추천을 만들 수 없습니다.
두 소스를 새로고침한 뒤 다시 확인해주세요.
```

---

## 16. Feedback와 correction

### 16.1 Feedback type

```ts
type RecommendationFeedbackType =
  | "started"
  | "agent_prepare"
  | "completed"
  | "snoozed"
  | "incorrect"
  | "already_resolved"
  | "progressing_normally"
  | "not_stalled"
  | "expected_scope_change"
  | "follow_through_already_closed"
  | "not_mine"
  | "other_more_important";
```

```ts
type RecommendationFeedback = {
  feedbackId: string;
  decisionId: string;
  itemId: string;
  type: RecommendationFeedbackType;
  createdAt: string;
  snoozedUntil: string | null;
  preferredAlternativeItemId: string | null;
  reasonCode: string | null;
};
```

### 16.2 사용 원칙

- correction은 원본 source value를 덮어쓰지 않는다.
- `completed`는 사용자 suppression signal이지만 native source conflict를 보존한다.
- `snoozed`는 중요도를 영구히 낮추지 않고 지정 시각까지 suppress한다.
- 클릭과 무반응은 human-approved label이 아니다.
- explicit pairwise choice는 ranking review candidate로 사용할 수 있다.
- `not_stalled`, `progressing_normally`, `expected_scope_change`는 Codex detector
  review candidate이며 원본 실행 상태를 직접 덮어쓰지 않는다.
- `already_resolved`와 `follow_through_already_closed`는 stale lifecycle 또는
  linkage 오류를 먼저 조사한다.
- production feedback은 privacy review 없이 Golden으로 승격하지 않는다.

초기에는 feedback으로 자동 weight update를 하지 않는다. evaluation review에서
failure category를 확인한 뒤 policy version을 변경한다.

---

## 17. API와 호환 경계

### 17.1 권장 프로토타입 API

기존 `POST /api/suggestions`를 즉시 깨지 않는다.

Cross-source 평가 전에는 별도 route 또는 명시적 mode를 사용한다.

권장:

```text
POST /api/suggestions/cross-source
```

요청 초안:

```ts
type CrossSourceSuggestionRequest = {
  refreshSources: boolean;
  includeConversationUrls?: string[];
  focus: {
    primaryOutcome: string | null;
    availableMinutes?: number | null;
  };
};
```

운영 run은 요청을 받는 순간 내부 `asOf`를 한 번 고정하고 모든 freshness,
threshold, Calendar 계산에 같은 값을 사용한다. evaluation/replay에서는
case의 `decisionAt`을 `asOf`로 주입하며 계산 중 `Date.now()`를 다시 읽지 않는다.

응답:

```ts
type CrossSourceSuggestionResponse = {
  decision: RecommendationDecision;
  items: AttentionItem[];
  codexExecutionOverview: CodexExecutionOverview | null;
  sourceStatuses: Array<{
    source: ConnectedSource;
    status: "fresh" | "stale" | "partial" | "failed" | "disconnected";
    fetchedAt: string | null;
  }>;
};
```

### 17.2 통합 전제

- connector read failure와 recommendation failure 분리
- 일부 source 실패 시 remaining coverage를 명시
- source가 하나라도 연결됐다는 이유만으로 추천하지 않음
- connector-only 실행은 ChatGPT 3 URL gate와 분리
- 기존 v0.3 response contract는 baseline 전까지 유지

---

## 18. Evaluation Dataset 계획

### 18.1 Dataset 분류

| Dataset | 목적 | 변경 정책 |
|---|---|---|
| Dev Candidate | task 정의와 policy 개발 | 자유롭게 추가·수정 |
| Cross-source Golden | 핵심 계약 평가 | freeze 후 불변 |
| Regression | 확인된 오류 재발 방지 | 검토된 사례 추가 |
| Rolling | 최근 사용 분포 확인 | 주기적 교체 |
| Locked Holdout | 출시 전 일반화 확인 | routine 개발에서 비공개 |

기존 `gold-core-v0.1`과 별도의 dataset family를 사용한다.

권장 이름:

```text
suggestion-cross-source-dev-v0.1
suggestion-cross-source-gold-v0.1
suggestion-cross-source-regression-v0.1
suggestion-cross-source-holdout-v0.1
```

### 18.2 수동 평가 사례

초기 20~30개는 수정 가능한 dev candidate로 작성한다.
task 정의와 label agreement가 안정되면 40~60개 수준의 첫 Golden version을
검토하고 freeze한다.

```ts
type CrossSourceEvaluationCase = {
  caseId: string;
  decisionAt: string;
  timezone: string;
  focus: UserFocusContext;
  sourceSnapshotWindows: Array<{
    source: ConnectedSource;
    observationStartedAt: string;
    observationEndedAt: string;
    orderedSnapshotRefs: Array<{
      snapshotId: string;
      snapshotHash: string;
      fetchedAt: string;
    }>;
  }>;
  codexDetectorConfig: {
    version: string;
    immutableRef: string;
    sha256: string;
  } | null;
  expectedCodexExecutions: Array<{
    executionId: string;
    acceptableStates: CodexExecutionState[];
    mustAppearInOverview: boolean;
    acceptableInterventions: AttentionIntervention[];
    forbiddenAsAttentionCandidate: boolean;
  }>;
  acceptableTopItemIds: string[];
  forbiddenItemIds: string[];
  expectedStatus: CrossSourceSuggestionStatus;
  pairwisePreferences: Array<{
    preferredItemId: string;
    overItemId: string;
    reasonCode: string;
  }>;
  expectedReasonCodes: string[];
  reviewerNotes: string;
  reviewStatus:
    | "draft"
    | "reviewed"
    | "adjudicated"
    | "frozen";
};
```

단일 `topItemId`만 정답으로 두지 않는다.

Gold가 표현해야 하는 것:

- 허용 가능한 top set
- 절대 추천 금지 후보
- clarification/no-action 여부
- pairwise preference
- 당시 목표와 시간
- 우선순위 이유

### 18.3 오류 taxonomy

```text
missing_candidate
false_candidate
wrong_identity_merge
missed_identity_merge
wrong_state
wrong_owner
false_deadline
false_urgency
wrong_dependency
wrong_execution_state
missing_execution_overview_item
false_stall
missed_stall
false_failure
missed_failure
false_follow_through
missed_follow_through
false_scope_drift
missed_scope_drift
transient_request_escalated_too_early
stale_ephemeral_attention
healthy_execution_recommended
unsupported_progress_summary
wrong_lane
wrong_ranking
missed_clarification
unnecessary_clarification
missed_no_action
unsafe_first_step
stale_source_used
privacy_scope_violation
```

가중치를 조정하기 전에 오류가 어느 pipeline stage에서 발생했는지 분류한다.

---

## 19. 평가 지표와 provisional release gate

### 19.1 객관적으로 검증 가능한 지표

- candidate recall
- state accuracy
- owner accuracy
- deadline precision
- evidence precision
- conflict detection rate
- cross-source false merge rate
- completed/cancelled recommendation rate
- unsupported urgency rate
- stale/truncated source misuse rate
- Codex execution-state accuracy
- Codex overview coverage
- false-stall rate
- execution exception precision/recall
- configured follow-through precision
- resolved/expired approval-input leakage rate

### 19.2 선호와 의사결정 지표

- Acceptable@1
- pairwise preference accuracy
- clarification precision
- clarification recall
- no-action accuracy
- abstention precision
- first-step actionability

### 19.3 온라인 가치 지표

- Useful Next-Step Rate
- Resolved Open Loops / WAU
- Codex 현황 파악까지 걸리는 시간
- 사용자가 별도 session을 하나씩 열지 않고 진행/정체/실패를 올바르게
  식별한 비율
- 실제 exception 발생부터 사용자가 인지하기까지의 시간
- 추천 화면에서 유효한 disposition까지의 시간
- `incorrect`, `already completed`, `not mine` 비율
- 다른 후보 선택률과 이유

### 19.4 초기 gate 가설

아래는 첫 dataset을 위한 provisional target이며 제품 품질 주장이 아니다.

```text
Evidence precision ≥ 98%
완료·취소·담당자 오류 추천률 = 0%
Unsupported deadline/urgency = 0%
위험한 cross-source false merge ≤ 1%
명확한 사례 Acceptable@1 ≥ 85%
추천 금지 사례 abstention precision ≥ 95%
stale/truncated 상태를 숨긴 추천 = 0%
정상 running/idle Codex 실행의 attention 후보 전환 = 0%
검증되지 않은 stalled/follow-through 후보 = 0%
해결됐거나 만료된 Codex 승인·입력 요청 노출 = 0%
schema pass 또는 safe fallback = 100%
```

release 전에는 locked holdout과 human review가 필요하다.

---

## 20. 실행, 버전, 재현성 기록

### 20.1 추가할 version

```text
crossSourceEngineVersion
workSignalSchemaVersion
sourceNormalizerVersions
codexExecutionOverviewSchemaVersion
codexExecutionStatePolicyVersion
meaningfulProgressPolicyVersion
codexAnomalyPolicyVersion
codexAttentionEscalationPolicyVersion
followThroughPolicyVersion
codexDetectorConfigVersion
identityResolverVersion
claimResolverVersion
eligibilityPolicyVersion
attentionLanePolicyVersion
rankingPolicyVersion
firstStepPolicyVersion
feedbackSchemaVersion
```

### 20.2 Run record

```ts
type CrossSourceSuggestionRunRecord = {
  runId: string;
  decisionId: string;
  status: "running" | "completed" | "partial" | "failed";
  asOf: string;
  startedAt: string;
  completedAt: string | null;
  codeCommitSha: string;
  inputHash: string;
  outputHash: string | null;
  datasetVersion: string | null;
  datasetSha256: string | null;
  crossSourceEngineVersion: string;
  workSignalSchemaVersion: string;
  codexExecutionOverviewSchemaVersion: string;
  codexExecutionStatePolicyVersion: string;
  meaningfulProgressPolicyVersion: string;
  codexAnomalyPolicyVersion: string;
  codexAttentionEscalationPolicyVersion: string;
  followThroughPolicyVersion: string;
  codexDetectorConfigVersion: string;
  userIdentityMappingVersion: string;
  projectMappingVersion: string;
  identityResolverVersion: string;
  claimResolverVersion: string;
  eligibilityPolicyVersion: string;
  attentionLanePolicyVersion: string;
  rankingPolicyVersion: string;
  firstStepPolicyVersion: string;
  sourceSnapshotWindows: Array<{
    source: ConnectedSource;
    observationStartedAt: string;
    observationEndedAt: string;
    orderedSnapshots: Array<{
      schemaVersion: string;
      normalizerVersion: string;
      snapshotHash: string;
      fetchedAt: string;
      status: string;
      truncated: boolean;
      signalCount: number;
    }>;
  }>;
  contextHash: string;
  codexDetectorConfig: {
    immutableRef: string;
    sha256: string;
  } | null;
  candidateCount: number;
  eligibleCount: number;
  reviewRequiredCount: number;
  ineligibleCount: number;
  codexExecutionOverviewHash: string | null;
  codexExecutionObservationHash: string | null;
  codexExecutionCounts: Record<CodexExecutionState, number> | null;
  codexExceptionCandidateCount: number;
  selectedItemId: string | null;
  reasonCodes: string[];
  latencyMs: number;
  errors: Array<{
    source: ConnectedSource | "engine";
    code: string;
  }>;
};
```

원문, token, credentials, 전체 private path는 run record에 넣지 않는다.

### 20.3 Snapshot 보존과 replay

운영 UI가 사용하는 latest connector snapshot과 평가·회귀 재생용 input을
구분한다.

```text
Operational latest snapshot
→ connector 상태와 현재 화면용
→ 새 sync에서 교체 가능

Private replay snapshot
→ 특정 run 또는 evaluation case의 입력
→ snapshot hash와 version으로 불변 보존
→ retention 정책에 따라 승인된 private store에 저장
```

release 비교에 사용한 run은 latest snapshot 파일만 참조하면 안 된다. 동일 입력을
다시 실행할 수 있는 immutable private snapshot 또는 승인된 canonical fixture가
필요하다.

Codex 정체·복구·요청 수명주기를 평가한 run은 판단 기준 시각 `asOf`, 사용한
snapshot들의 순서, 관찰 시작·종료 시각, detector configuration의 immutable
reference와 SHA-256을 함께 보존한다. hash만 남기고 실제 config를 복구할 수
없는 상태는 replay 가능하다고 보지 않는다. snapshot 집합이 같아도 순서,
관찰 window 또는 `asOf`가 다르면 같은 평가 입력으로 간주하지 않는다.

### 20.4 Behavior change

semantic output을 바꾸는 구현은 다음을 수행한다.

- 가장 좁은 version 증가
- relevant unit/integration test
- 동일 frozen dataset targeted regression 또는 baseline
- Engine Change Record
- privacy/retention 영향 검토
- release/rollback 결정 기록

---

## 21. 개인정보와 안전

- source별 scope를 사용자가 직접 선택
- connector는 read-only 기본
- Notion 본문 수집 없이 mapped properties 우선
- Calendar는 free/busy 기본, title linking은 opt-in
- GitHub code/body/comment 전체 수집 금지
- Codex raw prompt, response, command, output은 저장하지 않고 metadata-only 기본
- 진행 요약은 가능한 경우 connector 내부에서 최소 정보로 만들고 evidence
  reference, opt-in, retention 정책을 적용
- private local path 대신 안전한 open reference 또는 hash 사용
- 여러 source의 raw content를 하나의 외부 LLM prompt로 전송하지 않음
- 외부 LLM에는 선택된 item의 최소 검증 필드만 전달
- raw snapshot과 private evaluation artifact는 `.local/` 또는 승인된 private store
- token과 credential은 기존 connector private storage 규칙 유지
- source별 즉시 disconnect/delete 지원
- production multi-user 저장소는 현재 cwd 단일 계정 local store와 분리 설계
- notification에는 private title 또는 repository/page 식별자 노출 금지
- 의료, 법률, 금융, 보안과 같은 고위험 task 자동 실행 금지
- 중요한 쓰기에는 preview, explicit confirmation, rollback contract 필요

---

## 22. 권장 디렉터리 구조

```text
suggestion/
├── docs/
│   ├── CROSS_SOURCE_SUGGESTION_IMPLEMENTATION_PLAN.md
│   ├── CROSS_SOURCE_ATTENTION_DEFINITION.md
│   ├── CROSS_SOURCE_EVALUATION_GUIDE.md
│   └── ENGINE_CHANGE_RECORD.md
├── src/
│   ├── crossSource/
│   │   ├── types.ts
│   │   ├── schema.ts
│   │   ├── versions.ts
│   │   ├── validateSnapshots.ts
│   │   ├── collectWorkSignals.ts
│   │   ├── buildCodexExecutionTimeline.ts
│   │   ├── detectMeaningfulProgress.ts
│   │   ├── buildCodexExecutionOverview.ts
│   │   ├── classifyCodexExecutionState.ts
│   │   ├── deriveCodexExceptionCandidates.ts
│   │   ├── escalateTransientAttention.ts
│   │   ├── deriveAttentionCandidates.ts
│   │   ├── resolveAttentionLineage.ts
│   │   ├── resolveClaims.ts
│   │   ├── assessEligibility.ts
│   │   ├── classifyAttentionLane.ts
│   │   ├── rankWithinLane.ts
│   │   ├── calculateCalendarFit.ts
│   │   ├── buildFirstStep.ts
│   │   ├── selectRecommendation.ts
│   │   ├── buildDecisionExplanation.ts
│   │   └── runCrossSourceSuggestionEngine.ts
│   ├── connectors/
│   │   ├── googleCalendar/toWorkSignals.ts
│   │   ├── notion/toWorkSignals.ts
│   │   ├── github/toWorkSignals.ts
│   │   └── codex/toWorkSignals.ts
│   └── evaluation/
│       ├── crossSourceDataset.schema.ts
│       ├── metrics.ts
│       └── runCrossSourceEvaluation.ts
├── tests/
│   ├── workSignalNormalization.test.ts
│   ├── codexExecutionOverview.test.ts
│   ├── codexExceptionCandidates.test.ts
│   ├── codexExecutionTimeline.test.ts
│   ├── transientAttentionEscalation.test.ts
│   ├── crossSourceLineage.test.ts
│   ├── claimResolver.test.ts
│   ├── crossSourceEligibility.test.ts
│   ├── attentionLane.test.ts
│   ├── contextualRanking.test.ts
│   ├── calendarFit.test.ts
│   ├── crossSourceSelection.test.ts
│   ├── crossSourcePipeline.test.ts
│   └── crossSourcePrivacy.test.ts
└── eval/
    └── synthetic/
```

기존 `suggestion/src/types.ts`, `scorePriority.ts`, `selectSuggestion.ts`를
즉시 대규모 수정하지 않는다. 새 계층을 독립적으로 검증한 뒤 공통 타입과
유틸리티를 좁게 추출한다.

---

## 23. 구현 Phase

### Phase 0 — Attention 정의와 평가 계약

산출물:

- `CROSS_SOURCE_ATTENTION_DEFINITION.md`
- `CROSS_SOURCE_EVALUATION_GUIDE.md`
- evaluation case Zod schema
- 합성 dev candidate 20~30개
- source authority matrix
- Codex meaningful progress, stall, failure, follow-through, scope drift 정의
- transient approval/input escalation 가설
- error taxonomy

완료 조건:

- 두 사람이 명확한 사례의 acceptable top set과 forbidden set에 합의 가능
- suggested/clarification/no-action을 구분 가능
- source별 추론 금지 범위가 문서화됨
- 정상 Codex 실행과 사용자 개입이 필요한 실행 예외를 구분 가능
- 실제 private user data가 Git fixture에 없음

### Phase 1 — Snapshot envelope와 WorkSignal

산출물:

- snapshot validity/freshness gate
- connector별 deterministic normalizer
- source evidence discriminated union
- ordered snapshot window와 Codex execution timeline
- stable signal ID와 hash
- normalization tests

완료 조건:

- 같은 snapshot과 version에서 같은 WorkSignal 출력
- 같은 ordered snapshot window와 policy에서 같은 progress/exception 판정
- stale/truncated/failed 상태가 숨겨지지 않음
- connector record가 가짜 conversation evidence로 변환되지 않음
- raw content와 credential이 결과에 없음

### Phase 2 — GitHub + Codex observability vertical slice

산출물:

- GitHub direct candidate rules
- Codex execution-state normalizer와 overview
- 의미 있는 진전, 정체, 실패 판정 규칙
- Codex exception/follow-through candidate rules
- 승인·입력 대기의 state/TTL/escalation 처리
- connector-only engine input
- basic eligibility
- execution overview와 suggested/no-action result

완료 조건:

- LLM 없이 GitHub review 후보와 Codex execution overview 생성
- 정상 running/idle Codex session을 AttentionItem으로 만들지 않음
- 정체·실패가 검증되고 중요한 outcome과 연결된 경우에만 후보 생성
- configured workflow가 없는 완료 실행에 후속조치를 추정하지 않음
- 짧게 발생하거나 이미 해결된 승인·입력 요청을 추천하지 않음
- authored open PR을 자동 user action으로 만들지 않음
- source-native destination과 evidence 제공

### Phase 3 — Project mapping, lineage, conflict

산출물:

- explicit project mapping
- native/explicit-link identity resolver
- `executes`, `produces`, `related_to` 관계 처리
- field-level authority resolver
- conflict record

완료 조건:

- 동일 native object 중복 제거
- Codex execution과 GitHub/Notion work item을 자동 merge하지 않음
- 비슷한 제목의 다른 프로젝트를 분리
- GitHub completed와 Notion stale open conflict 처리
- snapshot absence를 completion으로 해석하지 않음
- unresolved critical conflict를 top suggestion에서 제외

### Phase 4 — Eligibility, lane, ranking, selection

산출물:

- hard eligibility gate
- attention lane classifier
- versioned within-lane policy
- clarification/no-action selection
- deterministic explanation

완료 조건:

- deadline/blocker가 weak recency 신호보다 우선
- 정상 Codex 실행이 ranking 후보에 들어가지 않음
- approval/input 경과 시간만으로 `must_now`가 되지 않음
- stable ID tie-break만으로 product top을 고르지 않음
- no-action과 insufficient-evidence 분리
- 모든 결과에 reason code 존재
- 같은 입력과 policy version에서 같은 결정

### Phase 5 — Calendar fit과 Notion task mapping

산출물:

- free-block calculator
- first-step sizing
- Notion task DB selection/property mapping
- mapped Notion task normalizer

완료 조건:

- Calendar event 자체를 중요 task로 승격하지 않음
- 긴 top task를 낮추지 않고 first-step을 축소
- 일반 Notion page 최근 수정만으로 task를 만들지 않음
- completed/cancelled mapped task 제외

### Phase 6 — Feedback와 평가 baseline

산출물:

- explicit feedback events
- correction/snooze storage
- cross-source evaluation runner
- first dev baseline
- error breakdown report

완료 조건:

- feedback이 원본 source value를 덮어쓰지 않음
- 동일 dataset hash와 run ID로 비교 가능
- 오류가 pipeline stage별 taxonomy로 분류됨
- implicit reaction을 Gold로 취급하지 않음

### Phase 7 — Golden freeze와 release decision

산출물:

- human-reviewed 40~60 case dataset
- `suggestion-cross-source-gold-v0.1`
- dataset SHA-256
- baseline/regression/holdout run
- Engine Change Record
- release/rollback decision

완료 조건:

- provisional quality gate 충족 또는 예외 명시
- privacy/retention review 완료
- known regression과 accepted risk 기록
- 기존 v0.3 유지 또는 migration 결정

### Phase 8 — 제한적 개인화와 action preparation

첫 release 이후 별도 승인으로만 진행한다.

- explicit pairwise preference 기반 bounded adjustment
- user/project별 configurable policy
- agent preparation preview
- explicit approval
- action audit와 rollback

학습형 ranker는 충분한 reviewed feedback과 stable feature definition이 생긴 뒤
검토한다.

---

## 24. 필수 테스트 시나리오

### Snapshot 및 source

1. 한 source만 fresh하고 나머지는 disconnected
2. 결과를 바꿀 수 있는 truncated GitHub snapshot
3. stale Notion snapshot
4. Calendar sync error
5. connector token reauthorization 필요
6. 다음 snapshot에서 item이 사라졌지만 완료 evidence 없음
7. 서로 다른 GitHub/Notion 계정 이름이 우연히 같음
8. 명시적으로 확인되지 않은 source actor mapping

### 후보 생성과 Codex 관찰

9. GitHub assigned issue
10. GitHub review requested PR
11. 행동 필요 근거가 없는 authored open PR
12. draft PR
13. review request가 취소되거나 변경됨
14. failed checks가 있는 authored PR
15. 최근 의미 있는 진전이 있는 정상 Codex 실행
16. 여러 Codex 실행의 running/completed/failed overview 집계
17. heartbeat activity는 있지만 의미 있는 진전이 없는 실행
18. 정상적으로 오래 걸리는 phase가 거짓 정체로 판정되지 않음
19. phase별 stall threshold 직전과 직후
20. Codex 실패 후 다음 snapshot에서 자동 복구됨
21. 중요한 outcome과 연결된 미복구 또는 반복 실패
22. 사용자가 복구할 수 없거나 중요한 work와 연결되지 않은 실패
23. Codex 완료 후 예상된 후속조치까지 닫힘
24. Codex 완료 후 명시적으로 예상된 PR/handoff가 grace period 이후에도 열림
25. project workflow가 없는 Codex 완료 실행
26. 사용자가 허용한 예상 범위 확장
27. expected scope baseline이 없는 변경
28. baseline과 observed scope가 모두 있는 검증된 scope drift
29. escalation threshold 전의 Codex approval 요청
30. 다음 snapshot에서 해결된 Codex approval 요청
31. threshold를 넘고 여전히 미해결인 Codex approval 요청
32. threshold를 넘고 여전히 미해결인 Codex user-input 요청
33. Codex active 또는 idle session만 존재
34. 일반 Notion page가 최근 수정됨
35. mapped Notion task가 open
36. mapped Notion task가 completed
37. Calendar event만 존재

### Identity와 conflict

38. 같은 GitHub object가 중복 수집됨
39. Notion task에 동일 GitHub PR URL이 연결됨
40. Codex execution이 GitHub issue와 merge되지 않고 `executes` 관계로 연결됨
41. 비슷한 제목이지만 다른 project
42. GitHub merged, Notion open
43. user가 completed로 correction했지만 native source는 open
44. identity 확신이 중간이라 `related_to`로 유지
45. owner conflict
46. deadline conflict

### Priority와 selection

47. 임박한 명시적 마감 대 최근 low-impact task
48. Codex 정체가 중요한 outcome을 실제로 막음
49. 목표와 무관한 Codex 실패가 중요한 ready task를 이기지 않음
50. 완료 후 후속조치가 `close_loop` lane으로 분류됨
51. 오래 지속된 approval도 consequence 근거 없이 `must_now`가 되지 않음
52. GitHub review가 다른 사람을 기다리게 함
53. current goal과 일치하는 ready task
54. goal이 없어 두 project 후보가 동순위
55. 모든 item이 waiting
56. source가 정상이고 사용자 intervention이 없음
57. source가 불완전해 판단할 수 없음
58. stable ID는 다르지만 제품상 동점

### Calendar와 first-step

59. 다음 일정까지 10분
60. free block이 60분
61. all-day event
62. cancelled event
63. tentative event와 busy/transparency
64. 겹치는 일정
65. 사용자 timezone과 connector timezone이 다름
66. DST 경계의 event
67. top task 전체는 길지만 10분 first-step이 가능
68. first-step을 evidence 안에서 만들 수 없음

### Feedback와 privacy

69. completed correction
70. snooze until
71. other-more-important pairwise feedback
72. feedback 후 원본 source claim 보존
73. `not_stalled` feedback이 detector review event로 기록됨
74. `already_resolved` feedback 후 stale lifecycle 원인을 추적함
75. private repository title이 notification-safe output에 노출되지 않음
76. Codex prompt/response가 run record에 없음
77. token과 credential이 error/result에 없음
78. 같은 ordered snapshot window/config/`asOf` 재실행에서 hash, ordering, decision이 동일
79. 같은 snapshot 집합이라도 순서, observation window 또는 `asOf`가 다르면 input hash가 다름
80. Codex progress summary가 raw content 없이 evidence signal로 역추적 가능
81. 연속된 두 approval 요청이 서로 다른 request ID로 유지됨
82. resolved/expired/pending lifecycle의 모순된 timestamp 조합이 schema에서 거부됨
83. `sourceExecutionState=completed`이고 열린 `close_loop` AttentionItem이 gate를 통과함
84. detector config hash만 있고 immutable reference가 없는 run은 replay 불가로 판정됨

---

## 25. 예상 위험과 대응

| 위험 | 대응 |
|---|---|
| 모든 source를 같은 task로 취급 | WorkSignal과 AttentionItem 분리 |
| 최근 활동을 중요도로 오인 | recency는 실제 시각 기반 보조 신호 |
| source 중복을 반복 중요도로 계산 | identity resolution을 ranking보다 먼저 수행 |
| 완료 task 재추천 | field-level authority와 completion gate |
| snapshot 부재를 완료로 오인 | explicit state event 필수 |
| Notion 최근 수정을 task로 오인 | mapped task DB만 직접 후보 |
| Calendar event를 task로 오인 | 시간 constraint로만 사용 |
| Codex 정상 실행이나 idle을 task로 오인 | execution overview와 AttentionItem을 분리하고 검증된 예외만 후보화 |
| activity heartbeat를 진전으로 오인 | last activity와 last meaningful progress를 분리 |
| 정상 장기 실행을 정체로 오인 | phase별 threshold와 expected-next-event 사용 |
| 해결된 승인·입력 요청을 뒤늦게 추천 | request lifecycle, resolvedAt, validUntil, escalation gate 검증 |
| Codex 실행 완료를 project 완료로 오인 | execution과 work item을 관계로 연결하고 상태 authority 분리 |
| 완료 후 후속조치를 임의로 생성 | 명시적 GitHub linkage 또는 configured workflow 필수 |
| 항상 하나를 추천 | clarification/no-action/abstention 지원 |
| 가중치 과설계 | versioned initial hypothesis와 replay evaluation |
| 피드백 과적합 | explicit signal, dev/holdout 분리 |
| LLM이 ranking을 변경 | 결정적 selection 후 제한적 문구 합성 |
| private data 결합 위험 | source scope, metadata minimization, no raw mega-prompt |
| 기존 v0.3 회귀 | 별도 route와 contract로 평가 후 migration |
| 다른 세션 connector 변경과 충돌 | source adapter 경계에서 통합, 기존 파일 대규모 수정 회피 |

---

## 26. 실제 첫 구현 순서

1. `CROSS_SOURCE_ATTENTION_DEFINITION.md` 작성
2. `CROSS_SOURCE_EVALUATION_GUIDE.md`와 case schema 작성
3. 합성 dev candidate 20~30개 작성
4. `crossSource/types.ts`, `schema.ts`, `versions.ts` 작성
5. snapshot validity/freshness gate와 ordered snapshot window 작성
6. GitHub `toWorkSignals.ts` 작성
7. Codex `toWorkSignals.ts` 작성
8. Codex execution timeline과 meaningful-progress detector 작성
9. Codex execution overview 작성
10. stall/failure/follow-through/scope-drift detector 작성
11. transient approval/input lifecycle과 escalation gate 작성
12. connector-only candidate derivation 작성
13. project mapping, identity resolver, execution-work 관계 작성
14. claim authority resolver 작성
15. hard eligibility와 lane classifier 작성
16. clarification/no-action selection 작성
17. Calendar free-block과 first-step 작성
18. Notion task property mapping 작성
19. feedback event와 evaluation runner 작성
20. frozen baseline 후에만 ranking policy 보정

---

## 27. 이 계획에서 확정한 사항

- 새 엔진은 `suggestion/`의 별도 Cross-source Observation + Action Layer로
  만든다.
- 기존 ChatGPT v0.3 계획과 구현을 즉시 대체하지 않는다.
- connector record를 conversation message로 변환하지 않는다.
- source fact와 최종 AttentionItem을 분리한다.
- GitHub는 첫 직접 후보 source로 사용한다.
- Codex는 첫 execution-observability source로 사용하고 검증된 예외만
  AttentionItem으로 승격한다.
- 정상 Codex 실행과 최근 완료는 recommendation과 분리된 overview에 표시한다.
- 짧은 Codex 승인·입력 요청은 일시 상태이며, 미해결 상태가 versioned
  threshold를 넘을 때만 조건부 후보가 된다.
- Codex 실행 완료는 연결된 GitHub/Notion work item 완료를 의미하지 않는다.
- Calendar는 기본적으로 시간 constraint다.
- Notion은 mapped task database만 직접 후보 source로 사용한다.
- 사용자의 명시적 primary outcome을 초기 ranking context로 받는다.
- hard gate와 attention lane을 가중치보다 먼저 적용한다.
- `suggested`, `needs_clarification`, `no_action`,
  `insufficient_evidence`를 모두 정상 결과로 지원한다.
- 가중치와 threshold는 versioned hypothesis다.
- 수동 평가 사례는 dev candidate에서 시작하고 review 후 별도 Golden으로 freeze한다.
- 기존 `gold-core-v0.1`은 변경하지 않는다.
- production feedback은 자동 Gold가 아니다.
- cross-source behavior 변경에는 version, test, evaluation, Engine Change Record가 필요하다.

---

## 28. 남은 제품 결정

다음 질문은 Phase 0에서 명시적으로 결정해야 한다.

1. 첫 사용자군을 1인 개발자/메이커로 제한할 것인가?
2. 사용자에게 primary outcome을 언제, 얼마나 자주 물을 것인가?
3. Calendar는 free/busy만 사용할 것인가, title linking을 opt-in으로 제공할 것인가?
4. Notion task DB property mapping UX를 어디까지 지원할 것인가?
5. connector-only suggestion을 기존 화면에 합칠 것인가, 별도 실험 화면으로 둘 것인가?
6. `no_action`을 어떤 문구와 cadence로 보여줄 것인가?
7. AI가 준비할 수 있는 task를 top suggestion으로 노출할 것인가?
8. first release에서 source write/action은 전부 제외할 것인가?
9. Golden freeze 전에 필요한 human reviewer 수와 adjudication 절차는 무엇인가?
10. Codex에서 작업 유형별 `meaningful progress`를 무엇으로 정의할 것인가?
11. build, test, coding 등 phase별 stall threshold와 recovery window는 얼마인가?
12. 어떤 project workflow에서 commit, PR, review를 예상 후속조치로 볼 것인가?
13. scope drift의 expected baseline을 사용자 요청, 변경 파일 집합, project 설정 중
    어디에서 얻을 것인가?
14. approval/input escalation threshold와 상태 갱신 cadence는 얼마인가?
15. Codex 현황판에서 어느 수준의 progress summary를 opt-in으로 보여주고
    얼마나 보존할 것인가?

이 질문의 답은 구현을 막는 모든 선결 조건은 아니다. Phase 0의 dev fixture와
GitHub + Codex observability vertical slice를 진행하면서 검증 가능한 형태로
좁힌다.
