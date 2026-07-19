import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  coreSemanticItemV1Schema,
  evidenceAnchorV1Schema,
  intentItemV1Schema,
  semanticCandidateV1Schema,
  semanticCoreSnapshotV1Schema,
  semanticEvidenceRefV1Schema,
  verificationReasonV1Schema,
  type VerificationReasonV1
} from "../../src/core/types/semanticCoreV1";

describe("Semantic Core v1 item schemas", () => {
  it("accepts a Snapshot containing all seven Core types", () => {
    expect(
      semanticCoreSnapshotV1Schema.safeParse(makeSevenTypeSnapshot()).success
    ).toBe(true);
  });

  it("rejects legacy Semantic types", () => {
    const result = coreSemanticItemV1Schema.safeParse({
      ...makeEntity("entity_1", "ev_1"),
      type: "action"
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown keys on the Snapshot, item, source, Evidence, ref, and candidate", () => {
    const snapshot = makeSnapshot(
      [makeEntity("entity_1", "ev_1")],
      [makeEvidence("ev_1", 1, "user")]
    );

    expect(
      semanticCoreSnapshotV1Schema.safeParse({
        ...snapshot,
        unexpected: true
      }).success
    ).toBe(false);
    expect(
      coreSemanticItemV1Schema.safeParse({
        ...makeEntity("entity_1", "ev_1"),
        unexpected: true
      }).success
    ).toBe(false);
    expect(
      coreSemanticItemV1Schema.safeParse({
        ...makeEntity("entity_1", "ev_1"),
        source: { ...SOURCE, unexpected: true }
      }).success
    ).toBe(false);
    expect(
      evidenceAnchorV1Schema.safeParse({
        ...makeEvidence("ev_1", 1, "user"),
        unexpected: true
      }).success
    ).toBe(false);
    expect(
      semanticEvidenceRefV1Schema.safeParse({
        evidenceId: "ev_1",
        role: "direct_support",
        unexpected: true
      }).success
    ).toBe(false);
    expect(
      semanticCandidateV1Schema.safeParse({
        candidate: {},
        validationStatus: "pending",
        supportType: "explicit",
        reviewReasons: [],
        unexpected: true
      }).success
    ).toBe(false);
  });

  it("keeps Intent explicit-only", () => {
    const result = intentItemV1Schema.safeParse({
      ...makeIntent("intent_1", "ev_1"),
      supportType: "accepted_context",
      evidenceRefs: [{ evidenceId: "ev_1", role: "proposition" }]
    });

    expect(result.success).toBe(false);
  });

  it("rejects disallowed policy values for the other six Core types", () => {
    const invalidItems = [
      { ...makeTopic("topic_1", "ev_1"), topicIds: ["topic_1"] },
      {
        ...makeConstraint("constraint_1", "ev_1"),
        constraintKind: "tone"
      },
      {
        ...makeProblem("problem_1", "ev_1"),
        supportType: "accepted_context"
      },
      { ...makeChange("change_1", "ev_1"), changeKind: "tone" },
      {
        ...makeEntity("entity_1", "ev_1"),
        supportType: "accepted_context"
      },
      { ...makeRelation("relation_1", "ev_1", "a", "b"), predicate: "MENTIONS" }
    ];

    for (const item of invalidItems) {
      expect(coreSemanticItemV1Schema.safeParse(item).success).toBe(false);
    }
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01])(
    "rejects invalid confidence %s",
    (confidence) => {
      expect(
        coreSemanticItemV1Schema.safeParse({
          ...makeEntity("entity_1", "ev_1"),
          confidence
        }).success
      ).toBe(false);
    }
  );

  it("rejects blank identifiers and labels", () => {
    expect(
      coreSemanticItemV1Schema.safeParse({
        ...makeEntity("entity_1", "ev_1"),
        id: "   "
      }).success
    ).toBe(false);
    expect(
      coreSemanticItemV1Schema.safeParse({
        ...makeEntity("entity_1", "ev_1"),
        label: "   "
      }).success
    ).toBe(false);
  });

  it("rejects inconsistent Evidence spans", () => {
    const reversed = evidenceAnchorV1Schema.safeParse({
      ...makeEvidence("ev_1", 1, "user", "근거"),
      startChar: 2,
      endChar: 1
    });
    const wrongLength = evidenceAnchorV1Schema.safeParse({
      ...makeEvidence("ev_1", 1, "user", "근거"),
      startChar: 0,
      endChar: 1
    });

    expect(customReasons(reversed)).toContain("QUOTE_SPAN_MISMATCH");
    expect(customReasons(wrongLength)).toContain("QUOTE_SPAN_MISMATCH");
  });
});

describe("Semantic Core v1 Snapshot references", () => {
  it("rejects duplicate Item IDs without reporting them as dangling", () => {
    const evidence = makeEvidence("ev_1", 1, "user");
    const result = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeEntity("entity_duplicate", "ev_1"),
          makeEntity("entity_duplicate", "ev_1"),
          makeEntity("entity_other", "ev_1"),
          makeRelation("relation_1", "ev_1", "entity_duplicate", "entity_other")
        ],
        [evidence]
      )
    );

    expect(customReasons(result)).toContain("DUPLICATE_ITEM_ID");
    expect(customReasons(result)).not.toContain("DANGLING_ENTITY_REFERENCE");
    expect(customReasons(result)).not.toContain("RELATION_ENDPOINT_MISSING");
  });

  it("rejects duplicate Evidence IDs without cascading into accepted-context errors", () => {
    const proposition = makeEvidence("ev_proposition", 1, "assistant");
    const acceptance = makeEvidence("ev_acceptance", 2, "user");
    const constraint = makeConstraint("constraint_1", "ev_proposition", {
      supportType: "accepted_context",
      evidenceRefs: [
        { evidenceId: "ev_proposition", role: "proposition" },
        { evidenceId: "ev_acceptance", role: "acceptance" }
      ]
    });
    const result = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot([constraint], [proposition, { ...proposition }, acceptance])
    );

    expect(customReasons(result)).toContain("DUPLICATE_EVIDENCE_ID");
    expect(customReasons(result)).not.toContain("INVALID_ACCEPTED_CONTEXT");
  });

  it("rejects missing and orphan Evidence", () => {
    const missing = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot([makeEntity("entity_1", "ev_missing")], [])
    );
    const orphan = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [makeEntity("entity_1", "ev_1")],
        [makeEvidence("ev_1", 1, "user"), makeEvidence("ev_orphan", 2, "user")]
      )
    );

    expectCustomIssue(missing, "MISSING_EVIDENCE", [
      "items",
      0,
      "evidenceRefs",
      0,
      "evidenceId"
    ]);
    expectCustomIssue(orphan, "ORPHAN_EVIDENCE", ["evidence", 1, "id"]);
  });

  it("rejects duplicate Evidence and Entity references within an Item", () => {
    const entity = makeEntity("entity_1", "ev_1");
    const intent = makeIntent("intent_1", "ev_2", {
      evidenceRefs: [
        { evidenceId: "ev_2", role: "direct_support" },
        { evidenceId: "ev_2", role: "direct_support" }
      ],
      targetEntityIds: ["entity_1", "entity_1"]
    });
    const result = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [entity, intent],
        [makeEvidence("ev_1", 1, "user"), makeEvidence("ev_2", 2, "user")]
      )
    );

    expect(customReasons(result)).toEqual(
      expect.arrayContaining(["DUPLICATE_EVIDENCE_REF", "DUPLICATE_REFERENCE"])
    );
  });

  it("distinguishes missing references from wrong target types", () => {
    const topic = makeTopic("topic_1", "ev_1");
    const wrongTypeIntent = makeIntent("intent_1", "ev_2", {
      targetEntityIds: ["topic_1"]
    });
    const missingIntent = makeIntent("intent_2", "ev_3", {
      targetEntityIds: ["entity_missing"]
    });
    const result = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [topic, wrongTypeIntent, missingIntent],
        [
          makeEvidence("ev_1", 1, "user"),
          makeEvidence("ev_2", 2, "user"),
          makeEvidence("ev_3", 3, "user")
        ]
      )
    );

    expectCustomIssue(result, "REFERENCE_TARGET_TYPE_MISMATCH", [
      "items",
      1,
      "targetEntityIds"
    ]);
    expectCustomIssue(result, "DANGLING_ENTITY_REFERENCE", [
      "items",
      2,
      "targetEntityIds"
    ]);
  });
});

describe("Semantic Core v1 Evidence support", () => {
  it("accepts a valid assistant proposition followed by user acceptance", () => {
    const constraint = makeConstraint("constraint_1", "ev_proposition", {
      supportType: "accepted_context",
      evidenceRefs: [
        { evidenceId: "ev_proposition", role: "proposition" },
        { evidenceId: "ev_acceptance", role: "acceptance" }
      ]
    });
    const result = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [constraint],
        [
          makeEvidence("ev_proposition", 1, "assistant"),
          makeEvidence("ev_acceptance", 2, "user")
        ]
      )
    );

    expect(result.success).toBe(true);
  });

  it("rejects incomplete, reversed, or role-mismatched accepted context", () => {
    const refs = [
      { evidenceId: "ev_proposition", role: "proposition" },
      { evidenceId: "ev_acceptance", role: "acceptance" }
    ];
    const incomplete = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeConstraint("constraint_1", "ev_proposition", {
            supportType: "accepted_context",
            evidenceRefs: [refs[0]]
          })
        ],
        [makeEvidence("ev_proposition", 1, "assistant")]
      )
    );
    const reversed = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeConstraint("constraint_1", "ev_proposition", {
            supportType: "accepted_context",
            evidenceRefs: refs
          })
        ],
        [
          makeEvidence("ev_proposition", 2, "assistant"),
          makeEvidence("ev_acceptance", 1, "user")
        ]
      )
    );
    const wrongRoles = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeConstraint("constraint_1", "ev_proposition", {
            supportType: "accepted_context",
            evidenceRefs: refs
          })
        ],
        [
          makeEvidence("ev_proposition", 1, "user"),
          makeEvidence("ev_acceptance", 2, "assistant")
        ]
      )
    );

    expect(customReasons(incomplete)).toContain("INVALID_ACCEPTED_CONTEXT");
    expect(customReasons(reversed)).toContain("INVALID_ACCEPTED_CONTEXT");
    expect(customReasons(wrongRoles)).toContain("INVALID_ACCEPTED_CONTEXT");
  });

  it("rejects non-direct Evidence on explicit Items and attribution mismatches", () => {
    const wrongRefRole = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeIntent("intent_1", "ev_1", {
            evidenceRefs: [{ evidenceId: "ev_1", role: "proposition" }]
          })
        ],
        [makeEvidence("ev_1", 1, "user")]
      )
    );
    const wrongAttribution = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [makeIntent("intent_1", "ev_1")],
        [makeEvidence("ev_1", 1, "assistant")]
      )
    );

    expectCustomIssue(wrongRefRole, "ATTRIBUTION_MISMATCH", [
      "items",
      0,
      "evidenceRefs",
      0,
      "role"
    ]);
    expectCustomIssue(wrongAttribution, "ATTRIBUTION_MISMATCH", [
      "items",
      0,
      "attribution"
    ]);
  });

  it("requires user attribution for accepted-context Relation Items", () => {
    const result = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeEntity("entity_a", "ev_entity_a"),
          makeEntity("entity_b", "ev_entity_b"),
          makeRelation("relation_1", "ev_proposition", "entity_a", "entity_b", {
            attribution: "conversation",
            supportType: "accepted_context",
            evidenceRefs: [
              { evidenceId: "ev_proposition", role: "proposition" },
              { evidenceId: "ev_acceptance", role: "acceptance" }
            ]
          })
        ],
        [
          makeEvidence("ev_entity_a", 1, "user"),
          makeEvidence("ev_entity_b", 2, "user"),
          makeEvidence("ev_proposition", 3, "assistant"),
          makeEvidence("ev_acceptance", 4, "user")
        ]
      )
    );

    expectCustomIssue(result, "ATTRIBUTION_MISMATCH", [
      "items",
      2,
      "attribution"
    ]);
  });
});

describe("Semantic Core v1 Topic graph", () => {
  it("rejects invalid Topic ranges and Evidence outside the range", () => {
    const reversedRange = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeTopic("topic_1", "ev_1", {
            startMessageIndex: 2,
            endMessageIndex: 1
          })
        ],
        [makeEvidence("ev_1", 1, "user")]
      )
    );
    const evidenceOutsideRange = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeTopic("topic_1", "ev_1", {
            startMessageIndex: 2,
            endMessageIndex: 3
          })
        ],
        [makeEvidence("ev_1", 1, "user")]
      )
    );

    expectCustomIssue(reversedRange, "TOPIC_RANGE_INVALID", [
      "items",
      0,
      "endMessageIndex"
    ]);
    expectCustomIssue(evidenceOutsideRange, "TOPIC_RANGE_INVALID", [
      "items",
      0,
      "evidenceRefs"
    ]);
  });

  it("rejects invalid main and subtopic parent combinations", () => {
    const evidence = makeEvidence("ev_1", 1, "user");
    const mainWithParent = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeTopic("topic_1", "ev_1", {
            level: "main",
            parentTopicId: "topic_2"
          }),
          makeTopic("topic_2", "ev_1")
        ],
        [evidence]
      )
    );
    const subtopicWithoutParent = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeTopic("topic_1", "ev_1", {
            level: "subtopic",
            parentTopicId: null
          })
        ],
        [evidence]
      )
    );

    expectCustomIssue(mainWithParent, "DANGLING_TOPIC_REFERENCE", [
      "items",
      0,
      "parentTopicId"
    ]);
    expectCustomIssue(subtopicWithoutParent, "DANGLING_TOPIC_REFERENCE", [
      "items",
      0,
      "parentTopicId"
    ]);
  });

  it("detects Topic cycles at the edge that closes the cycle", () => {
    const topics = [
      makeTopic("topic_d", "ev_1", {
        level: "subtopic",
        parentTopicId: "topic_a"
      }),
      makeTopic("topic_a", "ev_1", {
        level: "subtopic",
        parentTopicId: "topic_b"
      }),
      makeTopic("topic_b", "ev_1", {
        level: "subtopic",
        parentTopicId: "topic_a"
      })
    ];
    const result = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(topics, [makeEvidence("ev_1", 1, "user")])
    );

    expectCustomIssue(result, "REFERENCE_CYCLE", ["items", 2, "parentTopicId"]);
  });

  it("rejects a Topic that is its own parent", () => {
    const result = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeTopic("topic_1", "ev_1", {
            level: "subtopic",
            parentTopicId: "topic_1"
          })
        ],
        [makeEvidence("ev_1", 1, "user")]
      )
    );

    expectCustomIssue(result, "REFERENCE_CYCLE", ["items", 0, "parentTopicId"]);
  });
});

describe("Semantic Core v1 Change and Relation invariants", () => {
  it("rejects a Change Event whose normalized before and after states are equal", () => {
    const result = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeChange("change_1", "ev_1", {
            before: " Gemini   API ",
            after: "gemini api"
          })
        ],
        [makeEvidence("ev_1", 1, "user")]
      )
    );

    expectCustomIssue(result, "CHANGE_STATE_UNCHANGED", ["items", 0, "after"]);
  });

  it("rejects missing, wrong-type, and self-referencing Relation endpoints", () => {
    const missing = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeEntity("entity_1", "ev_1"),
          makeRelation("relation_1", "ev_2", "entity_1", "entity_missing")
        ],
        [makeEvidence("ev_1", 1, "user"), makeEvidence("ev_2", 2, "user")]
      )
    );
    const selfEdge = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeEntity("entity_1", "ev_1"),
          makeRelation("relation_1", "ev_2", "entity_1", "entity_1")
        ],
        [makeEvidence("ev_1", 1, "user"), makeEvidence("ev_2", 2, "user")]
      )
    );
    const wrongType = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeTopic("topic_1", "ev_1"),
          makeEntity("entity_1", "ev_2"),
          makeRelation("relation_1", "ev_3", "topic_1", "entity_1")
        ],
        [
          makeEvidence("ev_1", 1, "user"),
          makeEvidence("ev_2", 2, "user"),
          makeEvidence("ev_3", 3, "user")
        ]
      )
    );

    expectCustomIssue(missing, "RELATION_ENDPOINT_MISSING", [
      "items",
      1,
      "targetEntityId"
    ]);
    expectCustomIssue(selfEdge, "RELATION_SELF_EDGE", [
      "items",
      1,
      "targetEntityId"
    ]);
    expectCustomIssue(wrongType, "REFERENCE_TARGET_TYPE_MISMATCH", [
      "items",
      2,
      "sourceEntityId"
    ]);
  });

  it("accepts and enforces canonical ordering for ALTERNATIVE_TO", () => {
    const invalid = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeEntity("entity_z", "ev_1"),
          makeEntity("entity_a", "ev_2"),
          makeRelation("relation_1", "ev_3", "entity_z", "entity_a", {
            predicate: "ALTERNATIVE_TO"
          })
        ],
        [
          makeEvidence("ev_1", 1, "user"),
          makeEvidence("ev_2", 2, "user"),
          makeEvidence("ev_3", 3, "user")
        ]
      )
    );
    const valid = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeEntity("entity_a", "ev_1"),
          makeEntity("entity_z", "ev_2"),
          makeRelation("relation_1", "ev_3", "entity_a", "entity_z", {
            predicate: "ALTERNATIVE_TO"
          })
        ],
        [
          makeEvidence("ev_1", 1, "user"),
          makeEvidence("ev_2", 2, "user"),
          makeEvidence("ev_3", 3, "user")
        ]
      )
    );

    expectCustomIssue(invalid, "RELATION_CANONICAL_ORDER_INVALID", [
      "items",
      2,
      "sourceEntityId"
    ]);
    expect(valid.success).toBe(true);
  });

  it("rejects exact and inverse duplicate Relations", () => {
    const entities = [
      makeEntity("entity_a", "ev_1"),
      makeEntity("entity_b", "ev_2")
    ];
    const exactDuplicate = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          ...entities,
          makeRelation("relation_1", "ev_3", "entity_a", "entity_b"),
          makeRelation("relation_2", "ev_3", "entity_a", "entity_b")
        ],
        [
          makeEvidence("ev_1", 1, "user"),
          makeEvidence("ev_2", 2, "user"),
          makeEvidence("ev_3", 3, "user")
        ]
      )
    );
    const inverseDuplicate = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          ...entities,
          makeRelation("relation_1", "ev_3", "entity_a", "entity_b", {
            predicate: "INCLUDES"
          }),
          makeRelation("relation_2", "ev_3", "entity_b", "entity_a", {
            predicate: "PART_OF"
          })
        ],
        [
          makeEvidence("ev_1", 1, "user"),
          makeEvidence("ev_2", 2, "user"),
          makeEvidence("ev_3", 3, "user")
        ]
      )
    );

    expect(customReasons(exactDuplicate)).toContain("DUPLICATE_RELATION");
    expect(customReasons(inverseDuplicate)).toContain("DUPLICATE_RELATION");
  });

  it("allows Relations that differ by polarity or modality", () => {
    const result = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeEntity("entity_a", "ev_1"),
          makeEntity("entity_b", "ev_2"),
          makeRelation("relation_1", "ev_3", "entity_a", "entity_b"),
          makeRelation("relation_2", "ev_3", "entity_a", "entity_b", {
            polarity: "negated"
          }),
          makeRelation("relation_3", "ev_3", "entity_a", "entity_b", {
            modality: "planned"
          }),
          makeRelation("relation_4", "ev_3", "entity_a", "entity_b", {
            predicate: "INCLUDES"
          }),
          makeRelation("relation_5", "ev_3", "entity_b", "entity_a", {
            predicate: "PART_OF",
            modality: "planned"
          })
        ],
        [
          makeEvidence("ev_1", 1, "user"),
          makeEvidence("ev_2", 2, "user"),
          makeEvidence("ev_3", 3, "user")
        ]
      )
    );

    expect(result.success).toBe(true);
  });

  it("does not collide Relation signatures containing delimiter characters", () => {
    const result = semanticCoreSnapshotV1Schema.safeParse(
      makeSnapshot(
        [
          makeEntity("a", "ev_1"),
          makeEntity("b|REQUIRES|c", "ev_1"),
          makeEntity("a|USES|b", "ev_1"),
          makeEntity("c", "ev_1"),
          makeRelation("relation_1", "ev_1", "a", "b|REQUIRES|c", {
            predicate: "USES"
          }),
          makeRelation("relation_2", "ev_1", "a|USES|b", "c", {
            predicate: "REQUIRES"
          })
        ],
        [makeEvidence("ev_1", 1, "user")]
      )
    );

    expect(result.success).toBe(true);
  });
});

const SOURCE = {
  extractor: "human",
  extractorVersion: "1.0.0",
  runId: "run_test"
} as const;

function makeSevenTypeSnapshot() {
  const evidence = [
    makeEvidence("ev_topic", 1, "user", "출시 범위를 논의한다"),
    makeEvidence("ev_blabase", 2, "user", "blabase"),
    makeEvidence("ev_intent", 3, "user", "정리 기능을 출시하고 싶다"),
    makeEvidence("ev_constraint_proposal", 4, "assistant", "정리만 포함하자"),
    makeEvidence("ev_constraint_acceptance", 5, "user", "좋아"),
    makeEvidence("ev_problem", 6, "user", "데이터가 부족하다"),
    makeEvidence("ev_change", 7, "user", "둘 다에서 정리만으로 바꾼다"),
    makeEvidence("ev_gemini", 8, "user", "Gemini"),
    makeEvidence("ev_relation", 9, "user", "blabase는 Gemini를 사용한다")
  ];
  const topic = makeTopic("topic_launch", "ev_topic", {
    startMessageIndex: 1,
    endMessageIndex: 9
  });
  const blabase = makeEntity("entity_blabase", "ev_blabase", {
    topicIds: ["topic_launch"],
    canonicalName: "blabase"
  });
  const gemini = makeEntity("entity_gemini", "ev_gemini", {
    topicIds: ["topic_launch"],
    canonicalName: "Gemini"
  });

  return makeSnapshot(
    [
      topic,
      blabase,
      makeIntent("intent_launch", "ev_intent", {
        topicIds: ["topic_launch"],
        targetEntityIds: ["entity_blabase"]
      }),
      makeConstraint("constraint_scope", "ev_constraint_proposal", {
        topicIds: ["topic_launch"],
        supportType: "accepted_context",
        evidenceRefs: [
          {
            evidenceId: "ev_constraint_proposal",
            role: "proposition"
          },
          {
            evidenceId: "ev_constraint_acceptance",
            role: "acceptance"
          }
        ],
        targetEntityIds: ["entity_blabase"]
      }),
      makeProblem("problem_data", "ev_problem", {
        topicIds: ["topic_launch"],
        affectedEntityIds: ["entity_blabase"]
      }),
      makeChange("change_scope", "ev_change", {
        topicIds: ["topic_launch"],
        subjectEntityIds: ["entity_blabase"]
      }),
      gemini,
      makeRelation(
        "relation_blabase_gemini",
        "ev_relation",
        "entity_blabase",
        "entity_gemini",
        { topicIds: ["topic_launch"] }
      )
    ],
    evidence
  );
}

function makeSnapshot(items: unknown[], evidence: unknown[]) {
  return {
    schemaVersion: "blabase-semantic-core.v1",
    snapshotId: "snapshot_test",
    snapshotVersion: "1",
    analysisId: "analysis_test",
    conversationId: "conversation_test",
    conversationRevision: "revision_test",
    createdAt: "2026-07-13T00:00:00.000Z",
    extractorVersion: "1.0.0",
    verifierVersion: "1.0.0",
    normalizerVersion: "1.0.0",
    items,
    evidence
  };
}

function makeEvidence(
  id: string,
  messageIndex: number,
  role: "user" | "assistant",
  quote = "근거"
) {
  return {
    id,
    messageId: `message_${messageIndex}`,
    messageIndex,
    role,
    quote,
    startChar: 0,
    endChar: quote.length
  };
}

function makeItemBase(
  id: string,
  evidenceId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    label: `${id} label`,
    description: `${id} description`,
    topicIds: [],
    evidenceRefs: [{ evidenceId, role: "direct_support" }],
    confidence: 0.95,
    canonicalKey: `${id}_canonical`,
    source: SOURCE,
    ...overrides
  };
}

function makeIntent(
  id: string,
  evidenceId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    ...makeItemBase(id, evidenceId),
    type: "intent",
    attribution: "user",
    supportType: "explicit",
    intentKind: "goal",
    scope: "conversation",
    targetEntityIds: [],
    ...overrides
  };
}

function makeTopic(
  id: string,
  evidenceId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    ...makeItemBase(id, evidenceId),
    type: "topic",
    attribution: "conversation",
    supportType: "explicit",
    topicIds: [],
    order: 0,
    level: "main",
    parentTopicId: null,
    summary: `${id} summary`,
    startMessageIndex: 1,
    endMessageIndex: 1,
    ...overrides
  };
}

function makeConstraint(
  id: string,
  evidenceId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    ...makeItemBase(id, evidenceId),
    type: "content_constraint",
    attribution: "user",
    supportType: "explicit",
    constraintKind: "scope_limit",
    polarity: "limit",
    targetEntityIds: [],
    ...overrides
  };
}

function makeProblem(
  id: string,
  evidenceId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    ...makeItemBase(id, evidenceId),
    type: "problem_signal",
    attribution: "user",
    supportType: "explicit",
    problemKind: "blocker",
    state: "open",
    affectedEntityIds: [],
    ...overrides
  };
}

function makeChange(
  id: string,
  evidenceId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    ...makeItemBase(id, evidenceId),
    type: "change_event",
    attribution: "user",
    supportType: "explicit",
    changeKind: "scope",
    subjectEntityIds: [],
    before: "정리와 제안",
    after: "정리",
    reasonText: null,
    ...overrides
  };
}

function makeEntity(
  id: string,
  evidenceId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    ...makeItemBase(id, evidenceId),
    type: "entity",
    attribution: "user",
    supportType: "explicit",
    entityKind: "concept",
    canonicalName: id,
    aliases: [],
    ...overrides
  };
}

function makeRelation(
  id: string,
  evidenceId: string,
  sourceEntityId: string,
  targetEntityId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    ...makeItemBase(id, evidenceId),
    type: "relation",
    attribution: "user",
    supportType: "explicit",
    sourceEntityId,
    polarity: "affirmed",
    modality: "asserted",
    predicate: "USES",
    targetEntityId,
    ...overrides
  };
}

type AnySafeParseResult =
  { success: true; data: unknown } | { success: false; error: z.ZodError };

function customIssues(result: AnySafeParseResult) {
  if (result.success) {
    return [];
  }
  return result.error.issues.flatMap((issue) => {
    if (issue.code !== z.ZodIssueCode.custom) {
      return [];
    }
    const reason = verificationReasonV1Schema.safeParse(issue.params?.reason);
    return reason.success ? [{ reason: reason.data, path: issue.path }] : [];
  });
}

function customReasons(result: AnySafeParseResult) {
  return customIssues(result).map((issue) => issue.reason);
}

function expectCustomIssue(
  result: AnySafeParseResult,
  reason: VerificationReasonV1,
  path: Array<string | number>
) {
  expect(customIssues(result)).toContainEqual({ reason, path });
}
