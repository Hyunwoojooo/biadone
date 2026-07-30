export const OWNER_HEADER = "x-gptmemory-owner";

const OWNER_KEY_PATTERN = /^[A-Za-z0-9._~-]{32,128}$/;
const NOTE_VIEWS = ["all", "favorites", "archive", "trash"] as const;
const CREATE_FIELDS = new Set([
  "title",
  "overview",
  "sections",
  "tags",
  "sourceUrl",
  "sourceTitle",
  "sourceMessageCount",
  "favorite",
  "archived",
]);
const PATCH_FIELDS = new Set([...CREATE_FIELDS, "deletedAt"]);

export type NoteView = (typeof NOTE_VIEWS)[number];
export type JsonObject = Record<string, unknown>;

export type PublicNote = {
  id: string;
  title: string;
  overview: string;
  sections: JsonObject[];
  tags: string[];
  sourceUrl?: string;
  sourceTitle?: string;
  sourceMessageCount?: number;
  favorite: boolean;
  archived: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateNoteInput = {
  title: string;
  overview: string;
  sections: JsonObject[];
  tags: string[];
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceMessageCount: number | null;
  favorite: boolean;
  archived: boolean;
};

export type PatchNoteInput = Partial<CreateNoteInput> & {
  deletedAt?: null;
};

export type ListNotesInput = {
  view: NoteView;
  query?: string;
  tag?: string;
};

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function requireOwnerKey(request: Request): string {
  const ownerKey = request.headers.get(OWNER_HEADER);
  if (!ownerKey) {
    throw new ApiRequestError(
      "OWNER_KEY_REQUIRED",
      `${OWNER_HEADER} header is required.`,
      401,
    );
  }
  if (!OWNER_KEY_PATTERN.test(ownerKey)) {
    throw new ApiRequestError(
      "INVALID_OWNER_KEY",
      "Owner key must be 32 to 128 URL-safe characters.",
      401,
    );
  }
  return ownerKey;
}

export function parseListNotesInput(request: Request): ListNotesInput {
  const searchParams = new URL(request.url).searchParams;
  const rawView = searchParams.get("view") ?? "all";
  if (!isNoteView(rawView)) {
    throw new ApiRequestError(
      "INVALID_VIEW",
      "view must be one of all, favorites, archive, or trash.",
    );
  }

  const query = optionalTrimmedString(searchParams.get("q"), "q", 200);
  const tag = optionalTrimmedString(searchParams.get("tag"), "tag", 64);
  return {
    view: rawView,
    ...(query ? { query } : {}),
    ...(tag ? { tag } : {}),
  };
}

export function parseCreateNoteInput(value: unknown): CreateNoteInput {
  const body = requireObject(value);
  rejectUnknownFields(body, CREATE_FIELDS);

  return {
    title: requiredTrimmedString(body.title, "title", 240),
    overview: optionalString(body.overview, "overview", 20_000) ?? "",
    sections: validateSections(body.sections ?? []),
    tags: validateTags(body.tags ?? []),
    sourceUrl: nullableUrl(body.sourceUrl, "sourceUrl"),
    sourceTitle: nullableTrimmedString(body.sourceTitle, "sourceTitle", 500),
    sourceMessageCount: nullableCount(
      body.sourceMessageCount,
      "sourceMessageCount",
    ),
    favorite: optionalBoolean(body.favorite, "favorite") ?? false,
    archived: optionalBoolean(body.archived, "archived") ?? false,
  };
}

export function parsePatchNoteInput(value: unknown): PatchNoteInput {
  const body = requireObject(value);
  rejectUnknownFields(body, PATCH_FIELDS);

  const patch: PatchNoteInput = {};
  if ("title" in body) {
    patch.title = requiredTrimmedString(body.title, "title", 240);
  }
  if ("overview" in body) {
    patch.overview = requiredString(body.overview, "overview", 20_000);
  }
  if ("sections" in body) {
    patch.sections = validateSections(body.sections);
  }
  if ("tags" in body) {
    patch.tags = validateTags(body.tags);
  }
  if ("sourceUrl" in body) {
    patch.sourceUrl = nullableUrl(body.sourceUrl, "sourceUrl");
  }
  if ("sourceTitle" in body) {
    patch.sourceTitle = nullableTrimmedString(
      body.sourceTitle,
      "sourceTitle",
      500,
    );
  }
  if ("sourceMessageCount" in body) {
    patch.sourceMessageCount = nullableCount(
      body.sourceMessageCount,
      "sourceMessageCount",
    );
  }
  if ("favorite" in body) {
    patch.favorite = requiredBoolean(body.favorite, "favorite");
  }
  if ("archived" in body) {
    patch.archived = requiredBoolean(body.archived, "archived");
  }
  if ("deletedAt" in body) {
    if (body.deletedAt !== null) {
      throw invalidField("deletedAt", "must be null to restore a note");
    }
    patch.deletedAt = null;
  }

  if (Object.keys(patch).length === 0) {
    throw new ApiRequestError(
      "EMPTY_PATCH",
      "At least one mutable note field is required.",
    );
  }

  return patch;
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiRequestError(
      "INVALID_JSON",
      "Request body must be valid JSON.",
    );
  }
}

export function noteApiResponse(
  payload: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), { ...init, headers });
}

export function noteErrorResponse(error: unknown): Response {
  if (error instanceof ApiRequestError) {
    return noteApiResponse(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.status },
    );
  }

  if (
    error instanceof Error &&
    error.name === "NotesDatabaseUnavailableError"
  ) {
    return noteApiResponse(
      {
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Notes storage is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }

  console.error("Notes API request failed", {
    error: error instanceof Error ? error.message : "Unknown error",
  });
  return noteApiResponse(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The notes request could not be completed.",
      },
    },
    { status: 500 },
  );
}

function isNoteView(value: string): value is NoteView {
  return (NOTE_VIEWS as readonly string[]).includes(value);
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiRequestError(
      "INVALID_BODY",
      "Request body must be a JSON object.",
    );
  }
  return value as Record<string, unknown>;
}

function rejectUnknownFields(
  body: Record<string, unknown>,
  allowed: Set<string>,
): void {
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ApiRequestError(
      "UNKNOWN_FIELDS",
      "Request body contains unsupported fields.",
      400,
      { fields: unknown.sort() },
    );
  }
}

function requiredTrimmedString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  const result = requiredString(value, field, maxLength).trim();
  if (!result) throw invalidField(field, "must not be empty");
  return result;
}

function requiredString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw invalidField(field, "must be a string");
  }
  if (value.length > maxLength) {
    throw invalidField(field, `must be at most ${maxLength} characters`);
  }
  return value;
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  return value === undefined
    ? undefined
    : requiredString(value, field, maxLength);
}

function optionalTrimmedString(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return requiredTrimmedString(value, field, maxLength);
}

function nullableTrimmedString(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) return null;
  return requiredTrimmedString(value, field, maxLength);
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  return value === undefined ? undefined : requiredBoolean(value, field);
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw invalidField(field, "must be a boolean");
  }
  return value;
}

function nullableCount(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 1_000_000
  ) {
    throw invalidField(
      field,
      "must be a non-negative integer no greater than 1000000",
    );
  }
  return value;
}

function nullableUrl(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  const raw = requiredTrimmedString(value, field, 2_048);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalidField(field, "must be a valid HTTP or HTTPS URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw invalidField(field, "must be a valid HTTP or HTTPS URL");
  }
  return url.toString();
}

function validateSections(value: unknown): JsonObject[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw invalidField("sections", "must be an array with at most 100 items");
  }
  if (
    value.some(
      (section) =>
        !section || typeof section !== "object" || Array.isArray(section),
    )
  ) {
    throw invalidField("sections", "items must be JSON objects");
  }
  if (JSON.stringify(value).length > 500_000) {
    throw invalidField("sections", "serialized content is too large");
  }
  return value as JsonObject[];
}

function validateTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 30) {
    throw invalidField("tags", "must be an array with at most 30 items");
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const rawTag of value) {
    if (typeof rawTag !== "string") {
      throw invalidField("tags", "items must be strings");
    }
    const tag = rawTag.trim();
    if (!tag || tag.length > 64) {
      throw invalidField(
        "tags",
        "items must be between 1 and 64 characters",
      );
    }
    const key = tag.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(tag);
    }
  }
  return result;
}

function invalidField(field: string, reason: string): ApiRequestError {
  return new ApiRequestError(
    "INVALID_FIELD",
    `${field} ${reason}.`,
    400,
    { field },
  );
}
