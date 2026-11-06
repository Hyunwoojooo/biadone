import {describe,expect,it} from 'vitest';
import {applyCommand,createProject} from '../src/domain/project';
import {groupScenes} from '../src/domain/captions';
import {defaultSceneSetup,getSceneSetup,permittedSceneKinds,sceneKind,sceneWithPlan,validateScenePlan} from '../src/domain/scenePlan';
import {projectSchema,scenePlanSchema} from '../src/shared/types';
import type {Project,ScenePlan,ScenePlanScene,SplitMode} from '../src/shared/types';
import {checkQuality} from '../src/domain/quality';

function expectCoverage(project:Project,mode:SplitMode,targetSeconds:number) {
 const grouped=groupScenes(project,targetSeconds,mode);let cursor=0;
 const target=Math.round(targetSeconds*project.settings.fps);
 for(const [index,scene] of grouped.scenes.entries()){
  expect(scene.startFrame).toBe(cursor);expect(Number.isInteger(scene.durationInFrames)).toBe(true);expect(scene.durationInFrames).toBeGreaterThan(0);
  if(mode==='fixed'&&index<grouped.scenes.length-1)expect(scene.durationInFrames).toBe(target);
  if(mode==='natural')expect(scene.durationInFrames).toBeLessThanOrEqual(Math.floor(target*1.2));
  cursor+=scene.durationInFrames;
 }
 expect(cursor).toBe(project.durationInFrames);return grouped;
}
function multiProject():Project {
 let p=createProject('장면 초안',30);p=applyCommand(p,{type:'splitScene',sceneId:p.scenes[0].id,atFrame:300});
 p=applyCommand(p,{type:'splitScene',sceneId:p.scenes[1].id,atFrame:600});
 p.captions=[{id:'source-caption',text:'나레이션의 원문입니다.',startFrame:0,endFrame:200}];
 p.words=[{id:'source-word',text:'나레이션',start:0,end:2}];return p;
}
function scenePlan(sceneId:string,patch:Partial<ScenePlanScene>={}):ScenePlanScene {
 return {sceneId,kind:'title',title:'초안 장면',heading:'원문에서 확인한 핵심',kicker:'',body:'',items:[],assetId:null,mediaStartFrame:0,mediaFit:'contain',motion:'standard',showCaptions:true,notes:'검토할 초안',...patch};
}

describe('frame-complete fixed and natural scene splitting',()=>{
 it('splits a single 60-second caption into seven exact 8-second scenes and a 4-second tail',()=>{
  const p=createProject('긴 자막',60);p.captions=[{id:'one-long-caption',text:'하나의 긴 자막입니다.',startFrame:0,endFrame:1800}];
  const grouped=expectCoverage(p,'fixed',8);expect(grouped.scenes.map(s=>s.durationInFrames/30)).toEqual([8,8,8,8,8,8,8,4]);
 });
 it('keeps natural scenes inside the hard upper bound without sentence-ending punctuation',()=>{
  const p=createProject('문장부호 없는 자막',36);p.captions=Array.from({length:12},(_,i)=>({id:`plain-${i}`,text:'이어지는 설명',startFrame:i*90,endFrame:(i+1)*90}));
  const grouped=expectCoverage(p,'natural',8);expect(grouped.scenes.map(s=>s.durationInFrames/30)).toEqual([9,9,9,9]);
 });
 it('falls back to exact intervals through long captions and large caption-free regions',()=>{
  for(const mode of ['fixed','natural'] as const){
   const p=createProject('희소한 자막',60.5);p.captions=[{id:'sparse',text:'한 문장',startFrame:1500,endFrame:1800}];
   expectCoverage(p,mode,8);
   p.captions=[];expectCoverage(p,mode,8);
  }
 });
 it('prefers a sentence boundary inside the natural window and preserves all source timings',()=>{
  const p=createProject('자연 경계',30);p.captions=Array.from({length:10},(_,i)=>({id:`cue-${i}`,text:'이어지는 내용',startFrame:i*90,endFrame:(i+1)*90}));
  p.words=[{id:'sentence-end',text:'문장입니다.',start:7,end:7.9}];
  const before=JSON.stringify({captions:p.captions,words:p.words,audioAssetId:p.audioAssetId,assets:p.assets});
  const grouped=expectCoverage(p,'natural',8);expect(grouped.scenes[0].durationInFrames).toBe(237);
  expect(JSON.stringify({captions:p.captions,words:p.words,audioAssetId:p.audioAssetId,assets:p.assets})).toBe(before);
 });
 it('preserves integer coverage for short projects and fractional target seconds',()=>{
  for(const duration of [1/30,1,5,60.1,1800])for(const mode of ['fixed','natural'] as const)expectCoverage(createProject('프레임',duration),mode,8.3);
 });
 it('saves setup and grouping mode while keeping captions, words and audio references unchanged',()=>{
  let p=multiProject();const before=JSON.stringify({captions:p.captions,words:p.words,assets:p.assets,audioAssetId:p.audioAssetId});
  p=applyCommand(p,{type:'updateSceneSetup',patch:{targetSeconds:8,splitMode:'natural',allowedKinds:['title','list'],motion:'calm',instructions:'차분하게 설명'}});
  p=applyCommand(p,{type:'regroup',splitMode:'fixed'});
  expect(p.sceneSetup).toEqual({targetSeconds:8,splitMode:'fixed',allowedKinds:['title','list'],motion:'calm',instructions:'차분하게 설명'});
  expect(p.scenes.every(s=>s.motion==='calm')).toBe(true);expect(p.scenes.map(s=>s.durationInFrames)).toEqual([240,240,240,180]);
  expect(JSON.stringify({captions:p.captions,words:p.words,assets:p.assets,audioAssetId:p.audioAssetId})).toBe(before);
 });
});

describe('compatible scene setup and explicit choice clearing',()=>{
 it('reads defaults without adding data to an old schemaVersion 1 project',()=>{
  const old=createProject();const before=JSON.stringify(old);expect(old.sceneSetup).toBeUndefined();
  const setup=getSceneSetup(old);expect(setup).toEqual(defaultSceneSetup);setup.allowedKinds.splice(0,1);
  expect(getSceneSetup(old).allowedKinds).toEqual(defaultSceneSetup.allowedKinds);expect(JSON.stringify(old)).toBe(before);expect(projectSchema.safeParse(old).success).toBe(true);
 });
 it('clears preferred kinds and asset bindings through explicit JSON nulls',()=>{
  let p=createProject();p=applyCommand(p,{type:'addAsset',asset:{id:'image-owned',name:'owned.png',kind:'image',fileName:'owned.png'}});
  p=applyCommand(p,{type:'updateScene',sceneId:p.scenes[0].id,patch:{template:'media',preferredKind:'image',assetId:'image-owned'}});
  expect(sceneKind(p.scenes[0],p.assets)).toBe('image');
  p=applyCommand(p,JSON.parse(JSON.stringify({type:'updateScene',sceneId:p.scenes[0].id,patch:{preferredKind:null,assetId:null}})));
  expect(p.scenes[0].preferredKind).toBeNull();expect(p.scenes[0].assetId).toBeUndefined();expect(sceneKind(p.scenes[0],p.assets)).toBeUndefined();
 });
 it('rejects empty or duplicate allowed kind lists',()=>{
  const p=createProject();expect(()=>applyCommand(p,{type:'updateSceneSetup',patch:{allowedKinds:[]}})).toThrow();
  expect(()=>applyCommand(p,{type:'updateSceneSetup',patch:{allowedKinds:['title','title']}})).toThrow();
 });
});

describe('atomic generated scene plans',()=>{
 it('applies content once while keeping all timing, sources, choices and non-target scenes unchanged',()=>{
  let p=multiProject();p=applyCommand(p,{type:'updateScene',sceneId:p.scenes[0].id,patch:{preferredKind:'list'}});
  const original=structuredClone(p);const plan:ScenePlan={scenes:[scenePlan(p.scenes[0].id,{kind:'list',items:[{title:'자료 확인',body:'보유 자료를 확인합니다.'},{title:'결과 검토',body:'결과를 직접 확인합니다.'}]})]};
  const result=applyCommand(p,{type:'applyScenePlan',plan,sceneIds:[p.scenes[0].id]});
  expect(result.revision).toBe(p.revision+1);expect(result.scenes[0].template).toBe('list');expect(result.scenes[0].preferredKind).toBe('list');
  expect(result.scenes.map(s=>[s.id,s.chapterId,s.startFrame,s.durationInFrames,s.locked])).toEqual(p.scenes.map(s=>[s.id,s.chapterId,s.startFrame,s.durationInFrames,s.locked]));
  expect(result.scenes.slice(1)).toEqual(p.scenes.slice(1));expect(result.captions).toEqual(p.captions);expect(result.words).toEqual(p.words);expect(result.assets).toEqual(p.assets);expect(result.audioAssetId).toBe(p.audioAssetId);expect(p).toEqual(original);
 });
 it('rejects duplicate, missing, additional and nonexistent scene IDs',()=>{
  const p=multiProject();const a=scenePlan(p.scenes[0].id),b=scenePlan(p.scenes[1].id);
  expect(()=>validateScenePlan(p,{scenes:[a,a]})).toThrow(/중복/);
  expect(()=>validateScenePlan(p,{scenes:[a]},[a.sceneId,b.sceneId])).toThrow(/빠진/);
  expect(()=>validateScenePlan(p,{scenes:[a,b]},[a.sceneId])).toThrow(/범위 밖/);
  expect(()=>validateScenePlan(p,{scenes:[scenePlan('missing')]})).toThrow(/없는 장면/);
 });
 it('rejects locked scenes and incompatible allowed or individually requested kinds',()=>{
  let p=multiProject();p=applyCommand(p,{type:'updateScene',sceneId:p.scenes[0].id,patch:{locked:true}});
  expect(()=>validateScenePlan(p,{scenes:[scenePlan(p.scenes[0].id)]})).toThrow(/잠겨/);
  p=applyCommand(p,{type:'updateScene',sceneId:p.scenes[0].id,patch:{locked:false}});
  p=applyCommand(p,{type:'updateScene',sceneId:p.scenes[0].id,patch:{preferredKind:'flow'}});
  expect(()=>validateScenePlan(p,{scenes:[scenePlan(p.scenes[0].id)]})).toThrow(/지정한 화면 유형/);
  p=applyCommand(p,{type:'updateScene',sceneId:p.scenes[0].id,patch:{preferredKind:null}});
  p=applyCommand(p,{type:'updateSceneSetup',patch:{allowedKinds:['list']}});
  expect(()=>validateScenePlan(p,{scenes:[scenePlan(p.scenes[0].id)]})).toThrow(/허용하지 않은/);
 });
 it('rejects missing, mismatched and too-short media and accepts valid owned media',()=>{
  let p=multiProject();const id=p.scenes[0].id;
  p=applyCommand(p,{type:'addAsset',asset:{id:'owned-image',name:'image.png',kind:'image',fileName:'image.png'}});
  p=applyCommand(p,{type:'addAsset',asset:{id:'owned-video',name:'video.mp4',kind:'video',fileName:'video.mp4',duration:12}});
  expect(()=>validateScenePlan(p,{scenes:[scenePlan(id,{kind:'image',assetId:'missing'})]})).toThrow(/자료/);
  expect(()=>validateScenePlan(p,{scenes:[scenePlan(id,{kind:'video',assetId:'owned-image'})]})).toThrow(/종류/);
  expect(()=>validateScenePlan(p,{scenes:[scenePlan(id,{kind:'video',assetId:'owned-video',mediaStartFrame:90})]})).toThrow(/원본 영상보다/);
  expect(validateScenePlan(p,{scenes:[scenePlan(id,{kind:'image',assetId:'owned-image'})]}).scenes[0].kind).toBe('image');
  expect(validateScenePlan(p,{scenes:[scenePlan(id,{kind:'video',assetId:'owned-video',mediaStartFrame:60})]}).scenes[0].kind).toBe('video');
 });
 it('leaves the whole project unchanged when one scene in a plan is invalid',()=>{
  const p=multiProject();const original=JSON.stringify(p);const plan={scenes:[scenePlan(p.scenes[0].id),scenePlan(p.scenes[1].id,{kind:'video',assetId:'missing'})]};
  expect(()=>applyCommand(p,{type:'applyScenePlan',plan,sceneIds:p.scenes.slice(0,2).map(s=>s.id)})).toThrow();
  expect(JSON.stringify(p)).toBe(original);
 });
 it('requires every output field and rejects attempts to edit timing or locks',()=>{
  const p=multiProject();const full=scenePlan(p.scenes[0].id);const missingField:Partial<ScenePlanScene>={...full};delete missingField.notes;
  expect(scenePlanSchema.safeParse({scenes:[missingField]}).success).toBe(false);
  expect(scenePlanSchema.safeParse({scenes:[{...full,startFrame:99}]}).success).toBe(false);
  expect(scenePlanSchema.safeParse({scenes:[{...full,locked:false}]}).success).toBe(false);
 });
 it('rejects graph counts and text that fail the same layout used by the video renderer',()=>{
  const p=multiProject(),id=p.scenes[0].id;
  expect(()=>validateScenePlan(p,{scenes:[scenePlan(id,{kind:'list',items:[{title:'하나만',body:''}]})]})).toThrow(/2~5개/);
  expect(()=>validateScenePlan(p,{scenes:[scenePlan(id,{kind:'flow',items:[{title:'시작',body:''},{title:'가'.repeat(40),body:''}]})]})).toThrow(/문구/);
  const result=applyCommand(p,{type:'applyScenePlan',plan:{scenes:[scenePlan(id,{kind:'stat',items:[{title:'37%',body:'자료에서 확인한 비율'}]})]}});
  expect(checkQuality(result).issues.filter(issue=>issue.severity==='error'&&issue.sceneId===id)).toHaveLength(0);
 });
 it('preserves user requirements verbatim while generated notes and visuals change',()=>{
  let p=multiProject();const id=p.scenes[0].id;const requirements='필수: 보유 자료만 사용하세요.\n비교 항목의 순서는 그대로 유지합니다.  ';
  p=applyCommand(p,{type:'updateScene',sceneId:id,patch:{requirements}});
  const value=scenePlan(id,{notes:'AI가 작성한 새 검토 메모',heading:'확인할 핵심'});
  expect(sceneWithPlan(p.scenes[0],value).requirements).toBe(requirements);
  const next=applyCommand(p,{type:'applyScenePlan',plan:{scenes:[value]},sceneIds:[id]});
  expect(next.scenes[0].requirements).toBe(requirements);expect(next.scenes[0].notes).toBe(value.notes);expect(p.scenes[0].requirements).toBe(requirements);
  expect(projectSchema.parse(JSON.parse(JSON.stringify(next))).scenes[0].requirements).toBe(requirements);
  expect(scenePlanSchema.safeParse({scenes:[{...value,requirements:'AI가 덮어쓴 요구'}]}).success).toBe(false);
 });
 it('bounds user requirements independently of generated notes',()=>{
  let p=multiProject();const id=p.scenes[0].id;
  p=applyCommand(p,{type:'updateScene',sceneId:id,patch:{requirements:'가'.repeat(4000)}});expect(p.scenes[0].requirements?.length).toBe(4000);
  expect(()=>applyCommand(p,{type:'updateScene',sceneId:id,patch:{requirements:'가'.repeat(4001)}})).toThrow();
  p=applyCommand(p,{type:'updateScene',sceneId:id,patch:{requirements:''}});expect(p.scenes[0].requirements).toBe('');
 });
 it('honors an explicit per-scene kind even when the legacy automatic pool excludes it',()=>{
  let p=multiProject();const id=p.scenes[0].id;
  p=applyCommand(p,{type:'updateSceneSetup',patch:{allowedKinds:['title']}});
  p=applyCommand(p,{type:'updateScene',sceneId:id,patch:{preferredKind:'list'}});
  expect(permittedSceneKinds(p,p.scenes[0])).toEqual(['list']);expect(permittedSceneKinds(p,p.scenes[1])).toEqual(['title']);
  const value=scenePlan(id,{kind:'list',items:[{title:'첫 항목',body:''},{title:'두 번째 항목',body:''}]});
  expect(validateScenePlan(p,{scenes:[value]}).scenes[0].kind).toBe('list');
  expect(()=>validateScenePlan(p,{scenes:[scenePlan(id)]})).toThrow(/지정한 화면 유형/);
  p=applyCommand(p,{type:'updateScene',sceneId:id,patch:{preferredKind:null}});
  expect(permittedSceneKinds(p,p.scenes[0])).toEqual(['title']);expect(()=>validateScenePlan(p,{scenes:[value]})).toThrow(/허용하지 않은/);
 });
});
