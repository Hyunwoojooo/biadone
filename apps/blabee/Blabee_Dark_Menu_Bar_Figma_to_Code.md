# Blabee Dark Menu Bar — Figma to Code

Source: [Figma prototype · node 165:163](https://www.figma.com/proto/BBrE3zYlHQ91cRF3XH3g0Y/Blabee-Character-Explorations-%C2%B7-v1?node-id=165-163&scaling=min-zoom&content-scaling=fixed&page-id=90%3A2)

This document converts the full linked 960×660 Figma frame into React 19 + TypeScript + plain CSS. It follows the existing Blabee site stack and does not require Tailwind or a motion library.

Included:

- Exact 960×660 presentation frame and 880×480 integrated motion screen
- Dark 60% system menu-bar glass
- Blabee 32px status zone
- Five actions, icons, labels, recommended state, and configured shortcuts
- `WORKING → NEEDS INPUT → AUTO OPEN → WAITING` 2.2-second loop
- Click and keyboard interaction hooks
- Reduced-motion, reduced-transparency, and no-backdrop-filter fallbacks

## File placement

Copy the accompanying `assets/` directory to the app's public directory:

```text
public/
└── blabee-dark-menu-bar/
    ├── figma-v14-action-1.svg
    ├── figma-v14-action-2.svg
    ├── figma-v14-action-3.svg
    ├── figma-v14-action-4.svg
    ├── figma-v14-action-5.svg
    ├── figma-v14-ambient-blue.svg
    ├── figma-v14-ambient-coral.svg
    ├── figma-v14-bee.svg
    ├── figma-v14-needs-input.svg
    └── figma-v14-working.svg
```

The SVG files are exact exported Figma assets. Do not redraw or replace them with emoji or font icons.

## `BlabeeDarkMenuBar.tsx`

```tsx
"use client";

import { KeyboardEvent, useCallback, useEffect, useState } from "react";
import "./blabee-dark-menu-bar.css";

export type BlabeeActionId = 1 | 2 | 3 | 4 | 5;

export type BlabeeAction = {
  id: BlabeeActionId;
  command:
    | "run-recommended"
    | "review-alternative"
    | "pause"
    | "return-to-previous-prompt"
    | "edit-next-prompt";
  label: string;
  shortcut: string;
  icon: string;
  recommended?: boolean;
};

type Phase = "working" | "needs-input" | "waiting";

type BlabeeDarkMenuBarProps = {
  projectName?: string;
  assetBase?: string;
  autoplay?: boolean;
  onAction?: (action: BlabeeAction) => void;
  onViewDetails?: () => void;
};

const actionSeed = [
  {
    id: 1,
    command: "run-recommended",
    label: "Fix 3 failing tests",
    shortcut: "⌘↵",
    icon: "figma-v14-action-1.svg",
    recommended: true,
  },
  {
    id: 2,
    command: "review-alternative",
    label: "Review SDK auth migration",
    shortcut: "⌥R",
    icon: "figma-v14-action-2.svg",
  },
  {
    id: 3,
    command: "pause",
    label: "Pause here",
    shortcut: "⌥P",
    icon: "figma-v14-action-3.svg",
  },
  {
    id: 4,
    command: "return-to-previous-prompt",
    label: "Return to previous prompt",
    shortcut: "⌘Z",
    icon: "figma-v14-action-4.svg",
  },
  {
    id: 5,
    command: "edit-next-prompt",
    label: "Edit next prompt",
    shortcut: "E",
    icon: "figma-v14-action-5.svg",
  },
] as const;

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export default function BlabeeDarkMenuBar({
  projectName = "blabase-web",
  assetBase = "/blabee-dark-menu-bar",
  autoplay = true,
  onAction,
  onViewDetails,
}: BlabeeDarkMenuBarProps) {
  const [selected, setSelected] = useState<BlabeeActionId | null>(null);
  const [phase, setPhase] = useState<Phase>(autoplay ? "working" : "waiting");

  const actions: BlabeeAction[] = actionSeed.map((action) => ({
    ...action,
    icon: `${assetBase}/${action.icon}`,
  }));

  useEffect(() => {
    if (!autoplay) {
      setPhase("waiting");
      return;
    }

    let needsInputTimer: number | undefined;
    let waitingTimer: number | undefined;

    const runTimeline = () => {
      setPhase("working");
      if (needsInputTimer) window.clearTimeout(needsInputTimer);
      if (waitingTimer) window.clearTimeout(waitingTimer);
      needsInputTimer = window.setTimeout(() => setPhase("needs-input"), 320);
      waitingTimer = window.setTimeout(() => setPhase("waiting"), 560);
    };

    runTimeline();
    const loop = window.setInterval(runTimeline, 2200);

    return () => {
      window.clearInterval(loop);
      if (needsInputTimer) window.clearTimeout(needsInputTimer);
      if (waitingTimer) window.clearTimeout(waitingTimer);
    };
  }, [autoplay]);

  const choose = useCallback(
    (action: BlabeeAction) => {
      setSelected(action.id);
      onAction?.(action);
    },
    [onAction],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (isEditableTarget(event.target)) return;

    const key = event.key.toLowerCase();
    let actionId: BlabeeActionId | null = null;

    if (event.metaKey && event.key === "Enter") actionId = 1;
    else if (event.altKey && key === "r") actionId = 2;
    else if (event.altKey && key === "p") actionId = 3;
    else if (event.metaKey && key === "z") actionId = 4;
    else if (!event.metaKey && !event.altKey && !event.ctrlKey && key === "e") {
      actionId = 5;
    }

    if (!actionId) return;
    event.preventDefault();
    const action = actions.find((item) => item.id === actionId);
    if (action) choose(action);
  };

  return (
    <section
      className={`blabee-v14${autoplay ? " blabee-v14--autoplay" : ""}`}
      data-node-id="165:163"
      data-phase={phase}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      aria-label="Blabee dark system-adaptive menu bar prototype"
    >
      <p className="blabee-v14__eyebrow">
        BLABEE · SYSTEM ADAPTIVE MENU BAR · DARK
      </p>
      <h1 className="blabee-v14__title">
        Decision required → badge appears → panel opens automatically.
      </h1>
      <p className="blabee-v14__timing">2.2s · AUTO OPEN</p>

      <div className="blabee-screen" data-node-id="165:167">
        <div className="blabee-workspace-backdrop" data-node-id="165:168">
          <img
            className="blabee-ambient blabee-ambient--blue"
            src={`${assetBase}/figma-v14-ambient-blue.svg`}
            alt=""
          />
          <img
            className="blabee-ambient blabee-ambient--coral"
            src={`${assetBase}/figma-v14-ambient-coral.svg`}
            alt=""
          />

          <div className="blabee-code-workspace" data-node-id="165:171">
            <div className="blabee-code-workspace__rail" />
            <i className="blabee-code-line blabee-code-line--1" />
            <i className="blabee-code-line blabee-code-line--2" />
            <i className="blabee-code-line blabee-code-line--3" />
            <i className="blabee-code-line blabee-code-line--4" />
          </div>
        </div>

        <div className="blabee-system-menu" data-node-id="165:177" aria-hidden="true" />
        <p className="blabee-system-menu__apps">Finder&nbsp;&nbsp; File&nbsp;&nbsp; Edit&nbsp;&nbsp; View</p>
        <p className="blabee-system-menu__time">Fri 9:41</p>

        <aside
          className="blabee-decision-panel"
          data-node-id="165:180"
          aria-label={`${projectName} next actions`}
        >
          <header className="blabee-decision-panel__header" data-node-id="165:205">
            <strong>{projectName}</strong>
            <button type="button" onClick={onViewDetails}>
              View details&nbsp; →
            </button>
          </header>

          <div className="blabee-action-list" data-node-id="165:208">
            {actions.map((action) => (
              <button
                type="button"
                key={action.id}
                className={[
                  "blabee-action",
                  action.recommended ? "blabee-action--recommended" : "",
                  selected === action.id ? "blabee-action--selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => choose(action)}
                data-action={action.command}
                data-node-id={
                  action.id === 1
                    ? "165:209"
                    : action.id === 2
                      ? "165:220"
                      : action.id === 3
                        ? "165:232"
                        : action.id === 4
                          ? "165:242"
                          : "165:254"
                }
              >
                <span className="blabee-action__main">
                  <img src={action.icon} alt="" aria-hidden="true" />
                  <span>{action.label}</span>
                </span>

                <span className="blabee-action__meta">
                  {action.recommended && (
                    <small className="blabee-action__recommended">Recommended</small>
                  )}
                  <kbd>{action.shortcut}</kbd>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div
          className="blabee-status-zone"
          data-node-id="165:182"
          role="status"
          aria-live="polite"
          aria-label={phase === "working" ? "Working" : "Needs input"}
        >
          <img
            className="blabee-status-zone__bee"
            src={`${assetBase}/figma-v14-bee.svg`}
            alt=""
            data-node-id="165:183"
          />
          <img
            className="blabee-status-zone__working"
            src={`${assetBase}/figma-v14-working.svg`}
            alt=""
            data-node-id="165:200"
          />
          <img
            className="blabee-status-zone__needs-input"
            src={`${assetBase}/figma-v14-needs-input.svg`}
            alt=""
            data-node-id="165:202"
          />
          <span className="blabee-sr-only">
            {phase === "working" ? "WORKING" : "NEEDS INPUT"}
          </span>
        </div>

        <p className="blabee-glass-caption">Adjustable glass opacity · 60% default</p>
        <p className="blabee-glass-token">GLASS OPACITY · DEFAULT 60%</p>
      </div>

      <p className="blabee-v14__timeline">
        0.0 WORKING&nbsp;&nbsp;&nbsp;&nbsp; 0.32 NEEDS INPUT&nbsp;&nbsp;&nbsp;&nbsp; 0.56 AUTO OPEN&nbsp;&nbsp;&nbsp;&nbsp; 2.20 WAITING
      </p>
    </section>
  );
}
```

## `blabee-dark-menu-bar.css`

```css
.blabee-v14 {
  --glass-opacity: 0.6;
  --blue: #8ea2ff;
  --blue-deep: #4655d6;
  --coral: #ff9178;
  position: relative;
  width: 960px;
  height: 660px;
  overflow: hidden;
  border-radius: 24px;
  color: #f4f7fc;
  background: #070a0f;
  font-family: Inter, "SF Pro Text", -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
  box-sizing: border-box;
  outline: none;
}

.blabee-v14 *,
.blabee-v14 *::before,
.blabee-v14 *::after {
  box-sizing: border-box;
}

.blabee-v14:focus-visible {
  box-shadow: inset 0 0 0 2px rgba(142, 162, 255, 0.72);
}

.blabee-v14__eyebrow,
.blabee-v14__timing,
.blabee-v14__timeline,
.blabee-glass-token,
.blabee-system-menu__time {
  font-family: "Cascadia Code", "SFMono-Regular", Menlo, monospace;
  font-weight: 600;
}

.blabee-v14__eyebrow {
  position: absolute;
  top: 32px;
  left: 40px;
  width: 360px;
  margin: 0;
  color: #8ea2ff;
  font-size: 14px;
  line-height: normal;
}

.blabee-v14__title {
  position: absolute;
  top: 59px;
  left: 40px;
  width: 540px;
  margin: 0;
  color: #f0f4fa;
  font-size: 18px;
  font-weight: 600;
  line-height: normal;
}

.blabee-v14__timing {
  position: absolute;
  top: 39px;
  left: 810px;
  width: 112px;
  margin: 0;
  color: #959eae;
  font-size: 11px;
  line-height: normal;
}

.blabee-screen {
  position: absolute;
  top: 108px;
  left: 40px;
  width: 880px;
  height: 480px;
  overflow: hidden;
  border: 1px solid #dbd4c4;
  border-radius: 18px;
  background: #060a10;
}

.blabee-workspace-backdrop {
  position: absolute;
  inset: -1px auto auto -1px;
  width: 880px;
  height: 480px;
  overflow: hidden;
  border-radius: 14px;
  background: #060b12;
}

.blabee-ambient {
  position: absolute;
  display: block;
  max-width: none;
  pointer-events: none;
}

.blabee-ambient--blue {
  top: -217px;
  left: 48px;
  width: 584px;
  height: 419px;
}

.blabee-ambient--coral {
  top: -4px;
  left: 536px;
  width: 478px;
  height: 398px;
}

.blabee-code-workspace {
  position: absolute;
  top: 62px;
  left: 32px;
  width: 816px;
  height: 380px;
  overflow: hidden;
  border: 1px solid rgba(244, 247, 252, 0.1);
  border-radius: 18px;
  background: rgba(10, 16, 25, 0.6);
  box-shadow: 0 14px 38px -10px rgba(0, 0, 0, 0.34);
}

.blabee-code-workspace__rail {
  position: absolute;
  top: 23px;
  left: 19px;
  width: 168px;
  height: 332px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.42);
}

.blabee-code-line {
  position: absolute;
  left: 225px;
  height: 8px;
  border-radius: 4px;
  background: rgba(95, 118, 164, 0.22);
}

.blabee-code-line--1 { top: 37px; width: 312px; }
.blabee-code-line--2 { top: 79px; width: 438px; }
.blabee-code-line--3 { top: 121px; width: 266px; background: rgba(226, 103, 69, 0.2); }
.blabee-code-line--4 { top: 163px; width: 390px; }

.blabee-system-menu {
  position: absolute;
  z-index: 5;
  top: -1px;
  left: -1px;
  width: 880px;
  height: 32px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 14px 14px 0 0;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.3);
  -webkit-backdrop-filter: blur(18px) saturate(132%);
  backdrop-filter: blur(18px) saturate(132%);
}

.blabee-system-menu::before {
  position: absolute;
  inset: 0;
  content: "";
  opacity: var(--glass-opacity);
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.16), rgba(112, 133, 199, 0.055) 55%, rgba(46, 66, 163, 0.04)),
    #060a12;
}

.blabee-system-menu__apps,
.blabee-system-menu__time {
  position: absolute;
  z-index: 6;
  top: 9px;
  margin: 0;
  color: rgba(244, 247, 252, 0.72);
  font-size: 9px;
  line-height: normal;
}

.blabee-system-menu__apps { left: 15px; font-weight: 400; }
.blabee-system-menu__time { left: 804px; white-space: nowrap; }

.blabee-decision-panel {
  position: absolute;
  z-index: 10;
  top: 31px;
  left: 439px;
  width: 420px;
  height: 346px;
  padding: 14px;
  overflow: hidden;
  border-radius: 0 0 18px 18px;
  transform-origin: top right;
  color: #f4f7fc;
  -webkit-backdrop-filter: blur(24px) saturate(135%);
  backdrop-filter: blur(24px) saturate(135%);
}

.blabee-decision-panel::before {
  position: absolute;
  z-index: -1;
  inset: 0;
  content: "";
  border: 1px solid rgba(255, 255, 255, 0.34);
  border-radius: 16px;
  opacity: var(--glass-opacity);
  background:
    linear-gradient(99.33deg, rgba(255, 255, 255, 0.13) 3.67%, rgba(97, 115, 173, 0.05) 45.87%, rgba(41, 61, 153, 0.04) 95.41%),
    #05080f;
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.36),
    0 22px 54px -12px rgba(0, 0, 0, 0.62);
}

.blabee-decision-panel__header {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 48px;
  padding: 0 4px 0 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.blabee-decision-panel__header strong {
  font-family: "Cascadia Code", "SFMono-Regular", Menlo, monospace;
  font-size: 13px;
  font-weight: 600;
}

.blabee-decision-panel__header button {
  padding: 0;
  border: 0;
  color: #8ea2ff;
  background: transparent;
  font: 600 12px/18px Inter, "SF Pro Text", sans-serif;
  cursor: pointer;
}

.blabee-decision-panel__header button:focus-visible,
.blabee-action:focus-visible {
  outline: 2px solid #8ea2ff;
  outline-offset: -2px;
}

.blabee-action-list {
  position: relative;
  z-index: 1;
  height: 255px;
  display: grid;
  grid-template-rows: repeat(5, 48px);
  gap: 5px;
  border: 1px solid rgba(142, 162, 255, 0.42);
  background: rgba(29, 38, 73, 0.62);
}

.blabee-action {
  min-width: 0;
  height: 48px;
  padding: 0 12px 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 9px;
  color: #f4f7fc;
  background: rgba(255, 255, 255, 0.05);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.13);
  font: 600 13px/18px Inter, "SF Pro Text", sans-serif;
  text-align: left;
  cursor: pointer;
}

.blabee-action__main,
.blabee-action__meta {
  min-width: 0;
  display: flex;
  align-items: center;
}

.blabee-action__main {
  gap: 12px;
  overflow: hidden;
}

.blabee-action__main img {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: block;
}

.blabee-action__main > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.blabee-action__meta {
  flex: 0 0 auto;
  gap: 6px;
}

.blabee-action__recommended,
.blabee-action kbd {
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}

.blabee-action__recommended {
  padding: 0 7px;
  border-radius: 6px;
  color: #fff;
  background: rgba(70, 85, 214, 0.72);
  font-size: 10px;
  font-weight: 600;
}

.blabee-action kbd {
  min-width: 28px;
  padding: 0 8px;
  border: 1px solid rgba(244, 247, 252, 0.14);
  border-radius: 7px;
  color: rgba(244, 247, 252, 0.74);
  background: rgba(0, 0, 0, 0.58);
  font: 600 10px/12px "Cascadia Code", "SFMono-Regular", Menlo, monospace;
  letter-spacing: 0.1px;
}

.blabee-action--recommended {
  border-color: rgba(142, 162, 255, 0.38);
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.035)),
    rgba(70, 85, 214, 0.14);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.24);
}

.blabee-action:hover,
.blabee-action--selected {
  border-color: rgba(142, 162, 255, 0.72);
  background: rgba(70, 85, 214, 0.3);
}

.blabee-status-zone {
  position: absolute;
  z-index: 20;
  top: -1px;
  left: 747px;
  width: 32px;
  height: 32px;
  transform-origin: center;
}

.blabee-status-zone__bee {
  position: absolute;
  top: 4px;
  left: 2px;
  width: 27.711px;
  height: 24px;
  display: block;
}

.blabee-status-zone__working,
.blabee-status-zone__needs-input {
  position: absolute;
  z-index: 2;
  top: 4px;
  left: 23px;
  width: 7px;
  height: 7px;
  display: block;
}

.blabee-status-zone__needs-input { opacity: 0; }

.blabee-glass-caption {
  position: absolute;
  top: 437px;
  left: 249.5px;
  width: 410px;
  margin: 0;
  color: #96a0b1;
  font-size: 13px;
  line-height: normal;
  text-align: center;
}

.blabee-glass-token {
  position: absolute;
  top: 459px;
  left: 365px;
  width: 206px;
  margin: 0;
  color: #8ea2ff;
  font-size: 9px;
  line-height: normal;
}

.blabee-v14__timeline {
  position: absolute;
  top: 618px;
  left: 40px;
  width: 500px;
  margin: 0;
  color: #959eae;
  font-size: 10px;
  line-height: normal;
  white-space: nowrap;
}

.blabee-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.blabee-v14--autoplay .blabee-decision-panel {
  animation: blabee-adaptive-panel 2.2s infinite;
  will-change: opacity, transform;
}

.blabee-v14--autoplay .blabee-status-zone {
  animation: blabee-adaptive-status-zone 2.2s infinite;
  will-change: transform;
}

.blabee-v14--autoplay .blabee-status-zone__working {
  animation: blabee-adaptive-working 2.2s infinite;
  will-change: opacity;
}

.blabee-v14--autoplay .blabee-status-zone__needs-input {
  animation: blabee-adaptive-needs-input 2.2s infinite;
  will-change: opacity;
}

@keyframes blabee-adaptive-panel {
  0%, 14.55% {
    opacity: 0;
    transform: translateY(-8px) scale(0.985);
    animation-timing-function: ease-out;
  }
  25.45%, 100% {
    opacity: 1;
    transform: translateY(0) scale(1);
    animation-timing-function: linear;
  }
}

@keyframes blabee-adaptive-status-zone {
  0%, 12.73% {
    transform: scale(1);
    animation-timing-function: ease-out;
  }
  19.09% {
    transform: scale(1.06);
    animation-timing-function: ease-out;
  }
  26.36%, 100% {
    transform: scale(1);
    animation-timing-function: linear;
  }
}

@keyframes blabee-adaptive-working {
  0%, 5.45% {
    opacity: 1;
    animation-timing-function: linear;
  }
  10.91%, 78.18% {
    opacity: 0;
    animation-timing-function: ease-out;
  }
  84.09%, 100% {
    opacity: 1;
    animation-timing-function: linear;
  }
}

@keyframes blabee-adaptive-needs-input {
  0%, 12.73% {
    opacity: 0;
    animation-timing-function: ease-out;
  }
  19.09%, 100% {
    opacity: 1;
    animation-timing-function: linear;
  }
}

@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .blabee-system-menu::before { opacity: 0.96; }
  .blabee-decision-panel::before { opacity: 0.98; }
}

@media (prefers-reduced-motion: reduce) {
  .blabee-v14--autoplay .blabee-decision-panel {
    opacity: 1;
    transform: none;
    animation: none;
  }
  .blabee-v14--autoplay .blabee-status-zone {
    transform: none;
    animation: none;
  }
  .blabee-v14--autoplay .blabee-status-zone__working {
    opacity: 0;
    animation: none;
  }
  .blabee-v14--autoplay .blabee-status-zone__needs-input {
    opacity: 1;
    animation: none;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .blabee-system-menu,
  .blabee-decision-panel {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  .blabee-system-menu::before {
    opacity: 1;
    background: #060a12;
  }
  .blabee-decision-panel::before {
    opacity: 1;
    background: #0b111c;
  }
}
```

## Usage

```tsx
import BlabeeDarkMenuBar from "./BlabeeDarkMenuBar";

export default function PrototypePage() {
  return (
    <main style={{ minHeight: "100vh", padding: 32, background: "#020408" }}>
      <BlabeeDarkMenuBar
        projectName="blabase-web"
        onViewDetails={() => console.log("Open details")}
        onAction={(action) => {
          // Production: forward action.command to the same Codex/Claude session.
          console.log(action.id, action.command);
        }}
      />
    </main>
  );
}
```

## Interaction contract

| Action | Shortcut | Command payload | Meaning |
|---|---|---|---|
| Fix 3 failing tests | `⌘↵` | `run-recommended` | Run the recommended next task |
| Review SDK auth migration | `⌥R` | `review-alternative` | Inspect the alternative before choosing it |
| Pause here | `⌥P` | `pause` | Preserve the current point and pause |
| Return to previous prompt | `⌘Z` | `return-to-previous-prompt` | Restart from the previous prompt, not a generic file rollback |
| Edit next prompt | `E` | `edit-next-prompt` | Edit the next prompt before sending it |

For the web preview, shortcuts are active while the 960×660 component is focused. In the macOS product, register the same combinations in the app's global hotkey layer and send the resulting command back to the same coding-agent session.

## Motion timing

| Time | Visual state |
|---:|---|
| `0ms` | Working dot visible; panel hidden at `translateY(-8px) scale(.985)` |
| `280–420ms` | Blabee status zone briefly scales to `1.06`; status changes to Needs Input |
| `320–560ms` | Decision panel fades and settles into the menu bar |
| `560–2200ms` | Panel stays open in the Waiting state |
| `2200ms` | Figma prototype loop restarts |

The production product should normally play the reveal once per real decision event. The infinite loop is retained here only because the linked Figma frame is a motion-demonstration board.
