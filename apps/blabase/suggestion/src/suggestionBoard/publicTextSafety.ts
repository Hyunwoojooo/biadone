import { containsCredentialShapedPublicText } from "../publicTextSafety";

const WORK_SUGGESTION_BOARD_PUBLIC_TEXT_FORBIDDEN_PATTERNS = [
  /[\u0000-\u001f\u007f-\u009f]/u,
  /https?:\/\/\S+/iu,
  /file:\/\/\S+/iu,
  /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*/u,
  /(?:^|[^\p{L}\p{N}_])(?:\/{1,2}(?!\s)\S+|\\\\\S+|[A-Za-z]:[\\/]\S+)/u,
  /\b[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+/u,
  /(?:^|[^A-Fa-f0-9])(?:[A-Fa-f0-9]{64}|[A-Fa-f0-9]{40})(?=$|[^A-Fa-f0-9])/u,
  /(?:session_|run_|analysis_|evidence_|source_ref_|managed_run_|continuation_observation_|continuation_candidate_)[A-Za-z0-9_-]*/u
] as const;

export function containsForbiddenWorkSuggestionBoardPublicText(
  value: string
): boolean {
  return WORK_SUGGESTION_BOARD_PUBLIC_TEXT_FORBIDDEN_PATTERNS.some(
    (pattern) => pattern.test(value)
  );
}

export function isWorkSuggestionBoardPublicOutputTextSafe(
  value: string
): boolean {
  return (
    !containsForbiddenWorkSuggestionBoardPublicText(value) &&
    !containsCredentialShapedPublicText(value)
  );
}
