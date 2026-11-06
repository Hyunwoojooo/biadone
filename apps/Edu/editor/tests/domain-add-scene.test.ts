import {describe,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {applyCommand,createProject,getSceneCaptionRange,withCommandSeed} from '../src/domain/project';
import {projectSchema} from '../src/shared/types';
import type {EditorCommand,Project} from '../src/shared/types';
import {ProjectStore} from '../server/storage';

function sourceProject():Project {
 let p=createProject('원본 나레이션',60);
 p.captions=[
  {id:'cue-0',text:'첫 문장입니다.',startFrame:30,endFrame:150},
  {id:'cue-1',text:'선택한 첫 줄입니다.\n뒤에 이어지는 문장입니다.',startFrame:300,endFrame:420},
  {id:'cue-2',text:'선택한 두 번째 문장입니다.',startFrame:600,endFrame:720},
  {id:'cue-3',text:'다음 문장입니다.',startFrame:900,endFrame:1020},
  {id:'cue-4',text:'마지막 문장입니다.',startFrame:1500,endFrame:1650},
 ];
 p.words=[{id:'word-0',text:'첫 문장',start:1,end:5},{id:'word-1',text:'선택 문장',start:10,end:14}];
 p.assets=[{id:'narration',name:'narration.wav',kind:'audio',fileName:'narration.wav',duration:60}];p.audioAssetId='narration';
 p=applyCommand(p,{type:'addChapter',title:'새 구성',idSeed:'manual-chapter'});return p;
}
function addCommand(project:Project,patch:Partial<Extract<EditorCommand,{type:'addScene'}>>={}):Extract<EditorCommand,{type:'addScene'}> {
 return {type:'addScene',chapterId:project.chapters[1].id,firstCaptionId:'cue-1',lastCaptionId:'cue-2',idSeed:'manual-scene',...patch};
}
function coverage(project:Project){let cursor=0;for(const scene of project.scenes){expect(scene.startFrame).toBe(cursor);expect(scene.durationInFrames).toBeGreaterThan(0);cursor+=scene.durationInFrames;}expect(cursor).toBe(project.durationInFrames);expect(projectSchema.safeParse(project).success).toBe(true);}
const sources=(project:Project)=>({captions:project.captions,words:project.words,assets:project.assets,audioAssetId:project.audioAssetId,durationInFrames:project.durationInFrames});

describe('manual scene creation from source narration',()=>{
 it('splits silence at midpoints and extends first/last selected cues to project edges',()=>{
  const p=sourceProject();expect(getSceneCaptionRange(p,'cue-1','cue-2')).toMatchObject({startFrame:225,endFrame:810});
  expect(getSceneCaptionRange(p,'cue-0','cue-0')).toMatchObject({startFrame:0,endFrame:225});
  expect(getSceneCaptionRange(p,'cue-4','cue-4')).toMatchObject({startFrame:1260,endFrame:1800});
  expect(getSceneCaptionRange(p,'cue-0','cue-4')).toMatchObject({startFrame:0,endFrame:1800});
 });
 it('creates one selected scene while retaining the full partition and exact source data',()=>{
  const p=sourceProject(),before=structuredClone(p);const requirements='반드시: 두 문장 내용을 함께 보여주세요.\n순서는 그대로 유지합니다.  ';
  const next=applyCommand(p,addCommand(p,{preferredKind:'flow',requirements}));coverage(next);
  expect(next.scenes.map(scene=>[scene.startFrame,scene.durationInFrames])).toEqual([[0,225],[225,585],[810,990]]);
  const created=next.scenes[1];expect(created.id).toBe('scene-manual-scene-0');expect(created.title).toBe('선택한 첫 줄입니다.');expect(created.heading).toBe(created.title);
  expect(created.chapterId).toBe(p.chapters[1].id);expect(created.template).toBe('flow');expect(created.preferredKind).toBe('flow');expect(created.requirements).toBe(requirements);
  expect(sources(next)).toEqual(sources(p));expect(next.revision).toBe(p.revision+1);expect(p).toEqual(before);
 });
 it('does not leave tiny leading/trailing silence scenes when all source cues are selected',()=>{
  const p=sourceProject();const next=applyCommand(p,addCommand(p,{firstCaptionId:'cue-0',lastCaptionId:'cue-4'}));
  expect(next.scenes).toHaveLength(1);expect(next.scenes[0].startFrame).toBe(0);expect(next.scenes[0].durationInFrames).toBe(1800);coverage(next);
 });
 it('preserves both boundary fragments including source video offsets and user requirements',()=>{
  let p=sourceProject();const originalId=p.scenes[0].id;
  p=applyCommand(p,{type:'addAsset',asset:{id:'source-video',name:'source.mp4',kind:'video',fileName:'source.mp4',duration:90}});
  p=applyCommand(p,{type:'updateScene',sceneId:originalId,patch:{template:'media',assetId:'source-video',mediaStartFrame:90,preferredKind:'video',requirements:'기존 구간의 필수 요구',notes:'기존 연출 메모'}});
  const original=structuredClone(p.scenes[0]);const next=applyCommand(p,addCommand(p));
  expect(next.scenes[0]).toEqual({...original,durationInFrames:225});
  expect(next.scenes[2]).toEqual({...original,id:'scene-manual-scene-1',startFrame:810,durationInFrames:990,mediaStartFrame:900});
  expect(next.scenes[2].mediaStartFrame-next.scenes[2].startFrame).toBe(original.mediaStartFrame-original.startFrame);coverage(next);
 });
 it('leaves entire scenes outside the selected interval unchanged',()=>{
  let p=sourceProject();p=applyCommand(p,{type:'splitScene',sceneId:p.scenes[0].id,atFrame:300,idSeed:'outside-left'});
  p=applyCommand(p,{type:'splitScene',sceneId:p.scenes[1].id,atFrame:1200,idSeed:'outside-right'});
  const first=structuredClone(p.scenes[0]),last=structuredClone(p.scenes[2]);
  const next=applyCommand(p,addCommand(p,{firstCaptionId:'cue-2',lastCaptionId:'cue-2'}));
  expect(next.scenes[0]).toEqual(first);expect(next.scenes.at(-1)).toEqual(last);coverage(next);
 });
 it('rejects a locked overlap atomically while allowing locked adjacent scenes',()=>{
  let p=sourceProject();p=applyCommand(p,{type:'updateScene',sceneId:p.scenes[0].id,patch:{locked:true}});const before=JSON.stringify(p);
  expect(()=>applyCommand(p,addCommand(p))).toThrow(/잠긴/);expect(JSON.stringify(p)).toBe(before);
  let adjacent=sourceProject();adjacent=applyCommand(adjacent,{type:'splitScene',sceneId:adjacent.scenes[0].id,atFrame:225,idSeed:'adjacent-left'});
  adjacent=applyCommand(adjacent,{type:'splitScene',sceneId:adjacent.scenes[1].id,atFrame:810,idSeed:'adjacent-right'});
  adjacent=applyCommand(adjacent,{type:'updateScene',sceneId:adjacent.scenes[0].id,patch:{locked:true}});
  adjacent=applyCommand(adjacent,{type:'updateScene',sceneId:adjacent.scenes[2].id,patch:{locked:true}});
  const next=applyCommand(adjacent,addCommand(adjacent));expect(next.scenes[0]).toEqual(adjacent.scenes[0]);expect(next.scenes[2]).toEqual(adjacent.scenes[2]);coverage(next);
 });
 it('rejects missing/reversed source cues and chapters without changing the project',()=>{
  const p=sourceProject(),before=JSON.stringify(p);
  expect(()=>applyCommand(p,addCommand(p,{firstCaptionId:'missing'}))).toThrow(/찾을 수/);
  expect(()=>applyCommand(p,addCommand(p,{firstCaptionId:'cue-3',lastCaptionId:'cue-1'}))).toThrow(/앞에/);
  expect(()=>applyCommand(p,addCommand(p,{chapterId:'missing'}))).toThrow(/챕터/);
  expect(()=>applyCommand(p,addCommand(p,{requirements:'가'.repeat(4001)}))).toThrow();expect(JSON.stringify(p)).toBe(before);
 });
 it('rejects ambiguous overlaps inside the selection or crossing either edge',()=>{
  const p=sourceProject();p.captions[1].endFrame=650;
  expect(()=>getSceneCaptionRange(p,'cue-1','cue-2')).toThrow(/겹칩니다/);
  const before=sourceProject();before.captions[0].endFrame=800;expect(()=>getSceneCaptionRange(before,'cue-2','cue-2')).toThrow(/겹칩니다/);
  const after=sourceProject();after.captions[2].startFrame=400;expect(()=>getSceneCaptionRange(after,'cue-1','cue-1')).toThrow(/겹칩니다/);
 });
 it('uses the maximum earlier end without altering unrelated source overlaps or stored cue order',()=>{
  const p=sourceProject();p.captions[0].endFrame=450;p.captions.reverse();const before=JSON.stringify(p.captions);
  const range=getSceneCaptionRange(p,'cue-2','cue-2');expect(range.startFrame).toBe(525);expect(range.endFrame).toBe(810);
  expect(JSON.stringify(p.captions)).toBe(before);range.captions[0].text='로컬 복사 수정';expect(JSON.stringify(p.captions)).toBe(before);
 });
 it('stores the addition as one recoverable revision through undo, redo and reload',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'studio-manual-scene-'));
  try {
   const store=new ProjectStore(directory);await store.init();const original=await store.import(sourceProject(),false);
   const payload=withCommandSeed(addCommand(original,{preferredKind:'list',requirements:'반드시 원문을 확인하세요.'}));
   const added=await store.command(original.id,payload,original.revision);const history=await store.history(original.id);expect(history).toHaveLength(2);expect(history[0].title).toBe('장면 추가');
   const undone=await store.navigate(original.id,added.revision,'undo');expect(undone.scenes).toEqual(original.scenes);expect(sources(undone)).toEqual(sources(original));
   const reloaded=new ProjectStore(directory),redone=await reloaded.navigate(original.id,undone.revision,'redo');
   expect(redone.scenes).toEqual(added.scenes);expect(sources(redone)).toEqual(sources(original));expect(redone.revision).toBeGreaterThan(undone.revision);
   expect((await reloaded.get(original.id)).scenes).toEqual(added.scenes);
  } finally {await rm(directory,{recursive:true,force:true});}
 });
});
