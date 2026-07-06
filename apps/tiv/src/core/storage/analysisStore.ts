import type { CanonicalConversation } from "../types/conversation";

export type AnalysisRecord = {
  id: string;
  status: "completed" | "failed";
  shareUrl: string;
  conversation?: CanonicalConversation;
  error?: {
    code: string;
    message: string;
    detail?: string;
  };
  createdAt: string;
  updatedAt: string;
};

export interface AnalysisStore {
  createCompleted(input: {
    shareUrl: string;
    conversation: CanonicalConversation;
  }): AnalysisRecord;
  createFailed(input: {
    shareUrl: string;
    error: { code: string; message: string; detail?: string };
  }): AnalysisRecord;
  get(id: string): AnalysisRecord | null;
}

export class MemoryAnalysisStore implements AnalysisStore {
  private readonly records = new Map<string, AnalysisRecord>();

  createCompleted(input: {
    shareUrl: string;
    conversation: CanonicalConversation;
  }): AnalysisRecord {
    const now = new Date().toISOString();
    const record: AnalysisRecord = {
      id: createAnalysisId(),
      status: "completed",
      shareUrl: input.shareUrl,
      conversation: input.conversation,
      createdAt: now,
      updatedAt: now
    };
    this.records.set(record.id, record);
    return record;
  }

  createFailed(input: {
    shareUrl: string;
    error: { code: string; message: string; detail?: string };
  }): AnalysisRecord {
    const now = new Date().toISOString();
    const record: AnalysisRecord = {
      id: createAnalysisId(),
      status: "failed",
      shareUrl: input.shareUrl,
      error: input.error,
      createdAt: now,
      updatedAt: now
    };
    this.records.set(record.id, record);
    return record;
  }

  get(id: string): AnalysisRecord | null {
    return this.records.get(id) ?? null;
  }
}

const globalStore = globalThis as typeof globalThis & {
  __jarvisAnalysisStore?: MemoryAnalysisStore;
};

export function getAnalysisStore(): AnalysisStore {
  globalStore.__jarvisAnalysisStore ??= new MemoryAnalysisStore();
  return globalStore.__jarvisAnalysisStore;
}

function createAnalysisId(): string {
  return `ana_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}
