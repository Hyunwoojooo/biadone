import { decodePayload } from "./decodePayloads";
import { dereference, type DereferenceResult } from "./dereference";
import { extractEnqueuePayloads } from "./extractEnqueuePayloads";
import { expandReactFlightPayloads } from "./parseReactFlightRows";

export type PayloadStructureSummary = {
  html: {
    length: number;
    hasStreamControllerEnqueue: boolean;
    hasLinearConversationText: boolean;
  };
  payloadCount: number;
  payloads: PayloadChunkSummary[];
  combined: StructureProbeSummary;
  dereferenced: StructureProbeSummary & {
    stats: DereferenceResult["stats"];
    warnings: string[];
  };
};

export type PayloadChunkSummary = {
  order: number;
  rawArgumentLength: number;
  decoded: ValueShapeSummary;
  probes: StructureProbeSummary;
};

export type StructureProbeSummary = {
  shape: ValueShapeSummary;
  linearConversationKeyPaths: string[];
  linearConversationStringPaths: string[];
  linearConversationStringPreviews: StringPreview[];
  mappingKeyCount: number;
  sampleMappingKeys: string[];
};

export type StringPreview = {
  path: string;
  prefix: string;
  aroundMatch: string;
};

export type ValueShapeSummary = {
  kind: "null" | "array" | "object" | "string" | "number" | "boolean" | "unknown";
  length?: number;
  keyCount?: number;
  sampleKeys?: string[];
  preview?: string;
};

const MAX_PATHS = 20;
const MAX_KEYS = 20;
const MAX_NODES = 50_000;
const MAX_DEPTH = 80;

export function summarizePayloadStructure(html: string): PayloadStructureSummary {
  const rawPayloads = extractEnqueuePayloads(html);
  const decodedPayloads = rawPayloads.map((payload) =>
    decodePayload(payload.rawArgument, payload.order)
  );
  const combinedRoot = decodedPayloads.length === 1 ? decodedPayloads[0] : decodedPayloads;
  const expandedRoot = expandReactFlightPayloads(combinedRoot);
  const dereferenced = dereference(expandedRoot, {
    maxDepth: 100,
    maxNodes: 100_000,
    preserveUnknownRefs: true
  });

  return {
    html: {
      length: html.length,
      hasStreamControllerEnqueue: html.includes("streamController.enqueue"),
      hasLinearConversationText: html.includes("linear_conversation")
    },
    payloadCount: rawPayloads.length,
    payloads: rawPayloads.map((payload, index) => ({
      order: payload.order,
      rawArgumentLength: payload.rawArgument.length,
      decoded: summarizeValueShape(decodedPayloads[index]),
      probes: probeStructure(decodedPayloads[index])
    })),
    combined: probeStructure(combinedRoot),
    dereferenced: {
      ...probeStructure(dereferenced.root),
      stats: dereferenced.stats,
      warnings: dereferenced.warnings
    }
  };
}

function probeStructure(root: unknown): StructureProbeSummary {
  const linearConversationKeyPaths: string[] = [];
  const linearConversationStringPaths: string[] = [];
  const linearConversationStringPreviews: StringPreview[] = [];
  const mappingKeys = new Set<string>();
  const queue: { value: unknown; path: string; depth: number }[] = [
    { value: root, path: "$", depth: 0 }
  ];
  const seen = new WeakSet<object>();
  let visitedNodes = 0;

  while (queue.length > 0 && visitedNodes < MAX_NODES) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    visitedNodes += 1;

    const { value, path, depth } = current;
    if (typeof value === "string") {
      if (
        value.includes("linear_conversation") &&
        linearConversationStringPaths.length < MAX_PATHS
      ) {
        linearConversationStringPaths.push(path);
        linearConversationStringPreviews.push({
          path,
          prefix: redactPreview(value.slice(0, 240)),
          aroundMatch: redactPreview(sliceAround(value, "linear_conversation", 120))
        });
      }
      if (/^_\d+$/.test(value)) {
        mappingKeys.add(value);
      }
      continue;
    }

    if (!value || typeof value !== "object" || depth >= MAX_DEPTH) {
      continue;
    }

    if (seen.has(value)) {
      continue;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        queue.push({
          value: item,
          path: `${path}[${index}]`,
          depth: depth + 1
        });
      });
      continue;
    }

    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${formatPathKey(key)}`;
      if (/^_\d+$/.test(key)) {
        mappingKeys.add(key);
      }
      if (
        key === "linear_conversation" &&
        linearConversationKeyPaths.length < MAX_PATHS
      ) {
        linearConversationKeyPaths.push(childPath);
      }
      queue.push({
        value: child,
        path: childPath,
        depth: depth + 1
      });
    }
  }

  return {
    shape: summarizeValueShape(root),
    linearConversationKeyPaths,
    linearConversationStringPaths,
    linearConversationStringPreviews,
    mappingKeyCount: mappingKeys.size,
    sampleMappingKeys: Array.from(mappingKeys).slice(0, MAX_KEYS)
  };
}

function summarizeValueShape(value: unknown): ValueShapeSummary {
  if (value === null) {
    return { kind: "null" };
  }

  if (Array.isArray(value)) {
    return {
      kind: "array",
      length: value.length
    };
  }

  if (typeof value === "object") {
    const keys = Object.keys(value);
    return {
      kind: "object",
      keyCount: keys.length,
      sampleKeys: keys.slice(0, MAX_KEYS)
    };
  }

  if (typeof value === "string") {
    return {
      kind: "string",
      length: value.length,
      preview: redactStringPreview(value)
    };
  }

  if (typeof value === "number") {
    return { kind: "number" };
  }

  if (typeof value === "boolean") {
    return { kind: "boolean" };
  }

  return { kind: "unknown" };
}

function redactStringPreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.includes("linear_conversation")) {
    return "[string containing linear_conversation]";
  }
  return compact.length > 80 ? `${compact.slice(0, 80)}...` : compact;
}

function redactPreview(value: string): string {
  return value.replace(/"[^"]{24,}"/g, '"<redacted-string>"');
}

function sliceAround(value: string, needle: string, radius: number): string {
  const index = value.indexOf(needle);
  if (index === -1) {
    return value.slice(0, radius * 2);
  }
  return value.slice(Math.max(0, index - radius), index + needle.length + radius);
}

function formatPathKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}
