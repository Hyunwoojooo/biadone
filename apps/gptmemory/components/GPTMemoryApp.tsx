"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type ViewKey = "all" | "favorites" | "archive" | "trash";
type MobilePane = "navigation" | "list" | "detail";
type SaveState = "idle" | "saving" | "saved" | "error";

type NoteSection = {
  id: string;
  heading: string;
  body: string;
  sourceMessageIds?: string[];
};

type NoteRecord = {
  id: string;
  title: string;
  overview: string;
  sections: NoteSection[];
  tags: string[];
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceMessageCount: number | null;
  favorite: boolean;
  archived: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type NoteDraft = Pick<
  NoteRecord,
  "title" | "overview" | "sections" | "tags"
>;

type ExistingNoteSummary = Pick<
  NoteRecord,
  "id" | "title" | "updatedAt" | "archived"
> & {
  deletedAt?: string | null;
  sourceMessageCount?: number | null;
};

type ImportResponsePayload = {
  status?: "created" | "replaced" | "already_exists";
  note?: Partial<NoteRecord>;
  existing?: ExistingNoteSummary;
  error?:
    | string
    | {
        code?: string;
        message?: string;
      };
  message?: string;
};

const OWNER_KEY_STORAGE = "gptmemory.owner-key.v1";

const viewMeta: Record<
  ViewKey,
  { label: string; eyebrow: string; symbol: string }
> = {
  all: { label: "All Notes", eyebrow: "Your library", symbol: "▤" },
  favorites: { label: "Favorites", eyebrow: "Saved for later", symbol: "♡" },
  archive: { label: "Archive", eyebrow: "Out of the way", symbol: "□" },
  trash: { label: "Trash", eyebrow: "Recently removed", symbol: "⌫" },
};

function createOwnerKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function getOwnerKey() {
  const current = window.localStorage.getItem(OWNER_KEY_STORAGE);
  if (current && /^[A-Za-z0-9_-]{32,128}$/.test(current)) return current;
  const next = createOwnerKey();
  window.localStorage.setItem(OWNER_KEY_STORAGE, next);
  return next;
}

function normalizeNote(input: Partial<NoteRecord>): NoteRecord {
  return {
    id: String(input.id ?? ""),
    title: input.title?.trim() || "제목 없는 노트",
    overview: input.overview ?? "",
    sections: Array.isArray(input.sections)
      ? input.sections.map((section, index) => ({
          id: section.id || `section-${index + 1}`,
          heading: section.heading || `맥락 ${index + 1}`,
          body: section.body || "",
          sourceMessageIds: section.sourceMessageIds ?? [],
        }))
      : [],
    tags: Array.isArray(input.tags) ? input.tags : [],
    sourceUrl: input.sourceUrl ?? null,
    sourceTitle: input.sourceTitle ?? null,
    sourceMessageCount:
      typeof input.sourceMessageCount === "number"
        ? input.sourceMessageCount
        : null,
    favorite: Boolean(input.favorite),
    archived: Boolean(input.archived),
    deletedAt: input.deletedAt ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat("ko-KR", {
    year: sameYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function notePreview(note: NoteRecord) {
  return (
    note.overview ||
    note.sections.find((section) => section.body.trim())?.body ||
    "아직 내용이 없습니다."
  )
    .replace(/\s+/g, " ")
    .trim();
}

function parseError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (typeof record.error === "string") return record.error;
  if (
    record.error &&
    typeof record.error === "object" &&
    typeof (record.error as Record<string, unknown>).message === "string"
  ) {
    return (record.error as { message: string }).message;
  }
  return fallback;
}

export function GPTMemoryApp() {
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [view, setView] = useState<ViewKey>("all");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>("list");
  const [detailResetToken, setDetailResetToken] = useState(0);
  const queryTimer = useRef<number | null>(null);
  const [ownerKey, setOwnerKey] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setOwnerKey(getOwnerKey()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(
    () => () => {
      if (queryTimer.current) window.clearTimeout(queryTimer.current);
    },
    [],
  );

  const selectedNote =
    notes.find((note) => note.id === selectedId) ?? notes[0] ?? null;

  const loadNotes = useCallback(
    async (nextView = view, nextQuery = query, nextTag = activeTag) => {
      if (!ownerKey) return;
      setLoading(true);
      setLoadError("");
      try {
        const params = new URLSearchParams({ view: nextView });
        if (nextQuery.trim()) params.set("q", nextQuery.trim());
        if (nextTag) params.set("tag", nextTag);
        const response = await fetch(`/api/notes?${params.toString()}`, {
          headers: { "x-gptmemory-owner": ownerKey },
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          notes?: Partial<NoteRecord>[];
        };
        if (!response.ok) {
          throw new Error(parseError(payload, "노트를 불러오지 못했습니다."));
        }
        const nextNotes = (payload.notes ?? []).map(normalizeNote);
        setNotes(nextNotes);
        setSelectedId((current) => {
          if (current && nextNotes.some((note) => note.id === current)) {
            return current;
          }
          return nextNotes[0]?.id ?? null;
        });
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : "노트를 불러오지 못했습니다.",
        );
      } finally {
        setLoading(false);
      }
    },
    [activeTag, ownerKey, query, view],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadNotes(), 0);
    return () => window.clearTimeout(timer);
  }, [loadNotes]);

  useEffect(() => {
    if (selectedId !== null) return;
    const timer = window.setTimeout(() => setMobilePane("list"), 0);
    return () => window.clearTimeout(timer);
  }, [selectedId]);

  const changeQuery = (value: string) => {
    setQueryInput(value);
    if (queryTimer.current) window.clearTimeout(queryTimer.current);
    queryTimer.current = window.setTimeout(() => setQuery(value), 260);
  };

  const changeView = (nextView: ViewKey) => {
    setView(nextView);
    setActiveTag(null);
    setMobilePane("list");
  };

  const chooseTag = (tag: string | null) => {
    setActiveTag(tag);
    setView("all");
    setMobilePane("list");
  };

  const chooseNote = (id: string) => {
    setSelectedId(id);
    setMobilePane("detail");
  };

  const replaceNote = (updated: NoteRecord) => {
    setNotes((current) =>
      current.map((note) => (note.id === updated.id ? updated : note)),
    );
  };

  const removeFromCurrentList = (id: string) => {
    setNotes((current) => current.filter((note) => note.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  };

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    notes.forEach((note) =>
      note.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)),
    );
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8);
  }, [notes]);

  return (
    <main className="memory-app" data-mobile-pane={mobilePane}>
      <aside className="sidebar" aria-label="노트 탐색">
        <div className="brand-row">
          <button
            className="brand-button"
            type="button"
            onClick={() => changeView("all")}
            aria-label="GPTMemory 모든 노트"
          >
            <span className="brand-mark" aria-hidden="true">
              M
            </span>
            <span>GPTMemory</span>
          </button>
          <button
            className="icon-button sidebar-settings"
            type="button"
            aria-label="설정"
            title="설정은 곧 제공됩니다"
          >
            ···
          </button>
        </div>

        <div className="profile-card">
          <span className="profile-orb" aria-hidden="true">
            나
          </span>
          <span>
            <strong>My conversations</strong>
            <small>이 브라우저의 개인 노트</small>
          </span>
        </div>

        <nav className="nav-block" aria-label="빠른 링크">
          <p className="nav-label">Quick links</p>
          {(Object.keys(viewMeta) as ViewKey[]).map((key) => (
            <button
              className={`nav-item ${view === key && !activeTag ? "active" : ""}`}
              key={key}
              type="button"
              onClick={() => changeView(key)}
              aria-current={view === key && !activeTag ? "page" : undefined}
            >
              <span className="nav-symbol" aria-hidden="true">
                {viewMeta[key].symbol}
              </span>
              <span>{viewMeta[key].label}</span>
              {key === view && !loading ? (
                <span className="nav-count">{notes.length}</span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="nav-block tag-block">
          <div className="nav-label-row">
            <p className="nav-label">Tags</p>
            {activeTag ? (
              <button type="button" onClick={() => chooseTag(null)}>
                지우기
              </button>
            ) : null}
          </div>
          {tags.length ? (
            tags.map(([tag, count]) => (
              <button
                className={`tag-nav-item ${activeTag === tag ? "active" : ""}`}
                key={tag}
                type="button"
                onClick={() => chooseTag(tag)}
              >
                <span aria-hidden="true">#</span>
                <span>{tag}</span>
                <small>{count}</small>
              </button>
            ))
          ) : (
            <p className="sidebar-hint">노트를 만들면 태그가 여기에 모입니다.</p>
          )}
        </div>

        <div className="privacy-note">
          <span aria-hidden="true">◌</span>
          <p>
            공개 공유 링크만 가져옵니다.
            <br />
            대화는 외부 AI로 전송하지 않습니다.
          </p>
        </div>
      </aside>

      <section className="notes-pane" aria-label="노트 목록">
        <div className="list-topbar">
          <button
            className="mobile-nav-button"
            type="button"
            onClick={() => setMobilePane("navigation")}
            aria-label="탐색 열기"
          >
            ☰
          </button>
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <span className="sr-only">노트 검색</span>
            <input
              value={queryInput}
              onChange={(event) => changeQuery(event.target.value)}
              placeholder="Search notes"
              type="search"
            />
            {queryInput ? (
              <button
                type="button"
                onClick={() => changeQuery("")}
                aria-label="검색어 지우기"
              >
                ×
              </button>
            ) : null}
          </label>
          <button
            className="import-button"
            type="button"
            onClick={() => setImportOpen(true)}
            aria-label="ChatGPT 대화 가져오기"
            title="ChatGPT 대화 가져오기"
          >
            +
          </button>
        </div>

        <header className="list-heading">
          <div>
            <p>{activeTag ? "Tagged notes" : viewMeta[view].eyebrow}</p>
            <h1>{activeTag ? `#${activeTag}` : viewMeta[view].label}</h1>
          </div>
          <span>{loading ? "…" : `${notes.length} notes`}</span>
        </header>

        <div className="note-list" aria-live="polite" aria-busy={loading}>
          {loading ? (
            <ListSkeleton />
          ) : loadError ? (
            <div className="list-message error-message">
              <span aria-hidden="true">!</span>
              <h2>목록을 열 수 없어요</h2>
              <p>{loadError}</p>
              <button type="button" onClick={() => void loadNotes()}>
                다시 시도
              </button>
            </div>
          ) : notes.length ? (
            notes.map((note) => (
              <button
                className={`note-card ${selectedNote?.id === note.id ? "selected" : ""}`}
                key={note.id}
                type="button"
                onClick={() => chooseNote(note.id)}
              >
                <span className="note-card-topline">
                  <strong>{note.title}</strong>
                  {note.favorite ? (
                    <span className="favorite-dot" aria-label="즐겨찾기">
                      ♥
                    </span>
                  ) : null}
                </span>
                <span className="note-card-preview">{notePreview(note)}</span>
                <span className="note-card-meta">
                  <time dateTime={note.updatedAt}>
                    {formatDate(note.updatedAt)}
                  </time>
                  {note.tags.slice(0, 2).map((tag) => (
                    <span className="mini-tag" key={tag}>
                      #{tag}
                    </span>
                  ))}
                </span>
              </button>
            ))
          ) : (
            <div className="list-message">
              <span className="empty-glyph" aria-hidden="true">
                ✦
              </span>
              <h2>
                {queryInput || activeTag
                  ? "맞는 노트가 없어요"
                  : view === "trash"
                    ? "휴지통이 비어 있어요"
                    : "첫 노트를 만들어보세요"}
              </h2>
              <p>
                {queryInput || activeTag
                  ? "다른 검색어나 태그를 사용해보세요."
                  : view === "trash"
                    ? "삭제한 노트가 없거나 모두 영구 삭제되었습니다."
                    : "ChatGPT 공유 링크 하나면 대화의 흐름이 읽기 좋은 노트가 됩니다."}
              </p>
              {!queryInput && !activeTag && view === "all" ? (
                <button type="button" onClick={() => setImportOpen(true)}>
                  대화 가져오기
                </button>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <section className="detail-pane" aria-label="선택한 노트">
        {selectedNote ? (
          <NoteDetail
            key={`${selectedNote.id}:${detailResetToken}`}
            note={selectedNote}
            ownerKey={ownerKey}
            view={view}
            onBack={() => setMobilePane("list")}
            onUpdated={replaceNote}
            onRemoved={removeFromCurrentList}
          />
        ) : (
          <EmptyDetail
            onImport={() => setImportOpen(true)}
            onBack={() => setMobilePane("list")}
          />
        )}
      </section>

      {importOpen ? (
        <ImportDialog
          ownerKey={ownerKey}
          onClose={() => setImportOpen(false)}
          onImported={(note) => {
            if (queryTimer.current) window.clearTimeout(queryTimer.current);
            setQueryInput("");
            setQuery("");
            setActiveTag(null);
            setView(
              note.deletedAt ? "trash" : note.archived ? "archive" : "all",
            );
            setNotes((current) => [
              note,
              ...current.filter((item) => item.id !== note.id),
            ]);
            setSelectedId(note.id);
            setDetailResetToken((current) => current + 1);
            setMobilePane("detail");
            setImportOpen(false);
          }}
        />
      ) : null}
    </main>
  );
}

function ListSkeleton() {
  return (
    <div className="list-skeleton" aria-label="노트 목록 불러오는 중">
      {[0, 1, 2, 3].map((item) => (
        <div key={item}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function EmptyDetail({
  onImport,
  onBack,
}: {
  onImport: () => void;
  onBack: () => void;
}) {
  return (
    <div className="empty-detail">
      <button
        className="detail-back-button"
        type="button"
        onClick={onBack}
        aria-label="노트 목록으로 돌아가기"
      >
        ←
      </button>
      <div className="paper-orbit" aria-hidden="true">
        <span>“</span>
      </div>
      <p className="detail-eyebrow">A quiet place for your conversations</p>
      <h2>대화에서 중요한 건<br />목록보다 흐름이니까요.</h2>
      <p>
        공개 ChatGPT 공유 링크를 붙여 넣으면 질문, 답변, 수정된 조건과
        마지막 맥락을 순서대로 읽히는 한 편의 노트로 정리합니다.
      </p>
      <button className="primary-action" type="button" onClick={onImport}>
        첫 대화 가져오기 <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

function NoteDetail({
  note,
  ownerKey,
  view,
  onBack,
  onUpdated,
  onRemoved,
}: {
  note: NoteRecord;
  ownerKey: string;
  view: ViewKey;
  onBack: () => void;
  onUpdated: (note: NoteRecord) => void;
  onRemoved: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NoteDraft>({
    title: note.title,
    overview: note.overview,
    sections: note.sections,
    tags: note.tags,
  });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [actionError, setActionError] = useState("");
  const [permanentDeleteOpen, setPermanentDeleteOpen] = useState(false);
  const [permanentDeleteError, setPermanentDeleteError] = useState("");
  const [permanentlyDeleting, setPermanentlyDeleting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const permanentDeleteTriggerRef = useRef<HTMLButtonElement>(null);
  const permanentDeleteCancelRef = useRef<HTMLButtonElement>(null);
  const permanentDeleteConfirmRef = useRef<HTMLButtonElement>(null);
  const permanentDeleteInFlight = useRef(false);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!permanentDeleteOpen) return;
    const focusTimer = window.setTimeout(
      () => permanentDeleteCancelRef.current?.focus(),
      0,
    );
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || permanentDeleteInFlight.current) return;
      setPermanentDeleteOpen(false);
      setPermanentDeleteError("");
      window.setTimeout(() => permanentDeleteTriggerRef.current?.focus(), 0);
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [permanentDeleteOpen]);

  const patchNote = async (patch: Record<string, unknown>) => {
    const response = await fetch(`/api/notes/${encodeURIComponent(note.id)}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gptmemory-owner": ownerKey,
      },
      body: JSON.stringify(patch),
    });
    const payload = (await response.json()) as {
      note?: Partial<NoteRecord>;
    };
    if (!response.ok || !payload.note) {
      throw new Error(parseError(payload, "변경사항을 저장하지 못했습니다."));
    }
    const updated = normalizeNote(payload.note);
    onUpdated(updated);
    return updated;
  };

  const saveDraft = async (nextDraft = draft) => {
    setSaveState("saving");
    setActionError("");
    try {
      const updated = await patchNote(nextDraft);
      setDraft({
        title: updated.title,
        overview: updated.overview,
        sections: updated.sections,
        tags: updated.tags,
      });
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setActionError(
        error instanceof Error
          ? error.message
          : "변경사항을 저장하지 못했습니다.",
      );
    }
  };

  const queueSave = (nextDraft: NoteDraft) => {
    setDraft(nextDraft);
    setSaveState("idle");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveDraft(nextDraft), 850);
  };

  const runAction = async (patch: Record<string, unknown>) => {
    setActionError("");
    try {
      await patchNote(patch);
      if (
        "deletedAt" in patch ||
        ("archived" in patch &&
          Boolean(patch.archived) !== (view === "archive")) ||
        ("favorite" in patch && view === "favorites" && !patch.favorite)
      ) {
        onRemoved(note.id);
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "요청을 처리하지 못했습니다.",
      );
    }
  };

  const moveToTrash = async () => {
    setActionError("");
    try {
      const response = await fetch(
        `/api/notes/${encodeURIComponent(note.id)}`,
        {
          method: "DELETE",
          headers: { "x-gptmemory-owner": ownerKey },
        },
      );
      const payload = (await response.json()) as {
        note?: Partial<NoteRecord>;
      };
      if (!response.ok || !payload.note) {
        throw new Error(
          parseError(payload, "노트를 휴지통으로 옮기지 못했습니다."),
        );
      }
      onRemoved(note.id);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "노트를 휴지통으로 옮기지 못했습니다.",
      );
    }
  };

  const closePermanentDelete = () => {
    if (permanentDeleteInFlight.current) return;
    setPermanentDeleteOpen(false);
    setPermanentDeleteError("");
    window.setTimeout(() => permanentDeleteTriggerRef.current?.focus(), 0);
  };

  const permanentlyDeleteNote = async () => {
    if (permanentDeleteInFlight.current) return;
    permanentDeleteInFlight.current = true;
    setPermanentlyDeleting(true);
    setPermanentDeleteError("");

    try {
      const response = await fetch(
        `/api/notes/${encodeURIComponent(note.id)}?permanent=true`,
        {
          method: "DELETE",
          headers: { "x-gptmemory-owner": ownerKey },
        },
      );
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        // A successful permanent delete may intentionally return no body.
      }
      if (!response.ok) {
        throw new Error(
          parseError(payload, "노트를 영구 삭제하지 못했습니다."),
        );
      }

      permanentDeleteInFlight.current = false;
      setPermanentlyDeleting(false);
      onRemoved(note.id);
    } catch (error) {
      permanentDeleteInFlight.current = false;
      setPermanentlyDeleting(false);
      setPermanentDeleteError(
        error instanceof Error
          ? error.message
          : "노트를 영구 삭제하지 못했습니다.",
      );
    }
  };

  const closeEditor = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (
      draft.title !== note.title ||
      draft.overview !== note.overview ||
      JSON.stringify(draft.sections) !== JSON.stringify(note.sections) ||
      JSON.stringify(draft.tags) !== JSON.stringify(note.tags)
    ) {
      await saveDraft();
    }
    setEditing(false);
  };

  const restore = async () => {
    await runAction({ deletedAt: null });
    onRemoved(note.id);
  };

  return (
    <article className="note-detail">
      <header className="detail-toolbar">
        <button
          className="detail-back-button"
          type="button"
          onClick={onBack}
          aria-label="노트 목록으로 돌아가기"
        >
          ←
        </button>
        <div className="detail-source">
          <span className="source-pulse" aria-hidden="true" />
          <span>ChatGPT conversation</span>
        </div>
        <div className="toolbar-actions">
          {view === "trash" ? (
            <>
              <button
                type="button"
                onClick={() => void restore()}
                disabled={permanentlyDeleting}
              >
                복원
              </button>
              <button
                ref={permanentDeleteTriggerRef}
                className="danger-toolbar-button"
                type="button"
                onClick={() => {
                  setPermanentDeleteError("");
                  setPermanentDeleteOpen(true);
                }}
                disabled={permanentlyDeleting}
              >
                영구 삭제
              </button>
            </>
          ) : (
            <>
              {note.sourceUrl ? (
                <a
                  href={note.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="원본 ChatGPT 대화 새 창에서 열기"
                >
                  원문 ↗
                </a>
              ) : null}
              <button
                className={note.favorite ? "active" : ""}
                type="button"
                onClick={() => void runAction({ favorite: !note.favorite })}
                aria-label={note.favorite ? "즐겨찾기 해제" : "즐겨찾기에 추가"}
                title={note.favorite ? "즐겨찾기 해제" : "즐겨찾기"}
              >
                {note.favorite ? "♥" : "♡"}
              </button>
              <button
                type="button"
                onClick={() => void runAction({ archived: !note.archived })}
                aria-label={note.archived ? "보관 해제" : "보관"}
                title={note.archived ? "보관 해제" : "보관"}
              >
                {note.archived ? "보관 해제" : "보관"}
              </button>
              <button
                type="button"
                onClick={() => void moveToTrash()}
                aria-label="휴지통으로 이동"
                title="휴지통으로 이동"
              >
                ⌫
              </button>
            </>
          )}
        </div>
      </header>

      <div className="note-paper">
        <div className="note-meta-row">
          <span>
            {note.sourceMessageCount
              ? `${note.sourceMessageCount}개의 메시지에서 정리`
              : "대화 흐름 노트"}
          </span>
          <span aria-hidden="true">·</span>
          <time dateTime={note.updatedAt}>{formatDate(note.updatedAt)} 수정</time>
          <span className={`save-indicator ${saveState}`}>
            {saveState === "saving"
              ? "저장 중…"
              : saveState === "saved"
                ? "저장됨"
                : saveState === "error"
                  ? "저장 실패"
                  : ""}
          </span>
        </div>

        {editing ? (
          <div className="note-editor">
            <label>
              <span>Title</span>
              <input
                value={draft.title}
                onChange={(event) =>
                  queueSave({ ...draft, title: event.target.value })
                }
              />
            </label>
            <label>
              <span>Overview</span>
              <textarea
                value={draft.overview}
                rows={4}
                onChange={(event) =>
                  queueSave({ ...draft, overview: event.target.value })
                }
              />
            </label>
            <div className="section-editor-list">
              {draft.sections.map((section, index) => (
                <div className="section-editor" key={section.id}>
                  <span className="section-index">{index + 1}</span>
                  <label>
                    <span>Section heading</span>
                    <input
                      value={section.heading}
                      onChange={(event) => {
                        const sections = draft.sections.map((item) =>
                          item.id === section.id
                            ? { ...item, heading: event.target.value }
                            : item,
                        );
                        queueSave({ ...draft, sections });
                      }}
                    />
                  </label>
                  <label>
                    <span>Section body</span>
                    <textarea
                      value={section.body}
                      rows={7}
                      onChange={(event) => {
                        const sections = draft.sections.map((item) =>
                          item.id === section.id
                            ? { ...item, body: event.target.value }
                            : item,
                        );
                        queueSave({ ...draft, sections });
                      }}
                    />
                  </label>
                </div>
              ))}
            </div>
            <label>
              <span>Tags · 쉼표로 구분</span>
              <input
                value={draft.tags.join(", ")}
                onChange={(event) =>
                  queueSave({
                    ...draft,
                    tags: event.target.value
                      .split(",")
                      .map((tag) => tag.trim().replace(/^#/, ""))
                      .filter(Boolean)
                      .slice(0, 8),
                  })
                }
              />
            </label>
            <div className="editor-footer">
              <p>{actionError || "입력한 내용은 잠시 후 자동 저장됩니다."}</p>
              <button
                className="primary-action"
                type="button"
                onClick={() => void closeEditor()}
              >
                편집 마치기
              </button>
            </div>
          </div>
        ) : (
          <>
            <h1>{note.title}</h1>
            {note.overview ? <p className="note-overview">{note.overview}</p> : null}
            <div className="note-divider">
              <span />
              <i>conversation note</i>
              <span />
            </div>
            <div className="note-sections">
              {note.sections.map((section, index) => (
                <section key={section.id}>
                  <span className="section-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h2>{section.heading}</h2>
                    {section.body
                      .split(/\n{2,}/)
                      .filter(Boolean)
                      .map((paragraph, paragraphIndex) => (
                        <p key={`${section.id}-${paragraphIndex}`}>
                          {paragraph}
                        </p>
                      ))}
                  </div>
                </section>
              ))}
            </div>
            {note.tags.length ? (
              <div className="note-tags" aria-label="노트 태그">
                {note.tags.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>
            ) : null}
            {actionError ? <p className="inline-error">{actionError}</p> : null}
          </>
        )}
      </div>

      {!editing && view !== "trash" ? (
        <button
          className="edit-note-button"
          type="button"
          onClick={() => setEditing(true)}
        >
          <span aria-hidden="true">✎</span> Edit note
        </button>
      ) : null}

      {view === "trash" && permanentDeleteOpen ? (
        <div
          className="dialog-backdrop permanent-delete-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePermanentDelete();
          }}
        >
          <section
            className="permanent-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="permanent-delete-title"
            aria-describedby="permanent-delete-description"
            aria-busy={permanentlyDeleting}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const cancelButton = permanentDeleteCancelRef.current;
              const confirmButton = permanentDeleteConfirmRef.current;
              if (!cancelButton || !confirmButton) return;
              if (event.shiftKey && document.activeElement === cancelButton) {
                event.preventDefault();
                confirmButton.focus();
              } else if (
                !event.shiftKey &&
                document.activeElement === confirmButton
              ) {
                event.preventDefault();
                cancelButton.focus();
              }
            }}
          >
            <span className="permanent-delete-symbol" aria-hidden="true">
              !
            </span>
            <p className="dialog-kicker">Permanent deletion</p>
            <h2 id="permanent-delete-title">이 노트를 완전히 삭제할까요?</h2>
            <p
              className="permanent-delete-description"
              id="permanent-delete-description"
            >
              <strong>{note.title}</strong> 노트와 저장된 대화 정리를 즉시
              삭제합니다. 이 작업은 취소하거나 복원할 수 없습니다.
            </p>
            {permanentDeleteError ? (
              <p className="permanent-delete-error" role="alert">
                {permanentDeleteError}
              </p>
            ) : null}
            <div className="dialog-actions permanent-delete-actions">
              <button
                ref={permanentDeleteCancelRef}
                type="button"
                onClick={closePermanentDelete}
                disabled={permanentlyDeleting}
              >
                취소
              </button>
              <button
                ref={permanentDeleteConfirmRef}
                className="permanent-delete-action"
                type="button"
                onClick={() => void permanentlyDeleteNote()}
                disabled={permanentlyDeleting}
              >
                {permanentlyDeleting ? "삭제하는 중…" : "완전히 삭제"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </article>
  );
}

function ImportDialog({
  ownerKey,
  onClose,
  onImported,
}: {
  ownerKey: string;
  onClose: () => void;
  onImported: (note: NoteRecord) => void;
}) {
  const [shareUrl, setShareUrl] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [existing, setExisting] = useState<ExistingNoteSummary | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, submitting]);

  const requestImport = async (replace?: ExistingNoteSummary) => {
    if (!shareUrl.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    setStatus(
      replace
        ? "기존 노트를 보존한 채 새 결과를 준비하는 중입니다…"
        : "공개 대화를 불러와 노트로 정리하는 중입니다…",
    );
    try {
      const response = await fetch("/api/notes/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-gptmemory-owner": ownerKey,
        },
        body: JSON.stringify({
          shareUrl: shareUrl.trim(),
          ...(replace
            ? {
                replace: {
                  noteId: replace.id,
                  expectedUpdatedAt: replace.updatedAt,
                },
              }
            : {}),
        }),
      });
      const payload = (await response.json()) as ImportResponsePayload;

      if (
        response.status === 409 &&
        payload.status === "already_exists" &&
        payload.existing
      ) {
        setExisting(payload.existing);
        setStatus("");
        return;
      }
      if (!response.ok || !payload.note) {
        throw new Error(
          parseError(payload, "이 대화를 노트로 만들지 못했습니다."),
        );
      }
      onImported(normalizeNote(payload.note));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "가져오기를 완료하지 못했습니다.",
      );
      setStatus("");
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (existing) return;
    await requestImport();
  };

  const openExisting = async () => {
    if (!existing || submitting) return;
    setSubmitting(true);
    setError("");
    setStatus("기존 노트를 여는 중입니다…");
    try {
      const response = await fetch(
        `/api/notes/${encodeURIComponent(existing.id)}`,
        {
          headers: { "x-gptmemory-owner": ownerKey },
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as {
        note?: Partial<NoteRecord>;
      };
      if (!response.ok || !payload.note) {
        throw new Error(parseError(payload, "기존 노트를 열지 못했습니다."));
      }
      onImported(normalizeNote(payload.note));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "기존 노트를 열지 못했습니다.",
      );
      setStatus("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        className="import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <button
          className="dialog-close"
          type="button"
          onClick={onClose}
          disabled={submitting}
          aria-label="가져오기 창 닫기"
        >
          ×
        </button>
        <span className="dialog-kicker">New conversation note</span>
        <h2 id="import-title">대화를 노트로 가져오기</h2>
        <p className="dialog-intro">
          ChatGPT의 공개 공유 링크를 붙여 넣으세요. 질문과 답변의 순서를 따라가며
          맥락이 바뀐 지점을 하나의 읽기 좋은 노트로 정리합니다.
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            <span>ChatGPT share link</span>
            <div className="url-input-wrap">
              <span aria-hidden="true">↗</span>
              <input
                ref={inputRef}
                type="url"
                inputMode="url"
                value={shareUrl}
                onChange={(event) => setShareUrl(event.target.value)}
                placeholder="https://chatgpt.com/share/..."
                required
                disabled={submitting || Boolean(existing)}
              />
            </div>
          </label>
          <div className="import-assurance">
            <span aria-hidden="true">◉</span>
            <p>
              공개 공유 링크만 지원합니다. 외부 AI를 호출하지 않으며, 가져온
              대화는 이 노트를 만드는 데만 사용합니다.
            </p>
          </div>
          {existing ? (
            <div className="existing-note-card" role="status">
              <span className="existing-note-symbol" aria-hidden="true">
                ↺
              </span>
              <div>
                <p className="existing-note-label">이미 가져온 대화입니다</p>
                <h3>{existing.title}</h3>
                <p className="existing-note-meta">
                  {formatDate(existing.updatedAt)} 수정
                  {existing.deletedAt
                    ? " · 휴지통"
                    : existing.archived
                      ? " · 보관됨"
                      : ""}
                  {existing.sourceMessageCount
                    ? ` · ${existing.sourceMessageCount}개 메시지`
                    : ""}
                </p>
                <p className="existing-note-warning">
                  다시 생성하면 직접 편집한 내용을 포함한 현재 노트가 새 결과로
                  교체됩니다. 생성에 실패하면 기존 노트는 그대로 유지됩니다.
                </p>
              </div>
            </div>
          ) : null}
          {status ? (
            <div className="import-status" role="status">
              <span className="status-spinner" aria-hidden="true" />
              <span>{status}</span>
            </div>
          ) : null}
          {error ? (
            <p className="import-error" role="alert">
              {error}
            </p>
          ) : null}
          {existing ? (
            <div className="dialog-actions duplicate-actions">
              <button type="button" onClick={onClose} disabled={submitting}>
                취소
              </button>
              <button
                className="existing-open-action"
                type="button"
                onClick={() => void openExisting()}
                disabled={submitting}
              >
                기존 노트 열기
              </button>
              <button
                className="primary-action replace-action"
                type="button"
                onClick={() => void requestImport(existing)}
                disabled={submitting}
              >
                {submitting ? "처리하는 중…" : "다시 생성"}
              </button>
            </div>
          ) : (
            <div className="dialog-actions">
              <button type="button" onClick={onClose} disabled={submitting}>
                취소
              </button>
              <button
                className="primary-action"
                type="submit"
                disabled={submitting || !shareUrl.trim()}
              >
                {submitting ? "정리하는 중…" : "노트 만들기"}
                {!submitting ? <span aria-hidden="true">→</span> : null}
              </button>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
