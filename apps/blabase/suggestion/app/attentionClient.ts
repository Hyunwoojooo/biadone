import type {
  AttentionApiResponse,
  AttentionFeedbackRecord,
  AttentionFeedbackType,
  AttentionHistoryResponse
} from "../src/attention/monitoringSchema";

export async function fetchAttention(
  refreshSources = false
): Promise<AttentionApiResponse> {
  const response = await fetch("/api/attention", {
    method: refreshSources ? "POST" : "GET",
    cache: "no-store"
  });
  return (await response.json()) as AttentionApiResponse;
}

export async function fetchAttentionHistory(): Promise<AttentionHistoryResponse> {
  const response = await fetch("/api/attention/history", {
    cache: "no-store"
  });
  return (await response.json()) as AttentionHistoryResponse;
}

export async function submitAttentionFeedback(input: {
  runId: string;
  feedbackType: AttentionFeedbackType;
}): Promise<
  | { status: "recorded"; feedback: AttentionFeedbackRecord }
  | { status: "error"; code: string; message: string }
> {
  const response = await fetch("/api/attention/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  return (await response.json()) as
    | { status: "recorded"; feedback: AttentionFeedbackRecord }
    | { status: "error"; code: string; message: string };
}
