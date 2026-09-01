---
name: landing-page-director
description: Direct the planning, implementation, review, and visual polish of the Blabee marketing landing page. Use for landing-page or launch-page work in this project; do not use for backend-only tasks.
---

# Landing Page Director

Produce a complete, source-backed landing page with one coherent visual concept. Preserve the user's requested scope and the repository's current architecture.

## Load the relevant sources

Before editing, read the nearest `AGENTS.md`, `DESIGN_BRIEF.md`, and the relevant files under the project-level `references/` directory.

Use this precedence when sources disagree:

1. The exact approved Figma frame or reference screenshot
2. Approved brand and copy files
3. Existing repository assets, tokens, and components
4. Other references explicitly supplied for the task
5. Conservative assumptions recorded in `DESIGN_BRIEF.md`

If an exact Figma frame is supplied, use the Figma design-to-code workflow to inspect that node and its screenshot before implementation. Do not substitute a parent frame or nearby variant.

## Direct the work

### Establish the product truth

- Identify the visitor, problem, promise, primary CTA, and conversion event.
- Separate verified current behavior from beta or planned behavior.
- Never invent testimonials, logos, metrics, integrations, privacy guarantees, or security claims.
- When a public claim cannot be verified, omit it or label it as unresolved in the working brief rather than publishing it.

### Establish the design direction

Translate abstract adjectives into concrete decisions about type, density, spacing, contrast, imagery, motion, and responsive composition. Update `DESIGN_BRIEF.md` only when the task changes an actual design decision or resolves an open input.

For Blabee, keep the compact decision interface central. The bee character may guide attention, but it must not overpower the product interaction. Read [references/anti-patterns.md](references/anti-patterns.md) before proposing or materially changing the visual direction.

### Implement the complete requested surface

- Reuse supplied assets and existing primitives before creating replacements.
- Keep copy editable and semantic structure accessible.
- Build intentional desktop, tablet, and mobile compositions.
- Use restrained motion and respect reduced-motion preferences.
- Do not stop at a hero, wireframe, placeholder section, or plan when implementation was requested.
- Do not add a production dependency unless its concrete benefit is explained.

### Run the browser polish loop

Read [references/landing-page-checklist.md](references/landing-page-checklist.md) for implementation or visual-QA tasks.

Prefer `$playwright-interactive` when its runtime prerequisites are active. If they are unavailable, use the installed frontend-testing/browser tools and disclose the substitution; never claim Playwright evidence that was not collected.

Check at least these viewports unless the user narrows the task:

- 390 x 844 mobile
- 768 x 1024 tablet
- 1440 x 900 desktop

Capture evidence before and after meaningful polish changes. Treat a reachable dev server, a successful build, and visual browser inspection as separate checks.

### Validate and report

Run only scripts that actually exist in the project. Fix errors introduced by the change and review the final diff for unrelated edits, dead code, fake content, broken links, and missing responsive behavior.

Report the design direction, files or routes changed, viewports checked, commands and results, unresolved content or asset inputs, and whether human approval is still needed.
