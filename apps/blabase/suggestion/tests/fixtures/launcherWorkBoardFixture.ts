import type { SemanticContinuationWorkBoardResponse } from "../../src/semanticContinuation/contracts";

const CONTINUATION_REF = `item_ref_${"c".repeat(32)}`;

export function workBoardResponse(): SemanticContinuationWorkBoardResponse {
  return {
    contract: "semantic-continuation-work-board-response-v0.2",
    schemaVersion: "semantic-continuation-presentation-schema-v0.2",
    base: {
      status: "ready",
      mode: "full",
      reasonCode: null,
      board: {
        contract: "work-suggestion-board-public-v0.1",
        schemaVersion: "work-suggestion-board-schema-v0.1",
        generatedAt: "2026-08-13T09:00:00.000Z",
        prominentLane: "attention",
        continuationStatus: "available",
        primary: {
          lane: "attention",
          item: {
            itemRef: `item_ref_${"a".repeat(32)}`,
            workContextRef: `context_ref_${"b".repeat(32)}`,
            kind: "active_attention",
            title: "현재 확인할 Attention",
            summary: "현재 확인할 Attention",
            observedAt: "2026-08-13T08:00:00.000Z",
            expiresAt: null,
            evidenceBand: "verified_attention",
            capability: "display",
            action: null,
            caveatCodes: []
          }
        },
        alternatives: [
          {
            lane: "continuation",
            item: {
              itemRef: CONTINUATION_REF,
              workContextRef: `context_ref_${"d".repeat(32)}`,
              kind: "linked_workstream",
              title: "최근 작업 이어가기",
              summary: "최근 작업 이어가기",
              observedAt: "2026-08-13T08:00:00.000Z",
              expiresAt: "2026-08-14T08:00:00.000Z",
              evidenceBand: "corroborated",
              capability: "display",
              action: null,
              caveatCodes: ["SOURCE_COVERAGE_PARTIAL"]
            }
          },
          {
            lane: "setup",
            item: {
              itemRef: `item_ref_${"e".repeat(32)}`,
              workContextRef: null,
              kind: "workspace_mapping",
              title: "작업공간 연결하기",
              summary: "작업공간 연결하기",
              observedAt: "2026-08-13T08:00:00.000Z",
              expiresAt: "2026-08-14T08:00:00.000Z",
              evidenceBand: "setup",
              capability: "display",
              action: null,
              caveatCodes: ["EXPLICIT_MAPPING_CONFIRMATION_REQUIRED"]
            }
          }
        ],
        executionPolicy: {
          automaticExecutionAllowed: false,
          explicitUserActionRequired: true,
          externalMutationAllowed: false
        }
      }
    },
    semanticPresentation: {
      contract: "semantic-continuation-presentation-v0.2",
      schemaVersion: "semantic-continuation-presentation-schema-v0.2",
      baseGeneratedAt: "2026-08-13T09:00:00.000Z",
      overlays: [
        {
          itemRef: CONTINUATION_REF,
          displayTitle: "QA 진행 상태 확인하기"
        }
      ]
    }
  };
}
