import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTENT_NOTE_SCHEMA_VERSION,
  ContentNoteGenerationError,
  createGeminiConversationContentNote,
  parseConversationContentNoteV4,
} from "./index.ts";

const NULL_EVENT_FIELDS = {
  targetKey: null,
  requestKind: null,
  status: null,
  owner: null,
  dueAt: null,
  resultKind: null,
  completionBasis: null,
  artifactKind: null,
  artifactLabel: null,
  artifactLocator: null,
  proposedBy: null,
  unresolvedKind: null,
  changeKind: null,
  from: null,
  to: null,
  reason: null,
};

function geminiResponse(value) {
  return new Response(
    JSON.stringify({ status: "completed", output_text: JSON.stringify(value) }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function requestPayload(init) {
  const body = JSON.parse(String(init.body));
  return {
    body,
    prompt: JSON.parse(body.input.slice(body.input.indexOf("{"))),
  };
}

function evidenceId(prompt, sourceMessageId, quotePart) {
  const item = prompt.evidenceCatalog.find(
    (candidate) =>
      candidate.sourceMessageId === sourceMessageId &&
      candidate.quote.includes(quotePart),
  );
  assert.ok(item, `missing evidence ${sourceMessageId}: ${quotePart}`);
  return item.evidenceId;
}

function evidenceText(text, evidenceIdValue) {
  return { text, evidence: [{ evidenceId: evidenceIdValue }] };
}

function publicEvidence(text, sourceMessageId = "u1") {
  return {
    text,
    sourceMessageIds: [sourceMessageId],
    evidenceSnippets: [{ sourceMessageId, quote: text }],
  };
}

function publicEvidenceWithQuote(text, quote, sourceMessageId = "u1") {
  return {
    text,
    sourceMessageIds: [sourceMessageId],
    evidenceSnippets: [{ sourceMessageId, quote }],
  };
}

function publicFixture() {
  return {
    schemaVersion: CONTENT_NOTE_SCHEMA_VERSION,
    conversationType: "research",
    title: publicEvidence("환경 변화에 적응하는 강화학습"),
    oneLineSummary: publicEvidence("환경 변화에는 추론형 적응과 모델 기반 제어가 현실적인 대안이다."),
    keyTakeaways: [
      publicEvidence("환경 변화마다 전체 정책을 재학습하면 운영 비용이 커진다."),
      publicEvidence("컨텍스트 추론은 가중치 갱신 없이 변화에 대응한다."),
      publicEvidence("실제 로봇은 MPC와 학습 모듈을 결합하는 구성이 현실적이다."),
    ],
    topics: [
      {
        title: publicEvidence("재학습 비용과 적용 한계"),
        summary: publicEvidence("비정상 환경에서는 end-to-end 재학습의 사업성이 제한될 수 있다."),
        details: [
          {
            ...publicEvidence("안전한 탐색과 유지 비용이 실제 도입의 핵심 제약이다."),
            kind: "rationale",
          },
        ],
      },
    ],
    conclusions: [
      publicEvidence("정책 전체보다 제한된 적응 모듈을 갱신하는 편이 현실적이다."),
    ],
    confirmedDecisions: [],
    actionItems: [],
    openQuestions: [],
    supportingInfo: {
      currentState: null,
      artifacts: [],
      activeProposals: [],
      constraintsAndChanges: [],
    },
  };
}

test("generates content first while retaining the validated state ledger", async () => {
  const messages = [
    {
      id: "u1",
      role: "user",
      text: "환경이 바뀔 때마다 강화학습을 다시 해야 하면 사업성이 떨어지는 것 아닐까?",
    },
    {
      id: "a1",
      role: "assistant",
      text: "전체 정책을 반복 재학습하기보다 컨텍스트를 추론하거나 MPC와 제한된 학습 모듈을 결합하는 방식이 현실적입니다.",
    },
  ];

  const fetchImpl = async (_url, init) => {
    const { body, prompt } = requestPayload(init);
    assert.equal(body.store, false);
    assert.doesNotMatch(body.input, /test-secret/);
    if (body.system_instruction.includes("content planner")) {
      assert.equal(body.model, "content-test-model");
      assert.equal(prompt.contentBudget.profile, "compact");
      assert.equal(prompt.contentBudget.targetPrimaryMaxChars, 3_000);
      const user = evidenceId(prompt, "u1", "사업성이 떨어지는 것 아닐까");
      const assistant = evidenceId(prompt, "a1", "전체 정책을 반복 재학습하기보다");
      return geminiResponse({
        conversationType: "research",
        title: evidenceText("환경 변화에 적응하는 강화학습", user),
        oneLineSummary: evidenceText(
          "전체 재학습보다 컨텍스트 추론과 MPC 결합이 현실적인 대안으로 정리됐다.",
          assistant,
        ),
        keyTakeaways: [
          evidenceText("환경 변화마다 전체 정책을 재학습하면 운영 비용이 커진다.", user),
          evidenceText("컨텍스트 추론은 가중치 갱신 없이 변화에 대응한다.", assistant),
          evidenceText("MPC와 제한된 학습 모듈의 결합이 실무적인 대안이다.", assistant),
        ],
        topics: [
          {
            title: evidenceText("재학습 비용과 현실적 대안", user),
            summary: evidenceText(
              "end-to-end 재학습의 한계를 컨텍스트 추론과 모델 기반 제어로 보완할 수 있다.",
              assistant,
            ),
            details: [
              {
                kind: "comparison",
                text: "전체 정책 갱신보다 제한된 적응 모듈을 바꾸는 방식이 운영 위험이 낮다.",
                evidence: [{ evidenceId: assistant }],
              },
            ],
          },
        ],
        conclusions: [
          evidenceText("실제 시스템에는 하이브리드 적응 구조가 더 현실적이다.", assistant),
        ],
      });
    }

    assert.match(body.system_instruction, /state-event extractor/i);
    assert.equal(body.model, "state-test-model");
    const user = evidenceId(prompt, "u1", "사업성이 떨어지는 것 아닐까");
    return geminiResponse({
      events: [
        {
          kind: "goal_opened",
          key: "rl-adaptation",
          text: "환경 변화에서 강화학습의 사업성을 검토한다.",
          ...NULL_EVENT_FIELDS,
          evidence: [{ evidenceId: user }],
        },
      ],
    });
  };

  const note = await createGeminiConversationContentNote(
    { title: "강화학습 적응", messages },
    {
      apiKey: "test-secret",
      model: "content-test-model",
      stateModel: "state-test-model",
      fetchImpl,
    },
  );

  assert.equal(note.schemaVersion, CONTENT_NOTE_SCHEMA_VERSION);
  assert.equal(note.topics[0].title.text, "재학습 비용과 현실적 대안");
  assert.deepEqual(note.topics[0].summary.sourceMessageIds, ["a1"]);
  assert.equal(note.keyTakeaways.length, 3);
  assert.equal(note.supportingInfo.currentState, null);
  assert.equal(JSON.stringify(note).includes("test-secret"), false);
});

test("does not expose an ordinary answer as an artifact", async () => {
  const messages = [
    { id: "u1", role: "user", text: "강화학습의 한계를 설명해줘." },
    { id: "a1", role: "assistant", text: "환경 변화와 안전한 탐색 비용이 주요 한계입니다." },
  ];
  const fetchImpl = async (_url, init) => {
    const { body, prompt } = requestPayload(init);
    const user = evidenceId(prompt, "u1", "한계를 설명해줘");
    const assistant = evidenceId(prompt, "a1", "주요 한계입니다");
    if (body.system_instruction.includes("content planner")) {
      return geminiResponse({
        conversationType: "learning",
        title: evidenceText("강화학습의 한계", user),
        oneLineSummary: evidenceText("환경 변화와 탐색 비용이 핵심 한계다.", assistant),
        keyTakeaways: [
          evidenceText("환경 변화는 기존 정책의 성능을 떨어뜨린다.", assistant),
          evidenceText("실제 탐색에는 안전 비용이 든다.", assistant),
          evidenceText("제약이 큰 분야에서는 적용 범위를 좁혀야 한다.", assistant),
        ],
        topics: [
          {
            title: evidenceText("환경 변화와 탐색 비용", assistant),
            summary: evidenceText("두 제약이 실제 적용을 어렵게 만든다.", assistant),
            details: [],
          },
        ],
        conclusions: [],
      });
    }
    return geminiResponse({
      events: [
        {
          kind: "request_fulfilled",
          key: "explain-limit",
          text: "질문에 답했다.",
          ...NULL_EVENT_FIELDS,
          targetKey: "explain-limit",
          resultKind: "answer",
          completionBasis: "conversation_output",
          artifactKind: "document",
          artifactLabel: "답변",
          evidence: [{ evidenceId: assistant }],
        },
      ],
    });
  };

  const note = await createGeminiConversationContentNote(
    { messages },
    { apiKey: "key", fetchImpl },
  );
  assert.deepEqual(note.supportingInfo.artifacts, []);
});

test("keeps a located or user-confirmed file as an actual artifact", async () => {
  const messages = [
    { id: "u1", role: "user", text: "report.md 문서를 만들어줘." },
    { id: "a1", role: "assistant", text: "report.md 문서를 만들었습니다." },
    { id: "u2", role: "user", text: "report.md 문서 생성 완료를 확인했어." },
  ];
  const fetchImpl = async (_url, init) => {
    const { body, prompt } = requestPayload(init);
    const request = evidenceId(prompt, "u1", "문서를 만들어줘");
    const completed = evidenceId(prompt, "a1", "문서를 만들었습니다");
    const confirmed = evidenceId(prompt, "u2", "생성 완료를 확인했어");
    if (body.system_instruction.includes("content planner")) {
      return geminiResponse({
        conversationType: "planning",
        title: evidenceText("보고서 문서 생성", request),
        oneLineSummary: evidenceText("report.md 문서 생성이 확인됐다.", confirmed),
        keyTakeaways: [
          evidenceText("사용자가 report.md 생성을 요청했다.", request),
          evidenceText("Assistant가 report.md 생성을 보고했다.", completed),
          evidenceText("사용자가 문서 생성 완료를 확인했다.", confirmed),
        ],
        topics: [
          {
            title: evidenceText("문서 생성", request),
            summary: evidenceText("요청된 report.md가 만들어지고 확인됐다.", confirmed),
            details: [],
          },
        ],
        conclusions: [],
      });
    }
    return geminiResponse({
      events: [
        {
          kind: "artifact_produced",
          key: "report-document",
          text: "report.md 문서가 생성됐다.",
          ...NULL_EVENT_FIELDS,
          resultKind: "document",
          completionBasis: "user_confirmed",
          artifactKind: "file",
          artifactLabel: "report.md",
          artifactLocator: "report.md",
          evidence: [{ evidenceId: completed }, { evidenceId: confirmed }],
        },
      ],
    });
  };

  const note = await createGeminiConversationContentNote(
    { messages },
    { apiKey: "key", fetchImpl },
  );
  assert.equal(note.supportingInfo.artifacts.length, 1);
  assert.equal(note.supportingInfo.artifacts[0].locator, "report.md");
});

test("splits a long unpunctuated clause into citable evidence instead of dropping it", async () => {
  const messages = [
    {
      id: "u1",
      role: "user",
      text: `${"가".repeat(421)} 정리해줘.`,
    },
  ];
  const fetchImpl = async (_url, init) => {
    const { body, prompt } = requestPayload(init);
    assert.ok(prompt.evidenceCatalog.length >= 2);
    assert.ok(
      prompt.evidenceCatalog.every(
        (item) => [...item.quote].length <= 420,
      ),
    );
    const tail = evidenceId(prompt, "u1", "정리해줘");
    if (body.system_instruction.includes("content planner")) {
      return geminiResponse({
        conversationType: "learning",
        title: evidenceText("긴 입력의 근거 분할", tail),
        oneLineSummary: evidenceText(
          "긴 문장도 버리지 않고 검증 가능한 근거 조각으로 나눈다.",
          tail,
        ),
        keyTakeaways: [
          evidenceText("420자를 넘는 문장을 여러 근거 조각으로 나눈다.", tail),
          evidenceText("각 근거 조각은 원래 메시지 ID를 유지한다.", tail),
          evidenceText("문장 끝의 요청도 인용 가능한 상태로 남는다.", tail),
        ],
        topics: [
          {
            title: evidenceText("근거 보존", tail),
            summary: evidenceText("긴 단일 문장의 뒷부분도 근거로 사용할 수 있다.", tail),
            details: [],
          },
        ],
        conclusions: [],
      });
    }
    return geminiResponse({
      events: [
        {
          kind: "goal_opened",
          key: "organize-long-input",
          text: "긴 입력을 정리한다.",
          ...NULL_EVENT_FIELDS,
          evidence: [{ evidenceId: tail }],
        },
      ],
    });
  };

  const note = await createGeminiConversationContentNote(
    { messages },
    { apiKey: "key", fetchImpl },
  );
  assert.deepEqual(note.oneLineSummary.sourceMessageIds, ["u1"]);
});

test("strictly validates v4 counts, evidence and quick-read length", () => {
  const valid = publicFixture();
  assert.deepEqual(parseConversationContentNoteV4(valid), valid);

  assert.throws(
    () =>
      parseConversationContentNoteV4({
        ...valid,
        keyTakeaways: valid.keyTakeaways.slice(0, 2),
      }),
    hasCode("CONTENT_INVALID_STRUCTURE"),
  );
  assert.throws(
    () =>
      parseConversationContentNoteV4({
        ...valid,
        topics: Array.from({ length: 6 }, () => valid.topics[0]),
      }),
    hasCode("CONTENT_INVALID_STRUCTURE"),
  );
  assert.throws(
    () =>
      parseConversationContentNoteV4({
        ...valid,
        title: {
          ...valid.title,
          evidenceSnippets: [
            { sourceMessageId: "missing", quote: "잘못된 근거" },
          ],
        },
      }),
    hasCode("CONTENT_INVALID_EVIDENCE"),
  );
  assert.throws(
    () =>
      parseConversationContentNoteV4({
        ...valid,
        keyTakeaways: Array.from({ length: 5 }, (_, index) =>
          publicEvidence(`${index + 1}-${"가".repeat(218)}`),
        ),
        oneLineSummary: publicEvidence("요".repeat(120)),
    }),
    hasCode("CONTENT_INVALID_STRUCTURE"),
  );
  assert.throws(
    () =>
      parseConversationContentNoteV4({
        ...valid,
        topics: [
          {
            ...valid.topics[0],
            summary: publicEvidence(
              "환경 변화마다 전체 정책을 재학습하면 운영 비용이 매우 커진다.",
            ),
          },
        ],
      }),
    hasCode("CONTENT_INVALID_STRUCTURE"),
  );
  assert.throws(
    () =>
      parseConversationContentNoteV4({
        ...valid,
        topics: [
          {
            ...valid.topics[0],
            summary: valid.keyTakeaways[0],
          },
        ],
      }),
    hasCode("CONTENT_INVALID_STRUCTURE"),
  );

  const richDetails = Array.from({ length: 6 }, (_, index) => ({
    ...publicEvidenceWithQuote(
      `${index + 1}번째 상세 설명은 ${["이론", "변수", "비교", "방법", "검증", "위험"][index]} 관점의 고유한 조건을 보존한다. ${["가", "나", "다", "라", "마", "바"][index].repeat(190)}`,
      `${index + 1}번째 상세 설명의 원문 근거`,
    ),
    kind: index % 2 ? "rationale" : "explanation",
  }));
  const rich = parseConversationContentNoteV4({
    ...valid,
    topics: [{ ...valid.topics[0], details: richDetails }],
  });
  assert.equal(rich.topics[0].details.length, 6);
  assert.ok(rich.topics[0].details[0].text.length > 220);
});

test("retries assistant-only adoption language as an unconfirmed proposal", async () => {
  const messages = [
    { id: "u1", role: "user", text: "개인 데이터 연구 방향으로 어떤 접근이 좋을까?" },
    {
      id: "a1",
      role: "assistant",
      text: "배타적 소유권보다 권리 묶음 접근을 사용하는 방안을 제안합니다.",
    },
  ];
  let contentCalls = 0;
  const fetchImpl = async (_url, init) => {
    const { body, prompt } = requestPayload(init);
    const user = evidenceId(prompt, "u1", "어떤 접근이 좋을까");
    const assistant = evidenceId(prompt, "a1", "방안을 제안합니다");
    if (body.system_instruction.includes("content planner")) {
      contentCalls += 1;
      const corrected = String(body.input).startsWith("CORRECTION:");
      return geminiResponse({
        conversationType: "research",
        title: evidenceText("개인 데이터 연구 방향", user),
        oneLineSummary: corrected
          ? evidenceText("권리 묶음 접근이 연구 대안으로 제안됐다.", assistant)
          : {
              text: "권리 묶음 접근을 연구 방향으로 채택함.",
              evidence: [{ evidenceId: user }, { evidenceId: assistant }],
            },
        keyTakeaways: [
          evidenceText("배타적 소유권의 한계를 검토했다.", user),
          evidenceText("권리 묶음은 실질적 통제권을 다루는 대안이다.", assistant),
          evidenceText("이 접근은 아직 사용자에게 확정되지 않았다.", assistant),
        ],
        topics: [
          {
            title: evidenceText("권리 묶음 대안", assistant),
            summary: evidenceText("권리 묶음 관점이 연구 방향으로 제안됐다.", assistant),
            details: [],
          },
        ],
        conclusions: [],
      });
    }
    return geminiResponse({
      events: [
        {
          kind: "proposal_made",
          key: "rights-bundle",
          text: "권리 묶음 접근을 연구 방향으로 제안한다.",
          ...NULL_EVENT_FIELDS,
          proposedBy: "assistant",
          evidence: [{ evidenceId: assistant }],
        },
      ],
    });
  };

  const note = await createGeminiConversationContentNote(
    { messages },
    { apiKey: "key", fetchImpl },
  );
  assert.equal(contentCalls, 2);
  assert.match(note.oneLineSummary.text, /제안됐다/);
  assert.equal(note.confirmedDecisions.length, 0);
});

test("keeps decision-only research state out of the quick-read status box", async () => {
  const messages = [
    { id: "u1", role: "user", text: "발음하기 쉬운 신조어형 서비스명을 원해." },
    { id: "a1", role: "assistant", text: "Nuvin은 짧고 발음하기 쉬운 후보입니다." },
    { id: "u2", role: "user", text: "Nuvin으로 해야겠다." },
  ];
  const fetchImpl = async (_url, init) => {
    const { body, prompt } = requestPayload(init);
    const preference = evidenceId(prompt, "u1", "발음하기 쉬운");
    const proposal = evidenceId(prompt, "a1", "Nuvin은");
    const decision = evidenceId(prompt, "u2", "Nuvin으로 해야겠다");
    if (body.system_instruction.includes("content planner")) {
      return geminiResponse({
        conversationType: "decision",
        title: evidenceText("서비스명 Nuvin 선택", decision),
        oneLineSummary: evidenceText("발음하기 쉬운 서비스명으로 Nuvin을 선택했다.", decision),
        keyTakeaways: [
          evidenceText("사용자는 발음하기 쉬운 신조어를 원했다.", preference),
          evidenceText("Nuvin이 짧고 발음하기 쉬운 후보로 제안됐다.", proposal),
          evidenceText("사용자가 최종적으로 Nuvin을 선택했다.", decision),
        ],
        topics: [
          {
            title: evidenceText("이름 선택", decision),
            summary: evidenceText("선호 조건을 반영해 Nuvin으로 이름을 정했다.", decision),
            details: [],
          },
        ],
        conclusions: [],
      });
    }
    return geminiResponse({
      events: [
        {
          kind: "decision_set",
          key: "service-name",
          text: "서비스명을 Nuvin으로 정한다.",
          ...NULL_EVENT_FIELDS,
          evidence: [{ evidenceId: decision }],
        },
      ],
    });
  };

  const note = await createGeminiConversationContentNote(
    { messages },
    { apiKey: "key", fetchImpl },
  );
  assert.equal(note.confirmedDecisions.length, 1);
  assert.equal(note.supportingInfo.currentState, null);
});

test("assigns an extended body budget to a long research conversation", async () => {
  const messages = [
    {
      id: "u1",
      role: "user",
      text: `${Array.from(
        { length: 60 },
        (_, index) =>
          `연구 쟁점 ${index + 1}은 서로 다른 이론 변수 ${index + 1}과 검증 조건 ${index + 1}을 비교한다.`,
      ).join(" ")} 최종 연구 방향을 정리해줘.`,
    },
  ];
  let observedExtendedBudget = false;
  const fetchImpl = async (_url, init) => {
    const { body, prompt } = requestPayload(init);
    if (!body.system_instruction.includes("content planner")) {
      const tailEvidence = prompt.evidenceCatalog.find((item) =>
        item.quote.includes("최종 연구 방향을 정리해줘"),
      );
      if (tailEvidence) {
        return geminiResponse({
          events: [
            {
              kind: "goal_opened",
              key: "research-direction",
              text: "최종 연구 방향을 정리한다.",
              ...NULL_EVENT_FIELDS,
              evidence: [{ evidenceId: tailEvidence.evidenceId }],
            },
          ],
        });
      }
      return geminiResponse({ events: [] });
    }
    assert.equal(prompt.contentBudget.profile, "extended");
    assert.equal(prompt.contentBudget.targetPrimaryMaxChars, 8_000);
    assert.equal(prompt.contentBudget.maxDetailsPerTopic, 7);
    observedExtendedBudget = true;
    const tail = evidenceId(prompt, "u1", "최종 연구 방향을 정리해줘");
    return geminiResponse({
      conversationType: "research",
      title: evidenceText("장기 연구 대화 정리", tail),
      oneLineSummary: evidenceText("긴 연구 대화에는 확장된 본문 예산을 적용한다.", tail),
      keyTakeaways: [
        evidenceText("연구 배경을 충분히 보존한다.", tail),
        evidenceText("설계 조건을 주제별 본문에 남긴다.", tail),
        evidenceText("상단 요약은 계속 짧게 유지한다.", tail),
      ],
      topics: [
        {
          title: evidenceText("확장 요약", tail),
          summary: evidenceText("대화 길이에 맞춰 주제별 설명 공간을 늘린다.", tail),
          details: [
            {
              kind: "principle",
              text: "서로 다른 이론 변수를 하나의 결론으로 뭉개지 않고 구분한다.",
              evidence: [{ evidenceId: tail }],
            },
            {
              kind: "comparison",
              text: "각 연구 쟁점의 비교 조건을 주제별 설명에 유지한다.",
              evidence: [{ evidenceId: tail }],
            },
            {
              kind: "verification",
              text: "검증 조건과 평가 관점을 다음 연구에서 다시 사용할 수 있게 보존한다.",
              evidence: [{ evidenceId: tail }],
            },
            {
              kind: "risk",
              text: "상단 압축이 본문의 설계 정보를 제거하지 않도록 별도 예산을 적용한다.",
              evidence: [{ evidenceId: tail }],
            },
          ],
        },
      ],
      conclusions: [],
    });
  };

  await createGeminiConversationContentNote(
    { messages },
    { apiKey: "key", fetchImpl },
  );
  assert.equal(observedExtendedBudget, true);
});

test("does not assign an extended budget to repetitive volume", async () => {
  const messages = [
    {
      id: "u1",
      role: "user",
      text: `${"같은 설명을 반복한다 ".repeat(1_600)} 마지막 요청을 정리해줘.`,
    },
  ];
  let observedCompactBudget = false;
  const fetchImpl = async (_url, init) => {
    const { body, prompt } = requestPayload(init);
    if (!body.system_instruction.includes("content planner")) {
      const tailEvidence = prompt.evidenceCatalog.find((item) =>
        item.quote.includes("마지막 요청을 정리해줘"),
      );
      return geminiResponse({
        events: tailEvidence
          ? [
              {
                kind: "goal_opened",
                key: "repeat-summary",
                text: "반복 입력의 마지막 요청을 정리한다.",
                ...NULL_EVENT_FIELDS,
                evidence: [{ evidenceId: tailEvidence.evidenceId }],
              },
            ]
          : [],
      });
    }
    assert.equal(prompt.contentBudget.profile, "compact");
    observedCompactBudget = true;
    const tail = evidenceId(prompt, "u1", "마지막 요청을 정리해줘");
    return geminiResponse({
      conversationType: "learning",
      title: evidenceText("반복 입력 압축", tail),
      oneLineSummary: evidenceText("반복된 분량은 상세도 신호로 사용하지 않는다.", tail),
      keyTakeaways: [
        evidenceText("동일한 설명은 하나의 정보 단위로 취급한다.", tail),
        evidenceText("실제 정보 다양성을 기준으로 예산을 정한다.", tail),
        evidenceText("짧은 핵심 요청은 compact 구조로 정리한다.", tail),
      ],
      topics: [
        {
          title: evidenceText("정보 다양성", tail),
          summary: evidenceText("글자 수보다 서로 다른 정보 단위를 우선한다.", tail),
          details: [],
        },
      ],
      conclusions: [],
    });
  };

  await createGeminiConversationContentNote(
    { messages },
    { apiKey: "key", fetchImpl },
  );
  assert.equal(observedCompactBudget, true);
});

test("maps malformed output and provider failures without leaking credentials", async () => {
  const input = {
    messages: [{ id: "u1", role: "user", text: "내용을 정리해줘." }],
  };
  for (const fixture of [
    {
      response: new Response(
        JSON.stringify({ status: "completed", output_text: "{" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
      code: "CONTENT_INVALID_JSON",
    },
    { response: new Response("rate", { status: 429 }), code: "CONTENT_RATE_LIMITED" },
  ]) {
    await assert.rejects(
      createGeminiConversationContentNote(input, {
        apiKey: "never-print-this",
        fetchImpl: async (_url, init) => {
          const body = JSON.parse(String(init.body));
          if (body.system_instruction.includes("content planner")) {
            return fixture.response;
          }
          return geminiResponse({ events: [] });
        },
      }),
      (error) => {
        assert.ok(error instanceof ContentNoteGenerationError);
        assert.equal(error.code, fixture.code);
        assert.doesNotMatch(error.message, /never-print-this/);
        return true;
      },
    );
  }
});

test("maps a content-planner timeout without leaking the server key", async () => {
  await assert.rejects(
    createGeminiConversationContentNote(
      {
        messages: [
          { id: "u1", role: "user", text: "대화의 핵심 내용을 정리해줘." },
        ],
      },
      {
        apiKey: "never-print-this",
        timeoutMs: 1,
        fetchImpl: async (_url, init) => {
          const { body, prompt } = requestPayload(init);
          if (body.system_instruction.includes("content planner")) {
            return new Promise((_resolve, reject) => {
              init.signal.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              );
            });
          }
          const user = evidenceId(prompt, "u1", "핵심 내용을 정리해줘");
          return geminiResponse({
            events: [
              {
                kind: "goal_opened",
                key: "organize-conversation",
                text: "대화의 핵심 내용을 정리한다.",
                ...NULL_EVENT_FIELDS,
                evidence: [{ evidenceId: user }],
              },
            ],
          });
        },
      },
    ),
    (error) => {
      assert.ok(error instanceof ContentNoteGenerationError);
      assert.equal(error.code, "CONTENT_PROVIDER_TIMEOUT");
      assert.doesNotMatch(error.message, /never-print-this/);
      return true;
    },
  );
});

function hasCode(code) {
  return (error) =>
    error instanceof ContentNoteGenerationError && error.code === code;
}
