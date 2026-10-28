# Biadone Studio design specification

Reference: `assets/editor-concept.png` (Image Gen, complete desktop editing screen).

Generation method: built-in `image_gen` (no API key). Prompt direction: a full, front-on 1536×1024 Korean narration-first long-form editor; light cool-gray surface, white panes, dark ink and emerald controls; Biadone Studio header and four workflow steps; chapter/scene rail, code-native 16:9 three-step preview with safe subtitles, scene inspector, caption editor and full-width narration/scene/caption timeline. The generated reference was inspected with `view_image` before implementation and compared with final desktop captures.

The working direction is a quiet Korean creative tool: cool gray work surface, white panes, dark ink, emerald controls, and a large 16:9 live preview. The reference is the visual baseline, not a substitute for live controls.

## Tokens

- Application background `#f3f5f7`; pane `#ffffff`; line `#e2e7ec`.
- Main text `#182322`; secondary `#6b7685`; accent `#15856d`; selected fill `#e5f4ef`.
- Main font: locally bundled Noto Sans KR variable. UI chrome 12–14 px, panel headings 13–14 px / 700, brand 20 px / 750. Explicit button/input typography.
- Pane corners 7–8 px; input corners 5 px. Single hairline pane boundaries; minimal shadows.
- 8 px base spacing; 10 px outer gutter; 8 px pane gaps; 14–18 px pane padding.

## Primary screen anatomy

1. Header: geometric play mark, Biadone Studio, editable project title, save state, export.
2. Workflow rail: `01 소스 준비`, `02 장면 구성`, `03 편집`, `04 검수 · 출력`.
3. Left scene/chapter rail: 250–270 px desktop; numbered thumbnail rows, active teal border/fill, title and actual times.
4. Center: video composition, playback controls, selected narration/caption editing.
5. Right inspector: 290–310 px desktop; template selector, native fields, theme, lock and real quality issues.
6. Bottom: scrollable/zoomable multi-track overview with chapters, scenes, actual narration waveform and captions. Playhead synchronized with preview.

Desktop target 1536×1024. At 1280 px panes compress without covering the preview. At narrower widths scene/inspector drawers preserve editing access; laptop height is handled with independently scrolling panes.

## Required functional surfaces

Source import, project selection/creation, chapter grouping, caption import/correction, quality review, render jobs/history, export and Codex connection details extend the same visual system. Dialogs have real labels, focus handling, keyboard dismissal and native form validation. Destructive history-changing operations keep recoverable revisions.

## Intentional dynamic differences

The concept's example times, titles and media are illustrative. Real projects use actual narration duration, selected media, caption contents and quality results. UI never invents saved/quality states. API-chat controls are not included; optional Codex MCP uses the same commands as manual editing.

## Visual verification

Compare the concept and latest browser screenshot with `view_image`. Inspect pane geometry, typography, color temperature, selection, preview layout, controls, and timeline. Inspect native desktop, 1280 px laptop and narrow responsive layout. All UI text and controls remain code-native.
