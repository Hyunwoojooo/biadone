# Blabee Landing Page Design Brief

Status: implementation source of truth for the Codex-first macOS private beta landing page.

## Product and audience

Blabee is a small interface that surfaces two to four ranked next actions on a Mac, then sends the selected shortcut back to the original Codex session.

The page is for people who hand a task to Codex, move into another window, and do not want to keep returning to the terminal just to make one decision.

## Promise and conversion

Promise: one small decision can happen from the current Mac screen, with one shortcut, while the original Codex session continues.

- Primary CTA: Join the Mac beta
- Conversion: private beta application
- Current scope: Codex-first on macOS
- Published language: English only

## Product truth boundaries

- Codex creates the choices; Blabee only displays them and sends the selection.
- A selection becomes a new user turn in the original Codex session.
- Blabee appears only when Codex has useful next actions and the current session is correctly bound.
- The current ranked flow contains two to four actions. Slot 1 is recommended and later slots are ranked alternatives.
- The current build does not expose rollback as an enabled action.
- Do not claim a separate LLM, decision layer, safety engine, long-term memory, independent Git rollback, multi-agent management, or confirmed Claude Code support.

## Page narrative

1. Header with brand and one Mac beta CTA
2. Hero with the terminal-to-ranked-action product demonstration
3. Three user benefits for people who move between windows
4. Three-step same-session flow
5. Current private beta scope
6. Product-truth FAQ
7. Mac private beta application
8. Minimal footer

## Visual concept: Quiet Signal

The normal state is pure black, implemented as the user-approved screen value `#000000`. Blazing Yellow appears when a decision boundary needs attention. The signature product moment is a thin yellow 32-pixel Blabee bar opening into ranked actions, followed by the original terminal session continuing.

- Every page-level section uses the same Jet Black canvas; tonal blacks are limited to controls and the product demonstration
- Blazing Yellow is an accent for decisions, CTAs, focus, and thin section signals, never a full page band
- No gradients, glow, glassmorphism, decorative bento grids, or generic AI motifs
- Flat editorial composition with fine rules, strict grids, and restrained tonal surfaces
- Product UI is more prominent than the character mark
- Warm off-white is used for essential headings; pure white is avoided
- Motion shows one working → complete → ranked actions → review sequence, then gets out of the way

## Motion direction

- GSAP Core and ScrollTrigger 3.15.0 are pinned and self-hosted; the page does not depend on a third-party CDN or a relaxed content-security policy
- The hero, product sequence, section headings, and supporting rows may reveal once with short opacity and 12–20 pixel translations
- Do not use pinned sections, scroll scrubbing, smooth scrolling, parallax, decorative loops, or motion that competes with the four-choice interaction
- A manual pointer or keyboard choice always stops the automatic product sequence; autoplay must never overwrite the user's decision
- With reduced motion enabled, the demo renders the useful four-choice decision state without an animated sequence
- If GSAP or ScrollTrigger fails to load, all page content remains visible and the demo falls back to the same static decision state

## Responsive composition

- 1440 × 900: five/seven-column hero split; headline and full product demo remain visible in the opening composition
- 768 × 1024: hero stacks while preserving a substantial demo and editorial spacing
- 390 × 844: copy, CTA, then the complete ranked-action demo; no decorative content competes with the interaction

## Implementation decisions

- Static HTML, CSS, and JavaScript with one pinned production dependency: self-hosted GSAP Core and ScrollTrigger 3.15.0
- Vendored GSAP files remain inside this site so the existing `script-src 'self'` policy does not need to change
- Canonical Blabee menu-bar SVG reused from the product repository
- A deterministic 1200 × 630 social card uses the same canonical product mark and current ranked-action copy
- Form success is shown only after a configured endpoint returns a successful response
- Until an endpoint is configured, submission uses the approved error state rather than pretending that an application was stored
- With JavaScript unavailable, the form is disabled and explains that JavaScript is required, preventing a fallback GET from exposing an email address in a URL
- No unapproved navigation, policy, social, customer, metric, or integration links are invented

## Remaining launch inputs

- Real private-beta form endpoint
- Product approval for whether the public narrative should explicitly explain Smart mode, or remain generic across Smart, Always, and Action only

## Non-canonical comparison variant: PetView Liquid Glass

`/liquid-glass/` is an isolated, `noindex` comparison route for evaluating whether the current macOS product material belongs in the marketing expression. It does not replace the canonical root page. The root page remains the approved Quiet Signal direction, including its flat composition and no-glass rule.

- Content, section order, typography, pure `#000000` canvas, Blazing Yellow hierarchy, product hooks, motion behavior, and fail-closed beta form stay aligned with the root page
- Canonical and Open Graph URLs continue to identify `https://blabee.com/`; the comparison route is not linked from the root page or added to the sitemap
- Every major page region carries the same material language: the hero demo, benefits, how-it-works, private-beta scope, FAQ, signup, and footer each use one blurred outer glass shell
- At desktop widths, the hero reading pane and product-demo window share the same top and bottom edges; the demo caption sits below that aligned pair and does not change either panel height
- Layered translucent fills, the PetView rim progression, and a restrained inner top highlight make each shell read as glass over the pure black canvas without adding background glow or a generic AI gradient
- Editorial rows, steps, scope rows, FAQ items, form controls, and shortcut keys are translucent insets without nested blur; this keeps the page cohesive without becoming a field of floating glass cards
- Yellow brand plates, CTAs, and the 32-pixel decision bar remain opaque so the decision signal keeps its visual authority

The material values map to the current `PetView.swift` hierarchy rather than a generic glass preset: panel radius `30px`, section radius `20px`, row radius `18px`, shortcut-key radius `8px`, and rim width `0.75px`; inset fills use white at `6.5%` or `10%` when emphasized, with a white `13%` rim and a Blazing Yellow `32%` accent rim. The strong web fallback uses `rgba(8, 9, 11, 0.68)`, `28px` blur, `135%` saturation, and the PetView dark rim progression of white `24%` to white `8%` to black `34%`.

All inner rows are translucent insets without nested blur. Unsupported backdrop filtering and reduced-transparency preferences receive an opaque tonal fallback; reduced-motion behavior remains static and usable. No ambient orbs, free-floating pills, decorative glass bento grid, or new animation loops are introduced.
