(function initializeActionHomePrototype() {
  "use strict";

  const mock = window.ACTION_HOME_MOCK;
  const view = document.querySelector("#prototype-view");
  const shell = document.querySelector("#prototype-shell");
  const stateSelect = document.querySelector("#prototype-state");
  const variantButtons = Array.from(
    document.querySelectorAll("[data-variant]")
  );
  const evidenceLayer = document.querySelector("#evidence-layer");
  const evidenceList = document.querySelector("#evidence-list");
  const rejectLayer = document.querySelector("#reject-layer");
  const rejectOptions = document.querySelector("#reject-options");
  const toast = document.querySelector("#prototype-toast");

  if (
    !mock ||
    !view ||
    !shell ||
    !stateSelect ||
    !evidenceLayer ||
    !evidenceList ||
    !rejectLayer ||
    !rejectOptions ||
    !toast
  ) {
    return;
  }

  const validVariants = new Set(["focus", "board", "concierge"]);
  const validStates = new Set([
    "recommendation",
    "running",
    "completed",
    "clarification",
    "empty"
  ]);
  const initialVariant = new URL(window.location.href).searchParams.get(
    "variant"
  );

  const prototypeState = {
    variant: validVariants.has(initialVariant) ? initialVariant : "focus",
    view: "recommendation",
    recommendationIndex: 0,
    shortened: false,
    feedback: "",
    clarificationChoice: ""
  };

  let lastFocusedElement = null;
  let activeModal = null;
  let toastTimer = null;

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function currentRecommendation() {
    return mock.recommendations[prototypeState.recommendationIndex];
  }

  function groundingClass(recommendation) {
    return recommendation.grounding === "근거 충분"
      ? "grounding-chip"
      : "grounding-chip needs-review";
  }

  function productTopbar() {
    const subtitles = {
      focus: mock.session.title,
      board: `${mock.session.title} · ACTION MAP`,
      concierge: `${mock.session.title} · AI CONCIERGE`
    };

    return `
      <header class="product-topbar">
        <div class="product-brand">
          <span class="brand-mark" aria-hidden="true">b</span>
          <span>
            <strong>blabase</strong>
            <small>${escapeHtml(subtitles[prototypeState.variant])}</small>
          </span>
        </div>
        <span class="analysis-status">분석 완료</span>
      </header>
    `;
  }

  function productFooter() {
    return `
      <footer class="product-footer">
        <span>${escapeHtml(mock.session.title)} · synthetic scenario</span>
        <span>${escapeHtml(mock.mockNotice)}</span>
      </footer>
    `;
  }

  function nextRecommendationButtons(className) {
    return mock.recommendations
      .map((recommendation, index) => ({ recommendation, index }))
      .filter(({ index }) => index !== prototypeState.recommendationIndex)
      .slice(0, 2)
      .map(
        ({ recommendation, index }) => `
          <button
            class="${className}"
            type="button"
            data-action="select-recommendation"
            data-index="${index}"
            aria-label="다음 제안: ${escapeHtml(recommendation.title)}"
          >
            <span>${escapeHtml(recommendation.title)}</span>
            <span aria-hidden="true">→</span>
          </button>
        `
      )
      .join("");
  }

  function recommendationMeta(recommendation) {
    return `
      <div class="recommendation-meta">
        <span class="${groundingClass(recommendation)}">
          ${escapeHtml(recommendation.grounding)}
        </span>
        <span class="source-chip">${escapeHtml(recommendation.source)}</span>
      </div>
    `;
  }

  function secondaryActions(otherLabel) {
    return `
      <div class="secondary-actions" aria-label="추천 보조 동작">
        <button
          class="secondary-action"
          type="button"
          data-action="other-recommendation"
          aria-label="${escapeHtml(otherLabel)}"
        >
          ${escapeHtml(otherLabel)}
        </button>
        <button
          class="secondary-action"
          type="button"
          data-action="evidence"
          aria-label="대화 근거 보기"
        >
          근거 보기
        </button>
        <button
          class="text-action"
          type="button"
          data-action="reject"
          aria-label="이 추천이 맞지 않음"
        >
          맞지 않음
        </button>
      </div>
    `;
  }

  function primaryAction(label) {
    return `
      <button
        class="primary-action"
        type="button"
        data-action="run"
        aria-label="${escapeHtml(label)}"
      >
        <span>${escapeHtml(label)}</span>
        <span class="button-arrow" aria-hidden="true">→</span>
      </button>
    `;
  }

  function workspaceSidebar(options) {
    const settings = options || {};
    const recommendation = currentRecommendation();
    const topics = mock.topics
      .map((topic) => {
        const related = recommendation.relatedTopics.includes(topic.id);
        return `
          <li class="${related ? "is-related" : ""}">
            <span
              class="topic-status-dot"
              data-tone="${escapeHtml(topic.tone)}"
              aria-hidden="true"
            ></span>
            <span>${escapeHtml(topic.title)}</span>
          </li>
        `;
      })
      .join("");

    return `
      <aside
        class="workspace-sidebar${settings.compact ? " is-compact" : ""}"
        aria-label="SABER paper 대화 맥락"
      >
        <div class="sidebar-home">
          <span aria-hidden="true">⌂</span>
          <span>Action home</span>
        </div>
        <p class="sidebar-label">Workspace</p>
        <div class="sidebar-session is-active">
          <span aria-hidden="true">▰</span>
          <span>${escapeHtml(mock.session.title)}</span>
        </div>
        <p class="sidebar-label">Topics</p>
        <ul class="sidebar-topics">
          ${topics}
        </ul>
        <div class="sidebar-footer-note">합성된 대화 시나리오</div>
      </aside>
    `;
  }

  function workspaceUtilityBar(label, title, status) {
    return `
      <header class="workspace-utility-bar">
        <div>
          <small>${escapeHtml(label)}</small>
          <strong>${escapeHtml(title)}</strong>
        </div>
        <span>${escapeHtml(status)}</span>
      </header>
    `;
  }

  function assistantIdentity(status) {
    return `
      <div class="assistant-identity">
        <span aria-hidden="true"></span>
        <div>
          <strong>blabase</strong>
          <small>${escapeHtml(status)}</small>
        </div>
      </div>
    `;
  }

  function renderFocusRecommendation() {
    const recommendation = currentRecommendation();
    const relatedTopics = recommendation.relatedTopics
      .map((topicId) => mock.topics.find((topic) => topic.id === topicId))
      .filter(Boolean)
      .map(
        (topic) =>
          `<span class="inline-reference">@${escapeHtml(topic.title)}</span>`
      )
      .join("");

    return `
      <section class="reference-stage focus-reference-stage" aria-labelledby="focus-heading">
        <div class="workspace-frame focus-workspace">
          ${workspaceSidebar({ compact: true })}

          <section class="workspace-canvas focus-document">
            ${workspaceUtilityBar(
              "Action home",
              mock.session.title,
              `${prototypeState.recommendationIndex + 1} / ${mock.recommendations.length}`
            )}

            <div class="focus-editorial">
              <p class="canvas-kicker">
                <span aria-hidden="true">✦</span>
                지금 먼저 할 일
              </p>
              <h1 id="focus-heading" data-view-heading tabindex="-1">
                ${escapeHtml(recommendation.title)}
              </h1>
              <p class="focus-reason">${escapeHtml(recommendation.reason)}</p>

              <div class="focus-reference-row" aria-label="영향을 받는 Topic">
                <span>연결된 맥락</span>
                ${relatedTopics}
              </div>

              <div class="deliverable-note">
                <span class="document-glyph" aria-hidden="true"></span>
                <div>
                  <small>AI가 만들 결과</small>
                  <strong>${escapeHtml(recommendation.outcome)}</strong>
                </div>
              </div>

              <div class="focus-command-row">
                ${primaryAction("AI가 진행")}
                ${secondaryActions("다른 제안")}
              </div>
            </div>

            <aside class="focus-next-rows" aria-label="다음 제안">
              <p>다음에 할 수 있는 일</p>
              <div>
                ${nextRecommendationButtons("next-card")}
              </div>
            </aside>
          </section>
        </div>
      </section>
    `;
  }

  function renderBoardMap(recommendation) {
    const boardDetails = {
      experiments: {
        title: "Baseline과 seed 조건",
        note: "실험 비교를 시작하기 위한 기준"
      },
      bellman: {
        title: "Weighting 비교 조건",
        note: "구현 전에 합의가 필요한 항목"
      },
      evaluation: {
        title: "CI 보고 형식",
        note: "결과를 같은 기준으로 읽기 위한 규칙"
      },
      submission: {
        title: "Submission checklist",
        note: "완료된 결과가 연결될 제출 항목"
      }
    };

    const topics = mock.topics
      .map((topic, index) => {
        const related = recommendation.relatedTopics.includes(topic.id);
        const detail = boardDetails[topic.id];
        return `
          <section
            class="topic-lane${related ? " is-related" : ""}"
            data-tone="${escapeHtml(topic.tone)}"
            aria-label="${escapeHtml(topic.title)}, ${escapeHtml(topic.summary)}${related ? ", 현재 추천과 관련됨" : ""}"
          >
            <header>
              <div>
                <span
                  class="topic-status-dot"
                  data-tone="${escapeHtml(topic.tone)}"
                  aria-hidden="true"
                ></span>
                <strong>${escapeHtml(topic.title)}</strong>
              </div>
              <small>${escapeHtml(topic.summary)}</small>
            </header>
            <article class="topic-paper-card${related && index === 0 ? " is-lifted" : ""}">
              <span>${related ? "현재 추천과 연결됨" : "대화에서 확인됨"}</span>
              <strong>${escapeHtml(detail.title)}</strong>
              <p>${escapeHtml(detail.note)}</p>
            </article>
          </section>
        `;
      })
      .join("");

    return `
      <section class="topic-board" aria-label="SABER paper Topic 맥락">
        <header class="goal-banner">
          <span>핵심 목표</span>
          <strong>${escapeHtml(mock.session.goal)}</strong>
        </header>
        <div class="topic-lanes">
          ${topics}
        </div>
      </section>
    `;
  }

  function renderBoardRecommendation() {
    const recommendation = currentRecommendation();
    const relatedTopics = recommendation.relatedTopics
      .map((topicId) => mock.topics.find((topic) => topic.id === topicId))
      .filter(Boolean)
      .map(
        (topic) =>
          `<span class="inline-reference">@${escapeHtml(topic.title)}</span>`
      )
      .join("");

    return `
      <section class="reference-stage board-reference-stage" aria-labelledby="board-heading">
        <div class="workspace-frame board-workspace">
          ${workspaceSidebar()}

          <section class="workspace-canvas board-canvas">
            ${workspaceUtilityBar("Workspace", mock.session.title, "Topic view")}
            ${renderBoardMap(recommendation)}
          </section>

          <aside class="ai-side-panel board-decision-panel">
            ${assistantIdentity("추천 준비됨")}
            <p class="decision-kicker">지금 먼저 할 일</p>
            ${recommendationMeta(recommendation)}
            <h1 id="board-heading" data-view-heading tabindex="-1">
              ${escapeHtml(recommendation.title)}
            </h1>
            <p class="board-reason">${escapeHtml(recommendation.reason)}</p>
            <div class="decision-references">${relatedTopics}</div>
            ${primaryAction("AI가 진행")}
            ${secondaryActions("다른 제안")}

            <div class="panel-next-actions" aria-label="다음 제안">
              <p>그다음 제안</p>
              <div class="board-next-list">
                ${nextRecommendationButtons("next-card")}
              </div>
            </div>
          </aside>
        </div>
      </section>
    `;
  }

  function renderConciergeRecommendation() {
    const recommendation = currentRecommendation();

    return `
      <section class="reference-stage concierge-reference-stage" aria-labelledby="concierge-heading">
        <div class="workspace-frame concierge-workspace">
          ${workspaceSidebar()}

          <section class="workspace-canvas concierge-document">
            ${workspaceUtilityBar("Analysis brief", mock.session.title, "Ready")}
            <div class="brief-document">
              <p class="document-section-label">CORE OBJECTIVE</p>
              <h2>${escapeHtml(mock.session.goal)}</h2>

              <div class="brief-divider"></div>

              <p class="document-section-label">OPEN ITEMS</p>
              <div class="open-item-rows">
                ${mock.unresolved
                  .map(
                    (item) => `
                      <div>
                        <span>${escapeHtml(item.label)}</span>
                        <strong>${item.count}</strong>
                      </div>
                    `
                  )
                  .join("")}
              </div>

              <div class="document-placeholder">
                <span class="document-glyph" aria-hidden="true"></span>
                <div>
                  <small>AI 작업 결과</small>
                  <strong>${escapeHtml(mock.artifact.title)}</strong>
                  <p>완료된 실행 계획이 이 작업면에 정리됩니다.</p>
                </div>
              </div>
            </div>
          </section>

          <aside class="ai-side-panel concierge-decision-panel">
            ${assistantIdentity("분석 완료")}
            <div class="concierge-status">
              <span aria-hidden="true">✓</span>
              대화 분석이 끝났어요
            </div>

            <p class="concierge-lead">제가 먼저 처리할 일은</p>
            <h1 id="concierge-heading" data-view-heading tabindex="-1">
              “${escapeHtml(recommendation.conciergeTitle)}”
            </h1>
            <p class="concierge-reason">${escapeHtml(recommendation.reason)}</p>
            <p class="concierge-outcome">
              <span aria-hidden="true">✦</span>
              <span>완료되면 ${escapeHtml(recommendation.outcome)}을 드릴게요.</span>
            </p>

            ${primaryAction("이대로 AI에게 맡기기")}
            ${secondaryActions("다른 일을 먼저 할래요")}

            <div class="panel-next-actions concierge-alternatives" aria-label="짧은 대안">
              <p>그다음에는</p>
              ${mock.recommendations
                .map((item, index) => ({ item, index }))
                .filter(
                  ({ index }) => index !== prototypeState.recommendationIndex
                )
                .slice(0, 2)
                .map(
                  ({ item, index }) => `
                    <button
                      class="next-card"
                      type="button"
                      data-action="select-recommendation"
                      data-index="${index}"
                      aria-label="대안 제안: ${escapeHtml(item.title)}"
                    >
                      <span>${escapeHtml(item.conciergeTitle)}</span>
                      <span aria-hidden="true">→</span>
                    </button>
                  `
                )
                .join("")}
            </div>
          </aside>
        </div>
      </section>
    `;
  }

  function stateContextPanel(kind) {
    const recommendation = currentRecommendation();
    const labels = {
      running: "작업 순서를 정리하는 중",
      completed: "결과가 준비됨",
      clarification: "사용자 확인을 기다리는 중",
      empty: "새로운 근거를 기다리는 중"
    };

    if (prototypeState.variant === "board") {
      const topics = mock.topics
        .map(
          (topic) => `
            <div class="${recommendation.relatedTopics.includes(topic.id) ? "is-related" : ""}">
              <span
                class="topic-status-dot"
                data-tone="${escapeHtml(topic.tone)}"
                aria-hidden="true"
              ></span>
              <span>${escapeHtml(topic.title)}</span>
              <small>${escapeHtml(topic.summary)}</small>
            </div>
          `
        )
        .join("");

      return `
        <aside class="ai-side-panel state-context-panel board-state-context">
          ${assistantIdentity(labels[kind])}
          <p class="decision-kicker">현재 작업 맥락</p>
          <h2>${escapeHtml(recommendation.title)}</h2>
          <div class="context-topic-list">
            ${topics}
          </div>
        </aside>
      `;
    }

    if (prototypeState.variant === "concierge") {
      return `
        <aside class="ai-side-panel state-context-panel concierge-state-context">
          ${assistantIdentity(labels[kind])}
          <p class="decision-kicker">제가 맡은 일</p>
          <h2>${escapeHtml(recommendation.conciergeTitle)}</h2>
          <p>${escapeHtml(recommendation.reason)}</p>
          <div class="context-outcome">
            <small>만들 결과</small>
            <strong>${escapeHtml(recommendation.outcome)}</strong>
          </div>
        </aside>
      `;
    }

    return "";
  }

  function renderStateWorkspace(kind, headingId, content) {
    const statuses = {
      running: "AI working",
      completed: "Completed",
      clarification: "Needs input",
      empty: "No action"
    };
    const labels = {
      focus: "Action home",
      board: "Action board",
      concierge: "AI workspace"
    };

    return `
      <section
        class="reference-stage state-reference-stage ${kind}-reference-stage"
        aria-labelledby="${escapeHtml(headingId)}"
      >
        <div class="workspace-frame state-workspace ${prototypeState.variant}-state-workspace">
          ${workspaceSidebar({ compact: prototypeState.variant === "focus" })}
          <section class="workspace-canvas state-canvas">
            ${workspaceUtilityBar(
              labels[prototypeState.variant],
              mock.session.title,
              statuses[kind]
            )}
            <div class="state-stage">
              ${content}
            </div>
          </section>
          ${stateContextPanel(kind)}
        </div>
      </section>
    `;
  }

  function runningHeading() {
    if (prototypeState.variant === "concierge") {
      return "제가 실행 순서를 정리하고 있어요";
    }
    return "Experiments 실행 계획을 만들고 있어요";
  }

  function renderRunningState() {
    const steps = mock.runningSteps
      .map((step, index) => {
        const className =
          index === 0 ? "is-done" : index === 1 ? "is-active" : "";
        const marker = index === 0 ? "✓" : String(index + 1);
        return `
          <li class="${className}">
            <span aria-hidden="true">${marker}</span>
            <div>
              <strong>${escapeHtml(step.title)}</strong>
              <small>${escapeHtml(step.detail)}</small>
            </div>
          </li>
        `;
      })
      .join("");

    return renderStateWorkspace(
      "running",
      "running-heading",
      `
        <article class="state-card">
          <header class="state-card-header">
            <span class="state-symbol" aria-hidden="true">✦</span>
            <div>
              <p>AI가 작업 중</p>
              <h1 id="running-heading" data-view-heading tabindex="-1">
                ${escapeHtml(runningHeading())}
              </h1>
            </div>
          </header>
          <p class="state-description">
            대화에서 확인한 조건을 실제로 쓸 수 있는 순서로 바꾸고 있어요.
          </p>
          <ol class="process-list" aria-label="Mock 작업 단계">
            ${steps}
          </ol>
          <div class="state-primary-row">
            <button
              class="primary-action"
              type="button"
              data-action="complete"
              aria-label="Mock 작업 완료 결과 보기"
            >
              완료 결과 보기
              <span class="button-arrow" aria-hidden="true">→</span>
            </button>
          </div>
        </article>
      `
    );
  }

  function artifactText() {
    const items = prototypeState.shortened
      ? mock.artifact.shortItems
      : mock.artifact.items;
    return `${mock.artifact.title}\n\n${items
      .map((item, index) => `${index + 1}. ${item}`)
      .join("\n")}`;
  }

  function renderCompletedState() {
    const items = prototypeState.shortened
      ? mock.artifact.shortItems
      : mock.artifact.items;

    return renderStateWorkspace(
      "completed",
      "completed-heading",
      `
        <article class="state-card artifact-card">
          <header class="artifact-heading">
            <div>
              <p>작업 완료</p>
              <h1 id="completed-heading" data-view-heading tabindex="-1">
                ${escapeHtml(mock.artifact.title)}
              </h1>
            </div>
            <span class="success-chip">검토 완료</span>
          </header>

          <ol class="artifact-list">
            ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ol>

          <div class="artifact-actions">
            <div class="artifact-tools">
              <button
                class="secondary-action"
                type="button"
                data-action="copy"
                aria-label="Mock 실행 계획 복사"
              >
                복사
              </button>
              <button
                class="secondary-action"
                type="button"
                data-action="shorten"
                aria-label="${prototypeState.shortened ? "전체 실행 계획 보기" : "실행 계획 더 짧게 보기"}"
              >
                ${prototypeState.shortened ? "전체 보기" : "더 짧게"}
              </button>
            </div>
            <button
              class="primary-action"
              type="button"
              data-action="next-task"
              aria-label="다음 추천 작업 보기"
            >
              다음 작업
              <span class="button-arrow" aria-hidden="true">→</span>
            </button>
          </div>

          <div class="feedback-row" aria-label="결과 피드백">
            <span>이 결과가 도움이 됐나요?</span>
            <button
              class="feedback-button"
              type="button"
              data-action="feedback"
              data-feedback="helpful"
              aria-label="도움이 됐어요"
              aria-pressed="${prototypeState.feedback === "helpful"}"
            >
              도움이 됐어요
            </button>
            <button
              class="feedback-button"
              type="button"
              data-action="feedback"
              data-feedback="not-helpful"
              aria-label="도움이 되지 않았어요"
              aria-pressed="${prototypeState.feedback === "not-helpful"}"
            >
              아니에요
            </button>
          </div>
        </article>
      `
    );
  }

  function renderClarificationState() {
    const choices = mock.clarification.choices
      .map(
        (choice) => `
          <button
            class="choice-button"
            type="button"
            data-action="clarification-choice"
            data-choice="${escapeHtml(choice)}"
            aria-label="우선 목표로 ${escapeHtml(choice)} 선택"
            aria-pressed="${prototypeState.clarificationChoice === choice}"
          >
            ${escapeHtml(choice)}
          </button>
        `
      )
      .join("");

    return renderStateWorkspace(
      "clarification",
      "clarification-heading",
      `
        <article class="state-card">
          <header class="state-card-header">
            <span class="state-symbol amber" aria-hidden="true">?</span>
            <div>
              <p>확인 필요</p>
              <h1 id="clarification-heading" data-view-heading tabindex="-1">
                ${escapeHtml(mock.clarification.question)}
              </h1>
            </div>
          </header>
          <p class="state-description">
            근거가 부족해요. 가장 중요한 목표 하나만 알려주시면 먼저 할 일을 정리할게요.
          </p>
          <div class="clarification-choices" role="group" aria-label="우선 목표 선택">
            ${choices}
          </div>
          ${
            prototypeState.clarificationChoice
              ? `
                <div class="state-primary-row">
                  <button
                    class="primary-action"
                    type="button"
                    data-action="clarification-confirm"
                    aria-label="${escapeHtml(prototypeState.clarificationChoice)} 목표로 추천 보기"
                  >
                    이 목표로 추천 보기
                    <span class="button-arrow" aria-hidden="true">→</span>
                  </button>
                </div>
              `
              : ""
          }
        </article>
      `
    );
  }

  function renderEmptyState() {
    return renderStateWorkspace(
      "empty",
      "empty-heading",
      `
        <article class="state-card empty-card">
          <header class="state-card-header">
            <span class="state-symbol muted" aria-hidden="true">—</span>
            <div>
              <p>EMPTY / ERROR MOCK</p>
              <h1 id="empty-heading" data-view-heading tabindex="-1">
                지금 제안할 일을 찾지 못했어요
              </h1>
            </div>
          </header>
          <p class="state-description">
            대화 근거가 충분하지 않거나 분석할 항목이 비어 있습니다. 이 화면에서는 안전하게 다시 시작할 수 있어요.
          </p>
          <div class="state-primary-row">
            <button
              class="primary-action"
              type="button"
              data-action="retry"
              aria-label="추천 Mock 상태로 돌아가기"
            >
              추천 상태로 돌아가기
              <span class="button-arrow" aria-hidden="true">→</span>
            </button>
          </div>
        </article>
      `
    );
  }

  function stateContent() {
    switch (prototypeState.view) {
      case "running":
        return renderRunningState();
      case "completed":
        return renderCompletedState();
      case "clarification":
        return renderClarificationState();
      case "empty":
        return renderEmptyState();
      default:
        if (prototypeState.variant === "board") {
          return renderBoardRecommendation();
        }
        if (prototypeState.variant === "concierge") {
          return renderConciergeRecommendation();
        }
        return renderFocusRecommendation();
    }
  }

  function render(options) {
    const settings = options || {};
    view.innerHTML = `
      <div
        class="product-frame ${prototypeState.variant}-frame"
        data-mock-state="${prototypeState.view}"
      >
        ${productTopbar()}
        ${stateContent()}
        ${productFooter()}
      </div>
    `;

    variantButtons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.variant === prototypeState.variant)
      );
    });
    stateSelect.value = prototypeState.view;
    document.title = `${variantTitle(prototypeState.variant)} · blabase prototype`;

    if (settings.focusHeading) {
      window.requestAnimationFrame(() => {
        const heading = view.querySelector("[data-view-heading]");
        if (heading) heading.focus({ preventScroll: true });
      });
    }
  }

  function variantTitle(variant) {
    const labels = {
      focus: "A. Focus",
      board: "B. Action Board",
      concierge: "C. AI Concierge"
    };
    return labels[variant] || labels.focus;
  }

  function setVariant(variant) {
    if (!validVariants.has(variant)) return;
    prototypeState.variant = variant;
    const url = new URL(window.location.href);
    url.searchParams.set("variant", variant);
    window.history.replaceState({ variant }, "", url);
    render({ focusHeading: false });
  }

  function setViewState(nextView, focusHeading) {
    if (!validStates.has(nextView)) return;
    prototypeState.view = nextView;
    if (nextView !== "completed") {
      prototypeState.shortened = false;
      prototypeState.feedback = "";
    }
    render({ focusHeading: Boolean(focusHeading) });
  }

  function setRecommendation(index, focusHeading) {
    if (!Number.isInteger(index)) return;
    const total = mock.recommendations.length;
    prototypeState.recommendationIndex = ((index % total) + total) % total;
    prototypeState.view = "recommendation";
    prototypeState.feedback = "";
    prototypeState.shortened = false;
    render({ focusHeading: Boolean(focusHeading) });
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2400);
  }

  function fillEvidenceDrawer() {
    evidenceList.innerHTML = mock.evidence
      .map(
        (item) => `
          <article class="evidence-item">
            <div class="evidence-meta">
              <span class="evidence-turn">${escapeHtml(item.turn)}</span>
              <span class="evidence-topic">${escapeHtml(item.topic)}</span>
            </div>
            <p class="evidence-sentence">${escapeHtml(item.sentence)}</p>
            <button
              class="secondary-action"
              type="button"
              data-action="original"
              aria-label="${escapeHtml(item.turn)} 원문 보기"
            >
              원문 보기
            </button>
          </article>
        `
      )
      .join("");
  }

  function fillRejectOptions() {
    rejectOptions.innerHTML = mock.rejectionReasons
      .map(
        (reason) => `
          <button
            type="button"
            data-action="reject-reason"
            data-reason="${escapeHtml(reason)}"
            aria-label="추천 제외 이유: ${escapeHtml(reason)}"
          >
            ${escapeHtml(reason)}
          </button>
        `
      )
      .join("");
  }

  function openModal(layer) {
    if (!layer) return;
    lastFocusedElement = document.activeElement;
    activeModal = layer;
    layer.hidden = false;
    shell.inert = true;
    window.requestAnimationFrame(() => {
      layer.classList.add("is-open");
      const firstFocusable = layer.querySelector(
        'button:not([disabled]), [href], select, [tabindex]:not([tabindex="-1"])'
      );
      if (firstFocusable) firstFocusable.focus();
    });
  }

  function closeModal(layer) {
    if (!layer || layer.hidden) return;
    layer.classList.remove("is-open");
    shell.inert = false;
    activeModal = null;
    window.setTimeout(() => {
      layer.hidden = true;
    }, 200);
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
  }

  function trapModalFocus(event) {
    if (!activeModal || activeModal.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal(activeModal);
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      activeModal.querySelectorAll(
        'button:not([disabled]), [href], select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function copyArtifact() {
    const text = artifactText();
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.setAttribute("readonly", "");
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        textArea.remove();
      }
      showToast("Mock 실행 계획을 복사했어요.");
    } catch {
      showToast("복사하지 못했어요. 브라우저 권한을 확인해 주세요.");
    }
  }

  function handleViewAction(actionButton) {
    const action = actionButton.dataset.action;
    switch (action) {
      case "run":
        setViewState("running", true);
        break;
      case "complete":
        setViewState("completed", true);
        break;
      case "other-recommendation":
      case "next-task":
        setRecommendation(prototypeState.recommendationIndex + 1, true);
        break;
      case "select-recommendation":
        setRecommendation(Number(actionButton.dataset.index), true);
        break;
      case "evidence":
        openModal(evidenceLayer);
        break;
      case "reject":
        openModal(rejectLayer);
        break;
      case "copy":
        copyArtifact();
        break;
      case "shorten": {
        prototypeState.shortened = !prototypeState.shortened;
        render();
        const shortenButton = view.querySelector('[data-action="shorten"]');
        if (shortenButton) shortenButton.focus();
        showToast(
          prototypeState.shortened
            ? "핵심 3단계로 줄였어요."
            : "전체 5단계를 다시 보여드려요."
        );
        break;
      }
      case "feedback":
        prototypeState.feedback = actionButton.dataset.feedback || "";
        render();
        showToast("피드백을 선택했어요. 이 목업에서는 저장되지 않습니다.");
        break;
      case "clarification-choice":
        prototypeState.clarificationChoice = actionButton.dataset.choice || "";
        render();
        break;
      case "clarification-confirm": {
        const mappedIndex =
          prototypeState.clarificationChoice === "논문 제출"
            ? 2
            : prototypeState.clarificationChoice === "Reviewer 대응"
              ? 1
              : 0;
        setRecommendation(mappedIndex, true);
        showToast(
          `${prototypeState.clarificationChoice} 목표로 추천을 정리했어요.`
        );
        break;
      }
      case "retry":
        setViewState("recommendation", true);
        break;
      default:
        break;
    }
  }

  view.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    handleViewAction(actionButton);
  });

  variantButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setVariant(button.dataset.variant);
    });
  });

  stateSelect.addEventListener("change", () => {
    setViewState(stateSelect.value, true);
  });

  evidenceLayer.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    if (actionButton.dataset.action === "close-evidence") {
      closeModal(evidenceLayer);
    } else if (actionButton.dataset.action === "original") {
      showToast("원문 연결은 포함하지 않은 디자인 목업입니다.");
    }
  });

  rejectLayer.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    if (actionButton.dataset.action === "close-reject") {
      closeModal(rejectLayer);
    } else if (actionButton.dataset.action === "reject-reason") {
      const reason = actionButton.dataset.reason || "선택한 이유";
      closeModal(rejectLayer);
      setRecommendation(prototypeState.recommendationIndex + 1, false);
      showToast(`“${reason}”으로 제외했어요. 다음 제안을 보여드려요.`);
    }
  });

  document.addEventListener("keydown", trapModalFocus);

  window.addEventListener("popstate", () => {
    const variant = new URL(window.location.href).searchParams.get("variant");
    if (validVariants.has(variant)) {
      prototypeState.variant = variant;
      render();
    }
  });

  fillEvidenceDrawer();
  fillRejectOptions();
  render();
})();
