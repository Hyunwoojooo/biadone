import { chooseDemoOption, renderDemoState, resetDemoSelection } from "./main.js?v=20261017a";

const page = document.documentElement;
const demo = document.querySelector("[data-product-demo]");
const scene = document.querySelector(".signal-scene");
const toggle = document.querySelector("[data-motion-toggle]");
const replay = document.querySelector("[data-motion-replay]");
const label = document.querySelector("[data-motion-label]");
const key = document.querySelector("[data-motion-key]");
const options = [...document.querySelectorAll("[data-choice]")];
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
const { gsap, ScrollTrigger } = window;

let context;
let story;
let ambient = [];
let heroIsVisible = true;
let hasPlayed = false;
let entrancePlayed = false;
let manualChoice = false;
let userPaused = false;
try { userPaused = sessionStorage.getItem("blabee.motion.paused") === "true"; } catch { /* Storage is optional. */ }

function updateControls() {
  const unavailable = !gsap || !ScrollTrigger;
  const paused = userPaused || reduced.matches || unavailable;
  page.dataset.motion = unavailable ? "static" : reduced.matches ? "reduced" : userPaused ? "paused" : "enhanced";
  toggle.hidden = unavailable;
  replay.hidden = false;
  toggle.disabled = reduced.matches;
  toggle.setAttribute("aria-pressed", String(paused));
  label.textContent = reduced.matches ? "Reduced motion" : userPaused ? "Play motion" : "Pause motion";
  replay.disabled = false;
}

function updateVisibility() {
  const paused = document.hidden || !heroIsVisible || page.dataset.motion !== "enhanced";
  for (const tween of ambient) tween.paused(paused);
  story?.paused(paused);
}

function settleDemo() {
  story?.kill();
  story = null;
  if (!manualChoice) {
    resetDemoSelection();
    renderDemoState("decision");
  }
}

function animateChoice(choice) {
  key.textContent = choice;
  if (!context || page.dataset.motion !== "enhanced") return;
  context.add(() => {
    gsap.fromTo(".shortcut-key", { y: 0, rotationX: 0 }, {
      y: 7, rotationX: 8, duration: .14, repeat: 1, yoyo: true, ease: "power2.inOut", overwrite: true,
      onComplete: () => gsap.set(".shortcut-key", { clearProps: "transform" })
    });
    gsap.fromTo(options[Number(choice) - 1], { scale: .96 }, {
      scale: 1, duration: .5, ease: "back.out(2)", overwrite: true, clearProps: "transform"
    });
    gsap.fromTo(".handoff-signal", { strokeDashoffset: 100 }, {
      strokeDashoffset: -100, duration: 1.05, ease: "power2.inOut", overwrite: true
    });
    gsap.fromTo(".terminal-status", { opacity: .4 }, { opacity: 1, duration: .65, clearProps: "opacity", overwrite: true });
  });
}

function playStory() {
  if (!context || page.dataset.motion !== "enhanced") {
    manualChoice = false;
    resetDemoSelection();
    renderDemoState("decision");
    return;
  }
  story?.kill();
  manualChoice = false;
  hasPlayed = true;
  key.textContent = "2";
  resetDemoSelection();
  renderDemoState("decision");
  context.add(() => {
    story = gsap.timeline({
      defaults: { ease: "power3.out" },
      onComplete: () => { story = null; }
    });
    story
      .call(() => renderDemoState("working"), null, .6)
      .fromTo(".terminal-log p", { opacity: .25, x: -6 }, { opacity: 1, x: 0, stagger: .2, duration: .45, clearProps: "opacity,transform" }, .6)
      .call(() => renderDemoState("completed"), null, 2.15)
      .fromTo(".handoff-signal", { strokeDashoffset: 100 }, { strokeDashoffset: 0, duration: .7 }, 2.15)
      .fromTo(".handoff-dot", { opacity: 0, scale: .2, transformOrigin: "center" }, { opacity: 1, scale: 1, duration: .3 }, 2.3)
      .to(".handoff-dot", { opacity: 0, duration: .3 }, 2.9)
      .call(() => renderDemoState("decision"), null, 3.05)
      .fromTo(options, { opacity: 0, x: 18 }, { opacity: 1, x: 0, duration: .42, stagger: .09, immediateRender: false, clearProps: "opacity,transform" }, 3.12)
      .call(() => chooseDemoOption("2", { userInitiated: false }), null, 5.2)
      .to(".handoff-signal", { strokeDashoffset: -100, duration: .5 }, 6.1);
    updateVisibility();
  });
}

function orbitParticle(target, track, duration, offset = 0) {
  const particle = document.querySelector(target);
  const path = document.querySelector(track);
  const length = path.getTotalLength();
  const progress = { value: offset };
  ambient.push(gsap.to(progress, {
    value: offset + 1, duration, repeat: -1, ease: "none",
    onUpdate: () => {
      const point = path.getPointAtLength((progress.value % 1) * length);
      gsap.set(particle, { attr: { cx: point.x, cy: point.y } });
    }
  }));
}

function initializeEnhanced() {
  gsap.registerPlugin(ScrollTrigger);
  context = gsap.context(() => {
    if (!entrancePlayed) {
      entrancePlayed = true;
      gsap.timeline({ defaults: { ease: "power3.out", clearProps: "opacity,visibility,transform" } })
      .from("#hero-title > span", { y: 36, autoAlpha: 0, duration: .85, stagger: .12 })
      .from(".hero-description, .hero-actions", { y: 18, autoAlpha: 0, duration: .6, stagger: .1 }, .25)
      .from(".terminal-float", { x: 24, y: 36, autoAlpha: 0, rotation: -8, duration: 1.05 }, .12)
      .from(".decision-float", { y: 60, autoAlpha: 0, rotation: 10, duration: .95 }, .35)
      .from(".shortcut-float", { y: 30, autoAlpha: 0, scale: .8, duration: .85 }, .5)
      .from(".signal-orbits", { autoAlpha: 0, scale: .92, duration: 1 }, .2);
    }

    ambient.push(gsap.to(".demo-window", { y: -7, duration: 3.6, repeat: -1, yoyo: true, ease: "sine.inOut" }));
    ambient.push(gsap.to(".decision-panel", { y: 5, duration: 3, repeat: -1, yoyo: true, ease: "sine.inOut" }));
    ambient.push(gsap.to(".shortcut-key", { y: -5, duration: 2.8, repeat: -1, yoyo: true, ease: "sine.inOut" }));
    ambient.push(gsap.to(".orbit-trail", { strokeDashoffset: -100, duration: 15, repeat: -1, ease: "none" }));
    orbitParticle(".signal-particle:not(.signal-particle-small)", ".orbit-track:not(.orbit-track-secondary)", 15, .18);
    orbitParticle(".signal-particle-small", ".orbit-track-secondary", 21, .55);

    gsap.to(".scroll-progress", {
      scaleX: 1, ease: "none", scrollTrigger: { trigger: document.body, start: "top top", end: "bottom bottom", scrub: .2 }
    });
    for (const section of document.querySelectorAll("main > .section, .signup-section")) {
      gsap.from(section.querySelectorAll(".section-heading, .signup-copy, .signup-form"), {
        y: 30, opacity: 0, duration: .75, stagger: .12, clearProps: "opacity,transform",
        scrollTrigger: { trigger: section, start: "top 88%", once: true }
      });
    }
    for (const row of document.querySelectorAll(".editorial-row, .scope-table > div, .faq-list details")) {
      gsap.from(row, { y: 16, opacity: 0, duration: .55, clearProps: "opacity,transform", scrollTrigger: { trigger: row, start: "top 94%", once: true } });
      if (row.matches(".editorial-row")) {
        gsap.from(row, { "--row-progress": 0, duration: .8, scrollTrigger: { trigger: row, start: "top 85%", once: true } });
      }
    }
    document.querySelectorAll(".steps-list > li").forEach((step, index) => {
      gsap.from(step, { y: 26, opacity: 0, duration: .65, delay: index * .12, clearProps: "opacity,transform", scrollTrigger: { trigger: step, start: "top 92%", once: true } });
      gsap.from(step.querySelector("svg"), { x: -12, opacity: 0, duration: .7, delay: .15 + index * .12, clearProps: "opacity,transform", scrollTrigger: { trigger: step, start: "top 85%", once: true } });
      const activeKey = step.querySelector(".step-key-active");
      if (activeKey) gsap.from(activeKey, { y: -7, duration: .35, repeat: 1, yoyo: true, delay: .6, scrollTrigger: { trigger: step, start: "top 85%", once: true } });
    });

    // Pointer depth only affects the illustration; links and reading text stay still.
    const rotateTerminal = gsap.quickTo(".terminal-float", "rotationY", { duration: .7, ease: "power3.out" });
    const rotatePanel = gsap.quickTo(".decision-float", "rotationY", { duration: .7, ease: "power3.out" });
    const movePointer = (event) => {
      if (!finePointer.matches) return;
      const box = scene.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - .5;
      rotateTerminal(x * 5);
      rotatePanel(x * -7);
    };
    const leavePointer = () => { rotateTerminal(0); rotatePanel(0); };
    scene.addEventListener("pointermove", movePointer);
    scene.addEventListener("pointerleave", leavePointer);
    return () => {
      scene.removeEventListener("pointermove", movePointer);
      scene.removeEventListener("pointerleave", leavePointer);
    };
  }, document.body);

  if (!hasPlayed && !manualChoice) {
    context.add(() => ScrollTrigger.create({ trigger: scene, start: "top 85%", once: true, onEnter: playStory }));
  }
  updateVisibility();
}

function refreshMotion() {
  story?.kill();
  story = null;
  context?.revert();
  context = null;
  ambient = [];
  if (gsap) gsap.set(".demo-window, .decision-panel, .shortcut-key, .terminal-status, .decision-option", { clearProps: "transform,opacity" });
  settleDemo();
  updateControls();
  if (page.dataset.motion === "enhanced") initializeEnhanced();
}

toggle.addEventListener("click", () => {
  if (reduced.matches) return;
  userPaused = !userPaused;
  try { sessionStorage.setItem("blabee.motion.paused", String(userPaused)); } catch { /* Storage is optional. */ }
  refreshMotion();
});
replay.addEventListener("click", playStory);
demo.addEventListener("blabee:choice", (event) => {
  if (event.detail.userInitiated) {
    manualChoice = true;
    story?.kill();
    story = null;
    if (gsap) gsap.set(options, { clearProps: "opacity,transform" });
  }
  animateChoice(event.detail.choice);
});
// Focusing a choice means the visitor has taken over the illustration.
demo.addEventListener("focusin", (event) => {
  if (!event.target.matches("[data-choice]")) return;
  story?.kill();
  story = null;
  if (gsap) gsap.set(options, { clearProps: "opacity,transform" });
});
const visibilityObserver = new IntersectionObserver(([entry]) => {
  heroIsVisible = entry.isIntersecting;
  updateVisibility();
}, { threshold: .05 });
visibilityObserver.observe(scene);
document.addEventListener("visibilitychange", updateVisibility);
reduced.addEventListener("change", refreshMotion);
refreshMotion();
