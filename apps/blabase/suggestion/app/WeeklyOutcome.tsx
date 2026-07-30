"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import { syncInvalidationBus } from "./sync/invalidationBus";

type WeeklyOutcomeFocus = {
  primaryOutcome: string;
  capturedAt: string;
  validUntil: string;
};

type WeeklyOutcomeResponse =
  | {
      status: "ready";
      focus:
        | {
            primaryOutcome: string | null;
            capturedAt: string | null;
            validUntil: string | null;
          }
        | null;
      projectResolution: unknown;
      projectId: string | null;
    }
  | {
      status: "error" | "unavailable";
      message?: string;
    };

export function WeeklyOutcome() {
  const [focus, setFocus] = useState<WeeklyOutcomeFocus | null>(null);
  const [draft, setDraft] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const sequenceRef = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++sequenceRef.current;
    try {
      const response = await fetch("/api/context/weekly-outcome", {
        cache: "no-store"
      });
      if (!response.ok) {
        if (response.status === 404) return;
        throw new Error("weekly outcome request failed");
      }
      const payload = (await response.json()) as WeeklyOutcomeResponse;
      if (
        sequence !== sequenceRef.current ||
        payload.status !== "ready"
      ) {
        return;
      }
      const nextFocus = activeFocus(payload.focus);
      setFocus(nextFocus);
      setDraft(nextFocus?.primaryOutcome ?? "");
      setIsEditing(nextFocus === null);
    } catch {
      if (sequence === sequenceRef.current) {
        setMessage("주간 결과를 불러오지 못했습니다.");
      }
    } finally {
      if (sequence === sequenceRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const primaryOutcome = draft.trim();
    if (!primaryOutcome || isSaving) return;

    const sequence = ++sequenceRef.current;
    setIsSaving(true);
    setMessage(null);
    let succeeded = false;
    try {
      const response = await fetch("/api/context/weekly-outcome", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ primaryOutcome })
      });
      if (!response.ok) throw new Error("weekly outcome save failed");
      const payload = (await response.json()) as WeeklyOutcomeResponse;
      if (
        sequence !== sequenceRef.current ||
        payload.status !== "ready"
      ) {
        return;
      }
      const nextFocus = activeFocus(payload.focus);
      setFocus(nextFocus);
      setDraft(nextFocus?.primaryOutcome ?? primaryOutcome);
      setIsEditing(false);
      setMessage("이번 주 결과를 반영했습니다.");
      succeeded = true;
    } catch {
      if (sequence === sequenceRef.current) {
        setMessage("저장하지 못했습니다. 잠시 후 다시 시도해주세요.");
      }
    } finally {
      if (sequence === sequenceRef.current) setIsSaving(false);
    }

    if (succeeded) {
      syncInvalidationBus.invalidate({
        reason: "context_changed",
        targets: ["attention"]
      });
    }
  }

  return (
    <section
      className="weeklyOutcome"
      aria-labelledby="weekly-outcome-title"
      aria-busy={isLoading || isSaving}
    >
      <div>
        <p className="eyebrow">Weekly focus</p>
        <h2 id="weekly-outcome-title">
          이번 주 가장 중요한 결과는 무엇인가요?
        </h2>
        <p>
          한 줄로 알려주면 연결된 작업 중 그 결과에 가까운 일을 먼저
          판단합니다.
        </p>
      </div>

      {isLoading ? (
        <p className="weeklyOutcomeStatus" role="status">
          주간 결과 확인 중
        </p>
      ) : isEditing || focus === null ? (
        <form className="weeklyOutcomeForm" onSubmit={save}>
          <input
            type="text"
            value={draft}
            maxLength={240}
            placeholder="예: 첫 유료 사용자가 결제까지 완료하게 만들기"
            aria-label="이번 주 가장 중요한 결과"
            onChange={(event) => setDraft(event.target.value)}
          />
          <div>
            <button
              type="submit"
              disabled={!draft.trim() || isSaving}
            >
              {isSaving ? "저장 중" : "반영하기"}
            </button>
            {focus ? (
              <button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  setDraft(focus.primaryOutcome);
                  setIsEditing(false);
                  setMessage(null);
                }}
              >
                취소
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="weeklyOutcomeValue">
          <strong>{focus.primaryOutcome}</strong>
          <span>
            {formatDate(focus.validUntil)}까지 사용 · 사용자가 바꾸면 즉시
            갱신
          </span>
          <button
            type="button"
            onClick={() => {
              setDraft(focus.primaryOutcome);
              setIsEditing(true);
              setMessage(null);
            }}
          >
            수정
          </button>
        </div>
      )}

      {message ? (
        <p className="weeklyOutcomeStatus" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function formatDate(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric"
  }).format(parsed);
}

function activeFocus(
  focus: Extract<
    WeeklyOutcomeResponse,
    { status: "ready" }
  >["focus"]
): WeeklyOutcomeFocus | null {
  if (
    focus === null ||
    typeof focus.primaryOutcome !== "string" ||
    typeof focus.capturedAt !== "string" ||
    typeof focus.validUntil !== "string"
  ) {
    return null;
  }
  return {
    primaryOutcome: focus.primaryOutcome,
    capturedAt: focus.capturedAt,
    validUntil: focus.validUntil
  };
}
