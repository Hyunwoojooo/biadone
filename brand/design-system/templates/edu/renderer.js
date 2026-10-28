/* Editable HTML source renderer. No content is truncated or scaled independently. */
(() => {
  "use strict";

  const WIDTH = 1600;
  const HEIGHT = 900;
  const FIT_TOLERANCE = 1;
  const labels = { cover: "표지", prose: "본문", table: "비교표", steps: "순서", summary: "요약·출처" };
  const ui = {
    deck: document.getElementById("slides"),
    host: document.getElementById("measurement-host"),
    template: document.getElementById("slide-template"),
    previous: document.getElementById("previous-page"),
    next: document.getElementById("next-page"),
    picker: document.getElementById("page-picker"),
    zoom: document.getElementById("zoom-mode"),
    zoomValue: document.getElementById("zoom-value"),
    showAll: document.getElementById("show-all"),
    status: document.getElementById("viewer-status"),
    error: document.getElementById("load-error")
  };
  const state = { data: null, pages: [], index: 0, ready: false, fontLoaded: false, fontReadiness: {}, renderVersion: 0 };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function fontRequirements(data) {
    const probe = ui.template.content.firstElementChild.cloneNode(true);
    const heading = probe.querySelector("[data-slide-title]");
    const body = element("p", "biadone-body", data.cover.description);
    heading.textContent = data.cover.title;
    probe.querySelector("[data-slide-body]").append(body);
    ui.host.append(probe);
    try {
      const requirement = (node, sample) => {
        const style = getComputedStyle(node);
        // Keep only the first family: a fallback must not count as its successful load.
        const familyToken = style.fontFamily.match(/^\s*("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^,]+)/)?.[1].trim() || "sans-serif";
        return {
          family: familyToken.replace(/^(["'])(.*)\1$/, "$2"),
          weight: style.fontWeight,
          size: style.fontSize,
          query: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${familyToken}`,
          sample
        };
      };
      return {
        heading: requirement(heading, [data.cover.title, data.text.title, data.table.title, data.process.title, data.summary.title, ...data.process.steps.map(step => step.title)].join(" ")),
        body: requirement(body, [data.cover.description, ...data.text.paragraphs, ...data.table.headers, ...data.table.rows.flat(), ...data.process.steps.map(step => step.description), ...data.summary.paragraphs].join(" "))
      };
    } finally {
      probe.remove();
    }
  }

  async function loadFont(requirement) {
    let loaded = false;
    try {
      const faces = await document.fonts.load(requirement.query, requirement.sample);
      loaded = faces.length > 0 && document.fonts.check(requirement.query, requirement.sample);
    } catch {
      // Preserve rendering with a visible fallback-font status when a file fails.
    }
    return { family: requirement.family, weight: requirement.weight, size: requirement.size, loaded };
  }

  function validate(data) {
    const text = (value, path) => {
      if (typeof value !== "string") throw new Error(`${path}는 문자열이어야 합니다.`);
    };
    const list = (value, path) => {
      if (!Array.isArray(value)) throw new Error(`${path}는 배열이어야 합니다.`);
    };
    if (!data || data.schemaVersion !== 1) throw new Error("content.json의 schemaVersion은 1이어야 합니다.");
    for (const key of ["title", "sampleLabel", "source", "note"]) text(data.meta?.[key], `meta.${key}`);
    for (const key of ["title", "description"]) text(data.cover?.[key], `cover.${key}`);
    list(data.cover.outcomes, "cover.outcomes");
    data.cover.outcomes.forEach((item, index) => {
      text(item.label, `cover.outcomes[${index}].label`);
      text(item.text, `cover.outcomes[${index}].text`);
    });
    for (const section of ["text", "summary"]) {
      text(data[section]?.title, `${section}.title`);
      list(data[section].paragraphs, `${section}.paragraphs`);
      data[section].paragraphs.forEach((item, index) => text(item, `${section}.paragraphs[${index}]`));
    }
    text(data.table?.title, "table.title");
    list(data.table.headers, "table.headers");
    if (!data.table.headers.length) throw new Error("table.headers에는 최소 한 열이 필요합니다.");
    data.table.headers.forEach((item, index) => text(item, `table.headers[${index}]`));
    list(data.table.rows, "table.rows");
    data.table.rows.forEach((row, index) => {
      list(row, `table.rows[${index}]`);
      if (row.length !== data.table.headers.length) throw new Error(`table.rows[${index}]의 열 수가 머리말과 다릅니다.`);
      row.forEach((item, column) => text(item, `table.rows[${index}][${column}]`));
    });
    text(data.process?.title, "process.title");
    list(data.process.steps, "process.steps");
    data.process.steps.forEach((item, index) => {
      text(item.title, `process.steps[${index}].title`);
      text(item.description, `process.steps[${index}].description`);
    });
    list(data.summary.sources, "summary.sources");
    data.summary.sources.forEach((item, index) => {
      for (const key of ["title", "path", "note"]) text(item[key], `summary.sources[${index}].${key}`);
    });
  }

  function createPage(kind, title) {
    const slide = ui.template.content.firstElementChild.cloneNode(true);
    slide.dataset.kind = kind;
    slide.querySelector("[data-slide-title]").textContent = title;
    slide.querySelector("[data-slide-label]").textContent = `Edu · ${labels[kind]}`;
    slide.querySelector("[data-slide-source]").textContent = `${state.data.meta.sampleLabel} · 출처: ${state.data.meta.source}`;
    slide.querySelector("[data-page-number]").textContent = "00 / 00";
    ui.host.append(slide);
    const page = {
      kind,
      title,
      slide,
      body: slide.querySelector("[data-slide-body]"),
      content: slide.querySelector(".biadone-slide-content"),
      overflowItems: []
    };
    state.pages.push(page);
    return page;
  }

  function fits(page) {
    const content = page.content;
    const header = page.slide.querySelector(".biadone-header");
    const footer = page.slide.querySelector(".edu-slide__footer");
    return content.scrollHeight <= content.clientHeight + FIT_TOLERANCE &&
      content.scrollWidth <= content.clientWidth + FIT_TOLERANCE &&
      header.scrollWidth <= header.clientWidth + FIT_TOLERANCE &&
      footer.scrollWidth <= footer.clientWidth + FIT_TOLERANCE;
  }

  function flagOverflow(page, itemLabel) {
    if (!page.overflowItems.includes(itemLabel)) page.overflowItems.push(itemLabel);
    page.slide.dataset.overflow = "true";
    let notice = page.slide.querySelector(".edu-overflow-notice");
    if (!notice) {
      notice = element("p", "biadone-source edu-overflow-notice");
      notice.setAttribute("role", "note");
      page.slide.querySelector(".edu-slide__heading").append(notice);
    }
    notice.textContent = `편집 필요 · ${page.overflowItems.join(", ")}을 한 페이지에 담을 수 없습니다. 원문 전체를 유지했습니다. content.json에서 항목을 나누어 주세요.`;
  }

  function makeParagraph(text, kind, index, start = 0) {
    const paragraph = element("p", "biadone-body", text);
    paragraph.dataset.sourceKind = kind;
    paragraph.dataset.sourceIndex = String(index);
    paragraph.dataset.sourceStart = String(start);
    paragraph.dataset.sourceEnd = String(start + text.length);
    return paragraph;
  }

  function sentences(text) {
    if (typeof Intl.Segmenter === "function") {
      const parts = Array.from(new Intl.Segmenter("ko", { granularity: "sentence" }).segment(text), item => item.segment);
      if (parts.length && parts.join("") === text) return parts;
    }
    // Preserve every character, including whitespace, when Intl.Segmenter is unavailable.
    const parts = [];
    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
      if (!/[.!?。！？]/u.test(text[index])) continue;
      let end = index + 1;
      while (end < text.length && /[.!?。！？\u0022”’')\]]/u.test(text[end])) end += 1;
      if (end < text.length && !/\s/u.test(text[end])) continue;
      while (end < text.length && /\s/u.test(text[end])) end += 1;
      parts.push(text.slice(start, end));
      start = end;
      index = end - 1;
    }
    if (start < text.length) parts.push(text.slice(start));
    return parts.length ? parts : [text];
  }

  function paginateParagraphs(section, kind = "prose") {
    const newPage = () => {
      const page = createPage(kind, section.title);
      page.body.classList.add("edu-prose");
      return page;
    };
    let page = newPage();
    section.paragraphs.forEach((text, index) => {
      if (page.overflowItems.length) page = newPage();
      let paragraph = makeParagraph(text, kind, index);
      page.body.append(paragraph);
      if (fits(page)) return;
      paragraph.remove();
      if (page.body.children.length) page = newPage();
      page.body.append(paragraph);
      if (fits(page)) return;
      paragraph.remove();

      const parts = sentences(text);
      if (parts.length === 1) {
        page.body.append(paragraph);
        flagOverflow(page, `${index + 1}번 문단의 문장`);
        return;
      }

      let fragment = null;
      let offset = 0;
      for (const sentence of parts) {
        if (page.overflowItems.length) {
          page = newPage();
          fragment = null;
        }
        if (!fragment) {
          fragment = makeParagraph("", kind, index, offset);
          page.body.append(fragment);
        }
        const previousText = fragment.textContent;
        fragment.textContent = previousText + sentence;
        fragment.dataset.sourceEnd = String(offset + sentence.length);
        if (fits(page)) {
          offset += sentence.length;
          continue;
        }
        fragment.textContent = previousText;
        fragment.dataset.sourceEnd = String(offset);
        if (!previousText) fragment.remove();
        if (page.body.children.length) page = newPage();
        fragment = makeParagraph(sentence, kind, index, offset);
        page.body.append(fragment);
        offset += sentence.length;
        if (!fits(page)) flagOverflow(page, `${index + 1}번 문단의 문장`);
      }
    });
    return { page, newPage };
  }

  function renderCover(data) {
    const page = createPage("cover", data.title);
    page.body.classList.add("edu-cover");
    page.body.append(element("p", "biadone-body", data.description));
    const outcomes = element("div", "edu-cover__outcomes");
    data.outcomes.forEach(item => {
      const outcome = element("div");
      outcome.append(element("p", "biadone-source", item.label), element("p", "biadone-body", item.text));
      outcomes.append(outcome);
    });
    page.body.append(outcomes);
    if (!fits(page)) flagOverflow(page, "표지 제목 또는 소개");
  }

  function renderTable(data) {
    const newPage = () => {
      const page = createPage("table", data.title);
      const table = element("table", "biadone-table edu-table");
      table.append(element("caption", "edu-visually-hidden", data.title));
      const head = element("thead");
      const row = element("tr");
      data.headers.forEach(text => {
        const cell = element("th", "", text);
        cell.scope = "col";
        row.append(cell);
      });
      head.append(row);
      page.rows = element("tbody");
      table.append(head, page.rows);
      page.body.append(table);
      return page;
    };
    let page = newPage();
    data.rows.forEach((row, index) => {
      if (page.overflowItems.length) page = newPage();
      const node = element("tr");
      node.dataset.sourceKind = "table";
      node.dataset.sourceIndex = String(index);
      row.forEach((text, column) => {
        const cell = element(column === 0 ? "th" : "td", "", text);
        if (column === 0) cell.scope = "row";
        node.append(cell);
      });
      page.rows.append(node);
      if (fits(page)) return;
      node.remove();
      if (page.rows.children.length) page = newPage();
      page.rows.append(node);
      if (!fits(page)) flagOverflow(page, `표 ${index + 1}행 또는 열 머리말`);
    });
  }

  function renderSteps(data) {
    const newPage = () => {
      const page = createPage("steps", data.title);
      page.steps = element("ol", "biadone-steps");
      page.body.append(page.steps);
      return page;
    };
    let page = newPage();
    data.steps.forEach((step, index) => {
      if (page.overflowItems.length) page = newPage();
      const item = element("li");
      item.value = index + 1;
      item.dataset.sourceKind = "steps";
      item.dataset.sourceIndex = String(index);
      const number = element("span", "biadone-step-number", String(index + 1).padStart(2, "0"));
      number.setAttribute("aria-hidden", "true");
      const copy = element("div");
      copy.append(element("h3", "", step.title), element("p", "", step.description));
      item.append(number, copy);
      if (!page.steps.children.length) page.steps.start = index + 1;
      page.steps.append(item);
      if (fits(page)) return;
      item.remove();
      if (page.steps.children.length) page = newPage();
      if (!page.steps.children.length) page.steps.start = index + 1;
      page.steps.append(item);
      if (!fits(page)) flagOverflow(page, `${index + 1}번 단계`);
    });
  }

  function renderSummary(data) {
    let { page, newPage } = paginateParagraphs(data, "summary");
    function sourceGroup() {
      let group = page.body.querySelector(".edu-summary-sources");
      if (!group) {
        group = element("div", "edu-summary-sources");
        group.append(element("p", "biadone-source", "예시 내용과 레이아웃의 출처"));
        page.body.append(group);
      }
      return group;
    }
    data.sources.forEach((source, index) => {
      if (page.overflowItems.length) page = newPage();
      let group = sourceGroup();
      const node = element("p", "biadone-source", `${source.title} · ${source.path}\n${source.note}`);
      node.dataset.sourceKind = "sources";
      node.dataset.sourceIndex = String(index);
      group.append(node);
      if (fits(page)) return;
      node.remove();
      if (group.children.length === 1) group.remove();
      if (page.body.children.length) page = newPage();
      group = sourceGroup();
      group.append(node);
      if (!fits(page)) flagOverflow(page, `${index + 1}번 출처`);
    });
  }

  function finishPages() {
    const totals = state.pages.reduce((result, page) => {
      result[page.kind] = (result[page.kind] || 0) + 1;
      return result;
    }, {});
    const parts = {};
    const frames = state.pages.map((page, index) => {
      parts[page.kind] = (parts[page.kind] || 0) + 1;
      page.slide.querySelector("[data-slide-label]").textContent = `Edu · ${labels[page.kind]}${totals[page.kind] > 1 ? ` · ${parts[page.kind]}/${totals[page.kind]}` : ""}`;
      page.slide.querySelector("[data-page-number]").textContent = `${String(index + 1).padStart(2, "0")} / ${String(state.pages.length).padStart(2, "0")}`;
      page.slide.setAttribute("aria-label", `${index + 1} / ${state.pages.length} · ${labels[page.kind]} · ${page.title.replace(/\n/g, " ")}`);
      if (!fits(page) && !page.overflowItems.length) flagOverflow(page, "제목 또는 고정 머리말");
      page.measurement = {
        contentHeight: page.content.clientHeight,
        contentScrollHeight: page.content.scrollHeight,
        width: page.slide.offsetWidth,
        height: page.slide.offsetHeight
      };
      page.nativeHeight = Math.max(HEIGHT, page.slide.scrollHeight);
      page.frame = element("section", "edu-slide-frame");
      page.frame.id = `page-${index + 1}`;
      page.frame.setAttribute("aria-label", `${index + 1}번 슬라이드`);
      page.frame.append(page.slide);
      return page.frame;
    });
    ui.deck.replaceChildren(...frames);
    ui.host.replaceChildren();
    ui.picker.replaceChildren(...state.pages.map((page, index) => {
      const option = element("option", "", `${String(index + 1).padStart(2, "0")} · ${labels[page.kind]}`);
      option.value = String(index);
      return option;
    }));
    ui.picker.disabled = false;
  }

  function fitViewer() {
    if (!state.pages.length) return;
    const style = getComputedStyle(ui.deck);
    const availableWidth = Math.max(1, ui.deck.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    const availableHeight = Math.max(160, window.innerHeight - ui.deck.getBoundingClientRect().top - 32);
    const scale = ui.zoom.value === "native" ? 1 : Math.min(1, availableWidth / WIDTH, ui.showAll.checked ? 1 : availableHeight / HEIGHT);
    state.pages.forEach(page => {
      page.frame.style.setProperty("--edu-scale", String(scale));
      page.frame.style.width = `${WIDTH * scale}px`;
      page.frame.style.height = `${page.nativeHeight * scale}px`;
    });
    ui.zoomValue.value = `${Math.round(scale * 100)}%`;
  }

  function updateStatus() {
    const overflowCount = state.pages.filter(page => page.overflowItems.length).length;
    const failedFonts = Object.entries(state.fontReadiness)
      .filter(([, font]) => !font.loaded)
      .map(([role, font]) => `${role === "heading" ? "제목" : "본문"} ${font.family}`);
    const fontNote = state.fontLoaded ? "" : ` · ${failedFonts.join(", ")} 로드 실패: 대체 서체로 측정`;
    const overflowNote = overflowCount ? ` · 편집 필요 ${overflowCount}장` : "";
    ui.status.textContent = `${state.data.meta.sampleLabel} · ${state.index + 1} / ${state.pages.length}장 · 원본 1600×900${fontNote}${overflowNote}`;
  }

  function goToPage(index, scroll = false) {
    if (!state.pages.length) return;
    state.index = Math.max(0, Math.min(state.pages.length - 1, index));
    state.pages.forEach((page, pageIndex) => {
      page.frame.hidden = !ui.showAll.checked && pageIndex !== state.index;
    });
    ui.picker.value = String(state.index);
    ui.previous.disabled = state.index === 0;
    ui.next.disabled = state.index === state.pages.length - 1;
    fitViewer();
    updateStatus();
    history.replaceState(null, "", `#page-${state.index + 1}`);
    if (scroll && ui.showAll.checked) state.pages[state.index].frame.scrollIntoView({ block: "start", behavior: "auto" });
  }

  function getSnapshot() {
    if (!state.ready) return { ready: false };
    const nodes = kind => Array.from(ui.deck.querySelectorAll(`[data-source-kind="${kind}"]`));
    const restoreParagraphs = (kind, count) => Array.from({ length: count }, (_, index) => nodes(kind)
      .filter(node => Number(node.dataset.sourceIndex) === index).map(node => node.textContent).join(""));
    const paragraphs = restoreParagraphs("prose", state.data.text.paragraphs.length);
    const rows = nodes("table").map(row => Array.from(row.children, cell => cell.textContent));
    const steps = nodes("steps").map(item => ({ title: item.querySelector("h3").textContent, description: item.querySelector("p").textContent }));
    const typeSize = selector => {
      const node = ui.deck.querySelector(selector);
      return node ? getComputedStyle(node).fontSize : null;
    };
    return {
      ready: true,
      fontLoaded: state.fontLoaded,
      fontReadiness: Object.fromEntries(Object.entries(state.fontReadiness).map(([role, font]) => [role, { ...font }])),
      canvas: { width: WIDTH, height: HEIGHT },
      pageCount: state.pages.length,
      sectionPages: state.pages.reduce((counts, page) => {
        counts[page.kind] = (counts[page.kind] || 0) + 1;
        return counts;
      }, {}),
      sourceItemCounts: { prose: state.data.text.paragraphs.length, rows: state.data.table.rows.length, steps: state.data.process.steps.length },
      renderedItemCounts: { prose: new Set(nodes("prose").map(node => node.dataset.sourceIndex)).size, rows: rows.length, steps: steps.length },
      paragraphsPreserved: JSON.stringify(paragraphs) === JSON.stringify(state.data.text.paragraphs),
      tablePreserved: JSON.stringify(rows) === JSON.stringify(state.data.table.rows),
      stepsPreserved: JSON.stringify(steps) === JSON.stringify(state.data.process.steps),
      globalStepNumbers: nodes("steps").map(item => item.value),
      typography: { title: typeSize(".biadone-title"), body: typeSize(".biadone-body"), table: typeSize(".biadone-table"), stepTitle: typeSize(".biadone-steps h3"), stepBody: typeSize(".biadone-steps p") },
      overflowPages: state.pages.flatMap((page, index) => page.overflowItems.length ? [{ page: index + 1, items: [...page.overflowItems] }] : []),
      pageMeasurements: state.pages.map(page => ({ kind: page.kind, ...page.measurement }))
    };
  }

  async function render(candidate) {
    const data = JSON.parse(JSON.stringify(candidate));
    validate(data);
    const version = ++state.renderVersion;
    state.ready = false;
    ui.deck.setAttribute("aria-busy", "true");
    ui.status.textContent = "글꼴을 확인하고 실제 콘텐츠 높이를 측정하는 중입니다.";
    const requirements = fontRequirements(data);
    const [heading, body] = await Promise.all([loadFont(requirements.heading), loadFont(requirements.body)]);
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (version !== state.renderVersion) return { ready: false, superseded: true };
    state.fontReadiness = { heading, body };
    state.fontLoaded = heading.loaded && body.loaded;
    state.data = data;
    state.pages = [];
    ui.host.replaceChildren();
    document.title = data.meta.title;
    document.querySelector(".edu-sample-label").textContent = data.meta.sampleLabel;
    renderCover(data.cover);
    paginateParagraphs(data.text);
    renderTable(data.table);
    renderSteps(data.process);
    renderSummary(data.summary);
    finishPages();
    ui.error.hidden = true;
    ui.deck.setAttribute("aria-busy", "false");
    state.ready = true;
    const hash = /^#page-(\d+)$/.exec(location.hash);
    goToPage(hash ? Number(hash[1]) - 1 : 0);
    return getSnapshot();
  }

  ui.previous.addEventListener("click", () => goToPage(state.index - 1, true));
  ui.next.addEventListener("click", () => goToPage(state.index + 1, true));
  ui.picker.addEventListener("change", () => goToPage(Number(ui.picker.value), true));
  ui.zoom.addEventListener("change", fitViewer);
  ui.showAll.addEventListener("change", () => goToPage(state.index, true));
  document.addEventListener("keydown", event => {
    if (!state.ready || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.target.closest("input, select, textarea, [contenteditable='true']")) return;
    const destination = { ArrowLeft: state.index - 1, ArrowRight: state.index + 1, Home: 0, End: state.pages.length - 1 }[event.key];
    if (destination === undefined) return;
    event.preventDefault();
    goToPage(destination, true);
  });
  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(fitViewer);
  });
  window.addEventListener("hashchange", () => {
    const hash = /^#page-(\d+)$/.exec(location.hash);
    if (state.ready && hash) goToPage(Number(hash[1]) - 1, true);
  });

  window.biadoneEdu = Object.freeze({ render, getSnapshot });
  fetch("content.json")
    .then(response => {
      if (!response.ok) throw new Error(`content.json 응답: ${response.status}`);
      return response.json();
    })
    .then(render)
    .catch(error => {
      state.ready = false;
      ui.deck.setAttribute("aria-busy", "false");
      ui.status.textContent = "템플릿을 불러오지 못했습니다.";
      ui.error.hidden = false;
      ui.error.textContent = `${error.message} 저장소 루트의 HTTP 서버로 이 폴더를 열고 content.json과 공통 CSS 경로를 확인해 주세요.`;
    });
})();
