# blabase Cross-Source Suggestion Engine 구현 계획

> 첫 release에서는 GitHub와 Codex를 함께 쓰는 개발자의 실행 상태를
> 가시화하고, 사용자가 지금 개입할 가치가 가장 큰 열린 루프 하나를 근거와
> 함께 제안하는 Execution Observability + Action/Recommendation Layer 계획.
> GitHub는 현재 직접 후보 source이고, Codex inventory와 opt-in historical
> context는 overview-only다. Blabase-owned managed Codex run은 실시간 metadata로
> 검증된 실행 실패와 사용자가 설정한 완료 후속 작업을 직접 후보로 제공한다.
> Notion과 Google Calendar는 각각 project/schedule context source다.

| 항목 | 값 |
|---|---|
| 문서 상태 | Phase 4C macOS local launcher beta implemented, Draft v0.14 |
| 기준일 | 2026-08-03 |
| 대상 프로토타입 | `suggestion/` |
| 현재 엔진 | Cross-source active Attention v0.4; legacy conversation engine `suggestion-engine-v0.3` |
| 선행 계획 | `suggestion/implementation_plan.md` |
| Attention 정의 | `suggestion/docs/CROSS_SOURCE_ATTENTION_DEFINITION.md` |
| Evaluation 가이드 | `suggestion/docs/CROSS_SOURCE_EVALUATION_GUIDE.md` |
| Phase 2 계약 | `suggestion/docs/PHASE2_GITHUB_CODEX_OBSERVABILITY_CONTRACT.md` |
| Managed Codex 계약 | `suggestion/docs/MANAGED_CODEX_RUN_CONTRACT.md` |
| Managed semantic 계약 | `suggestion/docs/CODEX_MANAGED_SEMANTIC_TIMELINE_CONTRACT.md` |
| Work relation 계약 | `suggestion/docs/WORK_RELATION_RESOLUTION_CONTRACT.md` |
| Claim authority 계약 | `suggestion/docs/CLAIM_AUTHORITY_RESOLUTION_CONTRACT.md` |
| Eligibility shadow 계약 | `suggestion/docs/ATTENTION_ELIGIBILITY_SHADOW_CONTRACT.md` |
| Project workflow 계약 | `suggestion/docs/PROJECT_WORKFLOW_FOLLOW_THROUGH_CONTRACT.md` |
| Local launcher 계약 | `suggestion/docs/LOCAL_LAUNCHER_CONTRACT.md` |
| 규범 문서 | `docs/ENGINE_DEVELOPMENT_RECORDS.md` |
| 구현 상태 | Phase 0·1, Phase 2A, Phase 2A.1 local Data Pipeline Stabilization, Codex historical capture v0.1, Phase 2B.0 Work Resumption, Phase 2B.1 managed observability, Phase 2B.2A direct-fact semantic timeline, Phase 3A `executes`, Phase 3B explicit GitHub artifact `produces`, Phase 3C claim authority/conflict, Phase 4A eligibility shadow, Phase 4B active candidate/lane/ranking/selection, Phase 4C macOS native launcher local beta 구현 |

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

초기 제품의 기본 화면은 `Work Cockpit`이다. Cockpit 전체 현황 위에
Attention Router가 선택한 **“지금 개입할 한 가지”**를 한 칸으로 보여준다.
추천 가능한 개입이 없거나 평가 범위가 부족해도 Cockpit 자체는 유지한다.

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

### 3.2 초기 제품 범위와 타깃 가설

첫 release의 초기 사용자는 **GitHub와 Codex를 함께 사용하는 AI-native
1인 개발자, 인디 메이커, 작은 스타트업 개발자**로 제한한다.

- GitHub issue, PR, review를 실제 work item과 협업 요청의 기준으로 사용한다.
- Codex를 하나 이상의 개발 작업 실행에 사용한다.
- 한 번에 여러 repository, project 또는 agent execution을 오가며 현재 상태를
  다시 파악하는 비용을 겪는다.
- 모든 개발 활동을 자동화하려는 것이 아니라, 사람의 개입이 필요한 순간을
  더 빨리 찾고 싶어 한다.

GitHub 또는 Codex를 사용하지 않는 사용자는 첫 release의 지원 대상이 아니다.
Phase 2A.1부터 Notion과 Google Calendar snapshot을 각각 project context와
schedule context로 Attention input에 연결한다. 다만 mapped Notion task와
Calendar 기반 first-step fit은 아직 직접 후보가 아니며, GitHub candidate
coverage를 대신하지 않는다. unavailable source와 context-only capability를
결과에서 숨기지 않는다.

이 범위는 제품 구현 결정을 위한 초기 가설이다. dogfooding, 인터뷰와 실제
사용 패턴으로 검증하되, 일반 생산성 사용자까지 먼저 확장하지 않는다.

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
현재 평가 가능한 범위에서는 사용자가 직접 개입할 항목이 없습니다.
평가하지 못한 source: Notion, Google Calendar
```

---

## 4. 고정할 계약과 실험할 가설

정답이 하나가 없는 추천 문제에서 구현 계획의 목적은 가중치를 미리 완성하는
것이 아니라 안전한 실험 경계를 만드는 것이다.

### 4.1 지금 고정할 계약

- 원본 source와 evidence lineage 보존
- source refresh를 서버 coordinator 하나로 통과시키고 source별 시도, 성공,
  실패, backoff와 snapshot revision을 보존
- current snapshot과 ordered sanitized sync history 분리
- source별 허용 scope와 freshness 표시
- 완료, 취소, 대체 항목 제외
- 사용자의 실제 개입이 필요한지 검증
- 정상 진행 중인 Codex 실행은 추천하지 않고 overview에만 표시
- Codex thread inventory와 blabase가 소유한 managed App Server event stream을
  구분하고 inventory에는 live execution state를 부여하지 않음
- Phase 2B.1 managed projection 중 exact direct failure와 configured completion
  follow-through만 Phase 4B의 versioned candidate gate를 거쳐 Attention에 사용
- Codex 승인·입력 요청은 안정된 발생·해결·만료 수명주기 계약 전까지
  active candidate에서 제외
- Codex 실행 완료와 GitHub/Notion task 완료를 분리
- 근거 없는 마감, 영향, 긴급성 생성 금지
- source claim 충돌을 덮어쓰지 않고 보존
- 낮은 확신의 cross-source fuzzy merge 금지
- project mapping은 opaque native reference와 explicit user confirmation만으로
  확정
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
- 프로젝트별 완료 후 후속조치 action/grace의 후속 version tuning
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

- 첫 release의 candidate-capable source는 GitHub와 Blabase-owned managed Codex의
  검증된 direct failure/configured follow-through로 제한
- Codex inventory/historical context는 overview-only이고, managed run은
  execution overview와 제한된 active exception candidate를 제공
- 네 source를 관리하는 server-side `SourceSyncCoordinator`
- source별 latest attempt/success/failure, retry/backoff와 ordered sanitized
  attempt history
- snapshot revision 기반 Work Cockpit/Attention Lab 자동 invalidation
- 사용자가 선택한 connector scope만 사용
- connector snapshot validity와 freshness 검사
- source별 `WorkSignal` 정규화
- GitHub assigned issue 후보와 review request 관찰
- Codex 실행별 진행 상태와 최근 의미 있는 진전 overview
- 검증된 Codex 정체, 실패, 완료 후 후속조치 누락 후보
- Codex 승인·입력 대기는 current active candidate 범위에서 제외
- Google Calendar schedule context. free-block과 실행 적합성은 후속 단계
- Notion project context. 명시적으로 매핑된 task database 후보는 후속 단계
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

- GitHub 또는 Codex를 사용하지 않는 일반 생산성 사용자 지원
- 첫 release에서 Notion/Calendar를 필수 source 또는 핵심 추천 source로 사용
- Notion 일반 페이지 본문과 댓글 전체 수집
- Calendar 제목을 기본 task 의미로 해석
- GitHub 코드, issue/PR 본문, 댓글 전체 수집
- managed live stream의 Codex prompt, response, command, output, diff와 tool
  payload 수집. 단, 별도 explicit opt-in historical collector와 로컬에서
  최소화한 managed lifecycle metadata는 각각의 제한된 계약에서 허용
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
+ Codex inventory-only execution overview
+ Blabase-owned managed execution progress (관찰 전용)
+ Google Calendar schedule context
+ Notion project context
+ 사용자의 이번 주 목표 한 줄
→ Codex execution overview
→ top / clarification / scoped no-action / insufficient-evidence
```

Google Calendar와 Notion은 Phase 2A.1부터 실제 Attention input, coverage와
Work Cockpit supporting context에 들어간다. Calendar event와 일반 Notion
resource 자체는 후보가 아니다. Calendar first-step 적합성과 Notion task DB
property mapping이 구현된 뒤에만 직접 결정 의미를 확대한다.

Codex inventory의 `active`와 `taskSummary`는 progress, stall, failure 또는
사용자 obligation을 증명하지 않는다. 승인·입력 상태도 overview badge로만
보여주며 ranking 후보로 만들지 않는다. Phase 2B.1 managed event는 live
progress를 별도 표시하지만 아직 Attention에 연결하지 않는다. richer native
contract와 detector 정책이 별도 version으로 검증된 뒤에만 예외 판정을
활성화한다.

`이번 주 최우선 결과`는 onboarding이나 매 화면마다 반복해서 묻지 않는다.
기본 cadence는 일주일에 한 번이며, 사용자가 직접 변경할 때 즉시 갱신한다.
project registry가 아직 없는 첫 사용자도 global outcome을 Attention focus로
받는다. 하나의 project가 resolve되면 project outcome을 우선하고, override가
없으면 global outcome으로 fallback한다.

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
| `clarify` | 추천 전에 사용자 확인 | 사용자가 해결할 수 있는 owner/eligibility conflict |
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
| `no_action` | 선언한 candidate-capable 평가 범위가 완전하고 그 범위에 지금 사용자 개입이 필요하지 않음 |
| `insufficient_evidence` | source 실패, stale, truncation 또는 evidence 부족 |

`no_action`과 `insufficient_evidence`를 합치지 않는다. 사용자가 할 일이 없는
상태와 엔진이 모르는 상태는 제품적으로 다르다.

---

## 7. 전체 파이프라인

```text
Server SourceSyncCoordinator
       ↓
Latest Connector Snapshots + Ordered Sanitized Attempt History
       ↓ snapshot revision
UI Invalidation / Stored Snapshot Reload
       +
Blabase-owned App Server Events → Managed Progress Projection/UI
                                  (Attention input으로 전달하지 않음)
       ↓
Current + Prior Source Snapshots + Optional Conversation Candidates
                         ↓
           Snapshot Validity / Freshness Gate
                         ↓
               Source-specific Normalizers
                         ↓
                    WorkSignal[]
                         +
      Explicit Project Mapping / Weekly Outcome
                         +
       Calendar Schedule / Notion Project Context
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

현재 `thread/list` collector는 inventory-only이므로
`liveObservationAvailable=false`, execution state `unknown`으로 보존한다.
inventory history는 목록 관찰의 순서만 제공하며 progress/stall detector에
사용하지 않는다.

Phase 2B.1의 Blabase-owned managed stream은 strict ordered lifecycle metadata와
latest projection을 별도 Work Cockpit 영역에 표시한다. 이 projection은
`forbiddenAsAttentionCandidate=true`이며 현재 pipeline의 WorkSignal,
AttentionItem, replay input과 monitor hash에 들어가지 않는다.

향후 managed Codex detector의 정체와 진전은 단일 event로 판단하지 않는다.
동일 execution의 순서가 보존된 event window에서 `lastActivityAt`과
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

Phase 1 runtime 계약은
`suggestion/src/crossSource/schema.ts`,
`validateSnapshots.ts`, `workSignalIntegrity.ts`를 기준으로 한다.
평가용 `SyntheticNormalizedSignal`과 별개의 계약이다.

### 8.1 Snapshot envelope

Phase 2A.1 operational sync는 GitHub, Codex, Notion, Google Calendar 전체에
공통 계약을 적용한다.

```ts
type SourceSyncState = {
  source: "github" | "codex" | "notion" | "google_calendar";
  status:
    | "disabled"
    | "never_synced"
    | "syncing"
    | "ready"
    | "retry_wait";
  retryCount: number;
  nextDueAt: string | null;
  lastAttempt: SourceSyncAttempt | null;
  lastSuccess: SourceSyncAttempt | null;
  lastFailure: SourceSyncAttempt | null;
  latestSnapshot: {
    revision: string;
    hash: string;
    itemCount: number;
    syncedAt: string;
  } | null;
};
```

`SourceSyncCoordinator`는 source별 single-flight, due schedule와 exponential
backoff를 관리한다. latest state와 ordered attempt history는 각각
`.local/sync/latest.json`, `.local/sync/history.json`에 분리 저장한다. history는
snapshot payload나 provider detail 없이 timing, revision/hash/count,
retry count와 sanitized error code만 가진다.
두 projection을 갱신하기 전 exact target과 attempt를
`.local/sync/settlements.json`의 `source-sync-settlement-v1`으로 먼저
기록한다. history→latest 중간 실패는 같은 process에서 즉시 확인·복구하고,
연속 실패나 crash는 다음 read/mutation 또는 재시작 때 저장된 target을 그대로
재생한다.
다른 source commit이 이 journal을 먼저 복구하면 recovered disk latest를
authoritative base로 사용하고 새 source state만 병합한 뒤 그 store를
coordinator memory에도 반환한다. journal recovery가 없는 정상 commit은
caller latest 전체를 유지하므로 adapter-registration normalization은
그대로 persistence된다. journal target 적용 전에는 transition 보호 대상이
아닌 source의 retained history와 latest `lastAttempt`가 모순되지 않는지
교차검증한다.
같은 authoritative handoff는 `beginTransition`, `updateTransition`,
`completeTransition`에도 적용한다. 다른 source reset/disconnect가 journal을
복구하면 recovered latest에 transition source target만 병합하고 그 결과를
coordinator memory에 되돌린다.
coordinator는 sync와 reset/disconnect intent 준비 전에도 journal recovery를
선택적으로 수행한다. 따라서 같은 source disconnect의 `previous`,
`retryCount`, `lastSuccess`와 attempt가 recovered state에서 만들어진다.
adapter가 없는 source는 transition/pending 확인 뒤 즉시 skip한다. 실제 등록된
adapter는 unrelated transition이 있어도 settlement queue를 무조건 통과한 뒤
current/due/previous snapshot을 읽고 실행한다.

connector connect/callback, Codex refresh/content mode,
`POST /api/attention`과 `evaluateCurrentAttention({refreshSources:true})`의
명시적 snapshot collection도 coordinator를 통과한다.
`CONNECTOR_DISCONNECTED`, `REAUTHORIZATION_REQUIRED`와 명시적인
refresh-token 부재·만료는 persisted `disabled`와 `nextDueAt=null`로 남아
scheduled retry를 멈추고, reconnect 뒤 manual sync가 성공하면 `ready`로
복구한다.

`GET /api/sync/status`와 `GET /api/attention`은 side-effect-free read다.
visible UI는 same-origin `POST /api/sync/start`로 local background scheduler를
명시적으로 시작한다. start 응답은 외부 source collection을 기다리지 않고
due timer를 arm한 직후 반환한다. GitHub/Notion/Calendar provider HTTP 요청은
요청당 15초 상한을 가지며, manual sync mutation도 완료 뒤 scheduler 유지를
보장한다.

Cross-source semantic normalization의 current envelope는 GitHub와 Codex
`WorkSignalBatch`에 적용한다.

```ts
type RuntimeSource = "github" | "codex";

type SourceSnapshotArtifact<T> = {
  contract: "runtime-source-snapshot-v0.1";
  source: RuntimeSource;
  sourceSchemaVersion: string;
  collectorVersion: string;
  fetchedAt: string;
  scopeIds: string[];
  sourceSnapshotSha256: string;
  payload: T;
};

type SourceCollectionFailure = {
  contract: "runtime-source-collection-failure-v0.1";
  source: RuntimeSource;
  status: "missing" | "invalid" | "unsupported";
  code:
    | "SNAPSHOT_MISSING"
    | "SNAPSHOT_PARSE_FAILED"
    | "SNAPSHOT_SCHEMA_UNSUPPORTED";
};

type SnapshotAssessment = {
  contract: "runtime-snapshot-assessment-v0.1";
  source: RuntimeSource;
  asOf: string;
  fetchedAt: string;
  freshnessPolicyVersion: string;
  freshness: "fresh" | "stale" | "invalid";
  completeness: "complete" | "partial";
  truncated: boolean;
  candidateSetComplete: boolean;
  usableForOverview: boolean;
  usableForCurrentCandidates: boolean;
  reasonCodes: string[];
};
```

성공 artifact, collection failure, freshness/completeness assessment를
분리한다. 그래서 `failed + payload` 같은 모순 상태를 만들지 않고, stale과
partial처럼 동시에 참일 수 있는 축을 하나의 status로 덮어쓰지 않는다.
collection failure에는 raw provider message나 payload를 넣지 않는다.

freshness TTL과 허용 clock skew는 하드코딩하지 않고 versioned policy와 고정된
`asOf`를 주입한다. source snapshot hash는 정규화된 connector payload만
포함하며 normalizer version은 포함하지 않는다.

`RuntimeSnapshotWindow`는 이미 정규화된 batch를 strict chronological order로
받고 minimum history, version change, truncation에 따른
`historySufficiency`만 판단한다. 현재 Codex v2 window는 native observation을
보존할 뿐 정체, 복구, 완료 또는 request lifecycle을 파생하지 않는다.

### 8.2 Source evidence

Conversation evidence와 connector evidence를 같은 형태로 위장하지 않는다.

```ts
type RuntimeSourceEvidence =
  | GitHubQueryMembershipEvidence
  | GitHubObjectFieldEvidence
  | GitHubActivityEvidence
  | CodexSessionFieldEvidence;
```

GitHub assigned/review/authored 의미는 object field가 아니라 API query membership
근거이므로 `github_query_membership`으로 기록한다. object field evidence는
허용 field enum과 value SHA-256을 사용한다. Codex도 허용된 session field만
`codex_session_field`로 기록한다. 임의의 `nativeField: string`이나
`conversation_span`은 runtime connector schema를 통과하지 못한다.

### 8.3 Work signal

```ts
type RuntimeWorkSignal = {
  contract: "runtime-work-signal-v0.2";
  signalId: string;       // snapshot 사이에 유지되는 claim identity
  observationId: string;  // 특정 snapshot의 observation identity
  signalHash: string;
  sourceSnapshotSha256: string;
  normalizerVersion: string;
  source: "github" | "codex";
  subjectId: string;
  subjectType: "work_item" | "source_activity" | "execution";
  sourceScopeId: string;
  projectId: string | null; // explicit active mapping이 있을 때만 값 존재
  kind:
    | "work_item_observation"
    | "deadline_observation"
    | "activity_observation"
    | "execution_observation";
  facts: GitHubWorkItemFacts
    | GitHubDeadlineFacts
    | GitHubActivityFacts
    | CodexExecutionObservationFacts;
  observedAt: string;
  sourceUpdatedAt: string | null;
  validUntil: string | null;
  directness: "explicit" | "derived";
  completeness: "complete" | "truncated" | "unknown";
  attentionCapability: "candidate_input" | "overview_only";
  evidence: RuntimeSourceEvidence[];
};
```

`facts`는 `unknown`이나 자유 형식 record가 아니라 `kind + source`별 strict
discriminated schema다. `signalId`는 native subject와 claim 종류로 결정돼
snapshot이 달라도 유지되고, `observationId`와 `signalHash`는 snapshot과
관찰값 변경을 반영한다. batch는 source snapshot hash, normalization input
hash, deterministic signal order, sanitized issue와 batch hash를 기록한다.

v0.2에서는 GitHub repository와 Codex scope를 explicit work-context registry로
조회해 `projectId`를 주입한다. mapping이 없거나 proposal 상태인 경우에는
`null`을 유지하며 source label/path 유사성으로 project를 추론하지 않는다.

GitHub authored PR과 activity는 `overview_only`다. review request는
`draftState = unknown`, `eligibilityLimit = draft_state_unknown`을 보존한다.
Codex inventory의 `active`, `not_loaded`, `system_error`는 live execution
state `unknown`이며
approval/input은 `overview_badge_only`다. Phase 1 schema에는
execution exception, completion, progress 또는 request lifecycle kind 자체가
없다.

runtime signal을 평가 fixture에 직접 넣지 않는다.
`mapRuntimeBatchToSyntheticEvaluationSignals`만 두 계약을 import해
evaluation-only signal과 normalized snapshot SHA-256을 만든다.

### 8.4 Codex execution overview

Codex의 진행 가시성은 추천 결과와 분리된 1급 출력으로 둔다.

현재 Phase 2A.1 output은 inventory-only다.

```ts
type CurrentCodexOverviewItem = {
  observationMode: "inventory_only";
  liveObservationAvailable: false;
  executionState: "unknown";
  waitingState: null;
  sourceEvent: "thread_inventory";
  executionStateReason:
    "CODEX_INVENTORY_IS_NOT_LIVE_EXECUTION_STATE";
  nativeActivityState:
    | "active"
    | "idle"
    | "not_loaded"
    | "system_error"
    | "unknown";
  forbiddenAsAttentionCandidate: true;
};
```

`not_loaded`는 stopped, failed 또는 completed가 아니라 “이 inventory
connection으로 live 실행을 관찰할 수 없음”이다. current snapshot마다
metadata-only observation을 strict sequence order로 최대 30일 저장하지만,
polling inventory history는 progress/stall/completion evidence가 아니다.
`codex-execution-observation-v2`는 위 inventory tuple을 exact하게 검증한다.
따라서 snapshot의 overview-only approval/input badge를 observation
`waitingState`로 저장하거나 managed 전용 reason/event를 섞을 수 없다.
semantically valid한 persisted v1 observation/history는 read 시 v2로
정규화하고 다음 정상 append에서 v2로 교체하지만, malformed v1은 fail
closed한다.

`running`, `completed`, `failed`, `interrupted`는 blabase가 long-lived App
Server connection을 소유하고 `thread/status/changed`, turn/item event를 직접
받는 `managed_event_stream`에서만 허용한다. 아래는 그 managed runtime과
Phase 2B detector가 완성된 뒤의 목표형이다.

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

Phase 2A.1 store는 global outcome(`projectId=null`)과 project-scoped outcome을
모두 7일 cadence로 보존한다. Attention run에 들어온 네 source scope를 explicit
registry로 resolve했을 때 active project가 하나면 해당 project outcome을
우선하고, 없으면 global outcome으로 fallback한다. 여러 project가 충돌하거나
registry가 없으면 project relation을 만들지 않는다.

현재 Work Cockpit의 `/api/context/weekly-outcome` UI는 global 한 줄을
capture/update한다. project-scoped 편집 UX는 후속 작업이지만 store,
resolution과 Attention input 계약은 이를 지원한다.
registry store가 아직 없는 첫 사용자 경로도 active global outcome을
Attention에 전달한다.

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
| `review_requested_pull_request`, draft unknown | provisional `inspect` | PR을 열어 draft 여부와 리뷰 가능 상태 확인 |
| `review_requested_pull_request`, `isDraft = false` | confirmed `review` | Phase 2B native contract에서 실제 review 후보 |
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

현재 connector의 review signal에는 `isDraft`가 없으므로 Phase 1 normalizer는
review 요청 사실만 `WorkSignal`로 보존한다. draft 상태를 `false`로 추정하거나
confirmed `review` candidate로 확정하지 않는다. Phase 2A는 safe destination이
있는 경우 provisional `inspect`로 상태 확인만 제안한다. `isDraft`가 native
contract에 추가된 뒤 Phase 2B에서 confirmed `review`로 승격한다.

### 9.2 Codex

Codex adapter는 source evidence가 붙은 `WorkSignal`만 만든다. 이후 observation
branch가 다음 두 출력을 만든다.

1. 모든 실행의 진행 상태를 보여주는 `CodexExecutionOverview`
2. 공통 resolver와 gate로 되돌려 보낼 검증된 exception `WorkSignal`

adapter나 exception detector가 `AttentionItem`을 직접 만들면 안 된다.
exception signal도 project mapping, relation resolution, claim authority,
eligibility를 통과한 뒤에만 공통 candidate derivation에서 AttentionItem이 된다.

현재 collector의 `thread/list`는 session inventory다. 모든 current observation은
`observationMode=inventory_only`, `executionState=unknown`이고
`forbiddenAsAttentionCandidate=true`다. `active`, `not_loaded`,
`system_error`와 approval/input badge를 아래의 정상 또는 예외 실행 상태로
변환하지 않는다. live state는 blabase가 소유한 long-lived App Server에서
ordered thread/turn/item notification을 받은 managed execution에만 허용한다.

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
| `execution_stalled` | `inspect` 또는 `resume` | fresh snapshot, 실행 지속 예상, phase별 threshold 초과, 의미 있는 진전 없음, 사용자 개입 가능, explicit goal·obligation·downstream block 중 하나와 연결 |
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
- stall state가 검증돼도 goal, obligation, downstream block 연결이 없으면
  overview-only로 유지하고 AttentionItem을 만들지 않는다.

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
`metadata_only`를 기본으로 유지한다. `conversation_and_execution`은 별도
current consent contract에 사용자가 명시적으로 동의한 선택 project에만
활성화한다. 이 mode는 `thread/read(includeTurns=true)`의 source cap 안에서
과거 prompt, answer, plan, command output/exit, file diff와 tool result를
connector 전용 private artifact에 최대 7일 저장한다. reasoning은 제외한다.
WorkSignal과 Attention에는 전체 원문이 아니라 completeness/count/status와
재정제된 최대 200자 clue만 전달한다.

### 9.3 Google Calendar

Calendar event는 기본적으로 task 후보가 아니다.

Phase 2A.1 `supporting-source-adapter-v0.3`는 current snapshot을
`schedule_context_only` Attention input으로 변환한다. 취소되지 않은 향후
event의 시작/종료, all-day, tentative와 explicit Calendar connection-scope
project mapping을 Work Cockpit supporting context에 전달한다. 결정적 순서의 최대
250개 constraint만 전달하고 초과 여부를 `truncated`로 보존한다.

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

Phase 2A.1 `supporting-source-adapter-v0.3`는 current snapshot을
`project_context_only` Attention input으로 변환한다. resource ID의 explicit
project mapping, kind, 최근 수정 시각과 truncation을 coverage/Work Cockpit에
전달하지만 candidate를 생성하지 않는다.

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

### 9.6 현재 source 계약과 다음 최소 보강

| Source | 현재 확인 가능한 필드 | 직접 추천 역할 | 다음 version에서 필요한 최소 보강 |
|---|---|---|---|
| GitHub | open assigned issue, review request, authored PR, label, milestone due. review request에는 현재 `isDraft` 없음 | assigned issue 후보, review 요청 관찰 | `isDraft`, review decision, checks, merge state, review 취소/변경 |
| Codex | `codex-snapshot-v3` inventory/history와 opt-in historical private store는 current state `unknown`. 별도 Blabase-owned managed App Server가 ordered lifecycle metadata, exact binding/GitHub relation, project workflow와 safe open reference를 제공 | inventory/history는 context-only. managed direct failure와 exact relation + configured workflow가 있는 completion follow-through만 active 후보 | verified meaningful progress/stall/scope drift, stable request ID와 requested/resolved/expired lifecycle, approval/input escalation |
| Calendar | OAuth 연결 세대별 random scope의 primary calendar, -7일~+14일, event start/end/status/title, `Asia/Seoul` | `schedule_context_only` | 사용자 timezone, busy/transparency, 포함 calendar scope, free/busy 정책 |
| Notion | page/data-source title, created/edited time | `project_context_only` | 선택 task DB와 status/assignee/due/priority/project property mapping |

새 normalizer는 현재 source 계약이 제공하지 않는 필드를 추론으로 채우지 않는다.
필드가 추가되기 전에는 해당 source의 역할을 위 표의 현재 범위로 제한한다.

따라서 Codex inventory snapshot/history만으로는 정체, 실패 복구, 완료 후 미정리,
scope drift를 안전하게 판단할 수 없다. `codex-snapshot-v3`의 inventory/
historical-context observation과 Blabase-owned `managed_event_stream`은 분리한다.
inventory, optional task summary와 bounded historical clue는 추천 후보로 승격하지
않고, persisted turn의 완료·실패도 current process의 완료·실패로 해석하지 않는다.
Phase 4B active resolver는 managed stream의 exact direct failure와 configured
completion follow-through만 검증된 예외로 사용한다. verified stall, scope drift와
approval/input escalation은 richer lifecycle 계약 전까지 비활성화한다.

optional `taskSummary`의 기본 의미 상태는 `unknown`이다. 사용자가 표시를
opt-in한 경우 Work Cockpit의 execution label을 돕는 단서로만 쓸 수 있다.
summary만으로 progress, 사용자 task, completion 또는 obligation을 만들지
않는다. follow-through AttentionItem은 exact GitHub relation과 configured active
non-archived project workflow가 모두 있을 때만 생성한다.

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
type SourceScopeRef =
  | {
      source: "github";
      resourceType: "repository";
      opaqueId: string;
    }
  | {
      source: "codex";
      resourceType: "scope";
      opaqueId: string;
    }
  | {
      source: "notion";
      resourceType: "resource";
      opaqueId: string;
    }
  | {
      source: "google_calendar";
      resourceType: "scope";
      opaqueId: "primary";
    };

type ProjectMappingDecision = {
  action: "confirm" | "remove";
  scope: SourceScopeRef;
  projectId: string | null;
  decisionSource: "explicit_user";
  decidedAt: string;
  supersedesDecisionId: string | null;
};
```

Phase 2A.1의 `work-context-registry-v1`은 project identity, ordered mapping
decision과 아직 적용되지 않은 proposal을 분리한다. proposal은 normalizer의
`projectId`를 바꾸지 않는다. `/api/context/projects`의
`explicitUserConfirmation=true` confirm/remove만 active mapping이 된다.
원본 email, repository name, local path 또는 title 유사성을 mapping key로
사용하지 않는다.

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
type RankableAttentionLane =
  | "must_now"
  | "unblock"
  | "close_loop"
  | "focus";
```

| Rankable lane | 포함 기준 |
|---|---|
| `must_now` | 검증된 임박 마감, 곧 시작할 약속에 직접 연결된 준비, 검증된 즉시 consequence |
| `unblock` | 리뷰 요청, 외부 사람이 기다림, 중요한 outcome을 막는 정체·실패·오래 지속된 승인/입력 |
| `close_loop` | 실행은 완료됐지만 명시적 workflow의 검토·커밋·PR·리뷰 후속조치가 남음 |
| `focus` | 직접 검증된 user/shared task이며 현재 시작 가능. primary outcome 연결은 같은 lane 안의 우선순위 근거 |

`clarify`와 `none`은 rankable lane이 아니다. 각각
`needs_clarification`과 `no_action`으로 가는 decision route다.

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
- deterministic tie-break는 적극 정책의 기본 선택에 사용하되 더 중요하다는
  근거로 표현하지 않고 caveat와 alternatives를 제공

### 13.3 Clarification 조건

다음 경우에만 한 번에 질문 하나를 반환한다.

- state/owner conflict를 사용자가 해결할 수 있음
- 사용자의 답이 eligibility나 명시적인 실행 결정을 바꿈
- source refresh가 아니라 사용자만 제공할 수 있는 사실이 필요함

같은 lane의 후보가 비슷하거나 primary outcome이 없다는 이유만으로
clarification을 만들지 않는다. Phase 2A는 stable ID를 마지막 default
tie-break로 사용하고 `CAVEAT_DEFAULT_TIE_BREAK_USED`와 alternatives를
반환한다.

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

Phase 2B.1 UI는 먼저 managed run별 연결, 연속성, effective/last-verified state와
최근 lifecycle item type만 보여준다. historical inventory와 managed progress를
별도 영역으로 나누고 “관찰 전용 · 추천 우선순위에 반영하지 않음”을 표시한다.
아래의 의미 있는 진전, 정체 reason과 후속조치는 detector가 구현된 뒤의 목표
표현이다.

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
현재 평가 가능한 범위에서는 사용자가 직접 개입할 항목이 없습니다.
GitHub assigned issue와 review request 관찰은 확인되지 않았고, Codex 작업
2개는 activity overview로 표시되지만 semantic progress는 아직 unknown입니다.
Notion은 이번 판단에서 평가하지 못했습니다.
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

현재 Phase 2A.1 local product route:

| Route | 역할 |
|---|---|
| `GET /api/sync/status` | side-effect-free source별 latest attempt/success/failure/backoff와 pipeline revision read |
| `POST /api/sync/start` | same-origin local background scheduler 시작 |
| `POST /api/sync` | same-origin source별 manual sync |
| `GET /api/attention` | side-effect-free stored snapshot preview, run history 미기록 |
| `POST /api/attention` | 네 source sync 후 Attention 평가와 run history 기록 |
| `GET/POST /api/context/weekly-outcome` | active global weekly outcome read/capture |
| `GET/POST /api/context/projects` | project registry read, project 생성과 explicit mapping confirm/remove |
| `GET /api/work-resumption` | explicit binding, Companion heartbeat와 bounded command 결과 read |
| `POST /api/work-resumption` | same-origin bind/unbind/focus-or-resume action |
| `GET /api/managed-codex-runs` | Attention과 분리된 managed run public progress projection read |

sync status는 source별 snapshot revision/hash를 반환한다. visible UI가 둘 중
하나의 변화를 확인하면 connector, timeline, Work Cockpit과 Attention Lab을 invalidation해
저장본을 다시 읽는다. client polling failure는 backoff 후 재시도하고,
disconnect/connect/context mutation도 같은 invalidation 경계를 사용한다.

managed run route도 local-only, `Cache-Control: no-store`이며 visible Work
Cockpit에서 별도 2초 polling한다. 이 revision은 source snapshot/Attention
revision과 독립이고 Attention invalidation을 만들지 않는다.

connector connect/callback, Codex refresh/content mode와 direct live Attention
refresh도 같은 coordinator attempt/history 경계를 통과한다. Work Cockpit의
global weekly outcome은 registry가 아직 없어도 Attention focus에 전달된다.

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
    attentionCapability:
      | "candidate_capable"
      | "overview_only"
      | "unsupported";
    capabilityReasonCodes: string[];
    fetchedAt: string | null;
  }>;
};
```

### 17.2 통합 전제

- connector read failure와 recommendation failure 분리
- 일부 source 실패 시 remaining coverage를 명시
- source freshness와 attention capability를 분리
- 검증된 positive candidate는 독립 source failure가 있어도 제한된 범위를
  밝히고 추천 가능
- `no_action`은 선언한 candidate-capable scope의 complete negative coverage가
  필요하며, 평가하지 못한 non-material source를 결과에 표시
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

mutable Dev Candidate는 material change마다 `datasetRevision`을 증가시킨다.
평가 run은 `datasetVersion + datasetRevision + materialized SHA-256`을 함께
기록하며, freeze 시에는 새 Golden version과 immutable canonical hash를 만든다.

```ts
type CrossSourceEvaluationCase = {
  caseId: string;
  title: string;
  summary: string;
  tags: string[];
  decisionAt: string;
  timezone: string;
  focus: UserFocusContext;
  sourceSnapshotWindows: Array<{
    source: ConnectedSource;
    status: "fresh" | "stale" | "partial" | "failed" | "disconnected";
    attentionCapability:
      | "candidate_capable"
      | "overview_only"
      | "unsupported";
    materialToDecision: boolean;
    candidateSetComplete: boolean;
    observationStartedAt: string;
    observationEndedAt: string;
    truncated: boolean;
    orderedSnapshotRefs: Array<{
      snapshotId: string;
      snapshotSha256: string;
      fetchedAt: string;
      schemaVersion: string;
      normalizerVersion: string;
      fixtureRef: string;
    }>;
  }>;
  // 평가 전용 shape. Phase 1 runtime WorkSignal과 mapping contract를 둔다.
  workSignals: SyntheticNormalizedSignal[];
  relations: WorkRelation[];
  codexDetectorConfig: {
    version: string;
    immutableRef: string;
    sha256: string;
  } | null;
  annotations: Array<{
    itemId: string;
    sourceSubjectIds: string[];
    disposition: AttentionDisposition;
    acceptableOverviewStates: CodexExecutionState[];
    eligibility: "eligible" | "review_required" | "ineligible";
    interventions: {
      required: AttentionIntervention[];
      acceptable: AttentionIntervention[];
      forbidden: AttentionIntervention[];
    };
    acceptableLanes: RankableAttentionLane[];
    forbiddenAsRankableCandidateAtDecision: boolean;
    reasonCodes: {
      overview: string[];
      candidate: string[];
      whyNow: string[];
      gate: string[];
      review: string[];
    };
    firstStep: {
      required: boolean;
      destinationRequired: boolean;
      acceptableInterventions: AttentionIntervention[];
      evidenceSignalIds: string[];
    };
  }>;
  expectedCodexExecutions: Array<{
    executionId: string;
    acceptableStates: CodexExecutionState[];
    mustAppearInOverview: boolean;
    executionForbiddenAsAttentionCandidate: true;
  }>;
  expectedCoverage: {
    disposition: "complete" | "limited_but_sufficient" | "insufficient";
    negativeCandidateCoverageComplete: boolean;
    limitedSources: ConnectedSource[];
    materialUncertaintySources: ConnectedSource[];
    uncertaintyBasis: Array<
      "source_coverage" | "history_gap" | "contract_gap" | "critical_conflict"
    >;
    positiveCandidateIndependentOfUnknowns: boolean;
  };
  expectedDecision: {
    status: CrossSourceSuggestionStatus;
    acceptableTopItemIds: string[];
    forbiddenItemIds: string[];
    reasonCodes: string[];
    clarification: {
      questionIntent: string;
      answerChanges: "top_item" | "eligibility";
    } | null;
  };
  pairwisePreferences: Array<{
    preferredItemId: string;
    overItemId: string;
    reasonCode: string;
  }>;
  hardFailureRisks: CrossSourceErrorCode[];
  review: {
    status: "draft" | "reviewed" | "adjudicated" | "frozen";
    authorId: string;
    reviewerIds: string[];
    adjudicationRef: string | null;
    notes: string;
  };
};
```

단일 `topItemId`만 정답으로 두지 않는다.

실행 가능한 schema는
`suggestion/src/evaluation/crossSourceDatasetSchema.ts`를 기준으로 한다. 첫
Dev Dataset은 connector adapter나 relation resolver가 아니라
`normalized_work_signals_and_relations` 이후의 판단 경계를 평가한다. relation은
이미 해결된 입력으로 주입한다. 실제 connector snapshot 변환과 relation 발견은
별도 integration fixture로 평가한다.

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
false_no_action
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

Phase 4B current version과 Phase 2 base compatibility:

```text
runtime WorkSignal                  runtime-work-signal-v0.3
runtime WorkSignal batch            runtime-work-signal-batch-v0.3
base Attention input/result         cross-source-attention-input-v0.3
                                     cross-source-attention-result-v0.3
active Attention input/result       cross-source-active-attention-input-v0.4
                                     cross-source-active-attention-result-v0.4
active Attention policy             aggressive-evidence-bound-attention-policy-v0.3
active candidate/lane               github-managed-codex-active-candidate-rule-v0.1
                                     active-attention-lane-policy-v0.1
active ranking/resolver             active-attention-ranking-policy-v0.2
                                     active-attention-decision-resolver-v0.3
active evaluator config             active-attention-decision-config-v0.2
GitHub candidate rule               github-project-aware-candidate-rule-v0.2
Codex overview rule                 codex-historical-context-overview-rule-v0.3
live orchestrator                   attention-live-orchestrator-v0.4
Attention monitor run              attention-monitor-run-v0.4
                                     (v0.1/v0.2/v0.3 read compatibility)
ephemeral Attention preview        attention-monitor-preview-v1
failed Attention execution         attention-monitor-failure-v0.3
                                     (v0.1/v0.2 read compatibility)
private Attention replay input     attention-replay-input-v2
                                     (v1 read compatibility)
claim resolver                      cross-source-claim-resolver-v0.2
eligibility projection/resolver    attention-eligibility-shadow-projection-v0.1
                                     attention-eligibility-resolver-v0.1
project workflow                    project-workflow-store-v0.1
                                     project-workflow-follow-through-policy-v0.1
source sync state/history           source-sync-state-v1
                                     source-sync-history-store-v1
source sync transition             source-sync-transition-v1
                                     source-sync-transition-store-v1
source sync settlement             source-sync-settlement-v1
                                     source-sync-settlement-store-v1
work context                        work-context-registry-v1
                                     weekly-outcome-store-v1
supporting source adapter           supporting-source-adapter-v0.3
Codex observation/history           codex-execution-observation-v2
                                     codex-observation-history-v2
                                     (exact v1 read compatibility)
managed Codex registry/event         codex-managed-run-registry-v1
                                     codex-managed-event-v1
managed Codex history/latest         codex-managed-event-history-v1
                                     codex-managed-latest-projection-store-v1
managed Codex public projection      codex-managed-public-projection-v1
managed Codex settlement/retention   codex-managed-settlement-v1
                                     codex-managed-retention-v1
```

### 20.2 Run record

```ts
type CrossSourceSuggestionRunRecord = {
  runId: string;
  analysisId: string;
  sessionId: string;
  decisionId: string;
  status: "running" | "completed" | "partial" | "failed";
  asOf: string;
  startedAt: string;
  completedAt: string | null;
  codeCommitSha: string | null;
  codeState:
    | "clean_commit"
    | "declared_commit"
    | "dirty_worktree"
    | "unavailable";
  codeFingerprintSha256: string | null;
  inputHash: string;
  outputHash: string | null;
  replayArtifactContract: "attention-replay-input-v2";
  replayArtifactSha256: string;
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

원문, token, credentials, 전체 private path는 metadata run record에 넣지
않는다.

Phase 4B local monitor run은 GitHub/Codex batch provenance에 더해
Calendar/Notion의 snapshot SHA-256, fetched time, supporting adapter version,
item/mapping/truncation과 work-context registry, resolved context,
weekly-outcome store의 hash·상태를 기록한다. title, URL, outcome 원문이나
provider payload는 monitor history에 복사하지 않는다. current
`attention-monitor-run-v0.4`는 `analysisId`, `sessionId`, active input/result와
eligibility projection hash, replay artifact SHA-256과 code provenance를 필수로
기록하고 v0.1/v0.2/v0.3은 read compatibility만 유지한다.

GET 자동 평가는 비영속 `attention-monitor-preview-v1`로 응답한다. 명시적
POST resolver가 source sync 또는 Attention resolution에서 실패하면
`attention-monitor-failure-v0.3`에 미리 발급한 `runId`, `analysisId`,
`sessionId`, 실패 단계, sanitized error code, retry count, latency와 적용한
engine/schema/policy/rule version 및 성공 run과 동일한 code provenance를
기록한다. v0.1/v0.2 failure는 legacy contract로만 호환해 읽는다. raw exception
detail과 provider payload는 기록하지 않는다.

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

`.local/sync/latest.json`과 `.local/sync/history.json`은 operational audit다.
revision/hash/count와 sanitized attempt metadata만 저장하므로 connector
snapshot payload를 재생하는 immutable evaluation input이 아니다.
`.local/sync/settlements.json`도 두 operational projection의 crash consistency를
위해 exact sanitized target을 잠시 보존하는 journal이며, evaluation replay
artifact나 새로운 Gold 근거가 아니다.
`.local/connectors/codex/observation-history.json`도 current inventory의 ordered
metadata일 뿐 managed execution event replay artifact가 아니다.

Phase 2B.1의 `.local/connectors/codex/managed/events/`는 Blabase-owned run의
sequence/hash-chain lifecycle history다. 이 history는 operational observability
artifact이며 그 자체가 평가 dataset은 아니다. Phase 4B active resolver는 same-
request authority lease에서 verified public projection과 exact semantic/dependency
hash를 읽고 direct failure/configured follow-through만 active input으로 materialize한다.

Phase 4B에서 metadata run과 replay 저장이 모두 성공한 formal explicit
evaluation은 실제 사용한 정확한 normalized Attention input을
`.local/attention/replay-inputs/run_<id>.json`에
`attention-replay-input-v2` immutable artifact로 저장한다. artifact의
`runId`, `analysisId`, `sessionId`, input hash와 artifact hash는 metadata run과
일치해야 하며 run과 같은 30일 retention으로 삭제된다. 이 private input에는
source title, safe URL, weekly outcome 등 평가에 실제 사용된 값이 포함될 수
있으므로 directory 0700, file 0600을 사용하고 Git과 제품 API 응답에서
제외한다.

history를 읽을 때 current v0.4 run이 `available`이라고 주장한 artifact의
실재 여부, schema, run/analysis/session/input/captured-at linkage와 artifact
SHA-256을 다시 검증하고 하나라도 맞지 않으면 fail closed한다. 실제 historical
v0.3 run/replay v1은 previous contract로 exact read validation을 유지한다.
v0.1/v0.2 record의 execution/replay/code field는 read 시 null,
`not_recorded`, `legacy_unknown`으로 보수적으로 정규화되어 신뢰 provenance를
주장할 수 없다. private store rewrite는 원본 legacy record를 그대로 보존해
기존 SHA를 silently overwrite하지 않는다.

replay cleanup은 monitor validation과 분리한다. valid store일 때만 retained run
set 기반 orphan cleanup을 수행하고, corrupt store에서는 strict canonical/temp
중 cutoff보다 오래된 파일만 제거한다. current artifact, unsafe name, directory는
보존한다.

code provenance는 clean worktree commit SHA, 운영자가 명시한 commit SHA,
dirty worktree fingerprint, unavailable을 구분한다. dirty fingerprint는 당시
code state의 식별자이지 source patch materialization이 아니므로 exact release
replay는 clean committed code SHA를 요구한다.

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
- Codex raw prompt, response, command, output은 저장하지 않는
  `metadata_only`가 기본이며 summary consent를 raw consent로 승격하지 않음
- exact `codex-conversation-content-consent-v1`에 동의한
  `conversation_and_execution`만 선택 project의 bounded historical raw를
  connector 전용 `.local` artifact에 최대 7일 저장. reasoning은 제외
- opt-out, scope 변경, expiry와 disconnect에서 raw artifact 삭제
- snapshot/WorkSignal/Attention/replay/monitor/sync/API/Git에는 full raw를
  넣지 않고, 화면과 Attention에는 재정제된 최대 200자 clue와
  count/completeness만 허용
- 진행 요약은 가능한 경우 connector 내부에서 최소 정보로 만들고 evidence
  reference, opt-in, retention 정책을 적용
- private local path 대신 안전한 open reference 또는 hash 사용
- 여러 source의 raw content를 하나의 외부 LLM prompt로 전송하지 않음
- 외부 LLM에는 선택된 item의 최소 검증 필드만 전달
- raw snapshot과 private evaluation artifact는 `.local/` 또는 승인된 private store
- token과 credential은 기존 connector private storage 규칙 유지
- `.local/sync`와 `.local/context`는 directory 0700, file 0600, atomic
  replacement를 사용
- sync attempt history에는 raw provider error 대신 sanitized error code만 기록
- project mapping은 opaque source ID만 저장하고 mapping proposal을 사용자
  확인 없이 적용하지 않음
- weekly outcome은 private store에 사용자가 입력한 최소 한 줄만 저장
- `attention-replay-input-v2`는 exact active normalized evaluation input을
  `.local/attention/replay-inputs`에 immutable private file로 최대 30일
  보존하고 Git과 제품 API 응답에서 제외. v1은 read compatibility만 유지
- Codex inventory observation history는 metadata-only, 최대 30일이며 raw
  prompt/response/command/output retention은 없음
- managed Codex store도 metadata-only, 최대 30일/run별 10,000 events이며
  native thread/turn/item ID, cwd, prompt/answer/reasoning, command/output,
  diff와 tool arguments/results를 저장하지 않음
- managed App Server는 `ws://127.0.0.1:<port>`만 허용하고 observer가
  approval/user-input server request에 응답하지 않음
- managed public projection은 same-request authority/dependency 검증 뒤 direct
  failure와 configured follow-through에만 사용하고 raw event나 다른 state는
  Attention candidate/ranking에 사용하지 않음
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
│   ├── PHASE2_GITHUB_CODEX_OBSERVABILITY_CONTRACT.md
│   ├── MANAGED_CODEX_RUN_CONTRACT.md
│   └── ENGINE_CHANGE_RECORD.md
├── src/
│   ├── crossSource/
│   │   ├── types.ts
│   │   ├── schema.ts
│   │   ├── attentionSchema.ts
│   │   ├── versions.ts
│   │   ├── canonicalHash.ts
│   │   ├── normalization.ts
│   │   ├── validateSnapshots.ts
│   │   ├── workSignalIntegrity.ts
│   │   ├── buildSnapshotWindow.ts
│   │   ├── runAttentionRouter.ts
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
│   │   └── codex/
│   │       ├── toWorkSignals.ts
│   │       ├── observationContract.ts
│   │       └── appServerWebSocket.ts
│   ├── managedCodex/
│   │   ├── contracts.ts
│   │   ├── store.ts
│   │   └── runtime.ts
│   ├── sync/
│   │   ├── schema.ts
│   │   ├── coordinator.ts
│   │   ├── repository.ts
│   │   └── runtime.ts
│   ├── context/
│   │   ├── contracts.ts
│   │   ├── localStore.ts
│   │   └── resolve.ts
│   ├── attention/
│   │   ├── liveAttention.ts
│   │   └── supportingSourceAdapters.ts
│   └── evaluation/
│       ├── crossSourceDatasetSchema.ts
│       ├── crossSourceIntegrity.ts
│       ├── loadCrossSourceEvaluationDataset.ts
│       ├── mapRuntimeWorkSignals.ts
│       ├── metrics.ts
│       └── runCrossSourceEvaluation.ts
├── tests/
│   ├── crossSourceDatasetSchema.test.ts
│   ├── snapshotValidity.test.ts
│   ├── workSignalNormalization.test.ts
│   ├── crossSourceSnapshotWindow.test.ts
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
│   ├── crossSourcePrivacy.test.ts
│   ├── sourceSyncCoordinator.test.ts
│   ├── syncRoutes.test.ts
│   ├── connectorCallbackSyncRoutes.test.ts
│   ├── dataPipelineE2E.test.ts
│   ├── uiSyncController.test.ts
│   ├── workContext.test.ts
│   ├── contextRoutes.test.ts
│   ├── liveAttention.test.ts
│   ├── codexObservationContract.test.ts
│   ├── codexAppServerWebSocket.test.ts
│   ├── managedCodexStore.test.ts
│   ├── managedCodexRuntime.test.ts
│   ├── managedCodexRunsRoute.test.ts
│   ├── managedCodexRunsClient.test.ts
│   └── supportingSourceAdapters.test.ts
└── eval/
    └── synthetic/
        ├── codexDetectorConfig.v0.1.json
        ├── codexDetectorConfig.ts
        ├── devCaseBuilder.ts
        └── crossSourceDevDataset.ts
```

기존 `suggestion/src/types.ts`, `scorePriority.ts`, `selectSuggestion.ts`를
즉시 대규모 수정하지 않는다. 새 계층을 독립적으로 검증한 뒤 공통 타입과
유틸리티를 좁게 추출한다.

---

## 23. 구현 Phase

### Phase 0 — Attention 정의와 평가 계약

상태: **Closed — dev contract complete**

산출물:

- `CROSS_SOURCE_ATTENTION_DEFINITION.md`
- `CROSS_SOURCE_EVALUATION_GUIDE.md`
- evaluation case Zod schema
- canonical snapshot, detector config, frozen dataset integrity verifier
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

현재 위 machine-readable artifact와 30개 synthetic draft case가 존재하고
Phase 0 dev contract는 종료한다. 남은 human review와 adjudication은 Phase 6,
Golden freeze와 release decision은 Phase 7의 후속 작업이다. 이를 이유로
Phase 1 시작을 막지 않는다. Phase 0 종료가 runtime engine 완료나 현재
connector capability 확대를 뜻하지는 않는다.

### Phase 1 — Snapshot envelope와 WorkSignal

상태: **Completed — pure runtime normalization contract v0.1**

산출물:

- connector native snapshot을 감싸는 strict runtime envelope
- 현재 native field만 보존하는 connector별 deterministic normalizer
- source evidence discriminated union과 typed `WorkSignal`
- native observation 순서를 보존하는 window와 history sufficiency 판정
- stable signal ID와 hash
- runtime `WorkSignal`과 evaluation `SyntheticNormalizedSignal`의 명시적 mapping
- normalization tests

완료 조건:

- 같은 snapshot과 version에서 같은 WorkSignal 출력
- 같은 native observation sequence에서 같은 order와 history sufficiency 출력
- stale/truncated/failed 상태가 숨겨지지 않음
- connector record가 가짜 conversation evidence로 변환되지 않음
- 현재 contract에 없는 progress, stall, failure, completion, request lifecycle,
  `isDraft`를 추론으로 채우지 않음
- raw content와 credential이 결과에 없음

Phase 1은 progress/exception detector나 최종 eligibility를 구현하는 단계가
아니다. 현재 Codex v2의 activity와 optional summary는 의미 상태가
`unknown`이며, ordered snapshot이 있다는 사실만으로 progress나 stall을
판정하지 않는다. GitHub review 요청도 `isDraft`가 없으면 관찰 signal까지만
만든다.

현재 `src/crossSource/`, GitHub/Codex `toWorkSignals.ts`, runtime/evaluation
mapper와 Phase 1 test 19개가 위 계약을 구현한다. 전체 test, typecheck, lint,
build를 통과했으며 자세한 version과 검증 결과는
`docs/ENGINE_CHANGE_RECORD.md`의 2026-07-26 기록을 따른다. 제품 API나
recommendation selection 연결은 아래 Phase 2A local orchestrator가 별도로
담당한다.

### Phase 2 — GitHub + Codex observability vertical slice

상태: **Phase 2A·2A.1 completed, Phase 2B.0·2B.1 local beta completed**

Phase 2는 current decision, data-pipeline stabilization과 enriched connector
capability의 세 단계로 나눈다.

#### Phase 2A — current contract

완료 산출물:

- strict GitHub/Codex decision input과 versioned aggressive policy
- GitHub assigned issue 직접 `do` 후보
- draft 여부가 없는 review request의 provisional `inspect` 후보
- current Codex v3 inventory + opt-in historical-context overview
- `must_now → unblock → close_loop → focus` lane precedence의 현재 지원 부분
- minimum score와 preference tie abstention이 없는 deterministic selection
- scoped `no_action`, partial positive suggestion, `insufficient_evidence`
- top 한 개, 최대 alternative 두 개, coverage/caveat/reason code
- result stable ID와 input/result SHA-256 integrity
- local-only Attention API와 기본 화면 Work Cockpit
- source health, Codex overview와 candidate feedback
- metadata-only 30일 run history와 Attention Lab

Phase 2A의 적극 추천은 source 사실을 추측하지 않는다. eligible 또는 안전한
provisional 후보가 하나라도 있으면 질문으로 멈추지 않고 best-observed
기본값을 보여주는 정책이다. current review request는 `isDraft = false`를
주장하지 않고 “PR을 열어 draft 여부와 리뷰 가능 상태 확인”으로 제한한다.

완료 조건:

- assigned issue가 목표·점수 없이도 suggestion이 됨
- 동급 후보도 같은 입력에서 같은 top과 alternatives를 반환
- current `active`, `system_error`, approval/input badge가 candidate가 되지 않음
- stale/invalid GitHub와 unsafe destination은 적극 정책에서도 추천하지 않음
- truncated snapshot의 확인된 positive는 provisional suggestion 가능
- complete GitHub negative coverage에서만 scoped `no_action`
- GET preview는 history를 변경하지 않고 same-origin POST만 refresh와 run 기록
- Work Cockpit과 Attention Lab에서 결과, 평가 범위, 후보 gate와 version 확인
- private history에는 title, URL, task summary와 raw content가 없음

#### Phase 2A.1 — Data Pipeline Stabilization

상태: **Completed — local server-coordinated pipeline v0.3**

완료 산출물:

- GitHub, Codex, Notion, Google Calendar 공통 `SourceSyncCoordinator`
- source별 due schedule, single-flight와 exponential failure backoff
- source별 latest attempt/success/failure, retry/next due와 snapshot revision/hash
- connector current snapshot과 분리된 ordered sanitized attempt history
- history와 latest 사이 crash를 exact target으로 복구하는 private
  `.local/sync/settlements.json` journal과 same-process read-back confirmation
- source별 reset/disconnect를 직렬화하고 재시작 가능한 durable transition
  intent를 보존하는 `.local/sync/transitions.json`
- `/api/sync`, `/api/sync/start`, `/api/sync/status` local same-origin contract
- side-effect-free Attention/status GET과 explicit POST scheduler start
- 외부 collection을 기다리지 않는 scheduler start와 provider HTTP 요청
  15초 상한
- connector connect/callback/refresh를 포함한 explicit collection의 coordinator
  단일 경계
- snapshot revision/hash polling과 connector/Work Cockpit/Attention Lab/timeline
  invalidation
- polling failure recovery, visibility lifecycle와 disconnect propagation
- polling in-flight stop/start recovery와 first-status revision invalidation
- 네 connector generation guard, source별 transition mutex와
  reconnect/disconnect race protection
- 네 connector atomic temp의 strict-name startup grace/active-write cleanup과
  explicit disconnect 시 recognized inactive credential/content temp 즉시 삭제
- GitHub/Notion/Calendar local-first disconnect와 2초 bounded remote revoke
- OAuth replacement 시 해당 source의 이전 connection lineage purge와
  다른 source history 보존. purge/disconnect completion 실패 시
  `source-sync-transition-v1` intent·target state·동일 disconnect attempt와
  retry schedule을 영속 보존하고 재시작 뒤 adapter보다 먼저 idempotent replay
- Calendar 재연결마다 새 random `connectionScopeId`를 발급하고 기존 project
  mapping을 자동 재사용하지 않는 account-scope 격리
- Codex scope/content contract 변경 시 coordinator lineage reset과 scope 변경
  snapshot/inventory history 제거
- coordinator in-flight supersession과 즉시 persisted disconnect 상태
- disconnected source의 persisted disable/no scheduled retry와 manual recovery
- Codex `inventory_only`/live state unknown 계약과 30일 ordered metadata history
- inventory의 null waiting/exact reason/event/timestamp와 managed event별
  state/waiting/reason 조합을 교차 검증하는 v2 contract, valid v1 read
  normalization과 malformed persisted history fail-closed
- blabase-owned App Server event에만 허용되는 `managed_event_stream` parser 계약
- 네 source의 opaque scope를 연결하는 explicit project identity registry
- sanitized source scope discovery와 명시적 연결·해제 Work Cockpit UI
- global/project weekly outcome store와 registry 없는 첫 사용자를 포함한
  Attention context resolution
- global weekly outcome 한 줄을 생성·수정하고 저장 즉시 Attention을
  invalidation하는 Weekly focus UI
- Calendar `schedule_context_only`, Notion `project_context_only`
  `supporting-source-adapter-v0.3`, Calendar collection/constraint 250개
  cap·truncation과 pagination loop guard
- 동일 의미 상태를 중복 기록하지 않는 Codex 30일 time-based observation
  history
- Calendar/Notion snapshot과 registry/resolution/outcome monitor provenance
- `attention-monitor-run-v0.3`의 `analysisId`/`sessionId`, clean/declared commit과
  dirty code fingerprint provenance
- 실제 normalized Attention input을 최대 30일 불변 보존하는 private
  `attention-replay-input-v1` artifact와 API 비노출
- explicit POST resolver 실패의 sanitized
  `attention-monitor-failure-v0.2` metadata, code provenance와 Attention Lab
  failure count (`v0.1`은 conservative read compatibility)
- current replay claim의 artifact 실재·schema·lineage·hash read-time 검증,
  raw legacy record 보존형 provenance claim 거부, corrupt-store 독립
  canonical/temp retention 정리
- four-source Attention input/result/policy, GitHub/Codex rule와 live orchestrator
  v0.2
- synthetic private fixture에서 실제 Chromium/Next.js route/React UI를
  연결하는 Playwright browser E2E

완료 조건:

- remote refresh가 connector UI별 timer가 아니라 server coordinator 경계를 통과
- 실패 후 latest successful snapshot을 보존하고 backoff 뒤 재시도 가능
- latest state와 ordered history가 private atomic store에 분리됨
- normal commit이 history 적용 뒤 멈춰도 동일 attempt/latest/history target을
  same-process 또는 재시작에서 복구하고 disabled 상태로 영구 정지하지 않음
- reset/disconnect write가 중간 실패해도 durable intent가 다른 source commit을
  지나 재시작 후 복구되고, 같은 source의 연속 transition이 호출 순서대로
  직렬화됨
- snapshot revision 변경이 열린 Work Cockpit과 Attention Lab에 자동 전파됨
- Codex inventory가 running/completed/failed를 주장하지 않음
- explicit user confirmation 없는 project proposal이 normalizer에 적용되지 않음
- weekly outcome과 네 source adapter가 실제 Attention input에 들어감
- Calendar/Notion context가 direct candidate 또는 no-action 근거로 오용되지 않음
- metadata run과 private replay artifact의 run/analysis/session/input/hash가
  일치하고 30일 retention 및 private file permission이 적용됨
- 명시적 POST resolver 실패도 실행 ID, failed status, 단계, sanitized
  error/retry/version metadata로 기록되고 raw error는 저장되지 않음
- persisted current run의 replay artifact가 없거나 변조되면 history가
  `available` replay를 반환하지 않고 fail closed함
- 실제 browser에서 polling failure recovery, first revision invalidation과
  Codex disconnect→snapshot revision 제거→Work Cockpit/Attention Lab 전파가
  검증됨
- filesystem-backed pipeline integration, callback/API routing, controller와 네
  connector race targeted regression, 전체 test/typecheck/lint/build 검증.
  최종 검증은 Vitest `37` files/`328` tests, Playwright Chromium E2E
  `2` tests, suggestion typecheck/lint/production build 통과

운영 제한:

- current coordinator timer는 local long-lived Next.js process 안에서 동작한다.
  production/serverless에는 durable scheduler 또는 external trigger가 필요하다.
- UI revision 전파는 15초 visible polling 기반 eventual refresh다.
- source-sync Codex collector는 managed App Server connection을 소유하지
  않는다. 별도 Phase 2B.1 manager가 owned run을 관찰하지만 Attention semantic
  detector는 계속 비활성화한다.
- 실제 browser E2E는 local single-process runtime을 검증한다. production
  multi-process scheduler/lease와 process 간 single-flight는 후속 운영 E2E
  범위다.

#### Phase 2B — enriched connector contract

완료한 local vertical slice:

- `[Phase 2B.0]` explicit WorkSessionBinding과 macOS Local Companion 기반
  Work Resumption
- Work Cockpit의 현재 task와 opaque Codex execution을 사용자가 직접 연결
- Companion online 상태에서만 `focus_or_resume` command를 생성
- 실행 순간에만 native thread/cwd를 resolve하고, 기존 Companion-launched
  Terminal focus 또는 새 Terminal의 Codex resume로 이동
- prompt 자동 전송, 승인 자동 처리, 자동 재시도와 arbitrary shell은 금지
- 세부 안전·저장·상태 계약은 `WORK_RESUMPTION_CONTRACT.md`를 따른다.
- `[Phase 2B.1]` Companion daemon이 소유한 local loopback App Server manager와
  remote TUI
- observer thread subscription 뒤 strict allowlist event를 실제 ingestion
- latest projection과 sequence/hash-chain history를 분리하고 settlement recovery
- sanitized metadata 30일/run별 10,000 event retention, raw Codex content 미저장
- local-only managed projection route와 Work Cockpit의 별도 실시간 진행 UI
- stream/owner 상실 시 live state fail-closed, reconnect continuity gap 표시
- reconnect 직후 과거 running/idle은 current로 재사용하지 않고 unknown으로
  낮추며, completed/failed/interrupted는 마지막으로 검증한 turn 결과로만 보존.
  이후 직접 관찰한 새 notification으로 current를 갱신하되 gap은 유지
- public read는 Work Resumption state lease 안에서 fresh owner와
  binding/execution/scope/connection generation exact authority를 함께 검증
- queue execution lease에서는 manager가 같은 lease를 중첩 획득하지 않으며,
  unbind/generation 변경을 감지하면 best-effort `run_closed` 뒤 session 종료
- 모든 managed projection을 Attention에서 금지
- 세부 authority·privacy·상태 계약은 `MANAGED_CODEX_RUN_CONTRACT.md`를 따른다.
- `[Phase 2B.2A]` 같은 atomic read의 verified managed history로 sanitized
  direct-fact semantic timeline과 detector projection 생성
- turn completed/failed/interrupted와 managed run failure를 분리하고, 실패 뒤
  새 turn은 현재 failure에서 억제하되 recovery로 표현하지 않음
- task-level meaningful progress는 `unknown`, stall은 `not_evaluable`, stable
  request escalation은 `unsupported`로 fail closed
- Work Cockpit에 direct event 해석과 bounded timeline을 표시하되 모든 semantic
  result는 Attention과 분리
- 세부 의미·평가 계약은
  `CODEX_MANAGED_SEMANTIC_TIMELINE_CONTRACT.md`를 따른다.

2026-08-01 local beta gate는 focused Vitest `6` files/`76` tests, 전체 Vitest
`51` files/`438` tests, Playwright Chromium E2E `5` tests(그중 managed UI `2`),
typecheck/lint/production build, 실제 `codex-cli 0.146.0` loopback App Server
initialize/close smoke와 `git diff --check`를 통과했다. Cross-source Dev Candidate는
v0.1 revision 2, 30 cases와 기존 SHA-256을 유지했다. 실제 Terminal launch와
native thread resume smoke만 활성 사용자 session 간섭 방지를 위해 수동 후속
검증으로 남긴다.

2026-08-01 Phase 2B.2A gate는 managed semantic/store/route/client focused
Vitest `4` files/`31` tests, detector evaluation `5` tests, 전체 Vitest `53`
files/`455` tests, typecheck/lint/production build와 Playwright Chromium E2E
`5` tests를 통과했다. 별도 synthetic detector Dev Candidate `18` cases는 exact
match `18/18`, latest-direct failure precision/recall `1.0/1.0`, 모든
failure/gap/systemError/unsupported-emission guardrail `0`을 기록했다. 기존
Cross-source Dev Candidate revision `2`, `30` cases와 canonical SHA-256은 변경하지
않았다.

2026-08-01 Phase 3A gate는 relation/binding/API/client/route/evaluation focused
Vitest `6` files/`31` tests, 전체 Vitest `58` files/`479` tests,
typecheck/lint/production build와 Playwright Chromium E2E `11` tests를 통과했다.
별도 synthetic relation Dev Candidate `28` cases는 exact match `28/28`, 예상/관찰
relation `24/24`, precision/recall `1.0/1.0`을 기록했다. false identity merge,
title-only/project-only inference, superseded-as-current, unsupported relation/authority,
privacy sentinel와 Attention leakage는 모두 `0`이다. 기존 Cross-source Dev
Candidate revision `2`, `30` cases와 canonical SHA-256은 유지했다.

2026-08-01 Phase 3B gate는 explicit-user artifact attribution ledger, exact GitHub
commit/PR native identity, Phase 3A `executes` join과 local-only artifact relation
projection을 별도 synthetic Dev Candidate `32` cases로 검증했다. exact match
`32/32`, 예상/관찰 `produces` relation `23/23`, precision/recall `1.0/1.0`이며
false positive/negative, implicit signal/similarity, invalid identity,
run-binding-execution mismatch, source-limit current claim, privacy/Attention leakage와
order determinism failure는 모두 `0`이다. focused Vitest `13` files/`112` tests,
전체 Vitest `65` files/`542` tests, Playwright Chromium E2E `14/14`, typecheck,
lint와 production build를 통과했다. 이 projection은 Attention에 연결하지 않았고
기존 Phase 3A dataset canonical SHA-256도 유지했다.

2026-08-02 Phase 3C는 source-specific claim을 exact target/field로 분리하고,
current authority, stale/context-only evidence, lineage와 conflict를 보수적으로
판정하는 observation-only projection을 구현했다. Phase 3A work relation,
Phase 3B artifact relation, GitHub batch/snapshot, managed source revision/time,
managed semantic projection과 context registry의 exact dependency를 하나의 managed
authority lease/`asOf`에서 검증한다. managed execution claim은 state와 일치하는
semantic evidence ID/sequence와 window, detector, projection hash가 없으면 생성하지
않는다. provider clock skew는 최대 `60,000ms`, deduplicated projection은
최대 `12,000` claims/resolutions/conflicts, relation refs는 최대 `100`개로
제한한다.

별도 mutable synthetic Dev Candidate `40` cases는 exact case/projection `40/40`,
resolution `42/42`, conflict `9/9`, precision/recall `1.0/1.0`과 authority,
stale/context winner, cross-domain conflation, false/missed conflict, timestamp-only
override, future evidence, privacy, determinism, Attention leakage guardrail `0`을 고정한다.
Phase 3A, Phase 3B와 Cross-source Dev Candidate canonical hash는 dependency로 검증하며
변경하지 않았다. final candidate run
`claim_authority_run_f2bc1b560e8e1b298f0c3bf2b5174648`는 full Vitest `588`,
Playwright `14`, typecheck/lint/build와 Phase 3A/3B regression gate를 통과했다.

Phase 4B 통합 과정에서는 same-native PR의 compatible authored/review roles를
거짓 critical conflict로 만들지 않도록 resolver v0.2와 mutable Dev Candidate
revision 2를 추가했다. current compatibility run
`claim_authority_run_0079980ec2ea503ca9718bc48f8846e6`는 `40/40` cases,
`42/42` resolutions, `9/9` conflicts와 모든 guardrail `0`을 유지한다. initial
Phase 3C run과 revision은 Engine Change Record에 역사적으로 보존한다.

Phase 4B 이후 남은 산출물:

- native `isDraft`를 사용한 confirmed GitHub `review`
- artifact/outcome/phase evidence를 사용한 의미 있는 진전과 verified 정체 규칙
- 승인·입력 대기의 stable request state/TTL/escalation 처리
- user-confirmed `related_to` 처리
- 실패 recommendation의 explicit snooze/acknowledgement 정책

완료 조건:

- GitHub `review` 후보는 native `isDraft = false`를 확인
- 정상 실행을 AttentionItem으로 만들지 않음
- 정체·실패가 검증되고 material outcome과 연결된 경우에만 후보 생성
- configured workflow가 없는 완료 실행에 후속조치를 추정하지 않음
- 짧게 발생하거나 이미 해결된 승인·입력 요청을 추천하지 않음
- explicit binding이 없는 task를 유사한 Codex title/path에 자동 연결하지 않음
- native Codex thread ID, local cwd와 shell command를 API·queue·history에
  저장하지 않음
- Phase 2B.1/2B.2A 관찰 결과가 relation/evidence와 추가 회귀 gate 없이 Attention input,
  hash 또는 ranking으로 승격되지 않음

### Phase 3 — Project mapping, lineage, conflict

상태: **Project registry, Phase 3A explicit managed Codex↔GitHub `executes`,
Phase 3B explicit GitHub artifact `produces`, Phase 3C field authority/conflict
local beta final gate와 Phase 4 eligibility integration 완료. user-confirmed
`related_to`는 후속 범위**

산출물:

- `[완료]` 네 source scope의 explicit project mapping registry
- `[Phase 3A 완료]` managed run↔explicit GitHub binding native identity resolver
- `[Phase 3A 완료]` `executes` 관계, binding lifecycle와 project conflict record
- `[Phase 3B 완료]` explicit-user commit/PR attribution과 `produces` lineage
- `[Phase 3C 구현 완료]` exact source/field claim authority resolver
- `[Phase 3C 구현 완료]` original claim을 보존하는 conflict record와 strict graph/API/client validation
- `[Phase 3C 완료]` final candidate baseline artifact, fingerprint와 run ID 기록
- `[Phase 3 후속]` user-confirmed `related_to` 관계 처리

완료 조건:

- `[Phase 3A/3C 완료]` 동일 native object 중복 제거
- `[Phase 3A/3C 완료]` Codex execution과 GitHub/Notion work item을 자동 merge하지 않음
- `[Phase 3A/3C 완료]` 비슷한 제목의 다른 프로젝트를 분리
- `[Phase 3C 완료]` snapshot absence를 completion으로 해석하지 않음
- `[adapter 후속]` GitHub completed와 configured Notion task stale open을 실제
  runtime에서 비교. 현재 Notion v1은 context-only라 이 충돌을 생성하지 않음
- `[Phase 4A/4B 완료]` 후보에 relevant한 unresolved critical conflict를 top
  suggestion의 hard eligibility에서 제외하고 해결 주체에 따라
  `needs_clarification` 또는 `insufficient_evidence`로 분기

Phase 3A local beta는 append-only WorkSessionBinding의 explicit-user bind
decision을 유일한 `executes` 권위로 사용한다. managed run의 exact binding/execution
identity와 `github:object:<native id>`만 join하며 title, project, URL 또는 path
유사성으로 관계를 만들지 않는다. rebind/unbind 뒤 과거 relation은 lineage로만
보존하고, snapshot absence는 completion으로 해석하지 않는다. 결과는 별도
`/api/work-relations`와 Work Cockpit에서 관찰하지만 Attention에는 연결하지 않는다.

세부 계약은 `WORK_RELATION_RESOLUTION_CONTRACT.md`를 따른다.

Phase 3B local beta는 raw GitHub URL을 attach 순간에만 parse하고
`repositoryNativeId + full 40/64-hex commit OID` 또는
`repositoryNativeId + PR native object ID`를 local private ledger에 저장한다. 이
ledger는 retained window 안에서만 append-only이며 최대 1,000 decision과 30일
cutoff를 적용해 다음 store 접근에서 prune한다. 로컬 앱이 실행되지 않는
동안의 물리적 삭제는 다음 접근에서 수행한다. GitHub
disconnect/connection/installation replacement와 Codex disconnect/Work
Resumption clear는 store를 즉시 purge하고, 동일 state lease로 old GitHub
snapshot 기반 attach 재생성을 막는다. commit의 실제 존재 여부는 v0.1
adapter에서 provider-verified가 아니며 사용자의 명시적 attribution으로만
취급한다. PR 번호는 persisted display/corroboration metadata지만
stable artifact key와 `artifactId` identity에서는 제외한다. Phase 3A
run/binding/execution/executes relation exact join을 통과한 attach만 `produces`로
projection하며 detach/reattach lineage와 unavailable/stale/not-observed/conflict
관찰 한계를 보존한다. projection은 repository-bearing URL을 내보내지 않고
Attention과 격리한다.

세부 계약은 `ARTIFACT_RELATION_RESOLUTION_CONTRACT.md`를 따른다.

Phase 3C local beta는 GitHub native field, Blabase-owned managed Codex direct
semantic event와 두 explicit source-scope mapping만 current runtime authority로
사용한다. Codex inventory는 context-only고 Notion/Calendar는 현재 adapter가
직접 task/event field와 same-work equivalence를 제공하지 않으므로 충돌 판정에
사용하지 않는다. managed run target은 run/binding/execution identity를 모두 포함해
재사용된 execution ID의 이전 terminal state를 새 run과 합치지 않는다.
projection은 source coverage와 claim의 authority/freshness, pre-dedup multiplicity,
stable IDs, exact resolution partition과 conflict graph를 검증한다. Phase 3C
projection 자체는 AttentionItem이 될 수 없는 관찰 정보로 남지만, Phase 4A/4B는
동일 request-time graph의 exact conflict/dependency hash를 별도 eligibility gate로
소비한다. claim 값 자체를 점수나 후보로 바꾸지는 않는다.

세부 계약은 `CLAIM_AUTHORITY_RESOLUTION_CONTRACT.md`를 따른다. future adapter,
same-work equivalence와 correction UX는 이번 release에 포함하지 않는다.

### Phase 4 — Eligibility, lane, ranking, selection

상태: **Phase 4A eligibility shadow와 Phase 4B active candidate/lane/ranking/
selection local beta 구현 및 targeted baseline 통과**

산출물:

- `[Phase 4A 구현]` exact GitHub candidate hard eligibility shadow
- `[Phase 4A 구현]` relevant conflict만 차단하는 user-review/source-refresh route
- `[Phase 4A 구현]` current-only local API와 Attention Lab diagnostics
- `[Phase 4B 구현]` GitHub direct-work, managed Codex direct failure와 configured
  completion follow-through candidate gate
- `[Phase 4B 구현]` `must_now`, `unblock`, `close_loop`, `focus` lane classifier
- `[Phase 4B 구현]` versioned deterministic within-lane ranking과 전체 eligible
  alternatives 보존
- `[Phase 4B 구현]` `suggested`, `needs_clarification`, `no_action`,
  `insufficient_evidence` selection과 deterministic explanation
- `[Phase 4B 구현]` project workflow unknown 기본값, 명시적 설정/closure와
  action-target compatibility gate
- `[Phase 4B 구현]` active result를 Work Cockpit, Attention Lab, monitor v0.4와
  private replay v2에 연결
- `[Phase 4B 구현]` Work Resumption open 시 exact binding/execution identity 재검증
- `[Phase 4B 구현]` archived project workflow, 다른 사용자의 review-requested PR과
  partial expected identity를 fail closed

완료 조건:

- deadline/blocker가 weak recency 신호보다 우선
- 정상 Codex 실행이 ranking 후보에 들어가지 않음
- approval/input 경과 시간만으로 `must_now`가 되지 않음
- stable ID 기본 선택을 더 중요하다는 근거처럼 표현하지 않고 caveat/alternative 제공
- no-action과 insufficient-evidence 분리
- 모든 결과에 reason code 존재
- 같은 입력과 policy version에서 같은 결정

현재 v0.4는 정상 진행 중인 managed run, inventory/history만 있는 Codex 작업,
workflow 미설정 또는 archived project의 완료 run을 후보로 만들지 않는다.
managed failure는 더 최신의 동일 대상 run 또는 직접 상태가 회복을 증명하면
제거한다. 완료 후속 작업은
설정 시각 이후 시작된 exact managed run에만 적용하며 completion 뒤 2분 grace와
GitHub target 종류 호환성을 모두 통과해야 한다. `request_review`는 사용자가
작성한 pull request에만 적용한다. 세션을 여는 동작만으로 실패가 해결되거나
snooze됐다고 기록하지 않는다.

Phase 4B mutable synthetic Dev Candidate revision 2는 44 cases와 80 assessments를
exact하게 검증했다. final run
`active_attention_eval_run_1a661f6515069b5721c9bbce775677d2`는 `44/44`,
`80/80`, archived workflow/authored-PR gate와 schema/determinism/privacy/unsafe
leakage를 포함한 모든 guardrail `0`을 기록했다. 이 결과는 human-reviewed
Golden이나 production 유용성 주장이 아니라 local development contract다.

### Phase 4C — macOS native launcher와 Local Agent

상태: **설치형 local development beta vertical slice 구현**

산출물:

- `[구현]` AppKit 메뉴바 앱, `⇧ Space` 전역 단축키와 중앙 floating panel
- `[구현]` Phase 4B top suggestion 한 개, 근거, 첫 단계와 source 평가 범위 표시
- `[구현]` 별도 URL의 Work Cockpit 대시보드 열기
- `[구현]` shell을 통하지 않는 Swift child-process supervisor와 versioned JSONL IPC
- `[구현]` 현재 result/candidate/binding/execution을 다시 확인하는 명시적
  `focus_or_resume` 실행 경계
- `[구현]` 고정 Node runtime과 bundle된 Local Agent를 포함한 `.app`/DMG build,
  검증, ad-hoc 서명 script
- `[구현]` `/Applications` 설치본의 `SMAppService` 로그인 시 자동 실행과 메뉴
  토글
- `[후속]` Developer ID 서명·Apple notarization credential로 external beta 생성
- `[후속]` 기존 pre-audit local monitor/failure record migration 또는 안전한
  invalidation
- `[후속]` 설치 앱의 first-run connector/data migration UX와 server-authoritative
  추천 전환

런처는 추천을 별도로 계산하거나 정렬하지 않는다. 기존 Active Attention 결과를
`blabase-launcher-attention-v2`로 축소해 표시하며 raw prompt/answer, command/output,
diff, native thread ID와 project 경로는 IPC에 포함하지 않는다. GitHub 이동은 정확한
HTTPS destination만 허용하고 Codex 이어가기는 현재 연결 identity가 같을 때만
기존 Work Resumption queue에 넣는다. 임의 prompt, shell command, 승인 응답과 외부
source write는 지원하지 않는다.

v2 projection은 decision reason, eligible/review/ineligible candidate count와 GitHub,
Codex, Notion, Google Calendar의 진단을 고정 순서로 포함한다. 런처는
제안이 없을 때 source별 연결·수집·freshness·signal/candidate coverage를
보여주고 GitHub·Codex 중 하나라도 복구가 필요하면 root ownership에 맞는
복구 동작을 제공한다. existing root는 owner Work Cockpit의 `/sources`, managed
root는 native data-root 설정으로 이동한다. 기존 data root를 명시적으로 선택할 때 dashboard가 기본
Cloud URL이면 local Work Cockpit `http://localhost:3102`로 맞추되, token·snapshot
복사나 Cloud/local data bridge는 생성하지 않는다. candidate 생성, filtering,
ranking과 selection은 기존 Active Attention resolver가 계속 소유한다.

현재 beta는 macOS native host 안에 고정 Node Local Agent를 포함하는 hybrid
구조다. 대시보드는 별도 웹 URL로 유지한다. 향후 추천 계산을 서버 권위로 옮겨도
로컬 Agent는 Codex 관찰, Terminal focus/resume와 OS integration 경계를 담당한다.
세부 계약과 build/release 절차는 `LOCAL_LAUNCHER_CONTRACT.md`와
`desktop/macos/README.md`를 따른다.

### Phase 5 — Calendar fit과 Notion task mapping

상태: **Context-only adapters delivered; candidate/fit work remains**

산출물:

- `[완료]` Calendar schedule context와 Notion project context adapter
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
54. goal이 없어 두 project 후보가 동순위여도 deterministic default와 caveat 반환
55. 모든 item이 waiting
56. source가 정상이고 사용자 intervention이 없음
57. source가 불완전해 판단할 수 없음
58. stable ID는 다르지만 제품상 동점이며 더 중요하다고 표현하지 않음

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

### Attention definition 정합성

85. stall state는 검증됐지만 goal, obligation, block 연결이 없어 overview-only
86. request ID 없는 현재 Codex attention badge는 overview에 남고 candidate에서는 제외
87. 사용자 답 하나로 해결할 review-required 후보가 `no_action`보다 먼저 clarification
88. overview-only source만 연결된 상태로 전체 attention `no_action`을 주장하지 않음
89. overview, candidate, gate, review, decision reason code가 별도 label로 기록됨

### Evaluation contract와 lifecycle

90. mutable Dev Candidate가 frozen dataset hash 또는 immutable reference를 주장하면 거부됨
91. signal이 존재하지 않거나 다른 source의 snapshot을 evidence로 참조하면 거부됨
92. normalized snapshot의 content, time 또는 version이 바뀌면 snapshot SHA-256이 바뀜
93. 정의되지 않은 reason code와 reason bucket 오배치가 거부됨
94. complete candidate-capable negative coverage 없이 `no_action` label을 만들 수 없음
95. partial source가 있는 suggestion은 positive candidate의 독립성을 명시해야 함
96. derived Codex signal은 detector config의 immutable reference와 SHA-256을 요구함
97. eligible first-step은 complete evidence와 source-native destination을 요구함
98. frozen case는 작성자와 다른 두 reviewer와 adjudication reference를 요구함
99. hash 생성 후 signal을 바꾸고 기존 snapshot hash를 유지하면 integrity 검증이 실패함
100. detector config reference가 실제 materialized artifact로 resolve되지 않으면 run이 실패함
101. frozen dataset의 canonical content와 dataset SHA-256이 다르면 run이 실패함
102. non-material source 실패는 source를 표시한 scoped `no_action`으로 표현 가능함
103. fresh complete source 사이 critical conflict는 `insufficient_evidence`로 표현 가능함
104. threshold를 넘은 transient request는 서로 다른 ordered snapshot에 있는 같은 request ID의 history를 요구함
105. mutable Dev Candidate의 material change는 `datasetRevision`을 증가시킴
106. resolved/expired transient request는 overview와 candidate에서 모두 제거됨
107. Codex execution/request signal의 source, kind, subject type 불일치가 거부됨
108. evaluation entrypoint가 schema parse 뒤 integrity 검증을 강제함
109. request candidate reason은 직접 참조한 request subject와 lifecycle evidence를 요구함
110. critical conflict annotation은 실제 두 material source의 subject를 참조해야 함
111. 같은 source의 동시 manual/scheduled sync는 single-flight result를 공유함
112. sync failure는 last successful snapshot을 보존하고 bounded exponential
     backoff 뒤 recovery 가능
113. latest sync state와 newest-first attempt history가 분리되고 sanitized error
     code만 저장됨
114. 첫 status 또는 이후 snapshot revision이 바뀌면 Work Cockpit, Attention
     Lab, connector와 timeline이 저장본을 다시 읽음
115. UI status polling 실패 후 backoff/retry하고 hidden→visible과 in-flight
     stop→start에서 즉시 재개
116. 네 connector 모두 disconnect 중이던 in-flight sync가
     credential/snapshot을 되살리지 않음
117. Codex `thread/list` inventory의 `active`와 `not_loaded`가 live execution
     state를 만들지 않음
118. managed App Server turn completion/failure만 managed execution state를 만듦
119. 명시적 확인이 없는 project mapping proposal이 `projectId`에 적용되지 않음
120. registry가 아직 없는 global outcome을 포함해 global/project weekly
     outcome이 7일 cadence와 fallback 규칙으로 resolve됨
121. Calendar schedule context와 Notion project context가 Attention input에
     포함되지만 direct candidate가 되지 않고 Calendar 250개 초과는
     truncated로 보존됨
122. source sync→snapshot revision→context resolve→Attention→UI invalidation의
     deterministic end-to-end propagation
123. connector connect/callback/refresh와 direct Attention refresh가
     coordinator attempt/history를 통과함
124. disconnected source는 scheduled retry 없이 persisted disabled가 되고
     reconnect manual sync로 ready에 복귀함
125. GET Attention/status는 side-effect-free이고 same-origin POST sync start가
     명시적 scheduler 시작 경계를 제공함
126. Attention monitor run이 Calendar/Notion snapshot과 context/outcome hash를
     raw title 없이 보존함
127. 실제 browser에서 첫 sync status 요청이 일시 실패해도 backoff 뒤
     polling이 복구되고 저장된 revision이 Work Cockpit과 Attention Lab에
     전파됨
128. 실제 Codex disconnect route가 local connection과 coordinator snapshot
     revision을 제거하고 두 UI에 disconnected 상태를 전파함
129. current `attention-monitor-run-v0.4`에 `analysisId`, `sessionId` 또는
     일치하는 `attention-replay-input-v2` active input/result hash가 없으면 저장이
     거부됨. v0.3/v1은 previous read contract로만 검증됨
130. private replay input은 제품 API 응답과 Git에 노출되지 않고 run과 같은
     30일 retention 및 0700/0600 permission을 적용함
131. clean/declared code provenance는 commit SHA를, dirty worktree는
     `codeCommitSha=null`과 deterministic code fingerprint를 요구함
132. source lineage reset finalization이 실패한 뒤 다른 source가 commit하고
     process가 재시작돼도 durable transition intent가 이전 lineage를 adapter
     실행 전에 제거함
133. disconnect finalization 실패 후 재시작 recovery는 같은 attempt ID를
     한 번만 history에 기록하고 source를 `disabled`로 유지함
134. 같은 source의 reset→disconnect와 disconnect→reset은 직렬화되고 마지막
     요청의 target state/history가 일관되게 남음
135. 명시적 Attention POST의 source sync 또는 resolver 실패는
     `attention-monitor-failure-v0.3`과 성공 run과 같은 code provenance로
     기록되며 원본 exception은 저장·응답하지 않음. v0.1/v0.2는
     이전 read contract로만 호환해 읽음
136. current run이 주장한 replay artifact의 실재, schema, execution linkage
     또는 SHA-256이 맞지 않으면 monitor history read가 fail closed함
137. historical v0.1/v0.2 run은 raw private record를 rewrite 간 보존하지만
     read/API에서 replay/execution/code provenance를 주장할 수 없음. corrupt
     monitor에서도 strict old canonical/temp는 정리되고 current/unsafe 파일은
     보존됨
138. connector startup/read는 strict-name crashed temp만 grace 뒤 제거하고
     explicit disconnect는 recognized inactive credential/content temp를
     즉시 삭제하되 canonical/unrelated file, directory와 symlink를 보존함
139. normal sync가 history를 쓴 뒤 latest 전에 실패하면
     `source-sync-settlement-v1`의 exact target을 재생해 동일 attempt로
     latest/history를 일치시키며 history에서 상태를 새로 추정하지 않음
140. disabled→manual success의 one-shot projection failure는 같은 process에서
     성공 확정되고, 연속 failure 뒤 process restart도 adapter 재실행 없이
     `ready` settlement를 복구함
141. transition store clear rename 뒤 chmod acknowledgement가 실패해도 exact
     bytes와 0600 mode read-back이 성공하면 coordinator pending intent를
     정리하고 같은 process에서 다음 sync를 수행할 수 있음
142. source A의 durable settlement가 남은 상태에서 source B가 same-process
     commit하면 recovered disk latest에 B만 병합하고 authoritative store를
     coordinator에 반환해 A/B latest와 history를 모두 보존하며 A adapter를
     다시 실행하지 않음
143. pending settlement가 없는 정상 commit은 caller latest 전체를 사용해
     adapter-registration normalization을 이전과 동일하게 persistence함
144. source A durable settlement 뒤 source B disconnect/reset이
     same-process에서 실행돼도 transition begin/complete의 authoritative
     handoff가 A ready state와 history를 보존하고 B target만 적용함
145. same-source success settlement 뒤 disconnect는 intent 준비 전에 recovery를
     끝내고 recovered last-success/retry lineage와 단일 disconnect attempt를
     보존하며 adapter를 다시 실행하지 않음
146. `inventory_only` schema는 approval/input waiting state, managed reason/event,
     null source timestamp를 포함한 모든 cross-mode 조합을 거부함
147. `managed_event_stream` schema는 thread status, turn, item event별 exact
     execution state/waiting/reason tuple만 허용함
148. semantically valid한 persisted v1 Codex observation history는 v2로
     정규화해 읽고, malformed v1/v2 inventory history는 fail closed함
149. pending settlement recovery와 unrelated source transition barrier가
     겹치면 등록 adapter는 barrier 전에 실행되지 않고, queue 해제 뒤 recovered
     previous snapshot을 받아 실행함. adapter 미등록 source는 barrier를
     기다리지 않고 skip함

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
| Codex inventory를 live execution으로 오인 | `inventory_only`, live state unknown을 강제하고 managed event와 schema 분리 |
| connector별 polling과 refresh가 서로 덮어씀 | server `SourceSyncCoordinator`, source single-flight와 latest/history audit |
| history write 뒤 latest write 전에 process가 멈춤 | exact `source-sync-settlement-v1` journal을 먼저 저장하고 same-process/read/startup에서 idempotent replay |
| 다른 source commit/transition의 stale caller가 방금 복구된 source를 덮어씀 | recovery가 실제 발생한 mutation만 disk latest를 authoritative base로 사용하고 대상 source 하나를 병합한 store를 coordinator에도 반환 |
| transition clear rename 뒤 chmod 실패를 전체 write 실패로 오인 | exact bytes와 0600 mode read-back으로 rename commit point를 확정 |
| 실패 후 sync가 영구 중단 | source별 exponential backoff, retry state와 UI health 표시 |
| disconnected source가 history를 계속 채움 | persisted disabled/no scheduled retry, reconnect manual recovery |
| disconnect 뒤 늦은 write가 연결을 되살림 | 네 connector generation guard와 serialized mutation |
| snapshot이 바뀌어도 화면이 오래된 상태 | pipeline/source revision polling과 공통 invalidation bus |
| read GET이 remote mutation을 시작 | side-effect-free GET과 explicit same-origin `POST /api/sync/start` 분리 |
| serverless process 종료로 scheduler 중단 | production 전에 durable scheduler/lease 또는 external trigger 도입 |
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

1. `[Phase 0 완료]` `CROSS_SOURCE_ATTENTION_DEFINITION.md` 작성
2. `[Phase 0 완료]` `CROSS_SOURCE_EVALUATION_GUIDE.md`와 case schema 작성
3. `[Phase 0 완료]` 합성 dev candidate 20~30개 작성
4. `[Phase 1 완료]` `crossSource/types.ts`, `schema.ts`, `versions.ts` 작성
5. `[Phase 1 완료]` snapshot validity/freshness gate와 ordered native observation
   window 작성
6. `[Phase 1 완료]` GitHub `toWorkSignals.ts` 작성. 현재 없는 `isDraft`는 unknown 유지
7. `[Phase 1 완료]` Codex `toWorkSignals.ts` 작성. activity와 `taskSummary`의 의미
   상태는 unknown 유지
8. `[Phase 2A 완료]` current GitHub direct/provisional candidate와 Codex overview 작성
9. `[Phase 2A 완료]` aggressive evidence-bound selection, scoped no-action,
   coverage/caveat/result integrity 작성
10. `[Phase 2A 완료]` local-only Attention API, Work Cockpit, metadata-only
    30일 monitor store와 Attention Lab 작성
11. `[Phase 2A.1 완료]` server `SourceSyncCoordinator`, source별
    attempt/success/failure/backoff 작성
12. `[Phase 2A.1 완료]` latest snapshot metadata와 ordered sanitized attempt
    history store, `/api/sync`, `/api/sync/start`, `/api/sync/status` 작성
13. `[Phase 2A.1 완료]` snapshot revision polling과 Work Cockpit/Attention Lab/
    connector/timeline invalidation 작성
14. `[Phase 2A.1 완료]` Codex inventory-only observation/history와 managed event
    semantic boundary 작성
15. `[Phase 2A.1 완료]` explicit project registry, global/project weekly outcome와
    Calendar/Notion context adapter를 Attention input 및 Work Cockpit UI에 연결
16. `[Phase 2A.1 완료]` monitor run v0.3 code/analysis/session provenance,
    failed-run metadata, private replay artifact read-time integrity/retention과
    실제 Playwright browser pipeline E2E 작성
17. `[Phase 2A.1 완료]` Codex `conversation_and_execution` explicit consent,
    `thread/read(includeTurns=true)` historical collector, 7일 private raw store,
    v3 manifest/WorkSignal/Attention context와 opt-out/disconnect purge 작성
18. `[Phase 2B.0 완료]` explicit task↔Codex binding, Local Companion command queue,
    safe `focus_or_resume` destination과 Work Cockpit 재개 UI 작성
19. `[Phase 2B.1 완료]` blabase-owned loopback App Server manager, remote TUI,
    managed event persistence와 관찰 전용 Work Cockpit UI 작성
20. `[Phase 2B.2A 완료]` managed Codex direct-fact semantic timeline과
    task-level meaningful-progress `unknown` gate 작성
21. `[Phase 2B.2A 일부 완료]` direct turn/managed-run failure lifecycle 작성.
    verified stall/follow-through/scope-drift detector는 richer evidence 뒤 진행
22. `[Phase 2B]` stable request lifecycle contract 후 escalation gate 작성
23. `[Phase 3A 완료]` native/explicit-link identity resolver와 managed
    Codex↔GitHub `executes` 관계 작성
24. `[Phase 3B 완료]` privacy-safe explicit-user artifact identity와 `produces`
    lineage 작성. user-confirmed `related_to`는 후속 범위
25. `[Phase 3C 완료]` claim authority/conflict resolver,
    exact dependency/semantic evidence, strict API/client graph validation과
    final candidate baseline fingerprint/run ID 기록
26. `[Phase 4A 완료]` GitHub direct-work hard eligibility shadow와 exact
    conflict route 작성
27. `[Phase 4B 완료]` GitHub/managed Codex active candidate, project workflow,
    lane/ranking/selection, active Work Cockpit/Lab, monitor v0.4와 replay v2 작성
28. `[Phase 4B 완료]` user-review clarification, source-refresh
    insufficient-evidence, scoped no-action와 exact Work Resumption open gate 작성
29. `[Phase 4C local beta 완료]` macOS 메뉴바 host, `⇧ Space` launcher,
    bundled Node Local Agent, versioned JSONL projection/실행 계약과 개발용 DMG 작성.
    runtime provenance/Agent hash, 64 KiB bounded framing, 5분 실행 TTL, physical
    data-root 검증과 root별 single source-writer/read-only override까지 고정
30. `[Phase 4C 후속]` pre-audit resolver v0.2 monitor/failure record의 versioned
    migration 또는 안전한 invalidation, first-run data 이동 UX와 external beta
    Developer ID/notarization 완료
31. Calendar free-block과 first-step 작성
32. Notion task property mapping 작성
33. formal feedback evaluation runner 작성
34. frozen baseline 후에만 ranking policy 보정

---

## 27. 이 계획에서 확정한 사항

- 첫 release의 사용자는 GitHub와 Codex를 함께 쓰는 AI-native 1인 개발자,
  인디 메이커, 작은 스타트업 개발자다.
- GitHub 또는 Codex를 사용하지 않는 사용자는 첫 release 범위 밖이다.
- Work Cockpit을 기본 화면으로 두고 그 위에 “지금 개입할 한 가지”를 표시한다.
- 새 엔진은 `suggestion/`의 별도 Cross-source Observation + Action Layer로
  만든다.
- 기존 ChatGPT v0.3 계획과 구현을 즉시 대체하지 않는다.
- connector record를 conversation message로 변환하지 않는다.
- source fact와 최종 AttentionItem을 분리한다.
- GitHub는 첫 직접 후보 source로 사용한다.
- Codex는 첫 execution-observability source로 사용하고 검증된 예외만
  AttentionItem으로 승격한다.
- 현재 Codex v3의 live semantic task/progress 상태는 기본 `unknown`이다.
- opt-in historical turn status는 persisted context일 뿐 live 상태나 직접
  추천 후보가 아니다.
- `taskSummary`는 opt-in overview label 단서일 뿐 obligation 근거가 아니다.
- Codex follow-through는 explicit GitHub relation 또는 사용자가 설정한 project
  workflow가 있을 때만 생성한다.
- Codex `thread/list`는 inventory-only이고 live execution state는 항상
  `unknown`이다.
- `running`, `completed`, `failed`는 blabase가 소유한 managed App Server의
  ordered event에서만 생성한다.
- 정상 Codex 실행과 최근 완료는 recommendation과 분리된 overview에 표시한다.
- Codex 승인·입력 요청은 현재 active candidate 범위가 아니다. 안정된 request
  lifecycle과 TTL/escalation 정책을 별도 검증하기 전에는 현황으로만 표시한다.
- Codex 실행 완료는 연결된 GitHub/Notion work item 완료를 의미하지 않는다.
- managed Codex↔GitHub `executes`의 유일한 권위는 사용자가 직접 확인한
  WorkSessionBinding이며 exact `bindingId`, execution identity와
  `github:object:<native id>`가 모두 일치해야 한다.
- rebind/unbind 뒤 과거 `executes` 관계는 lineage로만 보존하고 현재 연결이나
  Attention 후보로 사용하지 않는다.
- project mapping은 alignment/conflict 설명에만 사용하며 item relation을 만들지
  않는다. Phase 3A exact relation은 그 자체가 후보가 아니지만 Phase 4A/4B의
  identity, eligibility와 managed follow-through dependency로 사용한다.
- Calendar는 기본적으로 시간 constraint다.
- Notion은 mapped task database만 직접 후보 source로 사용한다.
- Calendar와 Notion은 Phase 2A.1 Attention input에 각각
  `schedule_context_only`, `project_context_only`로 연결하며
  `supporting-source-adapter-v0.3`를 사용한다.
- source scope의 project identity는 opaque native reference와 explicit user
  confirmation으로만 확정한다.
- 사용자의 명시적 primary outcome을 일주일에 한 번 또는 사용자가 변경할 때
  초기 ranking context로 받는다.
- weekly outcome store는 global/project scope를 지원하며 한 project가
  명확할 때 project outcome을 우선하고 global로 fallback한다. registry가
  없어도 global outcome은 active focus로 사용한다. 제품의 Weekly focus
  UI에서 global 한 줄 outcome을 생성·수정하고 저장 즉시 Attention을
  invalidation한다.
- Phase 2 초기 recommendation mode는 `aggressive_evidence_bound`다. 근거 있는
  후보가 하나라도 있으면 minimum score나 preference 동점 때문에 보류하지 않는다.
- 동급 후보는 deterministic default 한 개와 최대 두 alternatives, caveat로
  보여주며 더 중요하다는 의미를 만들지 않는다.
- 첫 release의 external source mutation은 read-only다. Work Resumption은 사용자의
  명시적 동작으로 local Codex session을 focus/resume하는 safe destination만
  제공하며 prompt, 승인, retry 또는 GitHub/Notion/Calendar mutation을
  수행하지 않는다.
- 현재 Attention monitor metadata store는
  `attention-monitor-run-v0.4`의 run/source/candidate gate/명시적 feedback,
  `analysisId`, `sessionId`, code provenance와 replay artifact hash를 최대
  30일 보관한다. raw prompt/response/command/output, title, URL, task
  summary는 metadata history에 보관하지 않는다. Calendar/Notion snapshot과
  context/outcome hash·version·상태는 provenance로 보존한다.
- 실제 평가에 사용한 exact normalized input은 별도의 private immutable
  `attention-replay-input-v2` artifact로 최대 30일 보관하고 제품 API와 Git에
  노출하지 않는다. replay v1과 monitor v0.1/v0.2/v0.3은 read compatibility만
  유지한다.
- server `SourceSyncCoordinator`가 네 source refresh, due schedule,
  single-flight와 failure backoff를 관리하며 connector connect/callback을
  포함한 explicit collection은 이 경계를 통과한다.
- read GET은 scheduler를 시작하지 않고 same-origin `POST /api/sync/start`가
  명시적 background start 경계를 제공한다.
- disconnected source는 scheduled retry가 없는 persisted disabled로 보존하고
  reconnect manual sync로 복구한다.
- source별 latest sync state와 ordered sanitized attempt history를 분리한다.
- 실제 Chromium browser E2E는 polling failure recovery, first stored revision
  invalidation, Codex disconnect와 Work Cockpit/Attention Lab 전파를 검증한다.
- Codex inventory observation history는 metadata-only로 최대 30일 보관하고
  Attention monitor history와 동일하게 취급하지 않는다. 별도 conversation
  store의 최대 7일 retention과 섞지 않는다.
- Phase 2B.1 managed observation은 explicit Work Resumption에서 Blabase-owned
  App Server lifecycle을 만들고 ordered metadata를 별도 UI에 표시한다.
  inventory polling history로 대체하지 않는다. Phase 4B는 이 중 exact direct
  failure와 configured completion follow-through만 Attention 후보로 사용한다.
- managed App Server는 local loopback만 허용하고 remote TUI가 사용자 interaction을
  담당한다. observer는 prompt, approval/input response 또는 작업 retry를
  자동으로 수행하지 않는다.
- managed store는 raw prompt/answer/command/output/diff/tool payload를 저장하지
  않고 30일/run별 10,000 event metadata만 보존한다.
- Phase 3C claim authority는 exact source semantic field를 범용 state/deadline으로
  합치지 않고, managed semantic direct evidence와 Phase 3A/3B/source
  dependency가 모두 일치할 때만 관찰 projection을 만든다.
- Phase 3C claim projection 자체는 Attention 후보가 아니며 source 값을 범용
  task 상태로 바꾸지 않는다. Phase 4A/4B는 동일 evidence graph의 relevant
  unresolved conflict만 별도 hard eligibility input으로 소비한다.
- Notion/Calendar future field의 schema 존재는 live authority가 아니다. configured
  adapter와 exact equivalence가 없는 현재 runtime에서는 context-only로 보존한다.
- Phase 3C final gate는 이미 확정한 fail-closed 범위를 검증하는 작업이므로
  추가 사용자 판단이 필요하지 않다.
- hard gate와 attention lane을 가중치보다 먼저 적용한다.
- rankable lane은 `must_now`, `unblock`, `close_loop`, `focus`로 제한하고
  clarification/no-action은 decision 단계에서 처리한다.
- `suggested`, `needs_clarification`, `no_action`,
  `insufficient_evidence`를 모두 정상 결과로 지원한다.
- 프로젝트 workflow 기본값은 `unknown`이며 사용자가 설정한 프로젝트에서만
  `review_changes`, `commit_changes`, `create_pull_request`, `request_review` 완료
  후속 작업을 만든다.
- managed recommendation에서 작업 세션을 열 때 current binding ID와 execution
  ID가 추천을 계산한 exact identity와 같아야 한다. 달라졌으면 열지 않고 새로
  평가한다. expected identity 한쪽만 있는 client 요청은 network mutation 전에
  거부하고, 명시적으로 전달된 빈 pair는 생략하지 않고 server 검증에 맡긴다.
- 가중치와 threshold는 versioned hypothesis다.
- 수동 평가 사례는 dev candidate에서 시작하고 review 후 별도 Golden으로 freeze한다.
- 기존 `gold-core-v0.1`은 변경하지 않는다.
- production feedback은 자동 Gold가 아니다.
- cross-source behavior 변경에는 version, test, evaluation, Engine Change Record가 필요하다.

---

## 28. 남은 제품 결정

Phase 4B와 Phase 4C local development beta 구현·검증에는 사용자가 추가로 판단할
항목이 없다. macOS native 메뉴바 앱, 기본 `⇧ Space`, 별도 웹 대시보드, bundled
Local Agent와 향후 server-authoritative 추천이라는 방향을 적용했다.
프로젝트 workflow의 unknown 기본값과 네 action, 적극 추천 정책, exact
GitHub–Codex 연결, LLM 원문 분석 opt-in은 이미 확정한 방향을 적용했다.
다음 질문은 external beta와 Phase 5 이후를 막지 않는 후속 제품·정책 결정이다.

1. Calendar는 free/busy만 사용할 것인가, title linking을 opt-in으로 제공할 것인가?
2. Notion task DB property mapping UX를 어디까지 지원할 것인가?
3. AI가 준비할 수 있는 task를 top suggestion으로 노출할 것인가?
4. Golden freeze 전에 필요한 human reviewer 수와 adjudication 절차는 무엇인가?
5. Codex에서 작업 유형별 `meaningful progress`를 무엇으로 정의할 것인가?
6. build, test, coding 등 phase별 stall threshold와 recovery window는 얼마인가?
7. scope drift의 expected baseline을 사용자 요청, 변경 파일 집합, project 설정 중
    어디에서 얻을 것인가?
8. approval/input escalation threshold와 상태 갱신 cadence는 얼마인가?
9. Codex 현황판에서 어느 수준의 progress summary를 opt-in으로 보여줄 것인가?
10. production에서 coordinator를 유지할 durable scheduler/lease 또는 external
    trigger를 어떤 runtime에 둘 것인가?
11. production background service와 multi-device 환경에서 Blabase-owned App
    Server connection/thread lifecycle을 어떻게 이전·복구할 것인가?
12. 현재 Work Cockpit의 project mapping과 global Weekly focus UI를 확장해
    project-scoped weekly outcome을 어느 project 선택 UX로 편집할 것인가?

이 질문은 Phase 4B의 미완료 항목이 아니다. production scheduling, richer
managed detector, Calendar/Notion candidate integration 또는 Golden freeze에
들어갈 때 평가 가능한 형태로 좁힌다.
