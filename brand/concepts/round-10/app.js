/* Font review only. Canonical templates and brand tokens are never rewritten. */
(() => {
  "use strict";
  const fonts = {
    pretendard: { name: "Pretendard", label: "기준 · Pretendard", family: '"Pretendard", sans-serif', face: "Pretendard" },
    wanted: { name: "Wanted Sans", label: "A · Wanted Sans", family: '"Review Wanted", sans-serif', face: "Review Wanted" },
    neo: { name: "나눔스퀘어 네오", label: "B · 나눔스퀘어 네오", family: '"Review Neo", sans-serif', face: "Review Neo" },
    line: { name: "LINE Seed KR", label: "C · LINE Seed KR", family: '"Review LINE", sans-serif', face: "Review LINE" }
  };
  const scenes = {
    web: new URL("../../design-system/templates/company/", location.href),
    edu: new URL("../../design-system/templates/edu/", location.href)
  };
  const ui = {
    font: document.getElementById("font-picker"), scene: document.getElementById("scene-picker"),
    viewport: document.getElementById("viewport-picker"), scope: document.getElementById("scope-picker"),
    kind: document.getElementById("edu-picker"), compare: document.getElementById("compare-toggle"),
    status: document.getElementById("preview-status"), candidate: document.getElementById("candidate-frame"),
    baseline: document.getElementById("baseline-frame"), baselinePane: document.getElementById("baseline-pane"),
    label: document.getElementById("candidate-label"), grid: document.getElementById("preview-grid"),
    copy: document.getElementById("sample-copy")
  };
  const defaultCopy = ui.copy.value;
  const query = new URLSearchParams(location.search);
  if (Object.hasOwn(fonts, query.get("font"))) ui.font.value = query.get("font");
  if (Object.hasOwn(scenes, query.get("scene"))) ui.scene.value = query.get("scene");
  if (["1280", "390"].includes(query.get("width"))) ui.viewport.value = query.get("width");
  if (["all", "headings"].includes(query.get("scope"))) ui.scope.value = query.get("scope");
  if (["cover", "prose", "table", "steps", "summary"].includes(query.get("kind"))) ui.kind.value = query.get("kind");
  ui.compare.checked = query.get("compare") === "1";

  let revision = 0;
  let ready = false;
  let lastError = null;
  let eduData;
  const sizes = new WeakMap();
  const observers = new WeakMap();
  const styleLoads = new WeakMap();

  function state() {
    return { font: ui.font.value, scene: ui.scene.value, width: ui.viewport.value, scope: ui.scope.value, kind: ui.kind.value, compare: ui.compare.checked };
  }

  async function until(test, label, timeout = 12000) {
    const start = performance.now();
    while (performance.now() - start < timeout) {
      try { if (test()) return; } catch { /* Frame navigation can temporarily detach its document. */ }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error(`${label} 준비가 지연되고 있습니다.`);
  }

  async function loadFaces(doc, id) {
    const family = fonts[id].face;
    const sample = "하고 싶은 일을 더 많이 해낼 수 있도록 Biadone AI AX 0123456789";
    let loaded;
    try {
      loaded = await Promise.all([400, 700].map(weight => doc.fonts.load(`${weight} 32px "${family}"`, sample)));
    } catch {
      throw new Error(`${fonts[id].name} 원본 서체 파일을 불러오지 못했습니다.`);
    }
    if (loaded.some(list => !list.length) || ![400, 700].every(weight => doc.fonts.check(`${weight} 32px "${family}"`, sample))) {
      throw new Error(`${fonts[id].name} 원본을 불러오지 못했습니다.`);
    }
    await doc.fonts.ready;
  }

  async function loadReviewStyles(frame, doc) {
    if (styleLoads.get(frame)?.doc === doc) return styleLoads.get(frame).promise;
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("fonts.css", location.href).href;
    const promise = new Promise((resolve, reject) => {
      link.addEventListener("load", resolve, { once: true });
      link.addEventListener("error", () => reject(new Error("비교용 서체 스타일을 불러오지 못했습니다.")), { once: true });
    });
    styleLoads.set(frame, { doc, promise });
    doc.head.append(link);
    return promise;
  }

  function sizeFrame(frame) {
    const item = sizes.get(frame);
    if (!item || !frame.contentDocument?.body) return;
    const shell = frame.parentElement;
    shell.style.maxWidth = `${item.width + 2}px`;
    const nativeHeight = item.scene === "edu" ? 900 : Math.ceil(frame.contentDocument.body.getBoundingClientRect().height);
    const available = Math.max(1, shell.clientWidth);
    const scale = Math.min(1, available / item.width);
    frame.style.width = `${item.width}px`;
    frame.style.height = `${nativeHeight}px`;
    frame.style.transform = `scale(${scale})`;
    shell.style.height = `${Math.ceil(nativeHeight * scale) + 2}px`;
    frame.dataset.scale = String(scale);
  }

  function watchFrame(frame) {
    const doc = frame.contentDocument;
    if (observers.get(frame)?.doc === doc) return;
    observers.get(frame)?.observer.disconnect();
    const observer = new ResizeObserver(() => sizeFrame(frame));
    observer.observe(doc.body);
    observers.set(frame, { doc, observer });
  }

  async function applyFrame(frame, id, snapshot, job) {
    const pane = frame.closest(".preview-pane");
    pane.setAttribute("aria-busy", "true");
    const expected = scenes[snapshot.scene];
    const width = snapshot.scene === "edu" ? 1600 : Number(snapshot.width);
    frame.style.width = `${width}px`;
    frame.style.height = snapshot.scene === "edu" ? "900px" : "1200px";
    if (new URL(frame.src).pathname !== expected.pathname) frame.src = expected.href;
    await until(() => frame.contentDocument?.readyState === "complete" && new URL(frame.contentDocument.URL).pathname === expected.pathname, "미리보기 페이지");
    if (job !== revision) return null;
    const doc = frame.contentDocument;
    await loadReviewStyles(frame, doc);
    await loadFaces(doc, id);
    if (job !== revision) return null;

    let sheet = doc.getElementById("font-review-overrides");
    if (!sheet) { sheet = doc.createElement("style"); sheet.id = "font-review-overrides"; doc.head.append(sheet); }
    const bodyFamily = snapshot.scope === "all" ? fonts[id].family : fonts.pretendard.family;
    sheet.textContent = `
      body.biadone-theme {
        --font-primary: ${bodyFamily};
        --button-font-family: ${bodyFamily};
        --ui-heading-weight: 700;
        --ui-label-weight: 700;
        font-family: var(--font-primary);
        font-weight: 400;
        font-synthesis: none;
      }
      .biadone-title, .biadone-section-title, .biadone-subtitle,
      .biadone-message, .biadone-flow p, .biadone-steps :is(h3,h4) {
        font-family: ${fonts[id].family};
        font-weight: 700;
      }
      .edu-toolbar, .edu-viewer-info, .edu-load-error, noscript { display:none; }
      body.edu-viewer { background:var(--color-background); }
      .edu-deck { padding:0; overflow:visible; }
      .edu-slide-frame { margin:0; }
    `;
    let pages = null;
    if (snapshot.scene === "edu") {
      await until(() => frame.contentWindow.biadoneEdu?.getSnapshot().ready, "Edu 페이지 분할");
      if (job !== revision) return null;
      if (!eduData) {
        eduData = fetch(new URL("content.json", scenes.edu)).then(response => {
          if (!response.ok) throw new Error("Edu 원문을 불러오지 못했습니다.");
          return response.json();
        });
      }
      const data = await eduData;
      if (job !== revision) return null;
      pages = await frame.contentWindow.biadoneEdu.render(data);
      if (job !== revision) return null;
      if (!pages.ready || pages.overflowPages.length || !pages.paragraphsPreserved || !pages.tablePreserved || !pages.stepsPreserved) {
        throw new Error(`${fonts[id].name}의 Edu 페이지를 확인해 주세요. 내용이 넘치거나 원문과 다른 부분이 있습니다.`);
      }
      const native = doc.getElementById("zoom-mode");
      native.value = "native";
      native.dispatchEvent(new frame.contentWindow.Event("change", { bubbles: true }));
      const selected = [...doc.querySelectorAll(".edu-slide-frame")].findIndex(node => node.querySelector(".biadone-slide")?.dataset.kind === snapshot.kind);
      const picker = doc.getElementById("page-picker");
      picker.value = String(Math.max(0, selected));
      picker.dispatchEvent(new frame.contentWindow.Event("change", { bubbles: true }));
    }
    if (job !== revision) return null;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (job !== revision) return null;
    sizes.set(frame, { width, scene: snapshot.scene });
    watchFrame(frame);
    sizeFrame(frame);
    frame.dataset.font = id;
    frame.dataset.scope = snapshot.scope;
    frame.dataset.scene = snapshot.scene;
    frame.dataset.kind = snapshot.kind;
    frame.title = `${fonts[id].name} · ${snapshot.scene === "web" ? "회사 홈페이지" : "Edu 강의자료"} 미리보기`;
    pane.setAttribute("aria-busy", "false");
    return { font: id, pages: pages?.pageCount ?? null };
  }

  async function update() {
    const job = ++revision;
    ready = false;
    lastError = null;
    const snapshot = state();
    ui.grid.dataset.compare = String(snapshot.compare);
    ui.baselinePane.hidden = !snapshot.compare;
    ui.label.textContent = fonts[snapshot.font].label;
    document.getElementById("viewport-control").hidden = snapshot.scene !== "web";
    document.getElementById("edu-control").hidden = snapshot.scene !== "edu";
    document.querySelectorAll("[data-preview-font]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.previewFont === snapshot.font)));
    const url = new URL(location.href);
    url.search = new URLSearchParams({ ...snapshot, compare: snapshot.compare ? "1" : "0" });
    history.replaceState(null, "", url);
    ui.status.textContent = `${fonts[snapshot.font].name} 원본과 화면을 불러오는 중입니다.`;
    try {
      const tasks = [applyFrame(ui.candidate, snapshot.font, snapshot, job)];
      if (snapshot.compare) tasks.push(applyFrame(ui.baseline, "pretendard", snapshot, job));
      const results = await Promise.all(tasks);
      if (job !== revision) return;
      ready = true;
      const pageNote = snapshot.scene === "edu" ? ` · ${results.filter(Boolean).map(item => `${fonts[item.font].name} ${item.pages}장`).join(" / ")}` : "";
      ui.status.textContent = `${fonts[snapshot.font].label} · ${snapshot.scope === "all" ? "제목·본문에 적용" : "제목에만 적용, 본문 Pretendard"} · 로고 고정${pageNote}`;
    } catch (error) {
      if (job !== revision) return;
      lastError = error.message;
      ui.status.textContent = `${error.message} 새로고침하거나 다른 후보를 골라 주세요.`;
    }
  }

  function updateCopy() {
    const text = ui.copy.value.trim() ? ui.copy.value : defaultCopy;
    document.querySelectorAll("[data-sample-title]").forEach(node => { node.textContent = text; });
  }
  ui.copy.addEventListener("input", updateCopy);
  document.getElementById("reset-copy").addEventListener("click", () => { ui.copy.value = defaultCopy; updateCopy(); });
  for (const control of [ui.font, ui.scene, ui.viewport, ui.scope, ui.kind, ui.compare]) control.addEventListener("change", update);
  document.querySelectorAll("[data-preview-font]").forEach(button => button.addEventListener("click", () => {
    ui.font.value = button.dataset.previewFont;
    update();
    document.getElementById("preview").scrollIntoView({ block: "start", behavior: "auto" });
  }));
  const shellObserver = new ResizeObserver(() => { sizeFrame(ui.candidate); if (ui.compare.checked) sizeFrame(ui.baseline); });
  document.querySelectorAll(".frame-shell").forEach(shell => shellObserver.observe(shell));
  Promise.all(Object.keys(fonts).map(async id => {
    const row = document.querySelector(`.font-row[data-font="${id}"]`);
    try {
      await loadFaces(document, id);
      row.dataset.load = "ready";
      row.querySelector("[data-font-status]").textContent = "원본 서체 표시 중";
    } catch {
      row.dataset.load = "failed";
      row.querySelector("[data-font-status]").textContent = "서체 파일을 불러오지 못했습니다.";
    }
  }));
  window.biadoneFontReview = Object.freeze({ getSnapshot: () => ({ ready, error: lastError, revision, ...state() }) });
  update();
})();
