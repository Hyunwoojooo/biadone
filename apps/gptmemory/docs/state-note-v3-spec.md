# GPTMemory State Note v3

## 목적

GPTMemory의 기본 결과를 대화 내용의 압축 요약이 아니라, 대화 종료 시점의 유효한
상태를 복원하는 노트로 바꾼다.

```text
대화 = 사고가 진행된 과정
상태 노트 = 사고가 도달한 현재 상태
```

사용자는 상태 노트만 보고 다음 세 질문에 답할 수 있어야 한다.

1. 지금 어디까지 왔는가?
2. 무엇이 확정됐고 무엇은 제안에 불과한가?
3. 다음에 실행하거나 판단할 것은 무엇인가?

## 공개 스키마

버전은 `gptmemory.state-note.v3`를 사용한다.

- `title`: 노트 제목
- `primaryGoal`: 대화가 해결하려던 핵심 문제. 명확하지 않으면 `null`
- `currentState`: 대화 마지막 시점의 유효한 상태를 나타내는 1~2문장
- `confirmedDecisions`: 현재도 유효한 사용자의 명시적 결정
- `completedResults`: 대화 중 실제로 제공되거나 완료됐다고 보고된 결과와 산출물
- `openActions`: 대화 종료 시점에도 남아 있는 명시적 요청 또는 약속
- `unresolvedQuestions`: 아직 답하지 않았거나 선택되지 않은 문제
- `activeConstraints`: 현재도 유효한 조건과 제약
- `activeProposals`: 사용자가 아직 채택하지 않은 Assistant 또는 사용자 제안
- `keyInsights`: 미래 판단에 다시 사용할 가치가 있는 지식과 결론
- `stateChanges`: 변경·보류·거절·대체된 방향

모든 공개 항목은 실제 입력 메시지의 부분집합인 `sourceMessageIds`를 가진다. 검증 UX를
위해 필요한 경우 선택된 짧은 근거 절만 함께 저장할 수 있지만, 원본 HTML과 전체 메시지
배열은 저장하지 않는다.

배열에는 최소 개수를 강제하지 않는다. 상태에 해당 항목이 없으면 빈 배열을 사용하고,
의미 없는 내용을 채워 넣지 않는다.

## 내부 상태 이벤트

LLM은 최종 노트를 바로 작성하지 않고, 우선 시간순 사건 후보를 추출한다.

- 목표: `goal_opened`
- 요청: `request_opened`, `request_fulfilled`, `request_blocked`,
  `request_deferred`, `request_cancelled`, `request_superseded`
- 제안: `proposal_made`, `proposal_accepted`, `proposal_rejected`,
  `proposal_deferred`, `proposal_superseded`
- 결정: `decision_set`, `decision_superseded`
- 제약: `constraint_set`, `constraint_changed`, `constraint_removed`
- 질문: `question_opened`, `question_resolved`
- 결과: `result_produced`, `artifact_produced`

서버는 각 사건의 근거, 메시지 역할, 메시지 순서와 상태 전이를 검증하고 시간순으로
fold하여 마지막 시점의 상태를 계산한다. 최종 노트는 검증된 상태 원장의 항목만 선택하고
압축할 수 있으며 새로운 사실이나 상태를 추가할 수 없다.

## 권한과 상태 규칙

### 결정

- Assistant의 제안만으로는 결정이 될 수 없다.
- 사용자 메시지의 명시적 선택 또는 수락이 있어야 한다.
- `그걸로 진행해` 같은 지시어 수락은 바로 앞에 수락 가능한 제안이 하나일 때만
  자동 연결한다.
- 여러 후보 뒤의 모호한 수락은 임의로 해석하지 않고 미해결로 남긴다.
- 만족 표현만으로는 결정을 만들지 않는다.
- 결정 권한 검사는 결정 목록뿐 아니라 제목, 현재 상태, 인사이트 등 모든 공개 문장에
  적용한다.

### 요청과 완료

```text
사용자 요청
├─ 이후 응답에서 충족됨 → completedResults
├─ 종료 시점까지 미충족 → openActions
├─ 명시적으로 막힘       → openActions(status=blocked)
├─ 보류됨                 → openActions(status=deferred)
├─ 취소됨                 → 기본 현재 상태에서 제외
└─ 다른 작업으로 교체됨   → stateChanges
```

- 질문은 뒤따른 Assistant 응답이 실제 답을 제공하면 종결한다.
- 문서, 코드, 목록 같은 즉시 산출물은 응답에서 결과가 제공되면 완료로 옮긴다.
- 외부 작업은 단순한 착수 선언으로 완료 처리하지 않는다.
- 사용자 완료 확인은 가장 강한 완료 근거다.
- Assistant가 제안한 다음 단계는 사용자가 수락하기 전까지 `openActions`가 아니라
  `activeProposals`다.

### 시간과 대체

- 메시지 순서를 시간 기준으로 사용한다.
- 같은 대상에 대한 나중의 명시적 사용자 수정은 이전 상태를 대체한다.
- Assistant의 나중 제안은 기존 사용자 결정을 대체할 수 없다.
- 상충하는 사용자 결정의 대체 관계가 불명확하면 하나를 임의 선택하지 않는다.
- 완료된 요청이 다시 열리면 이전 완료를 지우지 않고 새 요청으로 연결한다.

## 긴 대화

기존의 `chunk → partial summary → prose reduce` 대신 다음 절차를 사용한다.

```text
chunk
→ StateEvent 후보 추출
→ 중복 제거
→ chunk 사이 대상 연결
→ 전체 사건을 원문 순서로 fold
→ Current State Projection
```

chunk 크기가 달라도 같은 상태가 나오는지 회귀 테스트한다.

## UI 정보 순서

상세 화면은 다음 순서를 사용한다.

1. 현재 상태
2. 확정된 결정
3. 열린 작업과 차단 요소
4. 미해결 질문
5. 완료된 결과와 산출물
6. 현재 제약
7. 핵심 인사이트
8. 채택되지 않은 제안
9. 변경 이력
10. 접힌 대화 흐름 상세 보기

목록 카드는 제목, 현재 상태, 확정 결정 수, 열린 작업 수, 미해결 수와 수정 시각만
표시한다. 완료되거나 취소된 작업은 `할 일 있음` 신호를 만들지 않는다.

빈 상태는 단순히 숨기지 않고 상단 상태 줄에서 `확인된 결정 없음`, `확인된 남은 작업
없음`, `확인된 미해결 없음`처럼 명확히 표현한다.

## 호환성과 저장

- 기존 `summary_schema_version`, `summary_json` 컬럼을 계속 사용한다.
- v1의 `overview`, `sections_json`은 상세 대화 흐름과 fallback용으로 보존한다.
- v2 parser와 renderer를 유지한다.
- v3 parser와 renderer를 별도로 추가한다.
- 기존 v1·v2 노트는 자동 변환하지 않는다.
- 사용자가 재생성을 요청한 경우에만 v3로 교체한다.
- 생성·검증·조건부 저장이 모두 성공하기 전에는 기존 노트를 변경하지 않는다.
- provider 실패, timeout, rate limit, 잘못된 구조, 근거 실패, stale write에서는 기존
  데이터를 그대로 유지한다.

## 품질 기준

- 근거 없는 결정: 0건
- Assistant 제안을 사용자 결정으로 오인: 0건
- 완료된 요청을 열린 작업으로 표시: 0건
- 대체된 방향을 현재 상태로 표시: 0건
- 중요한 완료 산출물 누락: 0건
- 모든 공개 항목의 근거 ID 유효성: 100%
- 노트만 보고 현재 상태, 결정, 다음 판단을 파악하는 시간: 중앙값 10초 이하
- v1·v2 데이터와 사용자 편집본 보존
- 실패 시 기존 데이터 무변경
