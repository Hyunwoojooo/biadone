import {z} from 'zod';

export type Template = 'title' | 'quote' | 'compare' | 'steps' | 'media' | 'character' | 'list' | 'stat' | 'flow';
export type SceneKind = Exclude<Template,'media'> | 'image' | 'video';
export type SplitMode = 'fixed'|'natural';
export interface SceneSetup {targetSeconds:number;splitMode:SplitMode;allowedKinds:SceneKind[];motion:Motion;instructions:string}
export type ThemeId = 'sage' | 'ink' | 'sand';
export type Motion = 'calm' | 'standard' | 'lively';
export type AssetKind = 'audio' | 'image' | 'video';
export interface Asset {id:string; name:string; kind:AssetKind; fileName:string; duration?:number; width?:number; height?:number; waveform?:number[]}
export interface Word {id:string; text:string; start:number; end:number; confidence?:number}
export interface Caption {id:string; text:string; startFrame:number; endFrame:number; wordIds?:string[]}
export interface Chapter {id:string; title:string}
export interface SceneItem {title:string; body:string}
export interface Scene {id:string; title:string; chapterId:string; startFrame:number; durationInFrames:number; template:Template; heading:string; kicker:string; body:string; items:SceneItem[]; assetId?:string; mediaStartFrame:number; mediaFit:'contain'|'cover'; locked:boolean; showCaptions:boolean; motion:Motion; notes:string; preferredKind?:SceneKind|null;requirements?:string}
export interface ProjectSettings {width:number; height:number; fps:number; theme:ThemeId; accent:string; subtitleSize:number; subtitleBackground:boolean; showCaptions:boolean; audioGainDb:number; normalizeAudio:boolean}
export interface Project {schemaVersion:1; id:string; title:string; createdAt:string; updatedAt:string; revision:number; durationInFrames:number; settings:ProjectSettings; audioAssetId?:string; assets:Asset[]; words:Word[]; captions:Caption[]; chapters:Chapter[]; scenes:Scene[];sceneSetup?:SceneSetup}
export interface ScenePlanScene {sceneId:string;kind:SceneKind;title:string;heading:string;kicker:string;body:string;items:SceneItem[];assetId:string|null;mediaStartFrame:number;mediaFit:'contain'|'cover';motion:Motion;showCaptions:boolean;notes:string}
export interface ScenePlan {scenes:ScenePlanScene[]}
export type GeneratedPlan = ScenePlan;
export interface QualityIssue {id:string; severity:'error'|'warning'|'info'; code:string; message:string; sceneId?:string; captionId?:string}
export interface QualityReport {ok:boolean; issues:QualityIssue[]; checkedAt:string; summary:{scenes:number; captions:number; durationSeconds:number; errors:number; warnings:number}}
export type JobType = 'transcribe'|'render'|'generate';
export type JobStatus = 'queued'|'running'|'completed'|'failed'|'cancelled';
export interface Job {id:string; projectId:string; type:JobType; status:JobStatus; progress:number; message:string; createdAt:string; updatedAt:string; projectRevision:number; outputUrl?:string; error?:string; verification?:Record<string,unknown>}
export interface ProjectSummary {id:string; title:string; updatedAt:string; durationInFrames:number; fps:number; sceneCount:number}
export interface HistoryEntry {id:string; title:string; createdAt:string; revision:number}
export interface SystemStatus {ffmpeg:boolean; ffprobe:boolean; transcription:boolean; transcriptionReason?:string;codex:boolean;codexReason?:string; dataDirectory:string; appDirectory?:string; version:string}
export interface RenderOptions {resolution:'1080p'|'720p'; range?:{startFrame:number; endFrame:number}; allowWarnings?:boolean}
export type ScenePatch=Partial<Omit<Scene,'id'|'startFrame'|'durationInFrames'|'assetId'>> & {assetId?:string|null};

export type EditorCommand =
 | {type:'updateProject'; patch:Partial<Pick<Project,'title'>> & {settings?:Partial<ProjectSettings>}}
 | {type:'updateScene'; sceneId:string; patch:ScenePatch}
 | {type:'splitScene'; sceneId:string; atFrame:number;idSeed?:string}
 | {type:'mergeScene'; sceneId:string}
 | {type:'setBoundary'; sceneId:string; endFrame:number}
 | {type:'updateCaption'; captionId:string; patch:Partial<Pick<Caption,'text'|'startFrame'|'endFrame'>>}
 | {type:'addCaption'; caption:Caption}
 | {type:'removeCaption'; captionId:string}
 | {type:'replaceCaptions'; captions:Caption[]; words?:Word[]; regroup?:boolean;idSeed?:string}
 | {type:'regroup'; targetSeconds?:number;splitMode?:SplitMode;idSeed?:string}
 | {type:'updateSceneSetup';patch:Partial<SceneSetup>}
 | {type:'applyScenePlan';plan:ScenePlan;sceneIds?:string[]}
 | {type:'updateChapter'; chapterId:string; title:string}
 | {type:'addChapter'; title:string;idSeed?:string}
 | {type:'addScene';chapterId:string;firstCaptionId:string;lastCaptionId:string;idSeed?:string;preferredKind?:SceneKind|null;requirements?:string}
 | {type:'addAsset'; asset:Asset}
 | {type:'setNarration'; assetId:string;idSeed?:string};

const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, 'ID 형식이 올바르지 않습니다.');
export const idSeedSchema=z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/,'명령 ID 형식이 올바르지 않습니다.');
const frame = z.number().int().min(0).max(10_000_000);
const seconds = z.number().finite().min(0).max(86_400);
const text = (max:number) => z.string().max(max);
export const templateSchema = z.enum(['title','quote','compare','steps','media','character','list','stat','flow']);
export const sceneKindSchema = z.enum(['title','quote','compare','steps','character','list','stat','flow','image','video']);
export const splitModeSchema=z.enum(['fixed','natural']);
export const sceneSetupSchema=z.object({
 targetSeconds:z.number().finite().min(3).max(60),splitMode:splitModeSchema,
 allowedKinds:z.array(sceneKindSchema).min(1).max(10).refine(values=>new Set(values).size===values.length,'사용할 화면 유형은 중복될 수 없습니다.'),
 motion:z.enum(['calm','standard','lively']),instructions:text(10_000),
}).strict();
export const assetSchema = z.object({
 id, name:text(300).min(1), kind:z.enum(['audio','image','video']),
 fileName:z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, '파일 이름에 경로를 포함할 수 없습니다.'),
 duration:seconds.optional(), width:z.number().int().positive().max(32768).optional(), height:z.number().int().positive().max(32768).optional(),
 waveform:z.array(z.number().finite().min(0).max(1)).max(20_000).optional(),
}).strict();
export const wordSchema = z.object({id,text:text(1000),start:seconds,end:seconds,confidence:z.number().finite().min(0).max(1).optional()}).strict().refine(v=>v.end>=v.start,'단어 종료 시각은 시작 이후여야 합니다.');
export const captionSchema = z.object({id,text:text(4000),startFrame:frame,endFrame:frame,wordIds:z.array(id).max(2000).optional()}).strict().refine(v=>v.endFrame>v.startFrame,'자막 종료 시각은 시작 이후여야 합니다.');
const chapterSchema = z.object({id,title:text(200).min(1)}).strict();
const sceneItemSchema = z.object({title:text(300),body:text(2000)}).strict();
const sceneFields = {
 id,title:text(200),chapterId:id,startFrame:frame,durationInFrames:frame.refine(v=>v>0,'장면 길이는 1프레임 이상이어야 합니다.'),template:templateSchema,
 heading:text(300),kicker:text(200),body:text(4000),items:z.array(sceneItemSchema).max(12),assetId:id.optional(),mediaStartFrame:frame,
 mediaFit:z.enum(['contain','cover']),locked:z.boolean(),showCaptions:z.boolean(),motion:z.enum(['calm','standard','lively']),notes:text(10_000),preferredKind:sceneKindSchema.nullable().optional(),requirements:text(4000).optional(),
} as const;
export const sceneSchema = z.object(sceneFields).strict();
export const settingsSchema = z.object({
 width:z.number().int().min(320).max(4096),height:z.number().int().min(180).max(4096),fps:z.number().int().min(1).max(60),
 theme:z.enum(['sage','ink','sand']),accent:z.string().regex(/^#[0-9a-fA-F]{6}$/),subtitleSize:z.number().int().min(24).max(84),
 subtitleBackground:z.boolean(),showCaptions:z.boolean(),audioGainDb:z.number().finite().min(-40).max(12),normalizeAudio:z.boolean(),
}).strict();
export const projectSchema = z.object({
 schemaVersion:z.literal(1),id,title:text(200).min(1),createdAt:z.string().datetime(),updatedAt:z.string().datetime(),revision:z.number().int().min(0).max(1_000_000_000),
 durationInFrames:frame.refine(v=>v>0,'프로젝트 길이는 1프레임 이상이어야 합니다.'),settings:settingsSchema,audioAssetId:id.optional(),
 assets:z.array(assetSchema).max(10_000),words:z.array(wordSchema).max(250_000),captions:z.array(captionSchema).max(100_000),
 chapters:z.array(chapterSchema).min(1).max(1000),scenes:z.array(sceneSchema).min(1).max(10_000),sceneSetup:sceneSetupSchema.optional(),
}).strict().superRefine((p,ctx)=>{
 const ids=new Set<string>();
 for(const [name,values] of [['assets',p.assets],['words',p.words],['captions',p.captions],['chapters',p.chapters],['scenes',p.scenes]] as const) {
  for(let i=0;i<values.length;i++) {
   if(ids.has(values[i].id)) ctx.addIssue({code:z.ZodIssueCode.custom,path:[name,i,'id'],message:'프로젝트 안의 ID는 중복될 수 없습니다.'});
   ids.add(values[i].id);
  }
 }
 const chapters=new Set(p.chapters.map(c=>c.id)); let cursor=0;
 for(let i=0;i<p.scenes.length;i++) {
  const s=p.scenes[i];
  if(s.startFrame!==cursor) ctx.addIssue({code:z.ZodIssueCode.custom,path:['scenes',i,'startFrame'],message:'장면은 빈 구간이나 겹침 없이 시간순으로 이어져야 합니다.'});
  if(!chapters.has(s.chapterId)) ctx.addIssue({code:z.ZodIssueCode.custom,path:['scenes',i,'chapterId'],message:'장면의 챕터를 찾을 수 없습니다.'});
  cursor=s.startFrame+s.durationInFrames;
 }
 if(cursor!==p.durationInFrames) ctx.addIssue({code:z.ZodIssueCode.custom,path:['durationInFrames'],message:'마지막 장면은 프로젝트 끝과 일치해야 합니다.'});
});

const scenePatchSchema=z.object(sceneFields).omit({id:true,startFrame:true,durationInFrames:true,assetId:true}).partial().extend({assetId:id.nullable().optional()}).strict();
export const scenePlanSceneSchema=z.object({
 sceneId:id,kind:sceneKindSchema,title:text(200),heading:text(300),kicker:text(200),body:text(4000),items:z.array(sceneItemSchema).max(12),
 assetId:id.nullable(),mediaStartFrame:frame,mediaFit:z.enum(['contain','cover']),motion:z.enum(['calm','standard','lively']),showCaptions:z.boolean(),notes:text(10_000),
}).strict();
export const scenePlanSchema=z.object({scenes:z.array(scenePlanSceneSchema).min(1).max(10_000)}).strict();
export const commandSchema = z.discriminatedUnion('type',[
 z.object({type:z.literal('updateProject'),patch:z.object({title:text(200).min(1).optional(),settings:settingsSchema.partial().optional()}).strict()}).strict(),
 z.object({type:z.literal('updateScene'),sceneId:id,patch:scenePatchSchema}).strict(),
 z.object({type:z.literal('splitScene'),sceneId:id,atFrame:frame,idSeed:idSeedSchema.optional()}).strict(),
 z.object({type:z.literal('mergeScene'),sceneId:id}).strict(),
 z.object({type:z.literal('setBoundary'),sceneId:id,endFrame:frame}).strict(),
 z.object({type:z.literal('updateCaption'),captionId:id,patch:z.object({text:text(4000).optional(),startFrame:frame.optional(),endFrame:frame.optional()}).strict()}).strict(),
 z.object({type:z.literal('addCaption'),caption:captionSchema}).strict(),
 z.object({type:z.literal('removeCaption'),captionId:id}).strict(),
 z.object({type:z.literal('replaceCaptions'),captions:z.array(captionSchema).max(100_000),words:z.array(wordSchema).max(250_000).optional(),regroup:z.boolean().optional(),idSeed:idSeedSchema.optional()}).strict(),
 z.object({type:z.literal('regroup'),targetSeconds:z.number().finite().min(3).max(60).optional(),splitMode:splitModeSchema.optional(),idSeed:idSeedSchema.optional()}).strict(),
 z.object({type:z.literal('updateSceneSetup'),patch:sceneSetupSchema.partial()}).strict(),
 z.object({type:z.literal('applyScenePlan'),plan:scenePlanSchema,sceneIds:z.array(id).min(1).max(10_000).optional()}).strict(),
 z.object({type:z.literal('updateChapter'),chapterId:id,title:text(200).min(1)}).strict(),
 z.object({type:z.literal('addChapter'),title:text(200).min(1),idSeed:idSeedSchema.optional()}).strict(),
 z.object({type:z.literal('addScene'),chapterId:id,firstCaptionId:id,lastCaptionId:id,idSeed:idSeedSchema.optional(),preferredKind:sceneKindSchema.nullable().optional(),requirements:text(4000).optional()}).strict(),
 z.object({type:z.literal('addAsset'),asset:assetSchema}).strict(),
 z.object({type:z.literal('setNarration'),assetId:id,idSeed:idSeedSchema.optional()}).strict(),
]);
export const renderOptionsSchema = z.object({resolution:z.enum(['1080p','720p']),range:z.object({startFrame:frame,endFrame:frame}).strict().refine(v=>v.endFrame>v.startFrame,'출력 끝은 시작 이후여야 합니다.').optional(),allowWarnings:z.boolean().optional()}).strict();
