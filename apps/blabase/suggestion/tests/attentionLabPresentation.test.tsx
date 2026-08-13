import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ContinuationShadowPanel } from "../app/attention-lab/AttentionLab";
import type { WorkBoardReadyResponse } from "../src/suggestionBoard/monitoringSchema";

describe("Attention Lab decision presentation", () => {
  it("shows an available Continuation proposal before the retained Active status", () => {
    const markup = renderToStaticMarkup(
      createElement(ContinuationShadowPanel, {
        response: readyContinuationBoard(),
        loadFailed: false,
        activeDecisionStatus: "insufficient_evidence"
      })
    );

    const continuationLabel = "Continuation 제안 사용 가능";
    const activeLabel = "Active Attention 근거 부족";

    expect(markup).toContain('id="continuation-suggestion"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain(continuationLabel);
    expect(markup).toContain(activeLabel);
    expect(markup.indexOf(continuationLabel)).toBeLessThan(
      markup.indexOf(activeLabel)
    );
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("<a ");
  });

  it("offers an explicit local QA-title confirmation only for a mapped continuation", () => {
    const response = readyContinuationBoard();
    if (response.board.primary === null) {
      throw new TypeError("Synthetic continuation primary missing");
    }
    response.board.primary.item.workContextRef =
      `context_ref_${"a".repeat(43)}`;
    const markup = renderToStaticMarkup(
      createElement(ContinuationShadowPanel, {
        response,
        loadFailed: false,
        activeDecisionStatus: "no_action",
        semanticPresentation: {
          contract: "semantic-continuation-presentation-v0.2",
          schemaVersion: "semantic-continuation-presentation-schema-v0.2",
          baseGeneratedAt: response.board.generatedAt,
          overlays: [
            {
              itemRef: response.board.primary.item.itemRef,
              displayTitle: "QA 통과 결과 확인하기"
            }
          ]
        }
      })
    );

    expect(markup).toContain("QA 통과 결과 확인하기");
    expect(response.board.primary.item.title).toBe("Recent linked activity");
    expect(markup).toContain("QA 대상 이름");
    expect(markup).toContain("QA 진행 제목으로 확인");
    expect(markup).toContain("제목 미리보기");
    expect(markup).toContain("항목 실행·결과 반영·외부 변경은 하지 않습니다");
    expect(markup).not.toContain("pass");
    expect(markup).not.toContain("fail");
  });
});

function readyContinuationBoard(): WorkBoardReadyResponse {
  return {
    status: "ready",
    mode: "full",
    reasonCode: null,
    board: {
      contract: "work-suggestion-board-public-v0.1",
      schemaVersion: "work-suggestion-board-schema-v0.1",
      generatedAt: "2026-08-13T09:00:00.000Z",
      prominentLane: "continuation",
      continuationStatus: "available",
      primary: {
        lane: "continuation",
        item: {
          itemRef: "item_ref_0000000000000000000000",
          workContextRef: null,
          kind: "linked_workstream",
          title: "Recent linked activity",
          summary: "Recent linked activity",
          observedAt: "2026-08-13T08:00:00.000Z",
          expiresAt: "2026-08-14T08:00:00.000Z",
          evidenceBand: "corroborated",
          capability: "display",
          action: null,
          caveatCodes: []
        }
      },
      alternatives: [],
      executionPolicy: {
        automaticExecutionAllowed: false,
        explicitUserActionRequired: true,
        externalMutationAllowed: false
      }
    }
  } satisfies WorkBoardReadyResponse;
}
