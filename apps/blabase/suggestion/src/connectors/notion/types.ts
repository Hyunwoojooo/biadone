export type NotionResourceKind = "page" | "data_source";

export type NotionResourceSignal = {
  id: string;
  source: "notion";
  kind: NotionResourceKind;
  title: string;
  createdAt: string;
  lastEditedAt: string;
};

export type NotionSnapshot = {
  schemaVersion: "notion-snapshot-v1";
  apiVersion: string;
  fetchedAt: string;
  workspaceId: string;
  workspaceName: string | null;
  truncated: boolean;
  resources: NotionResourceSignal[];
};

export type StoredNotionTokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  botId: string;
  workspaceId: string;
  workspaceName: string | null;
};

export type NotionPreviewResource = {
  id: string;
  kind: NotionResourceKind;
  title: string;
  lastEditedAt: string;
};

export type NotionConnectionState =
  | {
      status: "unavailable";
      message: string;
      localUrl?: string;
    }
  | {
      status: "disconnected";
    }
  | {
      status: "connected";
      workspaceName: string | null;
      lastSyncedAt: string;
      resourceCount: number;
      pageCount: number;
      dataSourceCount: number;
      truncated: boolean;
      resources: NotionPreviewResource[];
    }
  | {
      status: "reauthorization_required";
      message: string;
    }
  | {
      status: "sync_error";
      message: string;
      lastSyncedAt: string | null;
    };
