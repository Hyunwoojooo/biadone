export type ReactFlightRow = {
  id: string;
  tag: string | null;
  path: string;
  body: unknown;
};

export type ReactFlightExpansion = {
  decodedPayloads: unknown;
  reactFlightRows: ReactFlightRow[];
  reactFlightTables: unknown[];
};

const MAX_NODES = 100_000;
const MAX_ROWS = 10_000;
const TOP_LEVEL_TABLE_KEYS = new Set(["linear_conversation"]);
const MATERIALIZED_OBJECT_KEYS = new Set([
  "id",
  "message",
  "parent",
  "children",
  "author",
  "role",
  "metadata",
  "content",
  "content_type",
  "parts",
  "text",
  "create_time",
  "createTime",
  "update_time",
  "updateTime"
]);

export function expandReactFlightPayloads(decodedPayloads: unknown): ReactFlightExpansion {
  return {
    decodedPayloads,
    reactFlightRows: collectReactFlightRows(decodedPayloads),
    reactFlightTables: collectReactFlightTables(decodedPayloads)
  };
}

function collectReactFlightRows(root: unknown): ReactFlightRow[] {
  const rows: ReactFlightRow[] = [];
  const queue: { value: unknown; path: string }[] = [{ value: root, path: "$" }];
  const seen = new WeakSet<object>();
  let visited = 0;

  while (queue.length > 0 && visited < MAX_NODES && rows.length < MAX_ROWS) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    visited += 1;

    const { value, path } = current;
    if (typeof value === "string") {
      const row = parseReactFlightRow(value, path);
      if (row) {
        rows.push(row);
        queue.push({ value: row.body, path: `${path}#body` });
      }
      continue;
    }

    if (!value || typeof value !== "object") {
      continue;
    }

    if (seen.has(value)) {
      continue;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        queue.push({ value: item, path: `${path}[${index}]` });
      });
      continue;
    }

    for (const [key, child] of Object.entries(value)) {
      queue.push({ value: child, path: `${path}.${formatPathKey(key)}` });
    }
  }

  return rows;
}

function parseReactFlightRow(value: string, path: string): ReactFlightRow | null {
  const trimmed = value.trim();
  const match = /^(?:(?<tag>[A-Z])(?=\d))?(?<id>\d+):(?<body>[\s\S]*)$/.exec(
    trimmed
  );
  const body = match?.groups?.body?.trim();
  const id = match?.groups?.id;

  if (!id || !body || !looksJsonParseable(body)) {
    return null;
  }

  try {
    return {
      id,
      tag: match.groups?.tag ?? null,
      path,
      body: JSON.parse(body)
    };
  } catch {
    return null;
  }
}

function collectReactFlightTables(root: unknown): unknown[] {
  const tables: unknown[] = [];
  const queue: unknown[] = [root];
  const seen = new WeakSet<object>();
  let visited = 0;

  while (queue.length > 0 && visited < MAX_NODES && tables.length < MAX_ROWS) {
    const value = queue.shift();
    visited += 1;

    if (!value || typeof value !== "object") {
      continue;
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      if (value.includes("linear_conversation")) {
        tables.push(materializeFlightTable(value));
      }
      queue.push(...value);
      continue;
    }

    queue.push(...Object.values(value));
  }

  return tables;
}

function materializeFlightTable(table: unknown[]): unknown {
  const output: Record<string, unknown> = {};

  for (let index = 0; index < table.length - 1; index += 1) {
    const key = table[index];
    if (typeof key !== "string" || !TOP_LEVEL_TABLE_KEYS.has(key)) {
      continue;
    }
    output[key] = materializeFlightValue(table[index + 1], {
      table,
      visiting: new Set<number>(),
      visited: 0
    });
  }

  return output;
}

function materializeFlightValue(
  value: unknown,
  ctx: {
    table: unknown[];
    visiting: Set<number>;
    visited: number;
  }
): unknown {
  ctx.visited += 1;
  if (ctx.visited > MAX_NODES) {
    return value;
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    if (value >= ctx.table.length || ctx.visiting.has(value)) {
      return value;
    }
    ctx.visiting.add(value);
    const output = materializeFlightValue(ctx.table[value], ctx);
    ctx.visiting.delete(value);
    return output;
  }

  if (Array.isArray(value)) {
    return value.map((item) => materializeFlightValue(item, ctx));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [rawKey, rawChild] of Object.entries(value)) {
      const keyIndex = parseReferenceKey(rawKey);
      const materializedKey =
        keyIndex === null ? rawKey : materializeFlightValue(keyIndex, ctx);
      const outputKey =
        typeof materializedKey === "string" ? materializedKey : rawKey;
      if (!MATERIALIZED_OBJECT_KEYS.has(outputKey)) {
        continue;
      }
      output[outputKey] = materializeFlightValue(rawChild, ctx);
    }
    return output;
  }

  return value;
}

function parseReferenceKey(key: string): number | null {
  const match = /^_(\d+)$/.exec(key);
  return match ? Number.parseInt(match[1], 10) : null;
}

function looksJsonParseable(value: string): boolean {
  return (
    value.startsWith("{") ||
    value.startsWith("[") ||
    value.startsWith('"') ||
    value === "null" ||
    value === "true" ||
    value === "false" ||
    /^-?\d/.test(value)
  );
}

function formatPathKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}
