import {
  CONTENT_NOTE_SCHEMA_VERSION,
  type ConversationContentNoteV4,
} from "../note-content/index.ts";
import {
  SUMMARY_SCHEMA_VERSION,
  type ConversationSummaryV2,
} from "../note-summary/index.ts";
import {
  STATE_NOTE_SCHEMA_VERSION,
  type ConversationStateNoteV3,
} from "../note-state/index.ts";

export const NOTE_IMPORT_WORKFLOW_VERSION = "gptmemory-note-import.v5";

export type GeneratedConversationNote =
  | ConversationSummaryV2
  | ConversationStateNoteV3
  | ConversationContentNoteV4;
export type GeneratedConversationNoteSchemaVersion =
  | typeof SUMMARY_SCHEMA_VERSION
  | typeof STATE_NOTE_SCHEMA_VERSION
  | typeof CONTENT_NOTE_SCHEMA_VERSION;

export type NoteImportReplacement = {
  noteId: string;
  expectedUpdatedAt: string;
};

export type NoteImportCommand = {
  ownerKey: string;
  normalizedUrl: string;
  shareId: string;
  replace?: NoteImportReplacement;
};

export type NoteImportGenerationMetadata = {
  runId: string;
  workflowVersion: typeof NOTE_IMPORT_WORKFLOW_VERSION;
  adapterVersion: string;
  noteEngineVersion: string;
  noteSchemaVersion: string;
  summarySchemaVersion: GeneratedConversationNoteSchemaVersion;
  summaryProvider: "gemini";
  summaryModel: string;
  summaryEngineVersion: string;
  summaryPromptVersion: string;
  sourceShareId: string;
  sourceContentSha256: string;
  sourceFetchedAt: string;
  generatedAt: string;
};

export type ImportedConversationMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string | null;
};

export type ImportedConversation = {
  conversation: {
    title: string | null;
    messages: ImportedConversationMessage[];
  };
  source: {
    normalizedUrl: string;
    shareId: string;
    fetchedAt: string;
    adapterVersion: string;
  };
};

export type GeneratedNoteDraft = {
  schemaVersion: string;
  title: string;
  overview: string;
  sections: Array<{
    id: string;
    heading: string;
    body: string;
    sourceMessageIds: string[];
  }>;
  closingState: string;
  tags: string[];
};

export type GeneratedImportDraft = {
  legacyDraft: GeneratedNoteDraft;
  summary: GeneratedConversationNote;
  summaryProvider: {
    provider: "gemini";
    model: string;
    engineVersion: string;
    promptVersion: string;
  };
};

export type ImportedNoteWrite = {
  title: string;
  overview: string;
  sections: Array<Record<string, unknown>>;
  tags: string[];
  sourceUrl: string;
  sourceTitle: string | null;
  sourceMessageCount: number;
  generationMetadata: NoteImportGenerationMetadata;
  summarySchemaVersion: GeneratedConversationNoteSchemaVersion;
  summary: GeneratedConversationNote;
};

export type ImportStoredNote = {
  id: string;
  title: string;
  sourceUrl?: string;
  sourceMessageCount?: number;
  archived: boolean;
  deletedAt?: string;
  updatedAt: string;
};

export type ExistingImportNoteSummary = {
  id: string;
  title: string;
  updatedAt: string;
  archived: boolean;
  deletedAt: string | null;
  sourceMessageCount: number | null;
};

export type ImportedNoteCreateResult<TNote extends ImportStoredNote> = {
  note: TNote;
  disposition: "created" | "existing";
};

export type NoteImportRepository<TNote extends ImportStoredNote> = {
  findBySourceUrl(ownerKey: string, normalizedUrl: string): Promise<TNote | null>;
  hasReplacementCandidate(input: {
    ownerKey: string;
    noteId: string;
    normalizedUrl: string;
    expectedUpdatedAt: string;
  }): Promise<boolean>;
  createImportedNote(
    ownerKey: string,
    input: ImportedNoteWrite,
  ): Promise<ImportedNoteCreateResult<TNote>>;
  replaceImportedNote(input: {
    ownerKey: string;
    noteId: string;
    normalizedUrl: string;
    expectedUpdatedAt: string;
    note: ImportedNoteWrite;
  }): Promise<TNote | null>;
};

export type NoteImportDependencies<TNote extends ImportStoredNote> = {
  repository: NoteImportRepository<TNote>;
  importShareUrl(normalizedUrl: string): Promise<ImportedConversation>;
  createDraft(imported: ImportedConversation): Promise<GeneratedImportDraft>;
  noteEngineVersion: string;
  now(): string;
  randomUUID(): string;
  sha256Hex(value: string): Promise<string>;
};

export type NoteImportResult<TNote extends ImportStoredNote> =
  | {
      status: "already_exists";
      existing: ExistingImportNoteSummary;
    }
  | {
      status: "created";
      note: TNote;
    }
  | {
      status: "replaced";
      note: TNote;
    };

export type NoteImportWorkflowErrorCode =
  | "NOTE_CHANGED_SINCE_CONFIRMATION"
  | "IMPORTED_SOURCE_MISMATCH";

export class NoteImportWorkflowError extends Error {
  readonly code: NoteImportWorkflowErrorCode;
  readonly httpStatus: number;

  constructor(
    code: NoteImportWorkflowErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(message);
    this.name = "NoteImportWorkflowError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Orchestrates duplicate-safe imports without importing a runtime database.
 * All network, storage, clock, identifier, and digest effects are injected so
 * this workflow can be exercised by Node tests with in-memory fakes.
 */
export function createNoteImportService<TNote extends ImportStoredNote>(
  dependencies: NoteImportDependencies<TNote>,
) {
  return {
    async execute(command: NoteImportCommand): Promise<NoteImportResult<TNote>> {
      if (!command.replace) {
        const existing = await dependencies.repository.findBySourceUrl(
          command.ownerKey,
          command.normalizedUrl,
        );
        if (existing) {
          return alreadyExists(existing);
        }
      } else {
        const replacementIsCurrent =
          await dependencies.repository.hasReplacementCandidate({
            ownerKey: command.ownerKey,
            noteId: command.replace.noteId,
            normalizedUrl: command.normalizedUrl,
            expectedUpdatedAt: command.replace.expectedUpdatedAt,
          });
        if (!replacementIsCurrent) {
          throw noteChangedSinceConfirmation();
        }
      }

      const imported = await dependencies.importShareUrl(command.normalizedUrl);
      assertImportedSource(imported, command);
      const draft = await dependencies.createDraft(imported);
      const generatedAt = dependencies.now();
      const generationMetadata: NoteImportGenerationMetadata = {
        runId: dependencies.randomUUID(),
        workflowVersion: NOTE_IMPORT_WORKFLOW_VERSION,
        adapterVersion: imported.source.adapterVersion,
        noteEngineVersion: dependencies.noteEngineVersion,
        noteSchemaVersion: draft.legacyDraft.schemaVersion,
        summarySchemaVersion: draft.summary.schemaVersion,
        summaryProvider: draft.summaryProvider.provider,
        summaryModel: draft.summaryProvider.model,
        summaryEngineVersion: draft.summaryProvider.engineVersion,
        summaryPromptVersion: draft.summaryProvider.promptVersion,
        sourceShareId: command.shareId,
        sourceContentSha256: await dependencies.sha256Hex(
          canonicalizeImportedConversation(imported),
        ),
        sourceFetchedAt: imported.source.fetchedAt,
        generatedAt,
      };
      const note = buildImportedNoteWrite(
        imported,
        draft,
        command.normalizedUrl,
        generationMetadata,
      );

      if (!command.replace) {
        const created = await dependencies.repository.createImportedNote(
          command.ownerKey,
          note,
        );
        if (created.disposition === "existing") {
          return alreadyExists(created.note);
        }
        return { status: "created", note: created.note };
      }

      const replaced = await dependencies.repository.replaceImportedNote({
        ownerKey: command.ownerKey,
        noteId: command.replace.noteId,
        normalizedUrl: command.normalizedUrl,
        expectedUpdatedAt: command.replace.expectedUpdatedAt,
        note,
      });
      if (!replaced) {
        throw noteChangedSinceConfirmation();
      }
      return { status: "replaced", note: replaced };
    },
  };
}

export function canonicalizeImportedConversation(
  imported: ImportedConversation,
): string {
  return JSON.stringify({
    title: normalizeTitleForDigest(imported.conversation.title ?? ""),
    messages: imported.conversation.messages.map((message) => ({
      role: message.role,
      text: normalizeMessageForDigest(message.text),
    })),
  });
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function buildImportedNoteWrite(
  imported: ImportedConversation,
  draft: GeneratedImportDraft,
  normalizedUrl: string,
  generationMetadata: NoteImportGenerationMetadata,
): ImportedNoteWrite {
  const sections: Array<Record<string, unknown>> = draft.legacyDraft.sections.map(
    (section, index) => ({
      id: section.id || `section-${index + 1}`,
      heading: section.heading.trim() || `맥락 ${index + 1}`,
      body: section.body.trim(),
      sourceMessageIds: section.sourceMessageIds,
    }),
  );
  if (draft.legacyDraft.closingState.trim()) {
    sections.push({
      id: "closing-state",
      heading: "대화가 도달한 지점",
      body: draft.legacyDraft.closingState.trim(),
      sourceMessageIds: [],
    });
  }

  return {
    title:
      draft.summary.title.text.trim() ||
      imported.conversation.title?.trim() ||
      "ChatGPT 대화 노트",
    // Keep the deterministic v1 body intact for the expandable legacy view.
    // v2 cards and detail headers read summary.oneLineSummary directly.
    overview: draft.legacyDraft.overview.trim(),
    sections,
    tags: normalizeTags(draft.legacyDraft.tags),
    sourceUrl: normalizedUrl,
    sourceTitle: imported.conversation.title?.trim() || null,
    sourceMessageCount: imported.conversation.messages.length,
    generationMetadata,
    summarySchemaVersion: draft.summary.schemaVersion,
    summary: draft.summary,
  };
}

function alreadyExists<TNote extends ImportStoredNote>(
  note: TNote,
): NoteImportResult<TNote> {
  return {
    status: "already_exists",
    existing: {
      id: note.id,
      title: note.title,
      updatedAt: note.updatedAt,
      archived: note.archived,
      deletedAt: note.deletedAt ?? null,
      sourceMessageCount: note.sourceMessageCount ?? null,
    },
  };
}

function assertImportedSource(
  imported: ImportedConversation,
  command: NoteImportCommand,
): void {
  if (
    imported.source.normalizedUrl !== command.normalizedUrl ||
    imported.source.shareId !== command.shareId
  ) {
    throw new NoteImportWorkflowError(
      "IMPORTED_SOURCE_MISMATCH",
      "Fetched conversation provenance did not match the requested share link.",
      502,
    );
  }
}

function noteChangedSinceConfirmation(): NoteImportWorkflowError {
  return new NoteImportWorkflowError(
    "NOTE_CHANGED_SINCE_CONFIRMATION",
    "The existing note changed after replacement was confirmed.",
    409,
  );
}

function normalizeTitleForDigest(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeMessageForDigest(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function normalizeTags(values: string[]): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const tag = value.trim().replace(/^#/, "");
    const key = tag.toLocaleLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
    if (tags.length === 8) break;
  }
  return tags;
}
