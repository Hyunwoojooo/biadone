import { describe, expect, it } from "vitest";

import {
  ATLAS_EDGES,
  ATLAS_TOPICS,
  ATLAS_TOTALS,
  ATLAS_WORLD,
  ATLAS_ZONES,
  calculateAtlasTotals,
  getNeighborTopicIds,
  getTopicById,
  getZoneById,
  isTopicMatch,
  searchTopics,
  topicsForZone
} from "@/components/atlas/atlasModel";

describe("atlasModel", () => {
  it("exposes the source dashboard dimensions and totals", () => {
    expect(ATLAS_WORLD).toEqual({ width: 2920, height: 1640 });
    expect(ATLAS_TOTALS).toEqual({
      zones: 6,
      topics: 20,
      keywords: 450,
      atoms: 1200,
      edges: 36
    });
    expect(calculateAtlasTotals()).toEqual(ATLAS_TOTALS);
  });

  it("keeps zone and topic aggregates internally consistent", () => {
    for (const zone of ATLAS_ZONES) {
      const topics = topicsForZone(zone.id);
      expect(topics.length).toBeGreaterThan(0);
      expect(topics.reduce((sum, topic) => sum + topic.turnCount, 0)).toBe(
        zone.atomCount
      );
      for (const topic of topics) {
        expect(topic.x).toBeGreaterThanOrEqual(zone.x);
        expect(topic.x).toBeLessThanOrEqual(zone.x + zone.width);
        expect(topic.y).toBeGreaterThanOrEqual(zone.y);
        expect(topic.y).toBeLessThanOrEqual(zone.y + zone.height);
      }
    }
  });

  it("uses valid topic endpoints and accurate degrees for every edge", () => {
    const topicIds = new Set(ATLAS_TOPICS.map((topic) => topic.id));

    for (const edge of ATLAS_EDGES) {
      expect(topicIds.has(edge.source)).toBe(true);
      expect(topicIds.has(edge.target)).toBe(true);
      expect(edge.source).not.toBe(edge.target);
    }

    for (const topic of ATLAS_TOPICS) {
      expect(getNeighborTopicIds(topic.id).size).toBe(topic.degree);
    }
  });

  it("finds records by id and groups topics by zone", () => {
    expect(getTopicById("spatial-atlas")?.ko).toBe("공간 지도");
    expect(getTopicById("missing-topic")).toBeUndefined();
    expect(getZoneById("memory")?.title).toBe("Memory Engine / J.A.R.V.I.S");
    expect(getZoneById("missing-zone")).toBeUndefined();
    expect(topicsForZone("product")).toHaveLength(4);
  });

  it("matches English, Korean, summaries, and representative keywords", () => {
    const atlas = getTopicById("spatial-atlas");
    expect(atlas).toBeDefined();
    expect(isTopicMatch(atlas!, "SPATIAL")).toBe(true);
    expect(isTopicMatch(atlas!, "공간 지도")).toBe(true);
    expect(isTopicMatch(atlas!, "Topic hubs")).toBe(true);
    expect(isTopicMatch(atlas!, "없는 검색어")).toBe(false);
    expect(isTopicMatch(atlas!, "  ")).toBe(true);

    expect(searchTopics("Trigger phrase").map((topic) => topic.id)).toEqual([
      "evidence-chain"
    ]);
    expect(searchTopics("거버넌스 범위").map((topic) => topic.id)).toEqual([
      "roadmap"
    ]);
  });

  it("returns direct local neighbors and can include the selected topic", () => {
    expect([...getNeighborTopicIds("navigation")].sort()).toEqual([
      "inspector",
      "spatial-atlas"
    ]);
    expect([...getNeighborTopicIds("navigation", true)].sort()).toEqual([
      "inspector",
      "navigation",
      "spatial-atlas"
    ]);
    expect(getNeighborTopicIds("missing-topic").size).toBe(0);
    expect(getNeighborTopicIds("missing-topic", true).size).toBe(0);
  });
});
