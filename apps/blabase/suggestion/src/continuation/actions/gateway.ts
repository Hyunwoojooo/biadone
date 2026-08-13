import {
  continuationSetupActionBindingSchema,
  type ContinuationSetupActionIssueResponse,
  type ContinuationSetupActionOpenResponse
} from "./contracts";
import {
  consumeStoredContinuationSetupOffer,
  issueStoredContinuationSetupOffer
} from "./store";
import { evaluateLiveContinuationSetupActionAuthority } from "../../suggestionBoard/liveShadow";

export class ContinuationSetupActionGatewayError extends Error {
  constructor(public readonly code: "OFFER_NOT_CURRENT") {
    super(code);
    this.name = "ContinuationSetupActionGatewayError";
  }
}

export async function issueLiveContinuationSetupOffer(input: {
  itemRef: string;
  cwd?: string;
  clock?: () => Date;
  env?: NodeJS.ProcessEnv;
}): Promise<ContinuationSetupActionIssueResponse> {
  const clock = input.clock ?? (() => new Date());
  const cwd = input.cwd ?? process.cwd();
  return issueStoredContinuationSetupOffer({
    cwd,
    clock,
    resolveCurrent: async (lockedNow) => {
      const now = fixedNow(lockedNow);
      const live = await evaluateLiveContinuationSetupActionAuthority({
        cwd,
        now,
        ...(input.env ? { env: input.env } : {})
      });
      const current = live?.setupActionAuthorities.find(
        (authority) =>
          authority.binding.authority.itemRef === input.itemRef
      );
      if (live === null || current === undefined) {
        throw new ContinuationSetupActionGatewayError(
          "OFFER_NOT_CURRENT"
        );
      }
      return {
        installationSecret: live.installationSecret,
        binding: continuationSetupActionBindingSchema.parse(
          current.binding
        )
      };
    }
  });
}

export async function openLiveContinuationSetupOffer(input: {
  offerId: string;
  cwd?: string;
  clock?: () => Date;
  env?: NodeJS.ProcessEnv;
}): Promise<ContinuationSetupActionOpenResponse> {
  const cwd = input.cwd ?? process.cwd();
  return consumeStoredContinuationSetupOffer({
    cwd,
    offerId: input.offerId,
    clock: input.clock ?? (() => new Date()),
    revalidate: async (lockedNow) => {
      const now = fixedNow(lockedNow);
      const live = await evaluateLiveContinuationSetupActionAuthority({
        cwd,
        now,
        ...(input.env ? { env: input.env } : {})
      });
      if (live === null) {
        throw new ContinuationSetupActionGatewayError(
          "OFFER_NOT_CURRENT"
        );
      }
      return {
        installationSecret: live.installationSecret,
        currentBindings: live.setupActionAuthorities.map((authority) =>
          continuationSetupActionBindingSchema.parse(authority.binding)
        )
      };
    }
  });
}

function fixedNow(value: Date | undefined): Date {
  const now = value === undefined ? new Date() : new Date(value.getTime());
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("Continuation Setup action time is invalid");
  }
  return now;
}
