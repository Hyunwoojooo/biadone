# Blabee product-runtime audit

Date: 2026-08-30
Scope: current `apps/blabee` source compared with the English landing copy that existed at audit time.

## Summary

The landing was accurate about the Codex-first macOS scope, Codex supplying the next actions, and a selection continuing in the original Codex session. The audit identified four material corrections needed to represent the current build:

1. The default shortcuts are `Option+1` through `Option+4`, not bare number keys. They are user-configurable.
2. The current ranked flow contains **2–4 next actions**, not an invariant four-choice `recommended / alternative / pause / rollback` set.
3. The product default is `smart`, which can also surface useful follow-ups after substantive explanations or analysis; it is not limited to completed or blocked coding work.
4. Rollback is not enabled in the current build. Ranked packets omit it, and the legacy slot-4 representation is disabled. The live-looking `Restore pre-prompt state` option must therefore be removed or visibly marked unavailable.

Implementation status: the published landing copy and social image were corrected after this audit. They now use `Option+1`–`Option+4`, describe two to four ranked actions, use real alternatives in rows 3 and 4, and omit current-feature pause and rollback claims. The evidence table below preserves the pre-correction comparison so the reason for each change remains reviewable.

## Launch blockers vs acceptable simplification

### Truth corrections required before launch

- **Remove the enabled-looking rollback option and current-feature rollback copy.** This is the only hard feature-availability contradiction: current source explicitly rejects enabled rollback and emits legacy rollback as disabled.
- **Do not claim a bare number key controls the Mac product.** The smallest correction is changing “one key” to “one shortcut” and rendering the demo’s defaults as `⌥1`…`⌥4`.

### Acceptable narrative simplifications

- A **four-row demo may remain**. Four ranked actions are a valid current packet shape. It must be presented as one example, not as an invariant four-slot taxonomy.
- The page does not need to explain all three suggestion modes. A generic “when Codex has useful next actions” statement is truthful across modes; the exact Smart/Always/Action only policy can remain in product settings or FAQ.
- The page does not need to advertise shortcut configurability. It only needs to avoid describing the default modifier shortcut as a bare key.

### Smallest truthful English-copy patch

If the approved four-row composition must remain, this is the minimum correction set:

- `Respond with one key—without breaking your flow.` → **`Respond with one shortcut—without breaking your flow.`**
- `One key. Same session. Keep going.` → **`One shortcut. Same session. Keep going.`**
- Demo keycaps `1 / 2 / 3 / 4` → **`⌥1 / ⌥2 / ⌥3 / ⌥4`**
- Demo rows 3 and 4 → **`Add session rotation tests`** and **`Inspect auth edge cases`**
- `Choose quickly from the 1, 2, 3, or 4 options Codex provides.` → **`Choose quickly from up to four next actions Codex provides.`**
- `Blabee shows options 1–4` → **`Blabee shows Codex’s next actions`**
- `Review the next task, alternative, pause, or rollback that Codex prepared.` → **`Review the ranked next actions Codex prepared.`**
- `One-key control for Codex on macOS.` → **`Shortcut control for Codex on macOS.`**
- FAQ appearance answer → **`No. It appears only when Codex has useful next actions for the current response and the current session is correctly bound.`**

## Evidence table

| Claim | Audit result | Current product evidence | Recommended English landing wording |
|---|---|---|---|
| Default shortcuts | **Inaccurate.** The landing says “one key” and visually shows bare `1–4`. Runtime defaults are `Option+1`…`Option+4`; `Option+Space` toggles the Pet. | [PetHotKeys.swift:189–202](../../apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/PetHotKeys.swift#L189-L202); current landing [content.js:10–13](js/content.js#L10-L13) | Hero: **“Respond with one shortcut—without breaking your flow.”** Demo keys: `⌥1`, `⌥2`, `⌥3`, `⌥4`. Caption: **“One shortcut. Same session. Keep going.”** |
| Configurable shortcuts | **Ambiguous.** The landing omits that shortcuts can be edited, validated, saved, and restored to defaults. | [PetViewModel.swift:622–662](../../apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/PetViewModel.swift#L622-L662); persistence contract [PetHotKeys.swift:214–246](../../apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/PetHotKeys.swift#L214-L246) | Optional small note or FAQ: **“Default: Option+1–4. Customize the shortcuts in Blabee settings.”** |
| Choice count | **Inaccurate.** The current ranked contract accepts exactly 2, 3, or 4 actions. The landing repeatedly promises four numbered choices. | [decision-packet.schema.json:138–191](../../apps/blabee/Contracts/v1/decision-packet.schema.json#L138-L191); submission rule [SKILL.md:83–87](../../apps/blabee/Plugin/blabee/skills/blabee-decision/SKILL.md#L83-L87); current landing [content.js:46–54](js/content.js#L46-L54) | **“Blabee shows 2–4 next actions from Codex.”** Or, less contractual: **“Choose from Codex’s most useful next actions.”** |
| Slot semantics | **Inaccurate for the current ranked flow.** Ranked slot 1 is recommended; later slots are alternatives in priority order. The old fixed layout used recommended / alternative / pause / rollback, but the current plugin excludes pause and rollback from `next_actions`. Global hotkeys are registered only for enabled action choices. | Ranked labels [PetView.swift:718–734](../../apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/PetView.swift#L718-L734); ranked-vs-legacy parsing [PetModels.swift:949–968](../../apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/PetModels.swift#L949-L968); plugin rule [SKILL.md:83](../../apps/blabee/Plugin/blabee/skills/blabee-decision/SKILL.md#L83); hotkey eligibility [PetViewModel.swift:1315–1335](../../apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/PetViewModel.swift#L1315-L1335) | Make the demo four ranked actions, for example: `Implement logout`, `Review auth architecture`, `Add session rotation tests`, `Inspect auth edge cases`. Mark only item 1 **“Recommended by Codex.”** |
| Who creates the choices | **Aligned, with a wording refinement.** Codex submits 2–4 structured next actions. Blabee validates, displays, and relays them; it does not run a separate LLM to invent them. | [SMART_FOLLOW_UP_POLICY.md:9–19](../../apps/blabee/SMART_FOLLOW_UP_POLICY.md#L9-L19); [SKILL.md:42–83](../../apps/blabee/Plugin/blabee/skills/blabee-decision/SKILL.md#L42-L83) | **“Codex proposes the next actions. Blabee surfaces them and relays your selection.”** |
| When Blabee surfaces | **Product-decision required.** The landing describes action completion, failure, blocker, or decision boundaries only. The product default is `smart`, which also allows substantive explanations, analysis, and general questions when at least two genuine follow-ups exist. | Default `.smart` [BlabeeSuggestionModeStore.swift:34–46](../../apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/BlabeeSuggestionModeStore.swift#L34-L46); mode rules [BlabeeSuggestionMode.swift:15–26](../../apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/BlabeeSuggestionMode.swift#L15-L26); current landing [content.js:52–56](js/content.js#L52-L56), [content.js:75–76](js/content.js#L75-L76) | If `smart` remains the product default: **“Blabee appears when Codex has useful next actions—after eligible work, and after substantial explanations when there is a meaningful way to continue.”** If the landing promise should remain action-only, change the beta’s default product mode instead. |
| Selection returns to the same Codex session | **Aligned.** The selected action is queued with the bound `sessionID` as a new turn, using `codex queue --thread <sessionID>`. The receipt is rejected if Codex echoes a different session. | Selection dispatch [CoordinatorOperationalApplication.swift:2967–3006](../../apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorOperationalApplication.swift#L2967-L3006); exact Codex argv and receipt check [CodexQueueNextTurnDispatcher.swift:218–250](../../apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/CodexQueueNextTurnDispatcher.swift#L218-L250), [CodexQueueNextTurnDispatcher.swift:276–298](../../apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/CodexQueueNextTurnDispatcher.swift#L276-L298) | Keep: **“Your choice becomes a new user turn in the original Codex session.”** |
| Rollback semantics | **Inaccurate and release-blocking for this copy.** Current ranked packets do not emit rollback. Legacy slot 4 is disabled, and the semantic application rejects an enabled rollback. It is neither an independent restore feature nor a currently supported instruction to return to pre-prompt state. | Explicit current policy [Contracts/v1/README.md:54–56](../../apps/blabee/Contracts/v1/README.md#L54-L56); runtime rejection [CoordinatorSemanticApplication.swift:492–497](../../apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorSemanticApplication.swift#L492-L497); generated disabled slot [CoordinatorOperationalApplication.swift:3256–3271](../../apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorOperationalApplication.swift#L3256-L3271); current landing [content.js:24–28](js/content.js#L24-L28) | Remove **“Restore pre-prompt state”** and all current-feature rollback copy. Replace it with a real ranked alternative. Do not mention rollback until the shipped build supports it end to end. |
| Codex / macOS scope | **Aligned.** The executable is a macOS 13+ Swift package using AppKit, Carbon, and SwiftUI, and the continuation path calls the Codex queue executable. No current source implementation for another coding agent was found in the bounded product-source search. “Private beta” remains a business-status claim, not a code-verifiable fact. | [Package.swift:4–33](../../apps/blabee/src/coordinator-swift/Package.swift#L4-L33); Codex queue path [CodexQueueNextTurnDispatcher.swift:218–231](../../apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/CodexQueueNextTurnDispatcher.swift#L218-L231) | **“Built first for Codex on macOS.”** Keep Claude Code described only as unsupported or unconfirmed. |
| Suggestion modes | **Ambiguous / omitted.** The shipped model has `smart`, `always`, and `action_only`; `smart` is the product default, while invalid stored values fail closed to `action_only`. | Mode enum [BlabeeSuggestionMode.swift:7–10](../../apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/BlabeeSuggestionMode.swift#L7-L10); store behavior [BlabeeSuggestionModeStore.swift:34–50](../../apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/BlabeeSuggestionModeStore.swift#L34-L50); policy summary [SMART_FOLLOW_UP_POLICY.md:15–29](../../apps/blabee/SMART_FOLLOW_UP_POLICY.md#L15-L29) | FAQ option: **“Smart mode shows suggestions after eligible work and substantial explanations with useful follow-ups. Switch to Always or Action only in settings.”** |

## Recommended copy corrections

Apply these corrections even if the page does not explain every product setting:

- Replace every user-facing **“one key”** / **“one-key”** claim with **“one shortcut”** / **“shortcut control.”**
- Render demo shortcuts as `⌥1` through `⌥4`.
- Replace **“options 1–4”** with **“2–4 next actions”** or non-numeric **“next actions.”**
- Replace the demo’s `Pause this task` and `Restore pre-prompt state` with real ranked action alternatives.
- Remove **“next task, alternative, pause, or rollback”** from How It Works. Use **“the ranked next actions Codex prepared.”**
- Keep the original-session claim; it is supported by both implementation and tests.
- Either describe Smart mode accurately or make `action_only` the beta default. The current combination of Smart-by-default product behavior and action-boundary-only landing copy is internally inconsistent.

## Human decisions still required

1. **Public product narrative:** market the current Smart follow-up behavior, or change the beta default to Action only to preserve the narrower “appears only at decision boundaries” promise.
2. **Demo layout:** show a realistic variable 2–4 action list, or keep four rows as one example while clearly avoiding a claim that four rows always appear.
3. **Rollback roadmap:** remove rollback now, or delay the claim until current-build support, safety boundaries, and end-to-end tests exist. Current source does not authorize marketing it as available.
4. **Shortcut detail level:** show `Option+number` directly in the hero demo, and optionally disclose configurability in FAQ or nearby microcopy.

## Audit boundary

- The requested `/Users/joo/BiaDone/apps/blabee/AGENTS.md` file does not exist. The repository-root `/Users/joo/BiaDone/AGENTS.md` was applied instead.
- Codebase Memory project `Users-joo-BiaDone`, generation `2026-08-30T07:47:45Z`, was used at Tier 2 and followed by direct source reads. `PetViewModel.swift` and `CoordinatorOperationalApplication.swift` had changed metadata, so every relied-on range in those files was read directly.
- The product-tree coverage scope reports known generated/excluded directories and three parse-partial source/test ranges. The relevant partial ranges were read directly. The Claude search is therefore a bounded current-source finding, not an exhaustive promise about future adapters or untracked build artifacts.
- No product code or landing implementation file was changed by this audit.
