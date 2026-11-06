# Landing Page Completion Checklist

Use this checklist for implementation and final polish. Add task-specific checks when the requested page contains additional controls or states.

## Product and content

- A visitor can identify the product, audience, problem, outcome, and primary action from the hero.
- The primary CTA points to a real, approved conversion event.
- Current, beta, and planned capabilities are not conflated.
- No unsupported social proof, integration, privacy, security, or performance claim is present.
- Navigation and footer links resolve or are intentionally omitted.

## Visual system

- One visual concept governs type, spacing, color, imagery, cards, and motion.
- The product interaction remains more prominent than decorative character art.
- Section rhythm and content width are consistent without becoming repetitive.
- Supplied assets are used at an appropriate resolution and crop.
- Hover, focus, selected, loading, and reduced-motion states are coherent where applicable.

## Responsive browser QA

At 390 x 844, 768 x 1024, and 1440 x 900:

- Open the actual route and confirm the expected title and content.
- Exercise each meaningful control with normal pointer and keyboard input.
- Check headline wrapping, gutters, section spacing, image crop, navigation, CTA visibility, and footer completion.
- Confirm there is no horizontal overflow or accidental clipping.
- Inspect console errors and warnings relevant to the implementation.
- Capture final screenshots after corrections.

## Engineering

- Run only existing lint, typecheck, test, and build commands that apply.
- Review the diff for unrelated changes, duplicated UI, dead code, hard-coded values that should use tokens, and missing accessible names.
- State any validation that could not be performed and the exact manual follow-up.
