import { COPY } from "./content.js?v=20260830b";

const demo = document.querySelector("[data-product-demo]");
const demoPrompt = document.querySelector("[data-demo-prompt]");
const demoLog = document.querySelector("[data-demo-log]");
const demoStatus = document.querySelector("[data-demo-status]");
const demoWindow = document.querySelector(".demo-window");
const decisionPanel = document.querySelector(".decision-panel");
const decisionOptions = document.querySelector("[data-decision-options]");
const detailsButton = document.querySelector("[data-demo-details]");
const detailPanel = document.querySelector("[data-demo-detail-panel]");
const choiceButtons = [...document.querySelectorAll("[data-choice]")];
const betaForm = document.querySelector("[data-beta-form]");
const submitButton = betaForm?.querySelector("button[type='submit']");
const submitLabel = betaForm?.querySelector("[data-submit-label]");
const formError = betaForm?.querySelector("[data-form-error]");
const formSuccess = betaForm?.querySelector("[data-form-success]");
const jsRequiredControls = [...(betaForm?.querySelectorAll("[data-js-required]") ?? [])];

let currentDemoState = "decision";
let formState = "idle";
let demoTimeline = null;
let demoAutoplayInterrupted = false;
let motionMedia = null;

function getCopy(key) {
  return COPY[key] ?? key;
}

function renderLogLine(element, line) {
  const marker = line.charAt(0);
  const markerClass = marker === "✓" ? "log-ok" : marker === "⚠" ? "log-warning" : "log-running";
  const markerElement = document.createElement("span");
  markerElement.className = markerClass;
  markerElement.setAttribute("aria-hidden", "true");
  markerElement.textContent = marker;
  element.replaceChildren(markerElement, document.createTextNode(` ${line.slice(2)}`));
}

function renderDemoState(state) {
  if (!demo || !demoPrompt || !demoLog || !demoStatus) return;

  currentDemoState = state;
  demo.dataset.demoState = state;

  let promptKey = "demo.workingPrompt";
  let logKeys = ["demo.workingLog1", "demo.workingLog2", "demo.workingLog3"];
  let statusKey = "demo.workingStatus";

  if (state === "completed" || state === "decision") {
    logKeys = ["demo.completedLog1", "demo.completedLog2", "demo.completedLog3"];
    statusKey = "demo.completedStatus";
  }

  if (state === "review") {
    promptKey = "demo.reviewPrompt";
    logKeys = ["demo.reviewLog1", "demo.reviewLog2", "demo.reviewLog3"];
    statusKey = "demo.reviewStatus";
  }

  demoPrompt.textContent = getCopy(promptKey);
  [...demoLog.children].forEach((line, index) => renderLogLine(line, getCopy(logKeys[index])));
  demoStatus.textContent = getCopy(statusKey);

  const isReview = state === "review";
  const choicesAreAvailable = state === "decision" || isReview;
  decisionOptions?.setAttribute("aria-hidden", String(!choicesAreAvailable));
  choiceButtons.forEach((button) => {
    button.disabled = !choicesAreAvailable;
  });
  if (detailsButton) detailsButton.hidden = !isReview;
  if (!isReview) {
    if (detailPanel) detailPanel.hidden = true;
    detailsButton?.setAttribute("aria-expanded", "false");
  }
}

function resetDemoSelection() {
  choiceButtons.forEach((button) => {
    button.classList.remove("is-selected");
    button.setAttribute("aria-pressed", "false");
  });
  demo?.removeAttribute("data-selected-choice");
}

function clearDemoMotionProps(gsap) {
  const targets = [demoPrompt, demoLog, demoStatus, decisionPanel].filter(Boolean);
  if (targets.length > 0) gsap.set(targets, { clearProps: "opacity,visibility,transform" });
}

function stopDemoAutoplay({ markInterrupted = true } = {}) {
  if (markInterrupted) demoAutoplayInterrupted = true;
  demoTimeline?.kill();
  demoTimeline = null;

  if (window.gsap) clearDemoMotionProps(window.gsap);
}

function playDemoOnce(gsap) {
  if (!demo || demoAutoplayInterrupted) return;

  stopDemoAutoplay({ markInterrupted: false });
  const terminalTargets = [demoPrompt, demoLog, demoStatus].filter(Boolean);

  demoTimeline = gsap.timeline({
    delay: 0.7,
    defaults: { ease: "power2.out" },
    onComplete: () => {
      clearDemoMotionProps(gsap);
      demoTimeline = null;
    }
  });

  demoTimeline
    .call(() => {
      resetDemoSelection();
      renderDemoState("working");
    })
    .fromTo(
      terminalTargets,
      { autoAlpha: 0.52, y: 6 },
      { autoAlpha: 1, y: 0, duration: 0.42, stagger: 0.05 }
    )
    .call(() => renderDemoState("completed"), null, 1.55)
    .fromTo(
      terminalTargets,
      { autoAlpha: 0.52, y: 5 },
      { autoAlpha: 1, y: 0, duration: 0.38, stagger: 0.04, immediateRender: false },
      1.55
    )
    .call(() => renderDemoState("decision"), null, 2.65)
    .fromTo(
      decisionPanel,
      { y: -8 },
      { y: 0, duration: 0.36, immediateRender: false },
      2.65
    )
    .call(() => chooseDemoOption("2", { userInitiated: false }), null, 4.05)
    .fromTo(
      terminalTargets,
      { autoAlpha: 0.52, y: 5 },
      { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.04, immediateRender: false },
      4.05
    );
}

function chooseDemoOption(choice, { userInitiated = true } = {}) {
  if (userInitiated) stopDemoAutoplay();

  choiceButtons.forEach((button) => {
    const isSelected = button.dataset.choice === choice;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });

  if (demo) demo.dataset.selectedChoice = choice;
  renderDemoState(choice === "2" ? "review" : "decision");
}

function revealOnce(gsap, targets, { trigger, stagger = 0 } = {}) {
  const elements = gsap.utils.toArray(targets);
  const triggerElement = trigger ?? elements[0];
  if (!triggerElement || elements.length === 0) return;

  gsap.from(elements, {
    scrollTrigger: {
      trigger: triggerElement,
      start: "top 88%",
      once: true
    },
    autoAlpha: 0,
    y: 18,
    duration: 0.56,
    stagger,
    ease: "power2.out",
    clearProps: "opacity,visibility,transform"
  });
}

function setupHeroMotion(gsap) {
  gsap.timeline({ defaults: { ease: "power3.out" } })
    .from(".hero-copy .eyebrow", {
      autoAlpha: 0,
      y: 10,
      duration: 0.38,
      clearProps: "opacity,visibility,transform"
    })
    .from("#hero-title > span", {
      autoAlpha: 0,
      y: 24,
      duration: 0.64,
      stagger: 0.11,
      clearProps: "opacity,visibility,transform"
    }, "-=0.16")
    .from([".hero-description", ".hero-actions"], {
      autoAlpha: 0,
      y: 16,
      duration: 0.48,
      stagger: 0.08,
      clearProps: "opacity,visibility,transform"
    }, "-=0.32")
    .from("[data-product-demo]", {
      autoAlpha: 0,
      y: 22,
      duration: 0.62,
      clearProps: "opacity,visibility,transform"
    }, "-=0.38")
    .from("[data-product-demo] figcaption", {
      autoAlpha: 0,
      x: -10,
      duration: 0.38,
      clearProps: "opacity,visibility,transform"
    }, "-=0.24");
}

function setupSectionMotion(gsap) {
  for (const heading of document.querySelectorAll(
    ".section-benefits .section-heading, .section-how .section-heading-wide, .section-beta-scope .section-heading, .section-faq .section-heading"
  )) {
    revealOnce(gsap, heading);
  }

  for (const row of document.querySelectorAll(
    ".editorial-row, .steps-list > li, .scope-table > div, .faq-list details"
  )) {
    revealOnce(gsap, row);
  }

  document.querySelectorAll(".steps-list > li").forEach((step) => {
    const signal = step.querySelector(".step-signal span");
    if (!signal) return;
    gsap.from(signal, {
      scrollTrigger: {
        trigger: step,
        start: "top 88%",
        once: true
      },
      scale: 0,
      x: -10,
      duration: 0.34,
      delay: 0.16,
      ease: "back.out(2)",
      clearProps: "transform"
    });
  });

  const signupSection = document.querySelector(".signup-section");
  revealOnce(gsap, [".signup-copy", ".signup-form"], {
    trigger: signupSection,
    stagger: 0.1
  });
}

function setupDemoMotion(gsap, ScrollTrigger) {
  renderDemoState("decision");

  ScrollTrigger.create({
    trigger: demoWindow ?? demo,
    start: "top 86%",
    once: true,
    onEnter: () => playDemoOnce(gsap)
  });
}

function initializeMotion() {
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;

  if (!gsap || !ScrollTrigger) {
    document.documentElement.dataset.motion = "static";
    renderDemoState("decision");
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  motionMedia = gsap.matchMedia();
  motionMedia.add({
    reduceMotion: "(prefers-reduced-motion: reduce)",
    allowMotion: "(prefers-reduced-motion: no-preference)"
  }, (context) => {
    if (context.conditions.reduceMotion || !context.conditions.allowMotion) {
      document.documentElement.dataset.motion = "reduced";
      stopDemoAutoplay({ markInterrupted: false });
      renderDemoState("decision");
      return undefined;
    }

    document.documentElement.dataset.motion = "enhanced";
    setupHeroMotion(gsap);
    setupSectionMotion(gsap);
    setupDemoMotion(gsap, ScrollTrigger);

    return () => stopDemoAutoplay({ markInterrupted: false });
  });
}

function renderFormState(state) {
  if (!betaForm || !submitButton || !submitLabel || !formError || !formSuccess) return;

  formState = state;
  const isLoading = state === "loading";
  const isSuccess = state === "success";
  submitButton.disabled = isLoading || isSuccess;
  submitLabel.textContent = getCopy(isLoading ? "signup.loading" : "signup.submit");
  formError.hidden = state !== "error";
  formSuccess.hidden = !isSuccess;
}

choiceButtons.forEach((button) => {
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => chooseDemoOption(button.dataset.choice));
});

document.addEventListener("keydown", (event) => {
  const activeElement = document.activeElement;
  const isDemoFocused = demo && (activeElement === demo || demo.contains(activeElement));
  if (!isDemoFocused) return;
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const choice = /^Digit([1-4])$/.exec(event.code)?.[1];
  if (!choice) return;
  const targetButton = choiceButtons.find((button) => button.dataset.choice === choice);
  if (!targetButton || targetButton.disabled) return;
  event.preventDefault();
  chooseDemoOption(choice);
});

detailsButton?.addEventListener("click", () => {
  const willOpen = detailPanel.hidden;
  detailPanel.hidden = !willOpen;
  detailsButton.setAttribute("aria-expanded", String(willOpen));
});

document.querySelectorAll(".faq-list details").forEach((details) => {
  details.addEventListener("toggle", () => {
    if (!details.open) return;
    document.querySelectorAll(".faq-list details[open]").forEach((other) => {
      if (other !== details) other.open = false;
    });
  });
});

betaForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  renderFormState("idle");

  const emailInput = betaForm.elements.email;
  if (!(emailInput instanceof HTMLInputElement) || !emailInput.checkValidity()) {
    renderFormState("error");
    emailInput?.focus();
    return;
  }

  renderFormState("loading");
  const endpoint = betaForm.dataset.endpoint?.trim();

  if (!endpoint) {
    renderFormState("error");
    return;
  }

  const formData = new FormData(betaForm);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: formData.get("email"),
        agent: formData.get("agent")
      })
    });

    if (!response.ok) throw new Error(`Beta signup failed with ${response.status}`);
    renderFormState("success");
  } catch {
    renderFormState("error");
  }
});

const header = document.querySelector("[data-site-header]");
const updateHeader = () => header?.classList.toggle("is-scrolled", window.scrollY > 12);
window.addEventListener("scroll", updateHeader, { passive: true });
updateHeader();

jsRequiredControls.forEach((control) => {
  control.disabled = false;
});
renderDemoState(currentDemoState);
renderFormState(formState);
initializeMotion();
