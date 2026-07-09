import { describe, expect, it } from "vitest";

import { extractMockStructure } from "../../src/core/extractors/mockStructureExtractor";
import type {
  CanonicalConversation,
  CanonicalMessage
} from "../../src/core/types/conversation";

describe("extractMockStructure", () => {
  it("extracts Sprint 3A board items and preferences from clean user messages", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "PDF 업로드는 추후 기능으로 빼자."),
      cleanMessage(2, "assistant", "좋습니다. 링크 기반으로 먼저 가겠습니다."),
      cleanMessage(3, "user", "오케이. 이제 MockExtractor 규칙을 구체적으로 만들어줘."),
      contextSignal(4, "assistant", "{\"system1_search_query\":[{\"q\":\"mock extractor\"}]}"),
      internalMessage(5, "assistant", "[thoughts 첨부: v0.1에서는 분석 제외]")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.board.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "deferred",
          evidenceMessageIndexes: [1]
        })
      ])
    );
    expect(result.board.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "user_requested",
          evidenceMessageIndexes: [3]
        })
      ])
    );
    expect(result.preferenceSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "avoidance",
          evidenceMessageIndexes: [1]
        }),
        expect.objectContaining({
          category: "specificity_depth",
          evidenceMessageIndexes: [3]
        })
      ])
    );
    expect(result.diagnostics.contextSignalCount).toBe(1);
    expect(result.diagnostics.excludedInternalCount).toBe(1);
  });

  it("pairs assistant answers with the next user reaction for satisfaction", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "규칙을 제안해줘."),
      cleanMessage(2, "assistant", "규칙 초안을 제안했습니다."),
      cleanMessage(3, "user", "좋은데, 예시를 조금 더 추가해줘.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.satisfactionSignals).toEqual([
      expect.objectContaining({
        assistantMessageIndex: 2,
        userReactionMessageIndex: 3,
        status: "correction_requested",
        secondaryStatuses: expect.arrayContaining(["partially_satisfied"]),
        evidenceMessageIndexes: [2, 3]
      })
    ]);
  });

  it("keeps example-like rule specs out of semantic preference and decision extraction", () => {
    const conversation = createConversation([
      cleanMessage(
        1,
        "user",
        "예: “이걸로 하자”, “PDF는 빼자” 같은 문장. 이 룰 스펙 문서를 만들어줘."
      )
    ]);

    const result = extractMockStructure(conversation);

    expect(result.board.decisions).toEqual([]);
    expect(result.preferenceSignals).toEqual([]);
    expect(result.board.openQuestions).toEqual([]);
    expect(result.board.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "user_requested",
          evidenceMessageIndexes: [1]
        })
      ])
    );
    expect(result.diagnostics.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "EXAMPLE_TEXT_DETECTED",
          messageIndexes: [1]
        })
      ])
    );
  });

  it("pairs only the last assistant chunk before a user reaction", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "규칙을 제안해줘."),
      cleanMessage(2, "assistant", "중간 진행 상황입니다."),
      cleanMessage(3, "assistant", "최종 규칙 초안입니다."),
      cleanMessage(4, "user", "좋아.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.satisfactionSignals).toEqual([
      expect.objectContaining({
        assistantMessageIndex: 3,
        userReactionMessageIndex: 4,
        status: "satisfied",
        evidenceMessageIndexes: [3, 4]
      })
    ]);
  });

  it("treats pure topic transitions as continuing rather than correction", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "기획안을 정리해줘."),
      cleanMessage(2, "assistant", "기획안을 정리했습니다."),
      cleanMessage(3, "user", "그럼 이제 개발 얘기를 해보자.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.satisfactionSignals).toEqual([
      expect.objectContaining({
        assistantMessageIndex: 2,
        userReactionMessageIndex: 3,
        status: "continuing_without_clear_feedback",
        rulesMatched: []
      })
    ]);
  });

  it("marks repeated preferences as reinforced without counting adjacent duplicates", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "PDF 업로드는 일단 추후 기능으로 빼자."),
      cleanMessage(2, "user", "PDF 업로드는 일단 추후 기능으로 빼자."),
      cleanMessage(3, "assistant", "PDF는 후순위로 두겠습니다."),
      cleanMessage(4, "user", "다시 말하지만 PDF 업로드는 추후 기능으로 두자.")
    ]);

    const result = extractMockStructure(conversation);
    const pdfAvoidance = result.preferenceSignals.find(
      (signal) =>
        signal.category === "avoidance" &&
        signal.evidenceMessageIndexes.includes(1)
    );

    expect(pdfAvoidance).toMatchObject({
      reinforced: true,
      evidenceMessageIndexes: [1, 4]
    });
    expect(result.diagnostics.duplicateMessageIndexes).toEqual([2]);
    expect(result.diagnostics.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DUPLICATE_MESSAGE_SKIPPED",
          messageIndexes: [2]
        })
      ])
    );
  });

  it("marks open questions as superseded when a later scope decision removes the topic", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "PDF 업로드는 어떻게 처리해야 할까?"),
      cleanMessage(2, "assistant", "후순위로 둘 수 있습니다."),
      cleanMessage(3, "user", "PDF 업로드는 추후 기능으로 빼자.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.board.openQuestions[0]).toMatchObject({
      status: "superseded_by_scope_change",
      resolvedBy: {
        type: "superseded_by_scope_change",
        decisionId: result.board.decisions[0]?.id
      },
      resolvedByDecisionId: result.board.decisions[0]?.id
    });
    expect(result.board.decisions[0]).toMatchObject({
      status: "deferred"
    });
  });

  it("marks open questions as answered when the assistant replies before a decision", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "이 방식이 가능할까?"),
      cleanMessage(2, "assistant", "가능합니다. 공유 링크 HTML에서 대화 내용을 복원할 수 있습니다.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.board.openQuestions[0]).toMatchObject({
      status: "answered",
      resolvedBy: {
        type: "assistant_answer",
        messageIndex: 2
      }
    });
  });

  it("marks open questions as resolved by a later user decision", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "PDF보다 링크가 더 편하려나?"),
      cleanMessage(2, "assistant", "링크 방식이 더 단순합니다."),
      cleanMessage(3, "user", "링크로만 대화 내용 파악하는 걸 기술로 잡자.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.board.openQuestions[0]).toMatchObject({
      status: "resolved_by_user_decision",
      resolvedBy: {
        type: "user_decision",
        decisionId: result.board.decisions[0]?.id
      },
      resolvedByDecisionId: result.board.decisions[0]?.id
    });
  });

  it("splits composite decision messages into separate decision items", () => {
    const conversation = createConversation([
      cleanMessage(
        1,
        "user",
        "PDF 업로드는 추후 기능으로 빼고, 링크로만 대화 내용 파악하는 걸 기술로 잡자."
      )
    ]);

    const result = extractMockStructure(conversation);

    expect(result.board.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "deferred",
          description: "PDF 업로드는 추후 기능으로 빼고",
          triggerPhrase: "PDF 업로드는 추후 기능으로 빼고",
          evidenceMessageIndexes: [1]
        }),
        expect.objectContaining({
          status: "confirmed",
          description: "링크로만 대화 내용 파악하는 걸 기술로 잡자",
          triggerPhrase: "링크로만 대화 내용 파악하는 걸 기술로 잡자",
          evidenceMessageIndexes: [1]
        })
      ])
    );
    expect(result.board.decisions).toHaveLength(2);
  });

  it("keeps imperative action requests out of open questions", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "어떻게 작업하면 될지 정리해줘.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.board.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "user_requested",
          description: "어떻게 작업하면 될지 정리해줘",
          triggerPhrase: "어떻게 작업하면 될지 정리해줘"
        })
      ])
    );
    expect(result.board.openQuestions).toEqual([]);
  });

  it("creates candidate decisions for assistant-only suggestions", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "PDF 기능은 어떻게 가는 게 좋을까?"),
      cleanMessage(2, "assistant", "PDF 업로드는 후순위로 두는 것이 좋겠습니다.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.board.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "candidate",
          source: "assistant_suggestion",
          triggerPhrase: "PDF 업로드는 후순위로 두는 것이 좋겠습니다",
          evidenceMessageIndexes: [2],
          confidence: 0.55,
          reviewRequired: true,
          reviewRequiredReason: "candidate_decision",
          includeInMainBoard: false,
          includeInKeyDecisionIds: false
        })
      ])
    );
  });

  it("marks explicit high-confidence decisions for main board and key decision ids", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "링크로만 대화 내용 파악하는 걸 기술로 잡자.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.board.decisions[0]).toMatchObject({
      status: "confirmed",
      source: "explicit_user",
      reviewRequired: false,
      includeInMainBoard: true,
      includeInKeyDecisionIds: true
    });
    expect(result.overview.keyDecisionIds).toContain(result.board.decisions[0]?.id);
  });

  it("turns accepted assistant suggestions into confirmed decisions without creating acceptance actions", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "PDF 기능은 어떻게 가는 게 좋을까?"),
      cleanMessage(2, "assistant", "PDF 업로드는 후순위로 두는 것이 좋겠습니다."),
      cleanMessage(3, "user", "그래 그렇게 해보자.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.board.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "confirmed",
          source: "assistant_suggestion_accepted",
          evidenceMessageIndexes: [2, 3],
          confidence: 0.85
        })
      ])
    );
    expect(result.board.actions).toEqual([]);
  });

  it("classifies direct user commands as user requested actions", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "figma 화면 설계 진행해봐."),
      cleanMessage(2, "user", "연결됐는지 확인해봐."),
      cleanMessage(3, "user", "codex implementation plan.md 파일 만들자.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.board.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "user_requested",
          assignee: "assistant",
          evidenceMessageIndexes: [1]
        }),
        expect.objectContaining({
          actionType: "user_requested",
          assignee: "assistant",
          evidenceMessageIndexes: [2]
        }),
        expect.objectContaining({
          actionType: "user_requested",
          assignee: "assistant",
          evidenceMessageIndexes: [3]
        })
      ])
    );
    expect(result.board.actions.every((action) => action.actionType === "user_requested")).toBe(true);
  });

  it("classifies task failure and direction change reactions before clarification", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "html 파일 만들어줘."),
      cleanMessage(2, "assistant", "HTML 파일을 만들었습니다."),
      cleanMessage(3, "user", "뭐하냐 왜 못만드냐"),
      cleanMessage(4, "assistant", "다시 확인하겠습니다."),
      cleanMessage(5, "user", "실제 웹으로 더 개발하는게 나을 수도 있겠다.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.satisfactionSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assistantMessageIndex: 2,
          userReactionMessageIndex: 3,
          status: "task_failed"
        }),
        expect.objectContaining({
          assistantMessageIndex: 4,
          userReactionMessageIndex: 5,
          status: "direction_changed"
        })
      ])
    );
  });

  it("marks multi-status satisfaction signals for review", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "기획안을 만들어줘."),
      cleanMessage(2, "assistant", "기획안을 만들었습니다."),
      cleanMessage(3, "user", "좋은데, 아니 다시 수정해서 추가해줘.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.satisfactionSignals[0]).toMatchObject({
      status: "correction_requested",
      reviewRequired: true,
      reviewRequiredReason: "multi_status_satisfaction",
      includeInMainBoard: false
    });
  });

  it("stores short trigger quotes instead of full source messages", () => {
    const conversation = createConversation([
      cleanMessage(
        1,
        "user",
        "좋아. 전체 방향은 유지하자. PDF 업로드는 추후 기능으로 빼고, 지금은 링크 기반으로 진행하자."
      )
    ]);

    const result = extractMockStructure(conversation);

    expect(result.board.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "deferred",
          description: "PDF 업로드는 추후 기능으로 빼고"
        }),
        expect.objectContaining({
          status: "confirmed",
          description: "지금은 링크 기반으로 진행하자"
        })
      ])
    );
    expect(
      result.board.decisions.every((decision) => decision.description.length < 60)
    ).toBe(true);
  });

  it("creates more specific topic flow labels and change reasons", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "ChatGPT 공유 링크 분석 구조를 설명해줘."),
      cleanMessage(2, "assistant", "공유 링크 분석 구조를 설명했습니다."),
      cleanMessage(3, "user", "PDF 업로드는 추후 기능으로 빼자."),
      cleanMessage(4, "assistant", "범위를 링크 기반으로 좁히겠습니다."),
      cleanMessage(5, "user", "이제 MockExtractor 구현을 시작하자."),
      cleanMessage(6, "assistant", "구현을 시작하겠습니다."),
      cleanMessage(7, "user", "Sprint 3 문서를 .md 파일로 정리해줘.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.topicFlow.map((topic) => topic.changeReason)).toEqual([
      "new_user_question",
      "scope_changed",
      "implementation_phase_started",
      "artifact_requested"
    ]);
    expect(result.topicFlow.map((topic) => topic.label)).toEqual([
      "공유 링크 분석",
      "PDF 업로드 결정",
      "MockExtractor 구현",
      "Sprint 3 문서화"
    ]);
  });

  it("skips duplicate and short reaction messages when building topic flow", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "공유 링크 파싱 방식 검토해줘."),
      cleanMessage(2, "user", "공유 링크 파싱 방식 검토해줘."),
      cleanMessage(3, "assistant", "파싱 방식을 설명했습니다."),
      cleanMessage(4, "user", "좋아."),
      cleanMessage(5, "user", "다시 기획안 최종본을 만들어줘.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.topicFlow.map((topic) => topic.startMessageIndex)).toEqual([
      1, 5
    ]);
    expect(result.topicFlow.map((topic) => topic.label)).toEqual([
      "공유 링크 파싱 방식 검토",
      "기획안 재작성"
    ]);
    expect(result.topicFlow[0]?.mergedMessageIndexes).toEqual([2]);
    expect(result.diagnostics.duplicateMessageIndexes).toEqual([2]);
  });

  it("connects context signals to topics without creating semantic decisions", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "최신 OpenAI 모델 정보를 찾아서 정리해줘."),
      contextSignal(
        2,
        "assistant",
        JSON.stringify({ system1_search_query: [{ q: "OpenAI models" }] }),
        "search_query"
      ),
      contextSignal(
        3,
        "assistant",
        JSON.stringify({ open: [{ ref_id: "turn0search0" }] }),
        "opened_source"
      ),
      cleanMessage(4, "assistant", "공식 문서를 확인해 정리했습니다."),
      cleanMessage(5, "user", "좋아.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.topicFlow[0]).toMatchObject({
      contextSignalRefs: ["search_query:2", "opened_source:3"],
      contextSummary: {
        externalResearch: true,
        sourceBacked: true,
        signalCount: 2,
        signalTypes: ["search_query", "opened_source"],
        citationCount: 0
      }
    });
    expect(result.diagnostics.contextSignalTypeCounts).toEqual({
      search_query: 1,
      opened_source: 1
    });
    expect(result.diagnostics.sourceBackedTopicCount).toBe(1);
    expect(result.board.decisions).toEqual([]);
    expect(result.preferenceSignals).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceMessageIndexes: expect.arrayContaining([2, 3])
        })
      ])
    );
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "context_signal",
          contextSignalRefs: ["search_query:2"],
          evidenceMessageIndexes: []
        })
      ])
    );
  });

  it("keeps overview focused on product intent when the latest user message is meta", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "ChatGPT 공유 링크로 대화 내용을 분석하는 서비스를 만들고 싶어."),
      cleanMessage(2, "assistant", "공유 링크 기반 분석 방향을 정리했습니다."),
      cleanMessage(3, "user", "링크로만 대화 내용 파악하는 걸 기술로 잡자."),
      cleanMessage(4, "assistant", "링크 기반 v0.1 방향으로 정리했습니다."),
      cleanMessage(5, "user", "이거 gpt한테 물어볼 프롬프트 만들어줘.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.overview.mainSubject).toContain("링크로만 대화 내용");
    expect(result.overview.userCoreIntent).toContain("ChatGPT 공유 링크");
    expect(result.overview.userCoreIntent).not.toContain("프롬프트 만들어줘");
    expect(result.overviewSourceCandidates.latestMetaRequest).toMatchObject({
      messageIndex: 5,
      weight: 0.05
    });
    expect(result.overviewSourceCandidates.excludedMetaMessageIndexes).toContain(5);
  });

  it("uses recurring non-meta topic labels as overview candidates", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "공유 링크 파싱 방식 검토해줘."),
      cleanMessage(2, "assistant", "파싱 방식을 설명했습니다."),
      cleanMessage(3, "user", "PDF 업로드는 추후 기능으로 빼자."),
      cleanMessage(4, "assistant", "PDF는 후순위로 두겠습니다."),
      cleanMessage(5, "user", "공유 링크 파싱 방식 다시 검토해줘.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.overviewSourceCandidates.recurringTopicLabels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "공유 링크 파싱 방식 검토",
          count: 2,
          weight: 0.2
        })
      ])
    );
  });

  it("excludes review-required satisfaction signals from overview satisfaction summary", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "기획안을 만들어줘."),
      cleanMessage(2, "assistant", "기획안을 만들었습니다."),
      cleanMessage(3, "user", "좋은데, 아니 다시 수정해서 추가해줘.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.satisfactionSignals[0]?.reviewRequired).toBe(true);
    expect(result.overview.satisfactionSummary).toBe(
      "명시적 만족도 신호가 부족해 보수적으로 판단했다."
    );
  });

  it("separates content constraints from actions and format preferences by clause", () => {
    const conversation = createConversation([
      cleanMessage(
        1,
        "user",
        "외국인 포인트 넣고, 이 포인트들 반영해서, 기획안 다시 만들어줘, 노션에 넣을 수 있는 md파일로 만들어줘."
      )
    ]);

    const result = extractMockStructure(conversation);

    expect(result.contentConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraintType: "domain_point",
          triggerPhrase: "외국인 포인트 넣고",
          reviewRequired: false,
          includeInMainBoard: true
        }),
        expect.objectContaining({
          constraintType: "source_material",
          triggerPhrase: "이 포인트들 반영해서",
          reviewRequired: false,
          includeInMainBoard: true
        })
      ])
    );
    expect(result.board.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "user_requested",
          triggerPhrase: "기획안 다시 만들어줘"
        })
      ])
    );
    expect(result.preferenceSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "format",
          triggerPhrase: "노션에 넣을 수 있는 md파일로 만들어줘"
        })
      ])
    );
    expect(result.preferenceSignals).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          triggerPhrase: "외국인 포인트 넣고"
        })
      ])
    );
  });

  it("extracts content constraints with review metadata", () => {
    const conversation = createConversation([
      cleanMessage(1, "user", "외국인 사용자 사례를 포함해서 정리해줘.")
    ]);

    const result = extractMockStructure(conversation);

    expect(result.contentConstraints[0]).toMatchObject({
      constraintType: "include_content",
      triggerPhrase: "외국인 사용자 사례를 포함해서 정리해줘",
      reviewRequired: false,
      includeInMainBoard: true,
      evidenceMessageIndexes: [1]
    });
  });
});

function createConversation(messages: CanonicalMessage[]): CanonicalConversation {
  return {
    id: "conv_test",
    source: {
      type: "chatgpt_share_link",
      originalUrl: "https://chatgpt.com/share/test",
      normalizedUrl: "https://chatgpt.com/share/test",
      shareId: "test",
      adapterName: "ChatGPTShareAdapter",
      adapterVersion: "0.1.0",
      fetchedAt: "2026-07-08T00:00:00.000Z"
    },
    title: "테스트 대화",
    language: "ko",
    importedAt: "2026-07-08T00:00:00.000Z",
    messages,
    stats: {
      totalMessages: messages.length,
      userMessages: messages.filter((message) => message.role === "user").length,
      assistantMessages: messages.filter(
        (message) => message.role === "assistant"
      ).length,
      unsupportedMessages: 0,
      cleanConversationMessages: messages.filter(
        (message) => message.metadata.messageCategory === "clean_conversation"
      ).length,
      contextSignalMessages: messages.filter(
        (message) => message.metadata.messageCategory === "context_signal"
      ).length,
      excludedInternalMessages: messages.filter(
        (message) => message.metadata.messageCategory === "excluded_internal"
      ).length,
      totalChars: messages.reduce((sum, message) => sum + message.text.length, 0)
    },
    warnings: []
  };
}

function cleanMessage(
  index: number,
  role: "user" | "assistant",
  text: string
): CanonicalMessage {
  return message(index, role, text, "clean_conversation");
}

function contextSignal(
  index: number,
  role: "user" | "assistant",
  text: string,
  contextSignalType: CanonicalMessage["metadata"]["contextSignalType"] = "search_query"
): CanonicalMessage {
  return {
    ...message(index, role, text, "context_signal"),
    metadata: {
      messageCategory: "context_signal",
      contextSignalType
    }
  };
}

function internalMessage(
  index: number,
  role: "user" | "assistant",
  text: string
): CanonicalMessage {
  return {
    ...message(index, role, text, "excluded_internal"),
    metadata: {
      messageCategory: "excluded_internal",
      internalContentType: "thoughts"
    }
  };
}

function message(
  index: number,
  role: "user" | "assistant",
  text: string,
  messageCategory: CanonicalMessage["metadata"]["messageCategory"]
): CanonicalMessage {
  return {
    id: `msg_${index}`,
    index,
    role,
    text,
    blocks: [{ type: "paragraph", text }],
    sourceRef: {
      type: "chatgpt_share_payload",
      messageId: `raw_${index}`,
      messageIndex: index,
      role
    },
    metadata: {
      messageCategory
    }
  };
}
