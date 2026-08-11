import { z } from "zod";

export const ROOT_MARKER_CONTRACT =
  "blabase-root-marker-v1" as const;
export const ROOT_CONTEXT_CONTRACT =
  "blabase-root-context-v1" as const;

export const rootIdSchema = z
  .string()
  .regex(/^root_[a-f0-9]{32}$/);

export const rootSyncRevisionSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const rootMarkerSchema = z
  .object({
    contract: z.literal(ROOT_MARKER_CONTRACT),
    rootId: rootIdSchema
  })
  .strict();

export const rootContextSchema = z
  .object({
    contract: z.literal(ROOT_CONTEXT_CONTRACT),
    rootId: rootIdSchema,
    mutationAuthority: z.literal("dashboard"),
    syncRevision: rootSyncRevisionSchema.nullable()
  })
  .strict();

export type RootMarker = z.infer<typeof rootMarkerSchema>;
export type RootContext = z.infer<typeof rootContextSchema>;
