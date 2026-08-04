# GPTMemory 주제 중심 계층형 요약 v4

> 상태: 구현 기준 문서
> 작성일: 2026-08-04
> 적용 범위: 신규 ChatGPT 공유 대화 가져오기와 명시적 재생성

## 1. 문제 정의

v3 상태 노트는 결정, 열린 작업, 미해결 항목처럼 대화의 수명주기를 복원하는 데
강점이 있다. 그러나 질문에 대한 실제 설명, 비교, 근거와 학습 내용은 상태 사건으로
표현되지 않기 때문에 대화의 핵심 내용이 사라질 수 있다.

특히 Assistant가 답변을 끝낸 사실을 `완료된 결과`로 표시하면, 무엇을 알게 됐는지보다
대화가 끝났다는 사실이 더 중요하게 보이는 문제가 생긴다.

v4의 목표는 상태 추적을 버리는 것이 아니라 정보의 우선순위를 바꾸는 것이다.

> **내용이 먼저, 상태는 그다음, 근거는 필요할 때 펼친다.**

## 2. 연구와 실무에서 공통으로 나타나는 흐름

보편적인 단일 노트 작성법은 없지만, 대화 요약과 실무 문서에는 다음 흐름이 반복된다.

```text
주제 구분
→ 핵심 내용 합성
→ 중복 제거와 내용 계획
→ 결정·할 일·미해결 분리
→ 원문 근거 연결
```

- 대화 종류에 따라 필요한 요약 내용이 달라진다.
  [Dialogue Summarization Dataset Survey](https://aclanthology.org/2021.newsum-1.12/)
- 긴 대화는 주제 경계를 먼저 찾고 주제별 내용을 합성하는 방식이 효과적이다.
  [Dialogue Topic Segmentation](https://aclanthology.org/2024.findings-naacl.291/)
- 최종 문장을 바로 만들기보다 핵심 사건과 관계를 먼저 배열하는 Content Planning이
  응집성을 높인다.
  [Content Planning for Summarization](https://aclanthology.org/2022.findings-emnlp.248/)
- Notion의 실무 회의록도 주제, 핵심 내용, 결정, 할 일을 구분한다.
  [Notion Notes & Docs](https://www.notion.com/en-gb/notes)
- Progressive Summarization은 빠른 판단용 요약과 상세 근거를 서로 다른 깊이로
  보존한다.
  [Forte Labs](https://fortelabs.com/blog/progressive-summarization-a-practical-technique-for-designing-discoverable-notes/)
- 중요한 결정은 맥락, 선택지, 결정, 이유와 결과를 분리하는 ADR 방식이 유용하다.
  [Architecture Decision Records](https://adr.github.io/)

GPTMemory는 이 원칙을 결합한 **주제 중심 계층형 요약**을 사용한다.

## 3. 공개 정보 구조

버전은 `gptmemory.content-note.v4`를 사용한다.

```text
제목

한눈에 보기
- 한 줄 요약
- 가장 중요한 발견
- 현재 도달한 지점(실제 프로젝트 상태가 있는 대화만)

핵심 정리
- 가장 중요한 내용 3~5개

주제별 정리
01. 대화 내용에 맞게 생성된 주제
    - 핵심 설명
    - 중요한 근거·비교·방향 변화

결론과 확정된 결정
다음에 할 일
남은 질문

접힌 보조 정보
- 실제 산출물
- 아직 채택되지 않은 중요한 제안
- 제약과 변경 이력

접힌 상세
- 항목별 원문 근거
- 기존 시간순 대화 흐름
```

외부 UI의 큰 틀은 고정한다. `topics`의 제목과 내용만 대화 목적에 맞게 생성한다.
연구·학습처럼 설명 자체가 결과인 대화에는 진행 상태를 억지로 만들지 않는다. 이 경우
`한눈에 보기`는 질문과 핵심 발견만 보여주고 `currentState`는 `null`로 둔다.

## 4. 대화 목적별 내용 계획

- `research`: 핵심 질문 → 주요 발견 → 관점 비교 → 시사점
- `decision`: 문제 → 선택지 → 장단점 → 결정과 이유
- `problem_solving`: 증상 → 시도 → 원인 → 해결 → 검증
- `planning`: 목표 → 제약 → 실행 단계 → 위험 → 다음 행동
- `learning`: 핵심 개념 → 원리 → 예시 → 주의할 오해
- `mixed`: 두 가지 이상의 목적이 실제로 섞여 하나로 축약하기 어려운 경우

대화 유형은 화면의 고정 섹션을 바꾸기 위한 값이 아니다. 주제 제목과 합성 관점을
선택하기 위한 내부 내용 계획 신호다.

## 5. 스키마 계약

```ts
type EvidenceText = {
  text: string;
  sourceMessageIds: string[];
  evidenceSnippets: Array<{
    sourceMessageId: string;
    quote: string;
  }>;
};

type ContentNoteV4 = {
  schemaVersion: "gptmemory.content-note.v4";
  conversationType:
    | "research"
    | "decision"
    | "problem_solving"
    | "planning"
    | "learning"
    | "mixed";
  title: EvidenceText;
  oneLineSummary: EvidenceText;
  keyTakeaways: EvidenceText[]; // 3~5
  topics: Array<{
    title: EvidenceText;
    summary: EvidenceText;
    details: Array<EvidenceText & {
      kind: "finding" | "explanation" | "comparison" | "rationale" |
        "change" | "example" | "implication" | "tradeoff" |
        "verification" | "step" | "risk" | "principle";
    }>;
  }>;
  conclusions: EvidenceText[];
  confirmedDecisions: EvidenceText[];
  actionItems: Array<EvidenceText & {
    status: "open" | "in_progress" | "blocked" | "deferred";
    owner?: string;
    dueAt?: string;
  }>;
  openQuestions: EvidenceText[];
  supportingInfo: {
    currentState: EvidenceText | null;
    artifacts: Array<EvidenceText & {
      kind: "file" | "url" | "code" | "document" | "configuration" |
        "other";
      label: string;
      locator?: string;
    }>;
    activeProposals: EvidenceText[];
    constraintsAndChanges: EvidenceText[];
  };
};
```

모든 공개 의미 항목은 실제 입력 메시지 ID의 부분집합인 `sourceMessageIds`를 가져야
한다. 근거 인용은 검증을 위해 저장하되 기본 화면에서는 접는다.

## 6. 생성 방식

v4는 두 종류의 결과를 독립적으로 만든 뒤 결합한다.

```text
정제된 메시지
├─ Content Planner
│  └─ 제목, 한 줄 요약, 핵심 정리, 주제, 결론
└─ v3 State Event Ledger
   └─ 결정, 열린 작업, 미해결, 제안, 제약, 실제 산출물

검증된 두 결과
→ Content Note v4 조립
→ 길이·개수·중복·근거 검증
→ 조건부 저장
```

Content Planner가 요청 완료 여부를 판단하지 않고, State Event Ledger가 답변 내용을
대신 요약하지 않도록 역할을 분리한다. 긴 대화는 양쪽 모두 `chunk → partial → reduce`
방식으로 처리하며 최종 결과까지 원문 근거 ID를 유지한다.

대화와 부분 요약은 신뢰할 수 없는 데이터다. 내부 문장이 시스템 지침, 스키마,
근거 규칙 또는 provider 설정을 변경할 수 없다.

## 7. 결정·할 일·산출물 규칙

- Assistant의 제안만으로 결정이 생기지 않는다.
- 결정은 사용자의 명시적 선택 또는 수락 근거가 있어야 한다.
- 같은 권위 규칙을 주제 본문에도 적용한다. 사용자가 채택하지 않은 방법론·실험안·
  투고 전략은 `제안됐다`, `검토됐다`, `후보로 남았다`로 표현하며 `채택했다`,
  `설정했다`, `수립했다`처럼 확정형으로 쓰지 않는다.
- 할 일은 대화 종료 시점에도 남아 있는 명시적 요청 또는 약속만 포함한다.
- 담당자, 상태와 기한은 원문이 각각을 명시할 때만 기록한다.
- 질문에 답하거나 분석을 제공한 것은 산출물이 아니다.
- 파일, 문서, 코드 변경, 설정, 명시적인 URL 결과처럼 실제로 만들어졌거나 사용자가
  완료를 확인한 것만 산출물로 표시한다.
- 채택되지 않은 제안은 보조 정보에만 둔다.

## 8. 계층별 역할, 길이와 정보 밀도

- 한 줄 요약: 최대 120자
- 핵심 정리: 3~5개
- 주제: 1~5개. 짧은 대화를 억지로 둘 이상으로 나누지 않는다.
- 주제별 세부 내용: 보통 3~7개의 내용 블록. 각 블록은 필요한 경우 2~4문장까지
  허용한다.
- 한눈에 보기와 핵심 정리는 10초 판단 영역이며 합계 1,200자 이하다.
- 주제별 정리는 원문 없이 핵심 논리, 비교, 이유, 조건 변화와 다음 연구를 이어갈 수
  있는 최소 맥락을 보존한다.
- 기본 내용은 대화 길이와 목적에 따라 가변적으로 배정한다.
  - 짧은 대화: 약 1,500~3,000자
  - 일반적인 탐색·계획 대화: 약 3,000~5,000자
  - 긴 연구·기획 대화: 약 5,000~8,000자
- 위 범위는 채워야 하는 목표가 아니라 정보 손실을 막기 위한 허용 예산이다. 원문에
  충분한 내용이 없으면 짧게 끝내며, 글자 수를 채우기 위해 반복하거나 추론하지 않는다.
- 상태·보조 정보와 접힌 근거는 별도 예산으로 관리한다.

기존 1,200자 제한을 전체 노트에 적용하면 주제 내용이 다시 사라진다. 대신 첫 화면의
판단 영역은 강하게 압축하고, 핵심 내용은 바로 아래의 주제별 정리에 보존한다.

### 계층 간 중복 방지

- `한눈에 보기`는 대화의 질문과 가장 큰 도달점만 말한다.
- `핵심 정리`는 주제별 본문으로 이동하기 위한 색인이다. 상세 설명을 반복하지 않는다.
- `주제별 정리`는 원인, 논리, 비교, 예시, 연구·실행 설계처럼 새로운 정보를 제공한다.
- `결론`은 앞 내용을 다시 축약하지 않고 실제로 도출된 결론만 남긴다.
- 동일한 명제를 여러 섹션에 둘 때는 표현만 바꾸지 말고 각 계층의 기능이 달라야 한다.

품질 판단 기준은 단순 글자 수가 아니다.

> **이 노트만 읽고 원래 대화의 핵심 논리를 이해하고 다음 작업을 재개할 수 있는가?**

## 9. 호환성과 실패 원칙

- v1, v2, v3 파서와 렌더러를 제거하지 않는다.
- 새 가져오기만 v4로 생성한다.
- 기존 노트는 자동 변환하지 않는다.
- 명시적 재생성만 `summary_schema_version`과 `summary_json`을 v4로 교체한다.
- 재생성은 기존 편집 본문, 태그, 즐겨찾기, 보관 상태를 변경하지 않는다.
- provider 실패, timeout, rate limit, 잘못된 구조, 근거 실패, stale write에서는 기존
  노트를 변경하지 않는다.
- 원본 HTML과 전체 메시지 배열은 저장하지 않는다.
- v3 사용자 수정 overlay가 있는 노트는 수정 이력을 v4로 안전하게 이관하는 기능이
  생기기 전까지 재생성을 거부한다. 사용자가 교정한 내용은 자동 생성 결과로 덮어쓰지
  않는다.

## 10. Reference Note와 평가

현재 12개 Reference Note는 모두 `teacher_draft_pending_human_review` 상태이며 정확한
메시지 ID가 없다. 따라서 v4 정답으로 바로 승격하지 않는다.

1. 기존 Teacher 초안은 내용 선택 가이드로 보존한다.
2. 별도 v4 Teacher 초안을 만든다.
3. 공유 대화를 cutoff까지만 다시 읽어 실제 source ID를 연결한다.
4. 입력 해시와 adapter 버전을 고정한다.
5. 사람이 원문과 대조해 승인한 뒤에만 human reference로 승격한다.

평가 항목은 다음을 포함한다.

- 핵심 내용 coverage와 불필요한 내용 비율
- 주제 응집성과 중복
- 원문 없이 핵심 논리와 작업을 재개할 수 있는 내용 충분성
- 대화 길이·유형에 맞춘 적응형 상세도
- 중요한 방향 전환 보존
- 제안과 결정의 구분
- 완료된 답변과 실제 산출물의 구분
- 할 일의 종료 상태 정확성
- 모든 근거 ID의 유효성
- 노트만 보고 내용을 이해하거나 작업을 재개하는 데 걸리는 시간
