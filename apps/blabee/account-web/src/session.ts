import type { AccountController } from "./auth.ts";
import type { AuthCallback } from "./config.ts";

interface Subscription { unsubscribe(): void }

export async function startAccountSession(
  controller: AccountController,
  callback: AuthCallback,
  subscribe: (listener: (event: string) => void) => Subscription,
): Promise<Subscription> {
  let ready = false;
  let pendingSignIn = false;
  let disposed = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    // SDK calls must run outside Supabase's onAuthStateChange auth lock.
    refreshTimer = setTimeout(() => {
      if (!disposed) void controller.refreshUser();
    }, 0);
  }

  // Observe invalidation before even the first getUser request can complete.
  const subscription = subscribe((event) => {
    if (disposed) return;
    if (event === "SIGNED_OUT") {
      pendingSignIn = false;
      clearTimeout(refreshTimer);
      controller.signedOutElsewhere();
    } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
      if (ready) scheduleRefresh();
      else pendingSignIn = true;
    }
  });

  const cleanup = () => {
    disposed = true;
    clearTimeout(refreshTimer);
    subscription.unsubscribe();
  };
  try {
    await controller.start(callback);
    ready = true;
    if (pendingSignIn) scheduleRefresh();
    return { unsubscribe: cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
