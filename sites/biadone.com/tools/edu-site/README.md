# edu.biadone.com

Static Korean production-and-training website for `https://edu.biadone.com/`, served by the separate Cloudflare Pages project `biadone-edu`.

## Source and scope

The UI uses the user-supplied Biadone design system at `/Users/joo/BiaDone/brand/design-system/` (previewed at `http://127.0.0.1:4327/design-system/`). Its canonical blue `#2858F0`, ink `#23314D`, white and blue tint `#EEF5FF` now supersede the earlier Smart Marketer mint/pill styling. The existing content order, 2026-10-27 AI practical-education copy and approved curriculum are retained. Homepage production remains one application area alongside business operations and store-video content. The independent B reference HTML/ZIP is unchanged.

Current titles use SUITE 700; body text, menus, controls and the approved logo retain Pretendard. The curriculum overview is drawn with native HTML/CSS/SVG above the detailed curriculum. All labels are selectable text; the raster reference stays private.

The buildless source is `public/index.html`, `styles.css`, `site-content.js`, and `app.js`. `site-content.js` is the editable source of course, case, media, gallery, experience, and FAQ data. See [CONTENT_GUIDE.md](CONTENT_GUIDE.md) for confirmation and publication rules.

The user supplied `https://clover.biadone.com/home/` as an approved real example. Its public class/studio/reservation page was inspected and captured on 2026-10-27. The actual-case section uses the unmodified page screenshot. The first screen is text-only after the user-requested hero image removal. The case describes only observable page content and links; original business-problem history, AI conversation/work records, inquiry counts, contracts, and revenue are not claimed. General application directions remain visibly separate from this evidence.

All three enrollment categories are currently `preparing`. The separately supplied, approved detailed curriculum is published through `curriculumPlan`: eight areas and 52 practice items in two long panels. Its specified session timings and outcomes are preserved, while selling dates, locations, prices, support conditions and application URLs remain unconfirmed and empty. No course-purchase or enrollment buttons are generated. The introductory experience is reserved but hidden until confirmed content is ready. Offline event photo values are all empty and the entire gallery is hidden. Existing AI workspace images remain unused; no substitute event photos were added. The supplied real team portraits remain in the team section, with roles taking priority over unconfirmed academic/biographical details.

`public/_headers` keeps same-origin scripts, styles, fonts, and images. `media-src 'self'` permits approved local video when supplied. Videos have user controls, `playsinline`, metadata preload, and no autoplay. No externally hosted media or iframe is embedded. `public/404.html` shares the same white/blue design-system assets and components as the home page.

No framework, build step, package installation, backend, or analytics is added. The main `biadone` Pages project and its deployment pipeline are independent.

## Inquiry behavior

Institution/group education and custom production have separate entry buttons and field sets. Institution mode collects organization, audience, participant count, topic, timeline, and contact email; it never requires project budget. Custom mode collects the current work/desired result, optional budget/timeline, and contact email. The `맞춤 실무교육` inquiry option remains available. Learners are directed to courses rather than project-budget consultation.

The dialog prepares a `mailto:` draft for `biadone.official@gmail.com`. Visitors must send it in their configured mail app. The site does not send or store submissions, and it does not display a received/submitted confirmation. Copy and UTF-8 TXT export remain available; hidden field sets are disabled and excluded from validation, FormData, and the outgoing draft. Clipboard fallback and focus restoration are retained.

## Local preview

```bash
python3 -m http.server 8000 --directory tools/edu-site/public
```

This basic preview does not apply Cloudflare's `_headers` rules or custom 404 behavior. Check those separately before approving a deployment.

## Deployment

Deploy only `public/` after explicit user approval. This README, supplied source bundle, local caches, and operational records must not be uploaded.

```bash
npx -y wrangler@4.151.1 pages deploy tools/edu-site/public --project-name biadone-edu --branch main --commit-dirty=true
```

The site retains `X-Robots-Tag: noindex, nofollow` until indexing is intentionally enabled. `Cache-Control: public, no-cache, no-transform` preserves revalidation and prevents the zone's automatic analytics snippet from being injected. See [Cloudflare Web Analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/).

## Domain setup

- Production: `https://edu.biadone.com/`.
- Cloudflare Pages project: `biadone-edu`.
- DNS: proxied CNAME `edu.biadone.com` → `biadone-edu.pages.dev`, automatic TTL.
- Initial domain verification and certificate validation were active on 2026-10-20.

A local source update is not proof of a production update. Verify deployed HTML, asset hashes, headers, desktop/mobile rendering, and interactions on the production hostname after deployment.

## UI release — 2026-10-20

- Deployment: `834c3e1c-a87c-4d92-ba9f-5ee153405ea1` (`https://834c3e1c.biadone-edu.pages.dev`).
- Production domain: active; HTTPS verified on `https://edu.biadone.com/`.
- All 17 supplied public files matched deployed SHA-256 values after the intended home URL metadata update. Nine private/missing paths returned the custom 404.
- Chromium checks passed at widths 1440, 768, 390, and 320: navigation, mobile menu, keyboard service tabs, local schedule demo, FAQ, inquiry dialog and validation, copy, download, mailto draft composition, and motion preferences. Clipboard was stubbed and mailto navigation intercepted; no email was sent.
- The 1440 × 8013 reduced-motion full-page screenshot matched the supplied source exactly. Layout, visible copy, type, palette, imagery, and section order were preserved. No material visual deviations were found.
- Browser plugin was unavailable; existing Playwright 1.55.0 and Chromium 151 were used. Real mail-app delivery and browsers other than Chromium were not tested.

## Portrait update — 2026-10-20

- Deployment: `e0c97b86-4ba5-4bd2-a853-2d077fce12ad` (`https://e0c97b86.biadone-edu.pages.dev`).
- User-supplied Image 1 is 김동민; Image 2 is 주현우. Both JPEGs retain their original bytes. Existing 4:5 frames use `object-fit: cover` with top alignment.
- Verified name/photo mapping, loaded images, frame proportions, and no horizontal overflow or browser errors at widths 1440, 768, 390, and 320 on the production hostname. Both JPEGs and updated HTML/CSS match the deployed SHA-256 values.

## B / Working Studio release — 2026-10-23

- Deployment: `cf890d9c-13da-4f30-b225-1f19b220383c` (`https://cf890d9c.biadone-edu.pages.dev`). Cloudflare reports the production deployment as successful, with `edu.biadone.com` connected.
- Approved B layout is live, including the removed hero profiles, `#2340FF` accent, circular team photos, and homepage title practice. The design reference toolbar and review-only copy are excluded.
- Existing mailto consultation behavior is preserved, including required name/email/message validation, email-address copy, consultation copy and UTF-8 TXT download. No backend or storage is added.
- Local HTTP and the production hostname passed Chromium checks at 1440, 1024, 768, 390, and 320 px: page identity, CSP, all rendered assets, no horizontal overflow or relevant console errors, title edit/reset, practice TXT, navigation, FAQ, consultation validation/copy/TXT/mailto composition, Escape and focus restoration. Copy permissions were stubbed, and mailto navigation was intercepted; no email was sent.
- Eight missing/private paths returned the matching 404 page; a nested missing path could return home. Public HTML and assets were checked against their SHA-256 manifest. `_headers` remains configuration-only, and its live CSP, noindex, and cache headers were verified.
- Browser plugin not available; the existing Playwright/Chromium installation was used. Direct screenshot comparison confirmed the expected layout. Intentional changes from the reference are limited to removing review UI, production metadata/footer, and restoring the operational consultation form.
- The independent reference HTML/ZIP and main site files stayed unchanged (64-file hash baseline). Only `tools/edu-site/public/` was uploaded; no private documents, source references, environment files, or caches were included.
- Previous deployment: `e0c97b86-4ba5-4bd2-a853-2d077fce12ad`. A pre-change source backup is retained locally outside the deployment directory. Real mail-app delivery and non-Chromium browsers remain untested.

## AI practical-education update — 2026-10-27

- Deployment: `a34cf14b-d4f7-4db9-81ae-571db0a9dc95` (`https://a34cf14b.biadone-edu.pages.dev`). Cloudflare reports a successful production deployment for `edu.biadone.com`. Previous production deployment: `cf890d9c-13da-4f30-b225-1f19b220383c`.
- Updated title, metadata, navigation, hero, business concerns, learning method, three course categories, role-first team descriptions, FAQ and closing actions. Existing navy/blue palette, typography and general spacing were retained.
- User-approved Clover public homepage evidence and its unmodified screenshot are used in the hero and a real-page example. The case separates observable information from operator verification points; no undocumented AI work history or performance metrics are claimed. Three general application areas remain separate.
- Curriculum, operating conditions and enrollment URLs remain empty; all three categories show preparing status. Offline photos are empty and the gallery is hidden. No substitute event images or simulated AI execution were added. Confirmed data can be added through `site-content.js`; see CONTENT_GUIDE.md.
- Institution/group-education and custom-production inquiries have distinct fields and mail bodies. Required-field validation, copy/fallback, UTF-8 TXT, mailto composition, Escape and focus restoration passed. Mailto was intercepted and clipboard permissions were stubbed; no mail was sent.
- Local and production Chromium passed at widths 1440, 1024, 768, 390, and 320: identity, CSP, content/asset/anchor integrity, no horizontal overflow or relevant console errors, case/course visibility, menu, FAQ, and inquiry separation. Final whitespace/layout refinements also passed locally at 1440, 390 and 320.
- Temporary local fixture tests passed: zero approved cases, a complete five-part workflow case, one approved photo, rejected unapproved/external media, curricula of different lengths, ready introductory content, invalid enrollment URLs, closed-state messaging, and video controls without autoplay. Fixture data/video were never copied into public source or uploaded. Actual future course content, actual event photos/video and real mail-app delivery remain untested until supplied.
- Six private/missing paths returned the custom 404. All 24 downloadable public files match the local SHA-256 manifest; `_headers` is configuration-only and its live security/cache/noindex values were checked.
- Browser plugin not available; existing Playwright Chromium was used, with desktop/mobile screenshots visually inspected. A pre-edit source archive and screenshots/QA outputs are kept outside the deploy directory. The 64-file independent-reference/main-site hash baseline remained unchanged.

## Reference UI composition — 2026-10-27

Reference: [Smart Marketer AI Marketing Hub Blueprint](https://smartmarketer.com/ai-marketing-hub-blueprint/). The reference was inspected in Chromium at 1440×1000 and 390×1000, including its full page and computed layout values. The public fetch tool could not open it; the browser and direct HTML/CSS evidence were used instead. Browser plugin not available; the existing Playwright installation was reused.

Only public `index.html` and `styles.css` were changed for this restyle. The 205 existing static text fragments were preserved; `site-content.js`, `app.js`, `_headers`, case/portrait bytes, and the independent reference/main-site baseline were hash-checked unchanged. The meaning, confirmation boundaries, preparing courses, hidden gallery and email inquiry behavior are retained.

| Comparison point | Reference composition | EDU implementation / intentional adaptation |
| --- | --- | --- |
| Header | White centered logo row, sticky program/anchor/CTA row | Same two-row composition, Biadone wordmark and actual EDU anchors. Mobile quick anchor plus outline CTA; existing full-menu control retained. |
| Container | 1140px boxed content, 20px mobile sides | 1140px desktop content, matching mobile gutters. |
| Hero | Mint #d5ebe4, desktop 65:35 split, 39px heading, right circular artwork, large rounded CTA | Same mint/split/heading/CTA shape. Existing Clover screen sits in the circle with its source caption; mobile image moves above centered copy. |
| Four-column strip | Outline icons, white background, vertical dividers, centered copy | Existing four learning steps mapped to this strip; honest decorative vector icons only. |
| Explanatory content | Narrow narrative, alternating image/text rows | Existing concerns, verified Clover case and three general application directions. Abstract diagrams describe directions; no fabricated operating data/screens. |
| Learning band | Mint full-width band, three white cards | Existing learning description and three application-learning statements, with the same three-column card rhythm. |
| Course section | Centered title, mint module cards in a three-column grid | Three actual preparing course categories; no invented lessons, enrollment paths or prices. Tablet two-column and mobile single-column behavior retained. |
| Instructor | Text left, large portrait right on white | Existing role descriptions left and both supplied portraits right. Names/photo mapping retained. |
| Closing | Large centered white panel, colored top/bottom borders on mint | Existing learning CTA and institution/custom inquiry actions. No copied guarantee, testimonials, statistics, price or partner logos. |
| Typography / brand | Galano Grotesque, coral emphasis, navy text | Existing Pretendard and #2340FF accent, with source-like weight/scale and navy text. The original's observed headline overlap is corrected rather than duplicated. |

Reference-specific screenshots and the functional/content fixture outputs are kept outside the public deploy input. No third-party tracking scripts, brand/product badges, paid font files or testimonial assets were copied.

### Production verification — reference composition

- Production deployment: `4abf4066-2460-46f8-a07e-10a3aea54918` (`https://4abf4066.biadone-edu.pages.dev`), successfully serving `edu.biadone.com`. Prior deployment `a34cf14b-d4f7-4db9-81ae-571db0a9dc95` remains available.
- Local and production Chromium passed at 1440, 1024, 768, 390, and 320 px: page identity, assets/CSP, no horizontal overflow or relevant console errors, sticky navigation, actual Clover example, preparing courses and hidden reserved content, institution/custom field validation and separation, copy/TXT/intercepted mailto, mobile navigation, FAQ and focus restoration.
- Local future-content fixtures passed for variable curricula, valid/invalid enrollment URLs, zero and one approved case/photo, hidden/unapproved external media, ready introductory information, closed-course state, and controlled video playback without autoplay. No fixture content was deployed.
- All 24 downloadable public files match the local SHA-256 manifest. All 67 baseline files, including the exact content data, behavior script, CSP, original case/portrait media and unrelated site/reference files, remain unchanged. Static text preservation audit passed for all 205 existing fragments.
- Reference versus final production screenshots were viewed at matching 1440×1000 and 390×1000 viewports. Header, container, hero, icon strip, alternating rows, card bands, course grid, instructor layout and CTA panel were checked directly. Intentional differences are listed in the table above; no material unaddressed layout mismatch remains within the existing-content and brand constraints.
- Playwright was used because Browser plugin was unavailable. Clipboard permissions were stubbed and mailto was intercepted; no email was sent. Other browser engines and actual mail-app delivery remain untested.

## Approved curriculum panels — 2026-10-27

- Deployment: `5e6478a0-4f43-40cb-9eec-6289ac9a7078` (`https://5e6478a0.biadone-edu.pages.dev`), successfully serving `https://edu.biadone.com/#curriculum`. Previous deployment `4abf4066-2460-46f8-a07e-10a3aea54918` remains available.
- Added the user's newly approved curriculum using the supplied two-panel format: common foundation, five selectable areas, the advanced AI-team area and all-course operations. All eight titles/groups, 52 ordered practice items, timings, outputs and both footnotes were independently compared against the latest supplied image. The older separate Edu explorer wording was not substituted.
- Panel 1 contains F/A/B/S and panel 2 contains C/D/E/T, with four clearly labeled areas and 26 practice items per panel. Counts refer to areas, not lesson counts. Selection E remains exactly `과제에 따라 편성`; no combined mandatory duration is invented.
- Dark navy panels, section dividers, output summaries and #2340FF bullets follow the supplied format. Mobile stacks the panels without hiding or truncating practice items. Native HTML is used so the text remains selectable and responsive.
- Added a real curriculum anchor from the enrollment section. The curriculum and jump link remain hidden if the plan is unpublished/empty. Enrollment prices, dates, URLs and event photos remain unconfirmed/empty; no purchase flow was activated.
- Local and live Chromium passed 1440/1024/768/390/320 widths: exact curriculum data/text, all eight module titles/timings/outputs, 52 items, both notes, two-column/stacked layout, no overflow, anchors, case/course gating, unchanged institution/custom inquiry validation/copy/TXT/intercepted mailto, FAQ, focus and 404 behavior. Existing future-content fixtures also passed.
- Screenshot comparison against the supplied format was performed for desktop and mobile. Focused curriculum captures hide unrelated fixed header/skip-link chrome only during capture to avoid a tall-element screenshot artifact; production header behavior was not changed.
- All 24 downloadable public files match the SHA-256 manifest. The existing inquiry/navigation code was verified byte-identical, and 65 unrelated site/reference/CSP baseline files stayed unchanged.
- Browser plugin not available; existing Playwright Chromium was used. Clipboard was stubbed and mailto intercepted; no email was sent. Actual course delivery, external tool availability and real mail-app sending were not tested.


## Biadone design-system application — 2026-10-27

- Source: the actual running kit at `http://127.0.0.1:4327/design-system/`, backed by `/Users/joo/BiaDone/brand/design-system/`. The kit and its running server are unchanged.
- Added the shared `public/design-system/biadone.css` entrypoint and its six imports. Token CSS, component CSS and logo CSS remain byte-identical to the original. Only `fonts.css` changes its font URL to reuse the existing byte-identical local Pretendard file. The approved symbol SVG is copied unchanged; the lockup uses the system's crop, weight, spacing and proportions. No runtime localhost URL or external asset dependency is introduced.
- `styles.css` owns EDU composition and consumes the shared semantic/component tokens. Applied the canonical palette, typography, 1280px maximum width, 48px/24px page insets, 96px/64px section spacing, 4px corners, 48px controls and square flow markers. The redundant logo row, mint pattern, circular hero crop, pill controls, heavy frames and dark curriculum surfaces are replaced by the kit's white/tinted surfaces and thin rules.
- `index.html` and `404.html` load the real shared stylesheet and theme. The responsive single header and footer use the approved Biadone lockup. The EDU slide template, fixed canvas, sample content and renderer are not used for this responsive website.
- `app.js`, `site-content.js`, `_headers` and the 67-file independent-site/reference/behavior baseline remain byte-identical. All eight curriculum areas, 52 ordered practice items, timings, outputs and notes are preserved, along with preparing enrollment states, hidden event photos and mailto inquiry behavior. Static text changes are confined to the brand lockup and removal of duplicate brand/navigation labels.
- Local Chromium checks passed at 1440, 1024, 768, 390 and 320px, including exact approved curriculum content, responsive panels, image loading, no horizontal overflow or relevant console errors, anchors, mobile menus, FAQ, institution/custom inquiry separation and validation, copy/fallback, TXT and intercepted mailto composition. Existing future-content fixtures also passed. Clipboard permissions were stubbed; no email was sent.
- Browser plugin not available; the existing Playwright Chromium installation was used. Desktop/mobile first screens and focused curriculum captures were inspected against the actual kit. An independent read-only review found no material issue. QA scripts, screenshots and backup stay outside the public deploy directory. Production verification is recorded below.


### Production verification — Biadone design system

- Production deployment: `7b5f51b0-ce0f-4df6-8401-15120a100345` (`https://7b5f51b0.biadone-edu.pages.dev`). Cloudflare confirms successful production status, with `edu.biadone.com` associated and serving this deployment. Prior deployment: `5e6478a0-4f43-40cb-9eec-6289ac9a7078`.
- The actual `https://edu.biadone.com/` hostname passed Chromium checks at 1440, 1024, 768, 390 and 320px: system palette/heading/corners, complete approved curriculum, responsive layout, no horizontal overflow or relevant browser errors, existing assets/anchors/course visibility, mobile menu, FAQ and both inquiry modes. Copy was stubbed and mailto intercepted; no email was sent.
- All 32 downloadable public files match the current SHA-256 manifest. `_headers` is configuration-only; the live CSP/cache/noindex headers passed. Six private/missing paths returned the shared custom 404.
- Only `public/` was deployed. The 67-file source/behavior/content/header/independent-site baseline is unchanged. Existing brand sources and the user's preview server on port 4327 are untouched. No Git commit or push was made.
- Browser plugin not available; existing Playwright Chromium used. Non-Chromium browsers, real mail-app delivery and future unconfirmed enrollment operations remain outside the verification scope.


## Text-only hero — 2026-10-27

- Removed only the first-screen media/diagram container, including the Clover screenshot and caption there. `heroMedia` is now `null`; the shared renderer remains unchanged. The real Clover case, screenshot and link remain in the case section.
- Changed the hero to a single content column with a readable maximum width, so no image column or image-sized mobile gap remains. Kept the headline, description, CTA, audience note, case link and four-step learning row. Design-system assets and the approved curriculum are unchanged.

- Local and production Chromium passed at 1440/1024/768/390/320px: no hero media or fallback, one hero column, no overflow, retained Clover case/link, all 8 curriculum modules and 52 items, primary anchors, responsive menu and inquiry-dialog open/close. Only the changed hero behavior was retested; actual mail delivery was not exercised.
- Production deployment: `1f2bd3b4-6dee-4069-9523-de4254dcce5c` (`https://1f2bd3b4.biadone-edu.pages.dev`), confirmed successful for `https://edu.biadone.com/`. All 32 downloadable public files match the checked local manifest; `_headers` remains configuration-only. Public changes are confined to `index.html`, `styles.css` and the `heroMedia` data setting. Other case/course/gallery/FAQ data and the behavior script remain unchanged.


## Circular team introductions — 2026-10-27

- Replaced the separate text column and large portrait pair with a full-width introduction followed by two person-specific introductions. Each person has a face-focused 144px circular portrait beside their existing role, name and description. Below 1100px, introductions stack; mobile uses 96px portraits beside identity text with descriptions underneath.
- The crop is CSS-only: circular overflow with top-aligned enlarged source images. Both supplied portraits retain their original bytes, correct names and alt text. No image generation, clothing edits, credentials or new copy are introduced. Removed only duplicate captions; all other static text is preserved.
- Public changes are limited to `index.html` and `styles.css`. `app.js`, `site-content.js`, `_headers`, every image and the shared design-system assets are byte-identical to the pre-change baseline.
- Local Chromium passed at 1440/1024/768/390/320px: correct photo/name mapping, circular equal-width/height masks, paired/stacked introductions, no horizontal overflow or browser errors, retained text-only hero, actual Clover case, all 8 curriculum modules and 52 items, primary anchors, mobile navigation, and inquiry-dialog open/close. Desktop/mobile section captures were visually inspected. Browser plugin not available; existing Playwright Chromium used. No mail was sent.

- Production deployment: `d29df91a-371b-4b2d-92ba-2691db636a4f` (`https://d29df91a.biadone-edu.pages.dev`), confirmed successful for `https://edu.biadone.com/#team`. Prior deployment: `1f2bd3b4-6dee-4069-9523-de4254dcce5c`.
- The actual production hostname passed the same five-width checks. All 32 downloadable files match the local SHA-256 manifest; `_headers` remains configuration-only. Only the two intended public files changed, with original portraits and existing content/behavior preserved. QA outputs and backup remain outside public source. No Git commit or push was made.


## Requested copy removal — 2026-10-27

- Removed the eight user-specified text groups: hero audience sentence, case evidence note and screenshot caption, general application note, two-line course introduction, curriculum overview line and both curriculum footnotes. Empty curriculum summary/notes and course-copy slots remain editable but take no visible space.
- Cleared only the requested data fields; all 8 curriculum modules, 52 ordered practice items, titles/timings/outputs, actual case facts/image/link, course states, team layout and inquiry behavior are retained. Public-page evidence notes are optional so removing the note does not hide the approved case. Approval, required factual fields and valid URL/media checks remain.
- Public changes: `index.html`, `styles.css`, `site-content.js` and the single note-required condition in `app.js`. All other script content is identical; nonrequested data values and all assets are unchanged. Updated the content guide to document the optional note.
- Local Chromium passed at 1440/1024/768/390/320px: all requested strings absent, empty copy blocks hidden, no overflow or relevant browser errors, approved case retained, original curriculum count and circular profiles retained, primary anchors/menu and inquiry-dialog open/close. Targeted regression fixtures confirmed that missing purpose, invalid URL and unapproved cases remain hidden. Desktop/mobile affected sections were visually inspected. Browser plugin not available; existing Playwright Chromium used. No mail was sent.

- Production deployment: `3f17de5d-4ea5-481c-816e-04282e637c7c` (`https://3f17de5d.biadone-edu.pages.dev`), confirmed successful on `https://edu.biadone.com/`. Prior deployment: `d29df91a-371b-4b2d-92ba-2691db636a4f`.
- Production passed the same five-width display/content/navigation/dialog checks. All 32 downloadable public files match the local SHA-256 manifest; `_headers` remains configuration-only. Only `public/` was uploaded; no Git commit or push was made. QA captures, scripts, fixtures and the pre-edit archive remain outside the public directory.


## Reference-style case feature — 2026-10-27

- Removed the requested two-sentence introduction under the actual-case heading. Rebuilt the approved case from a prominent facts table into the supplied reference's feature-row composition: existing title, result summary, learning point and actual-page link on the left; the unchanged real screenshot on the right. Additional cases alternate left/right; the current public site still contains only the one approved case. Biadone's white/blue palette, font and shared tokens remain.
- Moved the existing purpose/materials/human-review facts into the native `사례 자세히 보기` disclosure below the main row. The result remains visible once as the summary and the learning copy remains visible. No source case data, screenshots, case validation or unverified claims changed. Below 960px, text precedes the screenshot and details in one column.
- Public changes are limited to `index.html`, `styles.css` and the rendering portion of `renderCases()` in `app.js`. All code outside that portion, the entire data file, media and other assets are unchanged.
- Local Chromium passed at 1440/1024/768/390/320px: removed copy absent, correct image/title/result/learning/link, desktop left/right placement, mobile order, keyboard/click disclosure, preserved original facts, no overflow or relevant browser errors, existing anchors, 52 curriculum items and circular team profiles. Fixtures verified second-row alternation and rejection of invalid case URLs. Captures were compared with the supplied composition at desktop/mobile widths. Browser plugin not available; existing Playwright Chromium used. No real email or external application action was performed.

- Production deployment: `adabef9c-e7aa-4529-bbb0-9d47d2c50e92` (`https://adabef9c.biadone-edu.pages.dev`), confirmed successful for `https://edu.biadone.com/#published-cases`. Prior deployment: `3f17de5d-4ea5-481c-816e-04282e637c7c`.
- The actual production hostname passed the same five-width layout/content/disclosure checks. All 32 downloadable public files match the checked local SHA-256 manifest; `_headers` remains configuration-only. Only `public/` was uploaded; the case data and all image bytes are unchanged. No Git commit or push was made. QA files and the pre-edit archive remain outside the public directory.


## Case prose paragraphs — 2026-10-27

- Replaced the old one-line Clover summary with two prose paragraphs composed from the supplied purpose, materials and operator-check facts. The first explains the visit/reservation purpose and included class/location/photo/link information; the second states the operator's information/price/link checks. No new feature or business outcome is claimed.
- Blank-line-separated case result text renders as real paragraph elements with token-based paragraph spacing. `showDetails: false` hides this case's duplicate facts disclosure. Other cases retain disclosure behavior by default, and required source facts remain in data. The existing screenshot, learning point, link and left-copy/right-image composition are unchanged.
- Local Chromium passed at 1440/1024/768/390/320px: exact two paragraphs, old summary absent, duplicate disclosure absent, correct image/link, preserved responsive order, no horizontal overflow or relevant browser errors, 52 curriculum items and the two team introductions. A fixture verified that cases without the visibility override still offer keyboard/click detail expansion. Browser plugin not available; existing Playwright Chromium used. Desktop/mobile captures were visually inspected.

- Production deployment: `2f71f132-b153-4f5b-9c22-761af21f14ce` (`https://2f71f132.biadone-edu.pages.dev`), confirmed successful for `https://edu.biadone.com/#published-cases`. Prior deployment: `adabef9c-e7aa-4529-bbb0-9d47d2c50e92`.
- The production hostname passed the same five-width paragraph/layout checks. All 32 downloadable public files match the verified local SHA-256 manifest; `_headers` is configuration-only. Public changes are confined to the HTML asset versions, case paragraph formatting/visibility, paragraph spacing and the selected case text/flag. No other content, source photo or non-case behavior changed. Only `public/` was uploaded; no Git commit or push was made.


## Latest heading typography and curriculum overview — 2026-10-27

- Synced the latest canonical `fonts.css`, `tokens.css`, `components.tokens.css` and `components.css` from the source confirmed byte-identical to `brand.biadone.com`. Added the unchanged SUITE Variable 2.040 WOFF2 and its license. `fonts.css` only adapts the two relative font URLs to the existing local asset folder. All other brand foundations, logo, colors, sizes and spacing remain unchanged.
- Added the shared heading role to every semantic EDU heading, including step/case/course/curriculum/team/closing/dialog titles. Font-family comes from `--heading-font-family` and weight from `--ui-heading-weight` (currently SUITE 700), with synthesis disabled. Body, lead, metadata, FAQ/menu/button controls and logo remain Pretendard. Added SUITE preload to home and 404 pages.
- The supplied 461×760 curriculum graphic is copied unchanged as `assets/images/edu-curriculum-overview-20261027.png`. Above the detailed panels, desktop presents its two diagrams side by side at up to their native width; tablet/mobile show the original continuous vertical poster. The accessible image link opens the original in a new tab. CSS changes the presentation; the source image bytes are unmodified. No event/gallery content was added.
- Public scope: seven existing HTML/CSS files updated, three new font/license/image assets. `app.js`, `site-content.js`, `_headers`, the 67-file protected baseline and all nine audited brand source files remain unchanged. The original 8 curriculum modules and 52 ordered practice items, cases, copy, inquiry behavior and reserved-content states remain intact.
- Local Chromium passed at 1440/1024/768/390/320px: all semantic headings compute as SUITE 700, actual platform-font inspection confirms SUITE glyphs in the main/section/step/case/course/curriculum/team/closing titles, while body/logo/CTA render Pretendard. The downloaded SUITE file matches SHA-256 `fc5e0648d5413b55b79ebbab0f50de561a026574cba3a9c8eb03d5bddd432263`. Complete content data matches the pre-change snapshot. No clipping/overflow or relevant browser errors; anchors/menu/FAQ/both dialogs/Escape/focus and the 404 font roles passed. Clipboard/mail sending were not exercised because their code is unchanged.
- Separate image checks passed the same five widths: intrinsic dimensions, desktop crop ratios, mobile full-poster ratio, alternative text, exact original hash, native-size bounds and original-view popup destination. QA waits for the actual popup navigation and eagerly loads hidden test images to avoid waiting on unused lazy images. No test-specific loading behavior is shipped.
- Desktop/mobile/320px screenshots were inspected. A read-only source review found no material issue. Browser plugin not available; existing Playwright Chromium used. QA scripts, captures, fixtures and the pre-change archive remain outside the deployment input.


### Production verification — SUITE and overview image

- Production deployment: `13cc9faf-0201-4b78-b921-65ee9d773366` (`https://13cc9faf.biadone-edu.pages.dev`), confirmed successful for `https://edu.biadone.com/`. Prior deployment: `2f71f132-b153-4f5b-9c22-761af21f14ce`.
- The actual production hostname passed all five typography/interaction/404 checks and all five overview-image/layout/original-link checks. Actual platform-font proof confirms SUITE headings and Pretendard body/logo/CTA; downloaded font bytes match the canonical source. All 35 downloadable files match the verified SHA-256 manifest; `_headers` remains configuration-only and its live font CSP passed.
- Final scope and protected-source checks passed: the original content/behavior, 67 protected files, nine brand source files and supplied poster bytes remain unchanged. Only the intended seven public files and three new assets were included. No Git commit or push was made; only `public/` was deployed. Other browser engines and actual mail sending remain outside this typography/media verification.


## Native curriculum infographics — 2026-10-28

- Replaced the raster poster and original-image link with two native diagrams in `index.html` and the isolated `curriculum-diagrams.css` stylesheet. SVG supplies the eight-sector ring, circulation arrows, icons and pyramid faces; every title, area name and explanatory sentence is real selectable HTML. No canvas, raster image, embedded image, generated bitmap, inline script or new dependency is used.
- The dark wheel presents eight approved areas: common foundation; optional A–E; advanced AI team; and all-course cost/account/security/error management. Its note explicitly keeps A–E optional. The light three-tier pyramid shows foundation, purpose-specific choices and advanced AI-team work, with the four-step idea/build/use/improve process below. Short labels reflect the supplied reference; the detailed curriculum remains the existing data source, with all 8 areas and 52 ordered practice items unchanged.
- Desktop keeps the circular wheel and faceted pyramid. At narrow widths, the same semantic lists reflow into readable module cards/rows and tier-shaped stages; labels do not shrink as a screenshot would. Titles retain SUITE 700 and information retains Pretendard. Body copy has actual whitespace when mobile line breaks collapse, and list items retain normal semantic elements.
- Moved the unchanged original PNG to private `reference/curriculum-overview-20261027.png`; it is no longer in `public/`. Removed the obsolete poster crop CSS. Public scope is the home HTML, removed obsolete styles, one new diagram stylesheet and removal of the old raster asset. Existing fonts/shared tokens, `app.js`, `site-content.js`, `_headers`, the 67-file protected baseline and nine brand source files are unchanged.
- Local Chromium initially passed 1440/1024/768/390/320px; after the final whitespace/list-semantic refinement, desktop/mobile were rechecked at 1440/390/320 and tablet widths were checked separately. Assertions cover no bitmap/canvas/SVG image/text elements, no reference PNG request, 8 sectors/8 module labels, 3 pyramid tiers/4 process items, A–E optional wording, selectable text, actual SUITE glyphs, readable reflow, no clipping/overflow or relevant browser errors, exact original content data, 52 practice items, anchors/menu and inquiry-dialog open/close.
- Desktop/mobile screenshots were visually compared with the supplied source; the deliberate adaptations are flat canonical brand surfaces and readable mobile reflow instead of raster scaling. Independent read-only source review found no material issue. Browser plugin not available; existing Playwright Chromium used. No email was sent. QA scripts, captures, reference and the pre-change source archive stay outside public deployment input.

- Production deployment: `8212febc-cf26-4f00-863f-b5f4ae0ad0af` (`https://8212febc.biadone-edu.pages.dev`), confirmed successful for `https://edu.biadone.com/#curriculum-overview`. Prior deployment: `13cc9faf-0201-4b78-b921-65ee9d773366`.
- The actual production hostname passed all five native-diagram/content/font/selection/responsive/interaction checks. All 35 downloadable files match the checked local SHA-256 manifest; `_headers` remains configuration-only. The obsolete poster URL and private reference URL both return 404 on the production hostname. Source checks still confirm the original content/behavior, 67 protected files and nine brand source files are unchanged. Only `public/` was uploaded; no Git commit or push was made.


## Pyramid removal — 2026-10-28

- Removed the complete light pyramid section and its attached four-step process, along with its dedicated `.edu-path-*` styles. The original four-step learning strip near the hero remains.
- The native eight-area wheel markup and CSS remain unchanged. Detailed curriculum, all 52 practice items, SUITE/Pretendard roles, source data, inquiry code and other assets are preserved. Only public `index.html` and `curriculum-diagrams.css` change.
- Local Chromium passed 1440/390/320px: no pyramid elements, eight wheel sectors/labels, all 8 curriculum modules/52 items, retained hero learning strip, no horizontal overflow or browser errors, correct typography/anchors, and the normal 48px wheel-to-curriculum gap. Browser plugin not available; existing Playwright Chromium used. No mail was sent.

- Production deployment: `ea525452-1fd4-4cb9-b073-01d24bfa9b59` (`https://ea525452.biadone-edu.pages.dev`), confirmed successful for `https://edu.biadone.com/#curriculum-overview`. Prior deployment: `8212febc-cf26-4f00-863f-b5f4ae0ad0af`.
- Production passed the same 1440/390/320px removal/content/spacing checks. All 35 downloadable public files match the local SHA-256 manifest; `_headers` remains configuration-only. The public diff remains exactly the two intended HTML/CSS files; no content data, behavior, font or original wheel changes were made. Only `public/` was uploaded; no Git commit or push was made.

## Confirmed learner FAQ — 2026-10-28

- Published the three user-confirmed questions about starting without AI/coding knowledge, a ChatGPT Plus-or-higher subscription, and questions/feedback through a planned Slack space with separately requested 1:1 coaching. The existing institution inquiry FAQ remains, for four visible entries. No Slack invitation or coaching application link was invented.
- The public change is limited to `site-content.js`. All other files match the previous 36-file public manifest; course/case data, curriculum, typography, native wheel, behavior and empty event gallery remain unchanged.
- Production deployment: `5e13a7bd-1cab-4f92-b2db-482ba9b0ce3b` (`https://5e13a7bd.biadone-edu.pages.dev`), confirmed successful for `https://edu.biadone.com/#faq`. Prior deployment: `ea525452-1fd4-4cb9-b073-01d24bfa9b59`.
- Production Chromium passed 1440/390px: all four FAQ entries render and expand with the approved answers, no horizontal overflow or browser errors, and the empty event gallery remains hidden. All 35 downloadable public files match the deployed SHA-256 manifest; `_headers` remains configuration-only. Browser plugin not available; existing Playwright Chromium used. Only `public/` was uploaded; no Git commit or push was made.

## FAQ refresh correction — 2026-10-28

- Reproduced the user's report in their existing Chrome EDU tab: only the prior institution FAQ was present. Fresh server responses contained all four approved FAQs, but the content script still used the old `20261027-case-paragraphs` URL. On the custom domain the JavaScript response carried `max-age=14400`, while the deployment origin retained `no-cache`; an already loaded document also does not reload scripts when only its hash changes.
- Changed only the `site-content.js` query version in public `index.html` to `20261028-faq`. The content data and other 35 public files remain unchanged. The explicit refresh link is `https://edu.biadone.com/?v=20261028-faq#faq`.
- Production deployment: `a89cebed-1672-47f8-b117-f25b078d3301` (`https://a89cebed.biadone-edu.pages.dev`), confirmed successful for `edu.biadone.com`. Prior deployment: `5e13a7bd-1cab-4f92-b2db-482ba9b0ce3b`.
- Verified production HTML and the exact versioned content-script response against the local SHA-256 values. Opened the refresh link in the same existing Chrome EDU tab and confirmed all four FAQ questions in the native accessibility tree and visible screenshot. No zone-wide cache setting or unrelated browser tab was changed; no Git commit or push was made. Future content updates must also refresh the content-script URL and verify that exact URL, including its query string.

## Circular arrowhead alignment — 2026-10-28

- Replaced the SVG end markers with two explicit filled triangular arrowheads. Each tip stays on the radius-130 circle at 25/205 degrees and points along its 115/295-degree clockwise tangent. The blue strokes stop six degrees earlier so their rounded caps are fully covered by the triangles rather than protruding past the tips.
- Geometric checks confirmed both tips are on the circle and the rounded caps fit inside the triangles (4.927 units of clearance for a 4.5-unit cap radius). Native Chrome preview and production screenshots were visually checked at the existing browser scales.
- Production deployment: `c8404ee4-abf1-4ac6-b700-5479bd46a2a4` (`https://c8404ee4.biadone-edu.pages.dev`), confirmed successful for `https://edu.biadone.com/?v=20261028-arrowheads#curriculum-overview`. Prior deployment: `a89cebed-1672-47f8-b117-f25b078d3301`.
- Production HTML matches the checked local SHA-256 value. Only public `index.html` changed; the other 35 public files match the previous deployment manifest. No Git commit or push was made.
