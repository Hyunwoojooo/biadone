# Implementation contract — local long-form editor

All workers use this contract. Root owns app shell/UI integration, package/config and final QA. Domain worker owns `src/shared/`, `src/domain/` and domain tests. Server worker owns `server/` except `server/render.ts`, plus Python STT helper and server tests. Render worker owns `src/video/`, `server/render.ts`, and render tests. No production API or secrets. Existing Edu sources and generated videos are read-only.

## Shared data (`src/shared/types.ts`)

Export the following types (all times are integer frames at project fps except Word times).

```ts
type Template = 'title'|'quote'|'compare'|'steps'|'list'|'stat'|'flow'|'media'|'character';
type ThemeId = 'sage'|'ink'|'sand';
type Motion = 'calm'|'standard'|'lively';
type AssetKind = 'audio'|'image'|'video';
interface Asset {id:string;name:string;kind:AssetKind;fileName:string;duration?:number;width?:number;height?:number;waveform?:number[]}
interface Word {id:string;text:string;start:number;end:number;confidence?:number}
interface Caption {id:string;text:string;startFrame:number;endFrame:number;wordIds?:string[]}
interface Chapter {id:string;title:string}
interface SceneItem {title:string;body:string}
interface Scene {id:string;title:string;chapterId:string;startFrame:number;durationInFrames:number;template:Template;heading:string;kicker:string;body:string;items:SceneItem[];assetId?:string;mediaStartFrame:number;mediaFit:'contain'|'cover';locked:boolean;showCaptions:boolean;motion:Motion;notes:string}
interface ProjectSettings {width:number;height:number;fps:number;theme:ThemeId;accent:string;subtitleSize:number;subtitleBackground:boolean;showCaptions:boolean;audioGainDb:number;normalizeAudio:boolean}
interface Project {schemaVersion:1;id:string;title:string;createdAt:string;updatedAt:string;revision:number;durationInFrames:number;settings:ProjectSettings;audioAssetId?:string;assets:Asset[];words:Word[];captions:Caption[];chapters:Chapter[];scenes:Scene[]}
interface QualityIssue {id:string;severity:'error'|'warning'|'info';code:string;message:string;sceneId?:string;captionId?:string}
interface QualityReport {ok:boolean;issues:QualityIssue[];checkedAt:string;summary:{scenes:number;captions:number;durationSeconds:number;errors:number;warnings:number}}
type JobType='transcribe'|'render'|'generate';
type JobStatus='queued'|'running'|'completed'|'failed'|'cancelled';
interface Job {id:string;projectId:string;type:JobType;status:JobStatus;progress:number;message:string;createdAt:string;updatedAt:string;projectRevision:number;outputUrl?:string;error?:string;verification?:Record<string,unknown>}
interface ProjectSummary {id:string;title:string;updatedAt:string;durationInFrames:number;fps:number;sceneCount:number}
interface HistoryEntry {id:string;title:string;createdAt:string;revision:number}
interface SystemStatus {ffmpeg:boolean;ffprobe:boolean;transcription:boolean;transcriptionReason?:string;dataDirectory:string;version:string}
interface RenderOptions {resolution:'1080p'|'720p';range?:{startFrame:number;endFrame:number};allowWarnings?:boolean}
```

Strings/arrays/frames/IDs/file names must be bounded and finite. Zod schemas exported as `projectSchema`, `commandSchema`, `renderOptionsSchema`. Caption start/end are inclusive/exclusive. Scenes completely partition `[0,durationInFrames)` with no gaps/overlaps. All IDs unique. Locked scenes reject edits, split/merge/boundary/grouping changes; explicit unlock is allowed. No source audio slicing in initial release, so scene boundary operations never shift narration.

## Domain functions (`src/domain/`)

`project.ts` exports `createProject(title?:string,durationSeconds?:number):Project`, `createDemoProject():Project`, `applyCommand(project:Project,command:EditorCommand):Project` and helpers `formatTime(seconds:number):string`, `sceneAtFrame(project,frame):Scene|undefined`. Commands preserve Project ID and increment revision; set updatedAt. Root imports from this module only.

`quality.ts` exports `checkQuality(project:Project):QualityReport`. It checks valid/contiguous scene coverage, bounded/caption display and timing, template-specific item/heading/body lengths, missing/incorrect assets, short video sources, caption gaps/overlaps and narration duration, fixed format. Warnings may be acknowledged for export; errors block export. A no-audio project is a warning, not a fabricated narration success.

`captions.ts` exports `parseCaptions(text:string,format:'srt'|'vtt'|'json',fps:number):{captions:Caption[];words:Word[]}`, `toSrt(project):string`, `toVtt(project):string`, `groupScenes(project:Project,targetSeconds?:number,splitMode?:'fixed'|'natural'):{scenes:Scene[];chapters:Chapter[]}`. Supports faster-whisper `segments[].words` JSON and our exported caption array. Split deterministically with fixed frame intervals or natural word/caption boundaries within ±20%; do not claim AI semantic analysis. Korean/CJK line wrapping for video captions.

Export `EditorCommand` union in shared/types.ts:
- `{type:'updateProject',patch:Partial<Pick<Project,'title'>> & {settings?:Partial<ProjectSettings>}}`
- `{type:'updateScene',sceneId:string,patch:Partial<Omit<Scene,'id'|'startFrame'|'durationInFrames'>>}`
- `{type:'splitScene',sceneId:string,atFrame:number}`
- `{type:'mergeScene',sceneId:string}` (merge with next, reject if either locked)
- `{type:'setBoundary',sceneId:string,endFrame:number}` (adjust next boundary while preserving total audio timeline)
- `{type:'updateCaption',captionId:string,patch:Partial<Pick<Caption,'text'|'startFrame'|'endFrame'>>}`
- `{type:'addCaption',caption:Caption}` / `{type:'removeCaption',captionId:string}`
- `{type:'replaceCaptions',captions:Caption[],words?:Word[],regroup?:boolean}`
- `{type:'regroup',targetSeconds?:number,splitMode?:'fixed'|'natural'}` (reject locked scenes)
- `{type:'updateChapter',chapterId:string,title:string}` / `{type:'addChapter',title:string}`
- `{type:'addAsset',asset:Asset}`
- `{type:'setNarration',assetId:string}` (adapt end-of-project duration to audio, retain safe existing edits, quality-check incompatible caption bounds; no silently fabricated transcript)

Failures throw user-facing Error with Korean message. Server validates before apply, checks optimistic `expectedRevision`, returns HTTP409 on stale write. UI retries only after reloading and user-visible conflict indication; never overwrites stale state silently.

## Local HTTP API (server at `127.0.0.1:4317`, Vite middleware in development)

JSON failures `{error:string}`; request JSON max 8MB, uploaded assets streamed, size capped at 2GB. Origin/Host restrictions for loopback and same-origin writes. No arbitrary file path serving, shell execution from input, network URL ingestion, or remote data uploads.

- `GET /api/system` → SystemStatus.
- `GET /api/projects` → ProjectSummary[].
- `POST /api/projects` body `{title?:string,durationSeconds?:number,demo?:boolean}` → Project.
- `GET /api/projects/:id` → Project.
- `POST /api/projects/:id/commands` body `{command:EditorCommand,expectedRevision:number}` → Project.
- `GET /api/projects/:id/history` → HistoryEntry[].
- `POST /api/projects/:id/undo` / `redo` body `{expectedRevision:number}` → Project.
- `POST /api/projects/:id/restore` body `{historyId:string,expectedRevision:number}` → Project.
- `POST /api/projects/:id/assets` multipart `file` → `{project:Project,asset:Asset}`. Asset mime/type/duration probed and sanitized, private path never accepted from browser. Adding an audio asset does not auto-bind narration; UI sends setNarration afterwards.
- `GET /api/projects/:id/assets/:assetId` serves original asset with Range support.
- `POST /api/projects/:id/captions` JSON `{text:string,format:'srt'|'vtt'|'json',regroup?:boolean,expectedRevision:number}` → Project.
- `GET /api/projects/:id/captions.srt` / `.vtt` → download.
- `GET /api/projects/:id/download` → project JSON download.
- `POST /api/projects/import` multipart `file` (our project JSON or portable project archive if supported) → Project. Validate all project fields; do not trust external file paths.
- `GET /api/projects/:id/quality` → QualityReport with actual file existence checks.
- `GET /api/jobs?projectId=...` → Job[].
- `POST /api/projects/:id/transcribe` body `{expectedRevision:number}` → Job. Local Python only, saved project revision snapshot; apply transcript only if narration/revision still match or expose result to import without replacing newer edits. Process stdout structured progress and stderr bounded. No downloads. Preserve failed job and allow retry.
- `POST /api/projects/:id/render` body `RenderOptions` → Job. Quality gate (errors block; warnings require allowWarnings). Render snapshot never changes project. Cancellation aborts actual render; restart marks abandoned running jobs as interrupted.
- `POST /api/jobs/:id/cancel` → Job. `POST /api/jobs/:id/retry` → Job (new ID; use original snapshot or current project explicitly per type and expose revision).
- `GET /api/outputs/:jobId/:fileName` → bounded exported output/QA downloads.

Project persistence: `editor/data/projects/<id>/project.json`, `assets/`, `revisions/`. Jobs: `editor/data/jobs/`. Atomic writes + in-process serialized project mutation. Bundle/import references stay within project root. Local model defaults are detected from `../.video-build/venv/bin/python` and existing faster-whisper model snapshot; config override through non-secret process vars is allowed. No env file creation needed.

## Renderer interface (render worker)

`src/video/Composition.tsx` exports `VideoComposition({project,assetBaseUrl,showGuides?}:{project:Project;assetBaseUrl:string;showGuides?:boolean})` for Remotion Player and export; `SceneVisual` may be exported for thumbnails. Locally bundled Noto Sans KR. All visuals deterministic by frame, using fixed theme tokens and bounds-aware wrapping/scaling. 6 templates, simple code-native character with restrained breathing/blink/mouth motion, letter/diagram reveals, actual image/video assets. No online fonts/images. Imported videos retain source audio muted under narration. Main audio exactly once (continuous narration), subtitles exact timed frames. Media URLs derive only from project asset IDs.

`src/video/Root.tsx` registers `BiadoneVideo` composition with dynamic metadata from project settings/duration.

`server/render.ts` exports:
```ts
interface RenderContext {
 project:Project; projectDirectory:string; outputDirectory:string; assetBaseUrl:string;
 options:RenderOptions; signal:AbortSignal; onProgress:(progress:number,message:string)=>void;
}
async function renderProject(context:RenderContext):Promise<{fileName:string;verification:Record<string,unknown>}>
```
Output H264 MP4 + AAC audio when present, faststart, expected duration/fps/size. FFmpeg verify whole-file decoding and report error on failed output; ffprobe may be discovered from PATH or sibling ffmpeg package. Optional loudness normalize only when settings.normalizeAudio true. The export references snapshot-local assets so editing during export is safe.

## Codex MCP

Local stdio server proxies ONLY the above loopback API (do not edit project JSON around HTTP locking). Tools: list_projects, get_project, edit_project (validated commands with expected revision), get_quality, import_captions, start_export, get_job. Mark read-only tools. Tool instructions: read project/revision first; preserve locked scenes; run quality check before output; poll jobs to completion; never call a started export complete. Include project-scoped config example/readme; do not change user's global Codex config.

## Acceptance

Real persisted project → local source import → Korean transcription/timed caption import → grouping → chapter/template/caption edits → undo/restore → saved reload → quality gate → output, verify and download. Test a real five-minute narration project as long-form evidence and a short output for exhaustive decoding/preview alignment. Also validate >20-minute domain/timeline state without claiming it was rendered unless actually rendered. Test cancelling a live job and preservation after failure. Browser verify scene selection, actual playback/seek, inspector editing, source import, quality errors and export progress. Test MCP protocol initialization/list/read/edit against running app using SDK client.


## 2026-10-26 scene generation extension

See [SCENE_GENERATION.md](SCENE_GENERATION.md). `src/shared/types.ts` is the executable schema. Existing schemaVersion 1 records remain compatible.

- `SceneKind = Exclude<Template,'media'> | 'image' | 'video'`.
- Optional `Project.sceneSetup`: targetSeconds, splitMode, allowedKinds (nonempty unique), motion, instructions. Default 8 seconds / fixed / all types / standard.
- Optional nullable `Scene.preferredKind`: null means automatic selection. `updateScene` also accepts `assetId:null` to explicitly remove the reference; stored Scene.assetId remains optional string.
- `updateSceneSetup {patch}` saves options; `applyScenePlan {plan,sceneIds?}` validates the whole scope before applying content-only patches. Start/duration/captions/locks are immutable in a generated plan.
- `ScenePlan.scenes[]` requires sceneId, kind, title, heading, kicker, body, items, nullable assetId, mediaStartFrame, mediaFit, motion, showCaptions, notes.
- `POST /api/projects/:id/generate {expectedRevision,sceneIds}` → Job. `GET /api/jobs/:id/plan` → `{plan,project}` snapshot. `POST /api/jobs/:id/apply {expectedRevision}` → Project only when the original revision is still current. Retained drafts are never silently rebased over a changed project.
- `SystemStatus.codex` / `codexReason` expose CLI availability/login status without returning credentials.
- Explicit Codex generation sends selected narration and asset metadata to Codex using existing authentication. It does not upload raw media or require an editor OpenAI API key. All other media operations remain local.

ID-creating commands (`regroup`, `splitScene`, `addChapter`, regrouping `replaceCaptions`, `setNarration`) accept optional `idSeed`. The browser calls `withCommandSeed` once before optimistic application and keeps that exact payload through the queue and rebases. Client/server therefore create identical scene/chapter IDs. Legacy unseeded server commands remain supported.


## Manual storyboard extension (2026-10-26, current UI)

- Optional `Scene.requirements` is user-authored text, maximum 4,000 characters. It is separate from generated `notes`, is not an output field of ScenePlan, and survives generation/application unchanged.
- `addScene {chapterId,firstCaptionId,lastCaptionId,idSeed?,preferredKind?,requirements?}` creates one scene from a contiguous narration range. First/last narration cues extend to project bounds; internal boundaries use silence-gap midpoints. Overlapping/ambiguous cue ranges and any overlapping locked scene are rejected atomically. Existing outside fragments retain content, requirements and video offsets; source audio/captions/words do not move.
- `withCommandSeed` includes addScene. The entire insertion is one revision and history entry.
- Explicit `preferredKind` overrides a legacy global automatic-selection pool. Automatic selection still uses the stored pool. Codex gets the user request as `userRequirements`, above generic direction/previous generated notes within timing/material/schema constraints.
- Source transcription uses replaceCaptions with regroup=false, preserving the user's storyboard.
- UI chapter runs follow scene playback order even for A→B→A membership; rail and timeline share the same grouping helper.
- Generation starts on scene cards or the global Generate All action. The composition screen embeds retained generation results, while the results tab provides a separate history view. Scene requirements use native maxlength enforcement as well as schema validation.
