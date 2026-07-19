export type ZoneId =
  "strategy" | "product" | "atlas" | "evidence" | "memory" | "governance";

export type KeywordKind =
  "topic" | "decision" | "action" | "evidence" | "pending";

export type AtlasEdgeKind =
  "supports" | "informs" | "feeds" | "validates" | "governs";

export interface AtlasKeyword {
  readonly id: string;
  readonly label: string;
  readonly kind: KeywordKind;
  readonly summary: string;
}

export interface AtlasTopic {
  readonly id: string;
  readonly title: string;
  readonly ko: string;
  readonly summary: string;
  readonly zoneId: ZoneId;
  readonly x: number;
  readonly y: number;
  readonly keywordCount: number;
  readonly turnCount: number;
  readonly degree: number;
  readonly keywords: readonly AtlasKeyword[];
}

export interface AtlasZone {
  readonly id: ZoneId;
  readonly num: number;
  readonly title: string;
  readonly ko: string;
  readonly summary: string;
  readonly color: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly atomCount: number;
}

export interface AtlasEdge {
  readonly source: string;
  readonly target: string;
  readonly label: string;
  readonly kind: AtlasEdgeKind;
}

export interface AtlasTotals {
  readonly zones: number;
  readonly topics: number;
  readonly keywords: number;
  readonly atoms: number;
  readonly edges: number;
}

export const ATLAS_WORLD = {
  width: 2920,
  height: 1640
} as const;

export const ATLAS_ZONES = [
  {
    id: "strategy",
    num: 1,
    title: "Strategy / Insight",
    ko: "브랜드·문제·인사이트",
    summary:
      "왜 필요한지, 무엇과 싸우는지, 어떤 관점으로 포지셔닝할지 정의하는 영역입니다.",
    color: "#f1a157",
    x: 80,
    y: 70,
    width: 850,
    height: 520,
    atomCount: 187
  },
  {
    id: "product",
    num: 2,
    title: "Product Structure",
    ko: "제품 구조·객체 모델",
    summary:
      "대화를 수집하고 구조화해 연결한 뒤 다음 행동을 제안하는 제품 코어입니다.",
    color: "#72c7ff",
    x: 1030,
    y: 70,
    width: 840,
    height: 620,
    atomCount: 284
  },
  {
    id: "atlas",
    num: 3,
    title: "Atlas UX / Graph Map",
    ko: "지도 UI·시각화",
    summary:
      "방대한 대화를 공간 지도와 점진적 상세 보기로 읽을 수 있게 관리합니다.",
    color: "#b299ff",
    x: 1970,
    y: 70,
    width: 870,
    height: 620,
    atomCount: 264
  },
  {
    id: "evidence",
    num: 4,
    title: "Evidence / Decision Ops",
    ko: "근거·결정 운영",
    summary: "원문 근거, 생각 변화, 결정 흐름과 다음 제안을 함께 운영합니다.",
    color: "#ff766a",
    x: 80,
    y: 790,
    width: 850,
    height: 710,
    atomCount: 174
  },
  {
    id: "memory",
    num: 5,
    title: "Memory Engine / J.A.R.V.I.S",
    ko: "장기 기억·검색 엔진",
    summary:
      "캡처 메모리와 그래프 메모리를 엮어 시간 너머의 작업 맥락을 재사용합니다.",
    color: "#68d8a7",
    x: 1030,
    y: 790,
    width: 840,
    height: 710,
    atomCount: 170
  },
  {
    id: "governance",
    num: 6,
    title: "Biadone Scale / Governance",
    ko: "생태계·리스크·확장",
    summary:
      "Before I Ask, Done 철학과 개인정보, 권한, 투명성 리스크를 다룹니다.",
    color: "#f3cd63",
    x: 1970,
    y: 790,
    width: 870,
    height: 710,
    atomCount: 121
  }
] as const satisfies readonly AtlasZone[];

export const ATLAS_TOPICS = [
  {
    id: "north-star",
    title: "North Star",
    ko: "북극성",
    summary: "긴 대화를 다시 쓸 수 있는 지식 지도로 바꾼다는 제품 목적입니다.",
    zoneId: "strategy",
    x: 250,
    y: 255,
    keywordCount: 24,
    turnCount: 72,
    degree: 3,
    keywords: [
      {
        id: "north-star-context-map",
        label: "Context map",
        kind: "topic",
        summary: "대화 전체를 맥락 지도처럼 읽는 핵심 개념"
      },
      {
        id: "north-star-reuse",
        label: "재사용 가능한 지식",
        kind: "decision",
        summary: "요약보다 재사용성을 우선하는 제품 방향"
      },
      {
        id: "north-star-traceability",
        label: "Traceability",
        kind: "evidence",
        summary: "모든 해석을 원문까지 추적할 수 있어야 한다는 원칙"
      },
      {
        id: "north-star-success-signal",
        label: "성공 신호 정의",
        kind: "pending",
        summary: "지도가 실제 재사용을 만들었는지 측정할 기준"
      }
    ]
  },
  {
    id: "value-thesis",
    title: "Value Thesis",
    ko: "가치 가설",
    summary: "검색과 요약 사이의 간극을 구조화된 맥락 탐색으로 해결합니다.",
    zoneId: "strategy",
    x: 520,
    y: 395,
    keywordCount: 22,
    turnCount: 60,
    degree: 3,
    keywords: [
      {
        id: "value-thesis-cognitive-load",
        label: "인지 부하",
        kind: "topic",
        summary: "긴 대화를 다시 읽을 때 발생하는 탐색 비용"
      },
      {
        id: "value-thesis-progressive-value",
        label: "Progressive value",
        kind: "decision",
        summary: "필요할 때만 상세 정보를 여는 가치 전달 방식"
      },
      {
        id: "value-thesis-user-interviews",
        label: "사용자 인터뷰",
        kind: "evidence",
        summary: "맥락 손실 문제를 보여 주는 정성 근거"
      },
      {
        id: "value-thesis-segment-test",
        label: "세그먼트 검증",
        kind: "action",
        summary: "초기 사용자군별 문제 강도를 검증하는 작업"
      }
    ]
  },
  {
    id: "roadmap",
    title: "Product Roadmap",
    ko: "제품 로드맵",
    summary: "복원, 구조화, 검증, 시각화 순으로 위험을 낮추며 확장합니다.",
    zoneId: "strategy",
    x: 790,
    y: 235,
    keywordCount: 20,
    turnCount: 55,
    degree: 4,
    keywords: [
      {
        id: "roadmap-shadow-mode",
        label: "Shadow mode",
        kind: "decision",
        summary: "새 추출기를 기존 결과 옆에서 비교하는 출시 전략"
      },
      {
        id: "roadmap-sprint-gates",
        label: "Sprint gates",
        kind: "topic",
        summary: "단계별 품질 기준과 출시 관문"
      },
      {
        id: "roadmap-atlas-milestone",
        label: "Atlas milestone",
        kind: "action",
        summary: "검증된 의미 구조를 지도 화면에 연결하는 단계"
      },
      {
        id: "roadmap-governance-gap",
        label: "거버넌스 범위",
        kind: "pending",
        summary: "초기 출시에서 다룰 보안 정책의 경계"
      }
    ]
  },
  {
    id: "ingestion",
    title: "Conversation Ingestion",
    ko: "대화 수집",
    summary: "공유 링크의 페이로드를 복원하고 정규화된 대화로 변환합니다.",
    zoneId: "product",
    x: 1220,
    y: 245,
    keywordCount: 25,
    turnCount: 72,
    degree: 2,
    keywords: [
      {
        id: "ingestion-share-link",
        label: "Share link",
        kind: "topic",
        summary: "ChatGPT 공유 대화의 입력 경계"
      },
      {
        id: "ingestion-flight-payload",
        label: "React Flight payload",
        kind: "evidence",
        summary: "원문 메시지를 복원하는 실제 페이로드 근거"
      },
      {
        id: "ingestion-normalization",
        label: "정규화",
        kind: "action",
        summary: "분기와 메타데이터를 일관된 메시지 배열로 변환"
      },
      {
        id: "ingestion-private-links",
        label: "비공개 링크",
        kind: "pending",
        summary: "인증이 필요한 대화 수집의 미해결 범위"
      }
    ]
  },
  {
    id: "structure-engine",
    title: "Structure Engine",
    ko: "구조 엔진",
    summary:
      "메시지 흐름을 토픽, 구간, 관계로 묶어 탐색 가능한 뼈대를 만듭니다.",
    zoneId: "product",
    x: 1635,
    y: 245,
    keywordCount: 26,
    turnCount: 80,
    degree: 4,
    keywords: [
      {
        id: "structure-engine-topic-flow",
        label: "Topic flow",
        kind: "topic",
        summary: "대화의 의미 전환 지점을 나타내는 구조"
      },
      {
        id: "structure-engine-segmentation",
        label: "Segmentation",
        kind: "decision",
        summary: "장문 대화를 구간별로 분석하는 처리 방식"
      },
      {
        id: "structure-engine-rule-extractor",
        label: "Rule extractor",
        kind: "evidence",
        summary: "현재 구조 결과를 만드는 기준선 추출기"
      },
      {
        id: "structure-engine-boundary-tuning",
        label: "경계 보정",
        kind: "action",
        summary: "잘못 분리되거나 합쳐진 토픽 경계를 개선"
      }
    ]
  },
  {
    id: "semantic-schema",
    title: "Semantic Schema",
    ko: "의미 스키마",
    summary: "의도, 결정, 행동, 문제 신호 등 공통 의미 타입을 정의합니다.",
    zoneId: "product",
    x: 1220,
    y: 500,
    keywordCount: 24,
    turnCount: 68,
    degree: 4,
    keywords: [
      {
        id: "semantic-schema-intent",
        label: "Intent",
        kind: "topic",
        summary: "사용자가 달성하려는 목적을 나타내는 의미 타입"
      },
      {
        id: "semantic-schema-decision",
        label: "Decision",
        kind: "topic",
        summary: "명시적으로 선택되거나 수락된 방향"
      },
      {
        id: "semantic-schema-shared-contract",
        label: "공통 계약",
        kind: "decision",
        summary: "Rule과 LLM이 같은 결과 타입을 사용한다는 결정"
      },
      {
        id: "semantic-schema-relation-coverage",
        label: "Relation coverage",
        kind: "pending",
        summary: "관계 타입의 충분한 표현 범위 검토"
      }
    ]
  },
  {
    id: "quality-loop",
    title: "Quality Loop",
    ko: "품질 루프",
    summary: "규칙과 LLM 결과를 비교하고 실패를 다시 개선 입력으로 돌립니다.",
    zoneId: "product",
    x: 1635,
    y: 500,
    keywordCount: 22,
    turnCount: 64,
    degree: 4,
    keywords: [
      {
        id: "quality-loop-shadow-comparison",
        label: "Shadow comparison",
        kind: "evidence",
        summary: "Rule과 LLM 결과의 병렬 비교"
      },
      {
        id: "quality-loop-coverage",
        label: "Coverage",
        kind: "topic",
        summary: "의미 타입과 메시지 근거의 포함 범위"
      },
      {
        id: "quality-loop-review-feedback",
        label: "검토 피드백",
        kind: "action",
        summary: "사람의 판정을 추출 개선에 반영"
      },
      {
        id: "quality-loop-thresholds",
        label: "품질 임계값",
        kind: "pending",
        summary: "자동 승인과 검토 전환의 기준"
      }
    ]
  },
  {
    id: "progressive-disclosure",
    title: "Progressive Disclosure",
    ko: "점진적 공개",
    summary:
      "영역에서 토픽, 키워드, 근거로 내려가며 필요한 밀도만 보여 줍니다.",
    zoneId: "atlas",
    x: 2165,
    y: 245,
    keywordCount: 24,
    turnCount: 65,
    degree: 4,
    keywords: [
      {
        id: "progressive-disclosure-four-levels",
        label: "4-level reveal",
        kind: "decision",
        summary: "영역, 토픽, 키워드, 근거의 네 단계 탐색"
      },
      {
        id: "progressive-disclosure-density",
        label: "정보 밀도",
        kind: "topic",
        summary: "줌과 선택 상태에 따라 달라지는 표현량"
      },
      {
        id: "progressive-disclosure-focus-mode",
        label: "Focus mode",
        kind: "action",
        summary: "한 영역이나 로컬 이웃만 남기는 조작"
      },
      {
        id: "progressive-disclosure-label-limit",
        label: "라벨 한계",
        kind: "pending",
        summary: "동시에 읽을 수 있는 라벨 수의 기준"
      }
    ]
  },
  {
    id: "spatial-atlas",
    title: "Spatial Atlas",
    ko: "공간 지도",
    summary:
      "토픽의 위치와 연결 강도로 대화 전체의 구조를 한 화면에 표현합니다.",
    zoneId: "atlas",
    x: 2625,
    y: 245,
    keywordCount: 27,
    turnCount: 78,
    degree: 3,
    keywords: [
      {
        id: "spatial-atlas-zones",
        label: "Zoned canvas",
        kind: "decision",
        summary: "의미 영역별로 공간을 구획하는 지도 방식"
      },
      {
        id: "spatial-atlas-topic-hubs",
        label: "Topic hubs",
        kind: "topic",
        summary: "연결의 중심이 되는 토픽 노드"
      },
      {
        id: "spatial-atlas-edge-weight",
        label: "Edge weight",
        kind: "evidence",
        summary: "관계 중요도를 선의 강도로 표현"
      },
      {
        id: "spatial-atlas-auto-layout",
        label: "자동 배치",
        kind: "pending",
        summary: "데이터 변화에 대응하는 안정적인 배치 방식"
      }
    ]
  },
  {
    id: "navigation",
    title: "Navigation",
    ko: "탐색 조작",
    summary: "검색, 영역 포커스, 팬과 줌으로 원하는 맥락에 빠르게 도달합니다.",
    zoneId: "atlas",
    x: 2165,
    y: 500,
    keywordCount: 22,
    turnCount: 58,
    degree: 2,
    keywords: [
      {
        id: "navigation-search",
        label: "통합 검색",
        kind: "action",
        summary: "토픽과 키워드를 한 번에 찾는 입력"
      },
      {
        id: "navigation-pan-zoom",
        label: "Pan & zoom",
        kind: "topic",
        summary: "대형 캔버스를 이동하고 확대하는 기본 조작"
      },
      {
        id: "navigation-local-neighbors",
        label: "Local neighbors",
        kind: "decision",
        summary: "선택 토픽과 직접 이웃을 중심으로 보여 주는 방식"
      },
      {
        id: "navigation-keyboard",
        label: "키보드 탐색",
        kind: "pending",
        summary: "노드 사이를 키보드만으로 이동하는 접근성 과제"
      }
    ]
  },
  {
    id: "inspector",
    title: "Inspector",
    ko: "인스펙터",
    summary: "선택한 토픽의 요약, 키워드, 연결, 원문 근거를 한곳에서 읽습니다.",
    zoneId: "atlas",
    x: 2625,
    y: 500,
    keywordCount: 23,
    turnCount: 63,
    degree: 4,
    keywords: [
      {
        id: "inspector-context-panel",
        label: "Context panel",
        kind: "topic",
        summary: "선택 개체의 상세 맥락을 보여 주는 우측 패널"
      },
      {
        id: "inspector-evidence-pin",
        label: "Evidence pin",
        kind: "action",
        summary: "중요한 근거 카드를 비교할 수 있도록 고정"
      },
      {
        id: "inspector-related-topics",
        label: "Related topics",
        kind: "evidence",
        summary: "현재 토픽과 직접 이어진 관계 목록"
      },
      {
        id: "inspector-multi-select",
        label: "다중 선택",
        kind: "pending",
        summary: "여러 토픽을 나란히 비교하는 후속 기능"
      }
    ]
  },
  {
    id: "evidence-chain",
    title: "Evidence Chain",
    ko: "근거 사슬",
    summary: "해석된 항목을 정확한 메시지와 인용 구간까지 연결합니다.",
    zoneId: "evidence",
    x: 250,
    y: 1065,
    keywordCount: 25,
    turnCount: 67,
    degree: 6,
    keywords: [
      {
        id: "evidence-chain-trigger-phrase",
        label: "Trigger phrase",
        kind: "evidence",
        summary: "의미 판단을 직접 지지하는 원문 구절"
      },
      {
        id: "evidence-chain-span",
        label: "Character span",
        kind: "topic",
        summary: "인용 구간의 시작과 끝 위치"
      },
      {
        id: "evidence-chain-direct-proof",
        label: "직접 근거 우선",
        kind: "decision",
        summary: "사용자 발화의 명시적 표현을 우선하는 검증 규칙"
      },
      {
        id: "evidence-chain-backfill",
        label: "근거 백필",
        kind: "action",
        summary: "과거 항목에 정확한 원문 위치를 다시 연결"
      }
    ]
  },
  {
    id: "decision-ledger",
    title: "Decision Ledger",
    ko: "결정 원장",
    summary: "무엇이 언제 어떤 이유로 결정되었는지 상태와 근거를 보존합니다.",
    zoneId: "evidence",
    x: 520,
    y: 1260,
    keywordCount: 21,
    turnCount: 56,
    degree: 4,
    keywords: [
      {
        id: "decision-ledger-accepted",
        label: "Accepted decision",
        kind: "decision",
        summary: "명시적으로 선택되거나 수락된 결정"
      },
      {
        id: "decision-ledger-rationale",
        label: "Rationale",
        kind: "evidence",
        summary: "결정에 도달한 이유와 당시 근거"
      },
      {
        id: "decision-ledger-superseded",
        label: "Superseded",
        kind: "topic",
        summary: "후속 결정으로 대체된 상태"
      },
      {
        id: "decision-ledger-owner",
        label: "결정 소유자",
        kind: "pending",
        summary: "결정 책임 주체를 표현하는 모델 과제"
      }
    ]
  },
  {
    id: "review-operations",
    title: "Review Operations",
    ko: "검토 운영",
    summary: "검증, 보류, 기각 상태를 분류하고 사람이 판단할 큐를 관리합니다.",
    zoneId: "evidence",
    x: 790,
    y: 1045,
    keywordCount: 20,
    turnCount: 51,
    degree: 4,
    keywords: [
      {
        id: "review-operations-verified",
        label: "Verified",
        kind: "evidence",
        summary: "근거 검사를 통과한 항목 상태"
      },
      {
        id: "review-operations-review-queue",
        label: "Review queue",
        kind: "action",
        summary: "사람의 판단이 필요한 항목 목록"
      },
      {
        id: "review-operations-rejected",
        label: "Rejected",
        kind: "topic",
        summary: "근거 부족이나 오류로 제외된 항목 상태"
      },
      {
        id: "review-operations-sla",
        label: "검토 SLA",
        kind: "pending",
        summary: "검토 우선순위와 처리 시간 기준"
      }
    ]
  },
  {
    id: "memory-model",
    title: "Memory Model",
    ko: "메모리 모델",
    summary: "토픽, 결정, 근거와 관계를 장기 기억 단위로 저장합니다.",
    zoneId: "memory",
    x: 1215,
    y: 1050,
    keywordCount: 24,
    turnCount: 65,
    degree: 4,
    keywords: [
      {
        id: "memory-model-memory-unit",
        label: "Memory unit",
        kind: "topic",
        summary: "재사용할 수 있는 최소 기억 단위"
      },
      {
        id: "memory-model-relational-memory",
        label: "관계형 기억",
        kind: "decision",
        summary: "고립된 메모보다 관계를 함께 보존하는 방식"
      },
      {
        id: "memory-model-source-links",
        label: "Source links",
        kind: "evidence",
        summary: "기억에서 원 대화로 돌아가는 참조"
      },
      {
        id: "memory-model-consolidation",
        label: "기억 병합",
        kind: "pending",
        summary: "중복되거나 충돌하는 기억을 합치는 기준"
      }
    ]
  },
  {
    id: "retrieval",
    title: "Context Retrieval",
    ko: "맥락 검색",
    summary: "질문과 현재 작업에 맞는 기억을 근거 및 관계와 함께 되찾습니다.",
    zoneId: "memory",
    x: 1450,
    y: 1260,
    keywordCount: 21,
    turnCount: 55,
    degree: 4,
    keywords: [
      {
        id: "retrieval-hybrid-search",
        label: "Hybrid search",
        kind: "decision",
        summary: "키워드와 의미 관계를 함께 사용하는 검색"
      },
      {
        id: "retrieval-evidence-ranking",
        label: "Evidence ranking",
        kind: "evidence",
        summary: "근거의 직접성과 최신성을 검색 순위에 반영"
      },
      {
        id: "retrieval-query-context",
        label: "Query context",
        kind: "topic",
        summary: "현재 질문과 작업 상태에서 얻는 검색 단서"
      },
      {
        id: "retrieval-evaluation-set",
        label: "검색 평가셋",
        kind: "action",
        summary: "검색 품질을 반복 측정할 대표 질문 구성"
      }
    ]
  },
  {
    id: "continuity",
    title: "Conversation Continuity",
    ko: "대화 연속성",
    summary: "새 대화에서도 과거의 결정과 열린 질문을 자연스럽게 이어 갑니다.",
    zoneId: "memory",
    x: 1720,
    y: 1040,
    keywordCount: 20,
    turnCount: 50,
    degree: 3,
    keywords: [
      {
        id: "continuity-open-loops",
        label: "Open loops",
        kind: "topic",
        summary: "아직 답하지 않았거나 끝나지 않은 작업"
      },
      {
        id: "continuity-handoff",
        label: "Context handoff",
        kind: "action",
        summary: "새 세션에 필요한 기억을 전달"
      },
      {
        id: "continuity-decision-history",
        label: "결정 이력",
        kind: "evidence",
        summary: "현재 방향을 설명하는 과거 선택의 흐름"
      },
      {
        id: "continuity-staleness",
        label: "기억 신선도",
        kind: "pending",
        summary: "오래된 맥락을 언제 낮게 평가할지 정하는 기준"
      }
    ]
  },
  {
    id: "provenance",
    title: "Provenance",
    ko: "출처 추적",
    summary: "모든 지식이 어느 대화와 처리 단계에서 왔는지 기록합니다.",
    zoneId: "governance",
    x: 2155,
    y: 1050,
    keywordCount: 21,
    turnCount: 47,
    degree: 4,
    keywords: [
      {
        id: "provenance-lineage",
        label: "Data lineage",
        kind: "topic",
        summary: "입력부터 파생 결과까지의 생성 경로"
      },
      {
        id: "provenance-audit-export",
        label: "Audit export",
        kind: "action",
        summary: "모델 결과와 근거를 검수 파일로 내보내기"
      },
      {
        id: "provenance-run-metadata",
        label: "Run metadata",
        kind: "evidence",
        summary: "모델, 시간, 버전 등 실행 당시 정보"
      },
      {
        id: "provenance-derived-attribution",
        label: "파생 출처 표기",
        kind: "pending",
        summary: "여러 근거가 합쳐진 지식의 출처 표현"
      }
    ]
  },
  {
    id: "access-control",
    title: "Access Control",
    ko: "접근 제어",
    summary: "민감한 대화와 기억을 사용자, 역할, 작업 범위에 맞게 제한합니다.",
    zoneId: "governance",
    x: 2430,
    y: 1260,
    keywordCount: 20,
    turnCount: 40,
    degree: 3,
    keywords: [
      {
        id: "access-control-least-privilege",
        label: "Least privilege",
        kind: "decision",
        summary: "필요한 최소 범위만 접근을 허용하는 원칙"
      },
      {
        id: "access-control-sensitive-content",
        label: "민감 정보",
        kind: "topic",
        summary: "외부 모델이나 사용자에게 노출하면 안 되는 내용"
      },
      {
        id: "access-control-scope-check",
        label: "Scope check",
        kind: "action",
        summary: "검색과 표시 전에 접근 가능 범위를 확인"
      },
      {
        id: "access-control-sharing-policy",
        label: "공유 정책",
        kind: "pending",
        summary: "Atlas 뷰를 다른 사용자와 공유하는 권한 모델"
      }
    ]
  },
  {
    id: "retention",
    title: "Retention & Lifecycle",
    ko: "보존·수명 주기",
    summary: "원문과 파생 지식의 보존 기간, 갱신, 삭제 기준을 관리합니다.",
    zoneId: "governance",
    x: 2710,
    y: 1045,
    keywordCount: 19,
    turnCount: 34,
    degree: 3,
    keywords: [
      {
        id: "retention-policy",
        label: "Retention policy",
        kind: "decision",
        summary: "데이터 종류별 보존 기간과 처리 원칙"
      },
      {
        id: "retention-delete-source",
        label: "원문 삭제",
        kind: "action",
        summary: "원 대화 삭제 시 파생 데이터까지 처리하는 흐름"
      },
      {
        id: "retention-version-history",
        label: "Version history",
        kind: "evidence",
        summary: "기억과 결정이 바뀐 과정을 보여 주는 기록"
      },
      {
        id: "retention-expiration-signal",
        label: "만료 신호",
        kind: "pending",
        summary: "낡은 기억을 자동으로 검토 대상으로 전환하는 조건"
      }
    ]
  }
] as const satisfies readonly AtlasTopic[];

export const ATLAS_EDGES = [
  {
    source: "north-star",
    target: "value-thesis",
    label: "frames",
    kind: "supports"
  },
  {
    source: "north-star",
    target: "roadmap",
    label: "directs",
    kind: "informs"
  },
  {
    source: "value-thesis",
    target: "roadmap",
    label: "prioritizes",
    kind: "informs"
  },
  {
    source: "ingestion",
    target: "structure-engine",
    label: "feeds",
    kind: "feeds"
  },
  {
    source: "structure-engine",
    target: "semantic-schema",
    label: "produces",
    kind: "feeds"
  },
  {
    source: "semantic-schema",
    target: "quality-loop",
    label: "is measured by",
    kind: "validates"
  },
  {
    source: "structure-engine",
    target: "quality-loop",
    label: "is audited by",
    kind: "validates"
  },
  {
    source: "progressive-disclosure",
    target: "spatial-atlas",
    label: "shapes",
    kind: "informs"
  },
  {
    source: "spatial-atlas",
    target: "navigation",
    label: "enables",
    kind: "supports"
  },
  {
    source: "navigation",
    target: "inspector",
    label: "opens",
    kind: "feeds"
  },
  {
    source: "progressive-disclosure",
    target: "inspector",
    label: "layers",
    kind: "informs"
  },
  {
    source: "evidence-chain",
    target: "decision-ledger",
    label: "substantiates",
    kind: "supports"
  },
  {
    source: "evidence-chain",
    target: "review-operations",
    label: "queues",
    kind: "feeds"
  },
  {
    source: "decision-ledger",
    target: "review-operations",
    label: "is reviewed by",
    kind: "validates"
  },
  {
    source: "memory-model",
    target: "retrieval",
    label: "enables",
    kind: "supports"
  },
  {
    source: "retrieval",
    target: "continuity",
    label: "sustains",
    kind: "supports"
  },
  {
    source: "memory-model",
    target: "continuity",
    label: "anchors",
    kind: "supports"
  },
  {
    source: "provenance",
    target: "access-control",
    label: "constrains",
    kind: "governs"
  },
  {
    source: "provenance",
    target: "retention",
    label: "traces",
    kind: "governs"
  },
  {
    source: "access-control",
    target: "retention",
    label: "enforces",
    kind: "governs"
  },
  {
    source: "value-thesis",
    target: "ingestion",
    label: "defines scope",
    kind: "informs"
  },
  {
    source: "roadmap",
    target: "quality-loop",
    label: "sets gates",
    kind: "governs"
  },
  {
    source: "north-star",
    target: "progressive-disclosure",
    label: "directs",
    kind: "informs"
  },
  {
    source: "structure-engine",
    target: "spatial-atlas",
    label: "maps to",
    kind: "feeds"
  },
  {
    source: "semantic-schema",
    target: "progressive-disclosure",
    label: "organizes",
    kind: "informs"
  },
  {
    source: "quality-loop",
    target: "evidence-chain",
    label: "verifies through",
    kind: "validates"
  },
  {
    source: "semantic-schema",
    target: "evidence-chain",
    label: "requires",
    kind: "supports"
  },
  {
    source: "inspector",
    target: "evidence-chain",
    label: "reveals",
    kind: "feeds"
  },
  {
    source: "inspector",
    target: "decision-ledger",
    label: "explains",
    kind: "feeds"
  },
  {
    source: "decision-ledger",
    target: "memory-model",
    label: "commits to",
    kind: "feeds"
  },
  {
    source: "evidence-chain",
    target: "retrieval",
    label: "ranks",
    kind: "informs"
  },
  {
    source: "continuity",
    target: "provenance",
    label: "preserves",
    kind: "governs"
  },
  {
    source: "memory-model",
    target: "retention",
    label: "is governed by",
    kind: "governs"
  },
  {
    source: "retrieval",
    target: "access-control",
    label: "is authorized by",
    kind: "governs"
  },
  {
    source: "review-operations",
    target: "provenance",
    label: "audits",
    kind: "validates"
  },
  {
    source: "review-operations",
    target: "roadmap",
    label: "informs",
    kind: "informs"
  }
] as const satisfies readonly AtlasEdge[];

export function calculateAtlasTotals(
  zones: readonly AtlasZone[] = ATLAS_ZONES,
  topics: readonly AtlasTopic[] = ATLAS_TOPICS,
  edges: readonly AtlasEdge[] = ATLAS_EDGES
): AtlasTotals {
  return {
    zones: zones.length,
    topics: topics.length,
    keywords: topics.reduce((total, topic) => total + topic.keywordCount, 0),
    atoms: topics.reduce((total, topic) => total + topic.turnCount, 0),
    edges: edges.length
  };
}

export const ATLAS_TOTALS = calculateAtlasTotals();

export function getTopicById(topicId: string): AtlasTopic | undefined {
  return ATLAS_TOPICS.find((topic) => topic.id === topicId);
}

export function getZoneById(zoneId: string): AtlasZone | undefined {
  return ATLAS_ZONES.find((zone) => zone.id === zoneId);
}

export function topicsForZone(zoneId: ZoneId): readonly AtlasTopic[] {
  return ATLAS_TOPICS.filter((topic) => topic.zoneId === zoneId);
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR");
}

export function isTopicMatch(topic: AtlasTopic, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const searchableText = [
    topic.id,
    topic.title,
    topic.ko,
    topic.summary,
    ...topic.keywords.flatMap((keyword) => [
      keyword.label,
      keyword.summary,
      keyword.kind
    ])
  ]
    .join(" ")
    .toLocaleLowerCase("ko-KR");

  return searchableText.includes(normalizedQuery);
}

export function searchTopics(query: string): readonly AtlasTopic[] {
  return ATLAS_TOPICS.filter((topic) => isTopicMatch(topic, query));
}

export function getNeighborTopicIds(
  topicId: string,
  includeSelf = false
): ReadonlySet<string> {
  const neighbors = new Set<string>();
  if (includeSelf && getTopicById(topicId)) neighbors.add(topicId);

  for (const edge of ATLAS_EDGES) {
    if (edge.source === topicId) neighbors.add(edge.target);
    if (edge.target === topicId) neighbors.add(edge.source);
  }

  return neighbors;
}
