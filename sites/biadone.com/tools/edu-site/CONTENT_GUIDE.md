# EDU content editing

Edit `public/site-content.js` for approved content. Keep this guide and operational notes outside `public/`. No build or dependency install is required. Test changes locally with the site's CSP and on the production hostname after an authorized deployment.

## Current publication boundary — 2026-10-27

- Message, learning method, application directions, and team roles follow the user's supplied brief.
- The user approved `https://clover.biadone.com/home/` as a real example. Its screenshot and observable class/studio/reservation links are published. The screenshot shows a website, not an EDU lesson or event.
- Clover uses `evidenceType: 'public-page'`. Original business-problem history and AI work records remain `null`/`[]`. The public evidence note explicitly limits what the example establishes. No inquiry, estimate, contract, revenue, time-saving, or view-count claims are added.
- All three enrollment categories remain `preparing`. The subsequently supplied detailed curriculum is now confirmed as a separate `curriculumPlan` with eight areas, 52 practice items, supplied timings and outcomes. Price, capacity, selling dates, support conditions, discounts and enrollment routes remain unconfirmed. The earlier product ideas are not sales conditions.
- All offline-gallery images are empty, and the section is hidden. Introductory experience details and unconfirmed FAQ answers are also hidden.

## Course fields

Each item in `courses` supports:

| Field | Type / behavior |
| --- | --- |
| `id`, `category` | Stable editor key and category label. |
| `status` | `preparing`, `announced`, `open`, or `closed`; matches actual readiness. |
| `title`, `description` | Confirmed course name and summary. Category is the title fallback. |
| `audience` | Array of confirmed audience/prerequisite strings. |
| `curriculum` | Any-length ordered array of strings or `{ title, description }`; reorder freely. No fixed lesson count. |
| `materials`, `outcomes` | Arrays describing confirmed supplied/prepared materials and actual learning scope. |
| `format`, `duration`, `schedule`, `location` | Confirmed delivery, total time/period, dates and location. |
| `price`, `support` | Confirmed price/conditions and question/feedback channel, scope and period. Strings, not assumed numbers. |
| `application` | `null`, or `{ label, url }` using an actual purchase/enrollment destination. |

Empty strings, `null`, and empty lists do not render. Details appear only when confirmed fields exist. An active application link requires both `status: 'open'` and a valid HTTPS or same-origin relative URL. Blank links, bare fragments, `javascript:` and `data:` are rejected. Never route a preparing learner course to custom-production inquiry. Align course information with the actual sales page, including 솜씨당 when that route is ready.

## Cases

Two evidence levels are supported:

1. `public-page`: an approved live result whose publicly visible features can be checked. Requires `approved: true`, `published: true`, `title`, `purpose`, nonempty `materials`, `result`, `humanReview`, `learning`, valid local `media`, and actual `url`. `evidenceNote` is optional; an empty note does not hide an otherwise approved case. Unknown `problem` and `work` stay empty. Labels describe the page's purpose, content, result and points an operator should check, rather than inventing original work history.
2. A documented workflow: requires approval/publication flags plus `title`, `problem`, nonempty `materials` and `work`, `result`, `humanReview`, `learning`, and valid local `media`. This exposes the five-part structure: problem → materials → AI work → result/use → human check/correction.

Case `result` text may contain a blank line between prose paragraphs. Set `showDetails: false` when those paragraphs already include all detail facts; the default keeps the optional facts disclosure.

Use only evidence supplied/confirmed for that case. Separate observed facts from educational interpretation and verification points. Keep inquiries, estimates, contracts and revenue distinct. Without a qualifying case, the actual-case section is hidden and navigation/hero links fall back to general application directions. General application directions remain distinct even when a real case is shown.

## Media

The current first screen is text-only; `heroMedia` is `null` and the hero media/diagram container is removed. Keep actual media in the case section. Case `media` uses `{ type, src, alt, caption, poster? }`, with `type` set to `image` or `video`. Media must live under same-origin `/assets/`; upload only the approved public file. Captions must match the actual source and event. Do not use concept imagery as proof of real operations or EDU events.

For video, provide an actual approved file and optional approved local poster. The renderer uses controls, inline playback and metadata preload, without autoplay. External video embeds are not supported by the current CSP. The first screen does not substitute a diagram or another image when hero media is empty.

## Offline photos

The empty initial structure is:

```js
offlineGallery: {
  cover: null,
  practice: null,
  feedback: null,
  additional: []
}
```

Fill any slot with `{ approved: true, src, alt, caption }` only after receiving the selected real event photo and matching information. `additional` can have any number of approved photos. One photo is enough to show the section; four are never required. Landscape and portrait images use contained sizing to preserve the photo. No valid approved photos means no visible gallery, empty boxes or repeated placeholders. Do not reuse Clover business screenshots or baking-event photos as EDU event photos.

## Introductory experience and FAQ

`introExperience` stays hidden while `status: 'preparing'`. Once its content is confirmed, set `status: 'ready'`, a real `title`, and confirmed `description`, `steps` and/or actual `application`. Steps can be strings or `{ title, description }`. This is an information renderer, not an AI execution system; do not imply that it ran an AI task.

Each FAQ has `question`, `answer`, and `published`. Only `published: true` with a real answer is shown. Eight requested questions are retained in the data, but only the currently confirmed institution-email inquiry method is published. Add answers only after operating conditions are settled.

## Inquiry flows

- Institution/group education: organization, audience/count, topic/result, timeline and contact.
- Custom production + usage education: current work/desired result, optional timeline/budget and contact.
- `맞춤 실무교육` remains an education inquiry option.
- The website opens a mail draft. Submission success cannot be claimed; sending is completed in the visitor's mail app. Copy and TXT export do not prove delivery either.

## Verification before publication

Check confirmed versus empty content, actual link destinations, no unwanted private files, mobile reading order and overflow, keyboard/focus behavior, inquiry validation/body separation, screenshot/media framing, and live CSP. Check the gallery with zero and one approved image; check curricula with different lengths; check preparing/open/closed statuses. Test-only data and media must remain outside the production source and deployment input.

## Approved detailed curriculum — 2026-10-27

The latest user-supplied curriculum image is authoritative for this section. The older `apps/Edu/output/biadon-edu-curriculum/curriculum.js` has different titles and outcomes and must not replace the newly supplied wording.

`curriculumPlan` in `site-content.js` contains `published`, `title`, `summary`, `tracks`, and `notes`. Each track has a display `title` and a variable-length `modules` array. Each module has a stable `id`, its original `group`, `title`, `duration`, `output`, and ordered `items`. Text is rendered as native HTML via `textContent`; no bitmap curriculum or simulated AI execution is used.

- Panel 1 groups common foundation F, options A/B, and all-course operations S.
- Panel 2 groups options C/D/E and advanced AI-team course T.
- Each panel currently has four areas. Header counts refer to areas, not lessons. The 52 bullets are practice items and must not be presented as 52 lessons.
- Preserve category labels, the timings specified in the supplied image and the two footnotes. Option E is exactly `과제에 따라 편성`; do not invent its duration or sum every elective into a mandatory total.
- `조회수 1만 회` is a creation/improvement challenge goal, with the explicit no-guarantee note. Tool/integration use and costs depend on account, plan and practice environment; retain that note too.
- Publishing the curriculum does not activate course sales. Only an actual confirmed enrollment route can activate an application button. The free/online/offline enrollment categories are not automatically mapped to every detailed area.
- The whole section and jump link stay hidden when the plan is unpublished or no valid track/module exists. Modules require a title and at least one nonempty practice item. Optional duration/outcome fields are shown only when present.
- Desktop/tablet use two panels; mobile stacks them. Do not clamp or omit practice lines to make panels match in height.
