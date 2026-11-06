import "./style.css";
import { AccountController } from "./auth.ts";
import type { AccountState } from "./auth.ts";
import { consumeCallback, readConfig } from "./config.ts";
import { createAccountClient, createOAuthOptions } from "./supabase.ts";
import { startAccountSession } from "./session.ts";

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing account element: ${id}`);
  return result as T;
}

const providers = element("login-options");
const google = element<HTMLButtonElement>("sign-in-google");
const github = element<HTMLButtonElement>("sign-in-github");
const signOut = element<HTMLButtonElement>("sign-out");
const retry = element<HTMLButtonElement>("retry");

function render(state: AccountState) {
  const authenticated = state.user !== null;
  const redirecting = state.phase === "redirecting";
  element("loading").hidden = state.phase !== "loading";
  providers.hidden = authenticated || state.phase === "loading" || state.phase === "unavailable";
  providers.setAttribute("aria-busy", String(redirecting));
  element("signed-in").hidden = !authenticated;
  element("account-heading").textContent = authenticated ? "Blabee 계정" : "Blabee에 로그인";
  element("intro").hidden = authenticated;
  element("account-email").textContent = state.user?.email ?? "이메일 정보 없음";
  google.disabled = redirecting;
  github.disabled = redirecting;
  element("google-label").textContent = redirecting && state.provider === "google" ? "Google로 이동 중…" : "Google로 계속하기";
  element("github-label").textContent = redirecting && state.provider === "github" ? "GitHub로 이동 중…" : "GitHub로 계속하기";
  signOut.disabled = state.phase === "signing-out";
  signOut.textContent = state.phase === "signing-out" ? "로그아웃하는 중…" : "이 브라우저에서 로그아웃";
  element("notice").hidden = !state.notice;
  element("notice").textContent = state.notice;
  element("problem").hidden = !state.problem;
  element("problem").textContent = state.problem;
  retry.hidden = state.phase !== "unavailable";
}

async function main() {
  // Consume and scrub the URL before any auth request or external navigation.
  const callback = consumeCallback(new URL(window.location.href), (path) => window.history.replaceState(null, "", path));
  try {
    const config = readConfig(import.meta.env);
    const client = createAccountClient(config);
    // Fixed same-origin root: never take a return URL from a query parameter.
    const controller = new AccountController(client.auth, new URL("/", window.location.origin).href, render,
      createOAuthOptions(config, (url) => window.location.assign(url)));
    google.addEventListener("click", () => { void controller.signIn("google"); });
    github.addEventListener("click", () => { void controller.signIn("github"); });
    signOut.addEventListener("click", () => { void controller.signOut(); });
    retry.addEventListener("click", () => { void controller.refreshUser(); });
    const subscription = await startAccountSession(controller, callback, (listener) => client.auth.onAuthStateChange(listener).data.subscription);
    window.addEventListener("pagehide", (event) => { if (!event.persisted) subscription.unsubscribe(); });
    // Back from a provider may restore a frozen page with both buttons disabled.
    window.addEventListener("pageshow", (event) => { if (event.persisted) void controller.refreshUser(); });
  } catch {
    render({ phase: "unavailable", user: null, notice: "", problem: "계정 서비스에 연결할 수 없습니다. 잠시 후 다시 방문해주세요." });
    retry.hidden = true;
  }
}

void main();
