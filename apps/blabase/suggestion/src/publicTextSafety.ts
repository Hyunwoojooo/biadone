const credentialShapedPublicTextPatterns = [
  /\b(?:github_pat_[A-Za-z0-9_]{8,}|gh[pousr]_[A-Za-z0-9_]{8,})\b/u,
  /\bsk-[A-Za-z0-9_-]{8,}\b/u,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/u,
  /\b(?:token|api[ _-]?key|access[ _-]?(?:key|token)|password|secret)\s*[:=]\s*["']?[^\s,;"']+/iu
] as const;

/**
 * Detects bounded, credential-shaped values before private display text crosses
 * a public response boundary. Callers must reject the affected item rather
 * than partially redact it into text with a different meaning.
 */
export function containsCredentialShapedPublicText(value: string): boolean {
  return credentialShapedPublicTextPatterns.some((pattern) =>
    pattern.test(value)
  );
}
