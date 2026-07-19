export type DereferenceOptions = {
  maxDepth: number;
  maxNodes: number;
  preserveUnknownRefs: boolean;
};

export type DereferenceResult = {
  root: unknown;
  stats: {
    totalRefs: number;
    resolvedRefs: number;
    unresolvedRefs: number;
    maxDepthReached: boolean;
  };
  warnings: string[];
};

type DerefContext = {
  refTable: Map<string, unknown>;
  visiting: Set<string>;
  warnings: string[];
  options: DereferenceOptions;
  visitedNodes: number;
  totalRefs: number;
  resolvedRefs: number;
  unresolvedRefs: number;
  maxDepthReached: boolean;
};

const DEFAULT_OPTIONS: DereferenceOptions = {
  maxDepth: 100,
  maxNodes: 100_000,
  preserveUnknownRefs: true
};

export function dereference(
  root: unknown,
  options: Partial<DereferenceOptions> = {}
): DereferenceResult {
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  const ctx: DerefContext = {
    refTable: buildReferenceTable(root),
    visiting: new Set(),
    warnings: [],
    options: resolvedOptions,
    visitedNodes: 0,
    totalRefs: 0,
    resolvedRefs: 0,
    unresolvedRefs: 0,
    maxDepthReached: false
  };

  return {
    root: deref(root, ctx, 0),
    stats: {
      totalRefs: ctx.totalRefs,
      resolvedRefs: ctx.resolvedRefs,
      unresolvedRefs: ctx.unresolvedRefs,
      maxDepthReached: ctx.maxDepthReached
    },
    warnings: ctx.warnings
  };
}

export function buildReferenceTable(root: unknown): Map<string, unknown> {
  const table = new Map<string, unknown>();
  const seen = new WeakSet<object>();

  function visit(value: unknown): void {
    if (!value || typeof value !== "object") {
      return;
    }
    if (seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      if (/^_\d+$/.test(key)) {
        table.set(key, child);
      }
      visit(child);
    }
  }

  visit(root);
  return table;
}

function deref(value: unknown, ctx: DerefContext, depth: number): unknown {
  ctx.visitedNodes += 1;
  if (ctx.visitedNodes > ctx.options.maxNodes) {
    ctx.warnings.push("MAX_NODES_REACHED");
    return value;
  }

  if (depth > ctx.options.maxDepth) {
    ctx.maxDepthReached = true;
    ctx.warnings.push("MAX_DEPTH_REACHED");
    return value;
  }

  if (typeof value === "string" && /^_\d+$/.test(value)) {
    ctx.totalRefs += 1;
    const resolved = ctx.refTable.get(value);
    if (resolved === undefined) {
      ctx.unresolvedRefs += 1;
      return ctx.options.preserveUnknownRefs ? value : null;
    }

    if (ctx.visiting.has(value)) {
      ctx.warnings.push(`CIRCULAR_REF:${value}`);
      return null;
    }

    ctx.resolvedRefs += 1;
    ctx.visiting.add(value);
    const output = deref(resolved, ctx, depth + 1);
    ctx.visiting.delete(value);
    return output;
  }

  if (Array.isArray(value)) {
    return value.map((item) => deref(item, ctx, depth + 1));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = deref(child, ctx, depth + 1);
    }
    return output;
  }

  return value;
}
