export const WORK_BOARD_MONITORING_RECEIPT_CONTRACT =
  "work-board-monitoring-receipt-v0.1" as const;
export const WORK_BOARD_MONITORING_API_CONTRACT =
  "work-board-monitoring-api-v0.1" as const;
export const WORK_BOARD_MONITORING_EVENT_CONTRACT =
  "work-board-monitoring-event-v0.1" as const;
export const WORK_BOARD_MONITORING_STORE_CONTRACT =
  "work-board-monitoring-store-v0.1" as const;
export const WORK_BOARD_MONITORING_QUALITY_CONTRACT =
  "work-board-monitoring-quality-v0.1" as const;
export const WORK_BOARD_MONITORING_REPLAY_CONTRACT =
  "work-board-monitoring-replay-v0.1" as const;
export const WORK_BOARD_MONITORING_SCHEMA_VERSION =
  "work-board-monitoring-schema-v0.1" as const;
export const WORK_BOARD_MONITORING_RECEIPT_POLICY_VERSION =
  "work-board-monitoring-receipt-policy-v0.1" as const;
export const WORK_BOARD_MONITORING_CONSENT_POLICY_VERSION =
  "work-board-monitoring-consent-policy-v0.1" as const;
export const WORK_BOARD_MONITORING_RETENTION_POLICY_VERSION =
  "work-board-monitoring-retention-policy-v0.1" as const;
export const WORK_BOARD_MONITORING_IDEMPOTENCY_POLICY_VERSION =
  "work-board-monitoring-idempotency-policy-v0.1" as const;

export const WORK_BOARD_MONITORING_RECEIPT_HEADER =
  "X-Blabase-Work-Board-Monitoring-Receipt" as const;
export const WORK_BOARD_MONITORING_SURFACE = "web" as const;
export const WORK_BOARD_MONITORING_RECEIPT_TTL_MS = 5 * 60 * 1_000;
export const WORK_BOARD_MONITORING_RETENTION_MS =
  30 * 24 * 60 * 60 * 1_000;
export const WORK_BOARD_MONITORING_MAX_RECEIPT_HEADER_BYTES = 6_144;
export const WORK_BOARD_MONITORING_MAX_REQUEST_BYTES = 8_192;
export const WORK_BOARD_MONITORING_MAX_EVENTS = 4_096;
export const WORK_BOARD_MONITORING_EVENT_RESERVE = 64;
export const WORK_BOARD_MONITORING_MAX_HISTORY = 50;
