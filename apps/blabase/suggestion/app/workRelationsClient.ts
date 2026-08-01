import type { ManagedCodexWorkRelationProjection } from "../src/relations";

export type WorkRelationsReadyResponse =
  ManagedCodexWorkRelationProjection & {
    status: "ready";
  };

export type WorkRelationsUnavailableResponse = {
  status: "error" | "unavailable";
  code?: string;
  message?: string;
};

export type WorkRelationsApiResponse =
  | WorkRelationsReadyResponse
  | WorkRelationsUnavailableResponse;

export async function fetchWorkRelations(): Promise<WorkRelationsApiResponse> {
  const response = await fetch("/api/work-relations", {
    cache: "no-store"
  });
  return (await response.json()) as WorkRelationsApiResponse;
}
