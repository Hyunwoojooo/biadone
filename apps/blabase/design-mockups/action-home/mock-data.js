(function exposeActionHomeMockData() {
  "use strict";

  const actionHomeMockData = {
    mockNotice: "합성 mock data · API/LLM 연결 없음",
    session: {
      title: "SABER paper",
      goal: "실험 결정을 마무리하고 논문 제출 준비하기"
    },
    topics: [
      {
        id: "experiments",
        title: "Experiments",
        summary: "결정 2 · 작업 3",
        tone: "lemon"
      },
      {
        id: "bellman",
        title: "Bellman weighting",
        summary: "검토 2 · 질문 1",
        tone: "lavender"
      },
      {
        id: "evaluation",
        title: "Evaluation",
        summary: "기준 2 · 검토 1",
        tone: "mint"
      },
      {
        id: "submission",
        title: "Submission",
        summary: "작업 2 · 질문 1",
        tone: "peach"
      }
    ],
    recommendations: [
      {
        id: "experiment-criteria",
        title: "Experiments 기준을 먼저 확정하세요",
        conciergeTitle: "Experiments 기준 확정",
        reason:
          "Bellman weighting 구현과 Evaluation 비교 기준이 이 결정에 의존하고 있습니다.",
        source: "blabase 제안",
        grounding: "근거 충분",
        turns: ["Turn 12", "Turn 18", "Turn 24"],
        outcome: "실험 기준과 비교 조건이 확정된 실행 계획",
        relatedTopics: ["experiments", "bellman", "evaluation"]
      },
      {
        id: "reviewer-risk",
        title: "Reviewer risk를 확인하세요",
        conciergeTitle: "Reviewer risk 확인",
        reason:
          "제출 전에 예상 반론과 대응 근거를 확인하면 수정 범위를 줄일 수 있습니다.",
        source: "blabase 제안",
        grounding: "확인 필요",
        turns: ["Turn 18", "Turn 24"],
        outcome: "Reviewer 우려와 대응 근거가 연결된 검토 목록",
        relatedTopics: ["evaluation", "submission"]
      },
      {
        id: "final-abstract",
        title: "Final abstract 수정안을 만드세요",
        conciergeTitle: "Final abstract 수정",
        reason:
          "확정된 실험 기준을 반영해 제출용 핵심 문장을 정리할 차례입니다.",
        source: "blabase 제안",
        grounding: "근거 충분",
        turns: ["Turn 12", "Turn 24"],
        outcome: "실험 결과와 제출 목표가 연결된 최종 abstract 초안",
        relatedTopics: ["experiments", "submission"]
      }
    ],
    unresolved: [
      { label: "확인이 필요한 결정", count: 2 },
      { label: "열린 질문", count: 1 },
      { label: "검토가 필요한 항목", count: 2 }
    ],
    evidence: [
      {
        turn: "Turn 12",
        topic: "Experiments",
        sentence: "UTD-1 baseline을 먼저 고정해야 한다."
      },
      {
        turn: "Turn 18",
        topic: "Bellman weighting",
        sentence: "Bellman weighting 비교 조건이 아직 정해지지 않았다."
      },
      {
        turn: "Turn 24",
        topic: "Evaluation",
        sentence: "Submission 전에 Evaluation 형식을 통일해야 한다."
      }
    ],
    runningSteps: [
      {
        title: "대화 근거 확인",
        detail: "관련 Turn과 결정 조건을 확인했어요."
      },
      {
        title: "실행 순서 구성",
        detail: "의존 관계에 맞춰 작업 순서를 정리하고 있어요."
      },
      {
        title: "결과 검토",
        detail: "빠진 조건이 없는지 마지막으로 살펴봐요."
      }
    ],
    artifact: {
      title: "Experiments 실행 계획",
      items: [
        "UTD-1 replay baseline을 고정한다.",
        "FetchPickAndPlace seed 조건을 확정한다.",
        "Bellman weighting 비교 조건을 기록한다.",
        "Confidence interval 보고 형식을 통일한다.",
        "최종 결과를 Submission checklist와 연결한다."
      ],
      shortItems: [
        "실험 baseline과 seed 조건을 확정한다.",
        "비교 조건과 보고 형식을 통일한다.",
        "최종 결과를 Submission checklist와 연결한다."
      ]
    },
    rejectionReasons: [
      "지금 필요 없음",
      "이미 완료함",
      "다른 작업이 더 중요함",
      "내용이 부정확함"
    ],
    clarification: {
      question: "어떤 목표를 먼저 진행할까요?",
      choices: ["실험 완료", "논문 제출", "Reviewer 대응"]
    }
  };

  window.ACTION_HOME_MOCK = Object.freeze(actionHomeMockData);
})();
