"use client";

import { useEffect } from "react";

import {
  SOURCE_CONNECTION_ANCHORS,
  launcherSourceAnchor
} from "../sourceNavigation";

const canonicalAnchors = new Set<string>(
  Object.values(SOURCE_CONNECTION_ANCHORS)
);

export function SourceFocusController() {
  useEffect(() => {
    function hashSourceAnchor(): string | null {
      const url = new URL(window.location.href);
      const hashAnchor = url.hash.startsWith("#")
        ? url.hash.slice(1)
        : "";
      return canonicalAnchors.has(hashAnchor) ? hashAnchor : null;
    }

    function focusSourceTarget(anchor: string | null): void {
      if (!anchor) return;

      const target = document.getElementById(anchor);
      if (!(target instanceof HTMLElement)) return;

      document
        .querySelectorAll<HTMLElement>("[data-source-focus='true']")
        .forEach((element) => {
          delete element.dataset.sourceFocus;
        });
      target.dataset.sourceFocus = "true";
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "start" });
    }

    const url = new URL(window.location.href);
    const launcherAnchor = launcherSourceAnchor(
      url.searchParams.get("source"),
      url.searchParams.get("entry")
    );
    if (launcherAnchor && url.hash !== `#${launcherAnchor}`) {
      url.hash = launcherAnchor;
      window.history.replaceState(
        null,
        "",
        `${url.pathname}${url.search}${url.hash}`
      );
    }

    focusSourceTarget(launcherAnchor ?? hashSourceAnchor());
    const focusHashTarget = () => focusSourceTarget(hashSourceAnchor());
    window.addEventListener("hashchange", focusHashTarget);
    return () => {
      window.removeEventListener("hashchange", focusHashTarget);
    };
  }, []);

  return null;
}
