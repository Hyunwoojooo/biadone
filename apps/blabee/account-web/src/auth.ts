import type { AuthCallback } from "./config.ts";

interface AuthFailure { code?: string; status?: number; name?: string }
export interface AccountUser { id: string; email?: string }
export type SocialProvider = "google" | "github";
export interface AuthPort {
  getUser(): Promise<{ data: { user: AccountUser | null }; error: AuthFailure | null }>;
  exchangeCodeForSession(code: string): Promise<{ error: AuthFailure | null }>;
  signInWithOAuth(input: { provider: SocialProvider; options: { redirectTo: string; skipBrowserRedirect: true } }): Promise<{ data: { url: string | null }; error: AuthFailure | null }>;
  signOut(input: { scope: "local" }): Promise<{ error: AuthFailure | null }>;
}
export interface AccountState {
  phase: "loading" | "signed-out" | "redirecting" | "signed-in" | "signing-out" | "unavailable";
  user: AccountUser | null;
  notice: string;
  problem: string;
  provider?: SocialProvider;
}

export interface AccountOptions {
  authorizeUrl: string;
  isProviderEnabled(provider: SocialProvider): Promise<boolean>;
  navigate(url: string): void;
}

const signedOut = (): AccountState => ({ phase: "signed-out", user: null, notice: "", problem: "" });

function messageFor(error: AuthFailure | null): string {
  if (error?.status === 429 || error?.code === "over_request_rate_limit") {
    return "요청이 많아 잠시 기다려야 합니다. 잠시 후 다시 시도해주세요.";
  }
  return "로그인을 시작하지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요.";
}

function authorizationUrl(value: string | null, endpoint: string, provider: SocialProvider, redirectTo: string): string {
  if (!value) throw new Error("Missing authorization URL");
  const url = new URL(value);
  const expected = new URL(endpoint);
  if (url.protocol !== "https:" || url.origin !== expected.origin || url.pathname !== expected.pathname
    || url.username || url.password || url.hash
    || url.searchParams.getAll("provider").length !== 1 || url.searchParams.get("provider") !== provider
    || url.searchParams.getAll("redirect_to").length !== 1 || url.searchParams.get("redirect_to") !== redirectTo
    || url.searchParams.getAll("code_challenge_method").length !== 1 || url.searchParams.get("code_challenge_method") !== "s256"
    || url.searchParams.getAll("code_challenge").length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("code_challenge") ?? "")) {
    throw new Error("Invalid authorization URL");
  }
  return url.href;
}

export class AccountController {
  private auth: AuthPort;
  private redirectTo: string;
  private update: (state: AccountState) => void;
  private revision = 0;
  private started: Promise<void> | undefined;
  private current: AccountState = { ...signedOut(), phase: "loading" };
  private options: AccountOptions;

  constructor(auth: AuthPort, redirectTo: string, update: (state: AccountState) => void, options: AccountOptions) {
    this.auth = auth;
    this.redirectTo = redirectTo;
    this.update = update;
    this.options = options;
  }

  get state(): Readonly<AccountState> { return this.current; }

  private publish(state: AccountState) {
    this.current = state;
    this.update(this.current);
  }

  start(callback: AuthCallback): Promise<void> {
    this.started ??= this.initialize(callback);
    return this.started;
  }

  private async initialize(callback: AuthCallback) {
    const revision = ++this.revision;
    if (callback.failed) {
      this.publish({ ...signedOut(), problem: "로그인이 취소되었거나 완료되지 않았습니다. 다시 로그인해주세요." });
      return;
    }
    if (callback.code) {
      try {
        const { error } = await this.auth.exchangeCodeForSession(callback.code);
        if (revision !== this.revision) return;
        if (error) throw error;
      } catch {
        if (revision !== this.revision) return;
        this.publish({ ...signedOut(), problem: "로그인을 완료하지 못했습니다. 로그인을 시작한 브라우저에서 다시 시도해주세요." });
        return;
      }
    }
    if (revision !== this.revision) return;
    await this.refreshUser();
  }

  async refreshUser() {
    const revision = ++this.revision;
    this.publish({ ...signedOut(), phase: "loading" });
    try {
      // A saved session alone is not proof of a currently valid account.
      const { data, error } = await this.auth.getUser();
      if (revision !== this.revision) return;
      if (error) {
        if (error.name === "AuthSessionMissingError" || error.code === "session_not_found" || error.code === "refresh_token_not_found" || error.status === 401 || error.status === 403) {
          this.publish(signedOut());
        } else {
          this.publish({ ...signedOut(), phase: "unavailable", problem: "로그인 상태를 확인하지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요." });
        }
        return;
      }
      this.publish(data.user ? { ...signedOut(), phase: "signed-in", user: { id: data.user.id, email: data.user.email } } : signedOut());
    } catch {
      if (revision === this.revision) this.publish({ ...signedOut(), phase: "unavailable", problem: "로그인 상태를 확인하지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요." });
    }
  }

  async signIn(provider: SocialProvider) {
    if (this.current.phase !== "signed-out" || (provider !== "google" && provider !== "github")) return;
    const revision = ++this.revision;
    const name = provider === "google" ? "Google" : "GitHub";
    this.publish({ ...signedOut(), phase: "redirecting", provider, notice: `${name} 로그인 화면으로 이동하고 있습니다.` });
    try {
      // The SDK constructs an authorize URL even for a disabled provider.
      // Check first so users stay here with a recoverable message.
      const enabled = await this.options.isProviderEnabled(provider);
      if (revision !== this.revision) return;
      if (!enabled) {
        this.publish({ ...signedOut(), problem: `${name} 로그인을 아직 사용할 수 없습니다. 잠시 후 다시 시도해주세요.` });
        return;
      }
      const { data, error } = await this.auth.signInWithOAuth({ provider, options: { redirectTo: this.redirectTo, skipBrowserRedirect: true } });
      if (revision !== this.revision) return;
      if (error) {
        this.publish({ ...signedOut(), problem: messageFor(error) });
        return;
      }
      this.options.navigate(authorizationUrl(data.url, this.options.authorizeUrl, provider, this.redirectTo));
    } catch {
      if (revision === this.revision) this.publish({ ...signedOut(), problem: messageFor(null) });
    }
  }

  signedOutElsewhere() {
    ++this.revision;
    this.publish(signedOut());
  }

  async signOut() {
    if (this.current.phase !== "signed-in") return;
    const previous = this.current;
    const revision = ++this.revision;
    this.publish({ ...previous, phase: "signing-out", problem: "" });
    try {
      const { error } = await this.auth.signOut({ scope: "local" });
      if (revision !== this.revision) return;
      this.publish(error ? { ...previous, problem: "로그아웃하지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요." } : signedOut());
    } catch {
      if (revision === this.revision) this.publish({ ...previous, problem: "로그아웃하지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요." });
    }
  }
}
