export const SEMANTIC_VALIDATION_RECEIPT_CONTRACT =
  "semantic-continuation-validation-receipt-v0.1" as const;
export const SEMANTIC_VALIDATION_STORE_CONTRACT =
  "semantic-continuation-validation-store-v0.1" as const;
export const SEMANTIC_VALIDATION_SCHEMA_VERSION =
  "semantic-continuation-validation-schema-v0.1" as const;
export const SEMANTIC_VALIDATION_PROFILE_VERSION =
  "semantic-continuation-validation-profile-v0.1" as const;
export const SEMANTIC_VALIDATION_RECEIPT_POLICY_VERSION =
  "semantic-continuation-validation-receipt-policy-v0.1" as const;
export const SEMANTIC_VALIDATION_TTL_POLICY_VERSION =
  "semantic-continuation-validation-ttl-24h-v0.1" as const;
export const SEMANTIC_VALIDATION_TITLE_TEMPLATE_POLICY_VERSION =
  "semantic-continuation-validation-title-template-v0.1" as const;

export const SEMANTIC_VALIDATION_STEPS = [
  "typecheck",
  "lint",
  "unit_test"
] as const;

export const SEMANTIC_VALIDATION_TTL_MS = 24 * 60 * 60 * 1_000;
export const SEMANTIC_VALIDATION_MAX_RECEIPTS = 512;

export const SEMANTIC_VALIDATION_TITLES = {
  running: "QA 진행 상태 확인하기",
  failed: "QA 실패 항목 검토하기",
  passed: "QA 통과 결과 확인하기"
} as const;
