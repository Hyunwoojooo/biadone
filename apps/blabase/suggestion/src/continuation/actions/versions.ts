export const CONTINUATION_SETUP_ACTION_API_CONTRACT =
  "continuation-setup-action-api-v0.1" as const;

export const CONTINUATION_SETUP_ACTION_OFFER_CONTRACT =
  "continuation-setup-action-offer-v0.2" as const;

export const CONTINUATION_SETUP_ACTION_EVENT_CONTRACT =
  "continuation-setup-action-event-v0.2" as const;

export const CONTINUATION_SETUP_ACTION_STORE_CONTRACT =
  "continuation-setup-action-store-v0.2" as const;

export const CONTINUATION_SETUP_ACTION_SCHEMA_VERSION =
  "continuation-setup-action-schema-v0.2" as const;

export const CONTINUATION_SETUP_ACTION_POLICY_VERSION =
  "continuation-setup-action-policy-v0.1" as const;

export const CONTINUATION_SETUP_ACTION_REVALIDATION_POLICY_VERSION =
  "continuation-setup-action-authority-revalidation-v0.2" as const;

export const CONTINUATION_SETUP_ACTION_RETENTION_POLICY_VERSION =
  "continuation-setup-action-tombstone-24h-v0.2" as const;

export const CONTINUATION_SETUP_ACTION_AUTHORITY_CONTRACT =
  "continuation-setup-action-authority-v0.1" as const;

export const CONTINUATION_SETUP_ACTION_AUTHORITY_SCHEMA_VERSION =
  "continuation-setup-action-authority-schema-v0.1" as const;

export const CONTINUATION_SETUP_ACTION_AUTHORITY_POLICY_VERSION =
  "continuation-setup-action-authority-policy-v0.1" as const;

export const CONTINUATION_SETUP_ACTION_NAMESPACE_VERSION =
  "continuation-setup-action-key-namespace-v0.1" as const;

export const CONTINUATION_SETUP_ACTION_CAPABILITY =
  "open_setup_surface" as const;

export const CONTINUATION_SETUP_ACTION_DESTINATION =
  "project_mappings" as const;

export const CONTINUATION_SETUP_ACTION_NAVIGATE_TO = "/projects" as const;

export const CONTINUATION_SETUP_ACTION_TTL_MS = 30_000;

export const CONTINUATION_SETUP_ACTION_TOMBSTONE_RETENTION_MS =
  24 * 60 * 60 * 1_000;

export const CONTINUATION_SETUP_ACTION_MAX_RETAINED_EVENTS = 2_048;
