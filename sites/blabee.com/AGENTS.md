# Blabee Landing Page Instructions

## Scope

This directory owns the public `blabee.com` landing page. Build deployable marketing pages, not product dashboards or backend services. The repository-level `AGENTS.md` still applies.

The directory currently has no runtime scaffold. Default to the repository convention of static HTML, CSS, and JavaScript unless an approved design or product requirement justifies a different stack. Explain any new production dependency before adding it.

## Sources of truth

When sources conflict, use this order:

1. The exact approved Figma frame or reference screenshot
2. Files under `references/`
3. Existing assets, design tokens, and components in this directory
4. Repository conventions
5. Conservative assumptions documented in `DESIGN_BRIEF.md`

Do not treat a nearby Figma variant, generic template, or generated mockup as the approved design.

## Product and content rules

- Present Blabee as a compact development-continuity decision interface, not a dashboard, project-management system, or general chatbot.
- Keep the four-decision interaction more prominent than decorative character art.
- Make the audience, problem, outcome, and primary action understandable from the hero.
- Distinguish verified current behavior from beta and planned behavior.
- Do not invent testimonials, customer logos, usage metrics, integrations, ratings, privacy guarantees, or security claims.
- Use only real, approved download, beta, waitlist, policy, company, and contact links.

## Visual and implementation rules

- Maintain one coherent visual concept across typography, spacing, color, imagery, UI surfaces, and motion.
- Use the warm yellow Blabee identity with controlled light and dark surfaces; preserve approved character and logo assets.
- Avoid generic AI gradients, decorative glow, excessive pills, repetitive bento grids, and fake dashboard mockups.
- Use semantic HTML, accessible interactions, visible keyboard focus, and reduced-motion handling.
- Implement desktop and mobile compositions intentionally; do not rely on proportional shrinking alone.
- Include metadata, favicon references, social preview configuration, and basic SEO when the chosen structure supports them.

## Verification

For complete-page work, browser-check 390 x 844, 768 x 1024, and 1440 x 900. Verify navigation, CTA states, typography, spacing, asset crop, overflow, keyboard behavior, reduced motion, footer completeness, and relevant console output.

Use `$landing-page-director` for landing-page planning, implementation, or polish. Prefer `$playwright-interactive` only when its runtime prerequisites are available; otherwise use the installed frontend-testing/browser tooling and state the validation boundary.

Run only commands defined by the selected project scaffold. Do not claim visual completion without opening the actual route in a browser, and do not treat a successful build as visual evidence.

## Done means

- The requested page and primary interactions are complete.
- Mobile, tablet, and desktop layouts have been browser-checked.
- Applicable lint, typecheck, tests, and production build pass.
- Public claims and links are supported by real product or business sources.
- The final report lists changed files, checks, risks, unresolved inputs, and any required human approval.
