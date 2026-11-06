import {describe,expect,it} from 'vitest';
import {applyCommand,createDemoProject,createProject,sceneAtFrame} from '../src/domain/project';
import {checkQuality} from '../src/domain/quality';
import {projectSchema,commandSchema} from '../src/shared/types';
import type {EditorCommand,Project} from '../src/shared/types';

function assertCoverage(project:Project) {
 let cursor=0;for(const scene of project.scenes){expect(scene.startFrame).toBe(cursor);expect(scene.durationInFrames).toBeGreaterThan(0);cursor+=scene.durationInFrames;}
 expect(cursor).toBe(project.durationInFrames);expect(projectSchema.safeParse(project).success).toBe(true);
}

describe('narration timeline invariants',()=>{
 it('ships an editable long-form example with truthful missing-narration status',()=>{
  const p=createDemoProject();assertCoverage(p);
  expect(p.durationInFrames/p.settings.fps).toBe(512);expect(p.scenes).toHaveLength(24);
  const quality=checkQuality(p);expect(quality.summary.errors).toBe(0);
  expect(quality.issues.some(i=>i.code==='NO_NARRATION'&&i.severity==='warning')).toBe(true);
 });
 it('maintains continuous frame coverage and immutable source through 200 edits of a 30-minute project',()=>{
  let project=createProject('긴 녹음',1800);const original=JSON.stringify(project);
  const source=project;
  for(let i=0;i<100;i++) {
   const candidate=project.scenes.find(s=>s.durationInFrames>2)!;
   const midpoint=candidate.startFrame+Math.floor(candidate.durationInFrames/2);
   project=applyCommand(project,{type:'splitScene',sceneId:candidate.id,atFrame:midpoint});assertCoverage(project);
   project=applyCommand(project,{type:'mergeScene',sceneId:candidate.id});assertCoverage(project);
  }
  expect(project.durationInFrames).toBe(54_000);expect(project.revision).toBe(200);expect(JSON.stringify(source)).toBe(original);
 });
 it('rejects split points outside the scene without changing project history',()=>{
  const p=createProject();const id=p.scenes[0].id;
  expect(()=>applyCommand(p,{type:'splitScene',sceneId:id,atFrame:0})).toThrow();
  expect(()=>applyCommand(p,{type:'splitScene',sceneId:id,atFrame:p.durationInFrames})).toThrow();
  expect(()=>applyCommand(p,{type:'splitScene',sceneId:id,atFrame:0.5})).toThrow();
  expect(p.revision).toBe(0);expect(p.scenes).toHaveLength(1);
 });
 it('moves a boundary without shifting narration or captions',()=>{
  let p=createProject('경계',20);p=applyCommand(p,{type:'splitScene',sceneId:p.scenes[0].id,atFrame:300});
  p=applyCommand(p,{type:'addCaption',caption:{id:'caption-fixed',text:'시간을 유지합니다.',startFrame:240,endFrame:360}});
  const updated=applyCommand(p,{type:'setBoundary',sceneId:p.scenes[0].id,endFrame:270});
  expect(updated.captions).toEqual(p.captions);expect(updated.durationInFrames).toBe(600);expect(updated.scenes[1].startFrame).toBe(270);assertCoverage(updated);
 });
 it('does not duplicate the same body when rejoining a split scene',()=>{
  let p=createProject();p.scenes[0].body='내용을 유지합니다.';
  p=applyCommand(p,{type:'splitScene',sceneId:p.scenes[0].id,atFrame:300});p=applyCommand(p,{type:'mergeScene',sceneId:p.scenes[0].id});
  expect(p.scenes[0].body).toBe('내용을 유지합니다.');
 });
 it('preserves video source continuity when splitting and merging a media scene',()=>{
  let p=createProject('영상 분할',20);
  p=applyCommand(p,{type:'addAsset',asset:{id:'video-source',name:'source.mp4',kind:'video',fileName:'source.mp4',duration:60}});
  p=applyCommand(p,{type:'updateScene',sceneId:p.scenes[0].id,patch:{template:'media',assetId:'video-source',mediaStartFrame:90}});
  const original=structuredClone(p.scenes[0]);
  p=applyCommand(p,{type:'splitScene',sceneId:p.scenes[0].id,atFrame:150});
  expect(p.scenes[0].mediaStartFrame).toBe(90);expect(p.scenes[1].mediaStartFrame).toBe(240);
  expect(p.scenes[1].mediaStartFrame+p.scenes[1].durationInFrames).toBe(original.mediaStartFrame+original.durationInFrames);
  p=applyCommand(p,{type:'mergeScene',sceneId:p.scenes[0].id});
  expect(p.scenes[0].mediaStartFrame).toBe(90);expect(p.scenes[0].durationInFrames).toBe(original.durationInFrames);assertCoverage(p);
 });
 it('keeps an unused media offset when splitting a title before attaching a video later',()=>{
  let p=createProject('나중에 영상 연결',120);
  p=applyCommand(p,{type:'splitScene',sceneId:p.scenes[0].id,atFrame:1800});
  expect(p.scenes[1].mediaStartFrame).toBe(0);
  const targetId=p.scenes[1].id;
  p=applyCommand(p,{type:'splitScene',sceneId:targetId,atFrame:2700});
  p=applyCommand(p,{type:'addAsset',asset:{id:'video-later',name:'later.mp4',kind:'video',fileName:'later.mp4',duration:30}});
  p=applyCommand(p,{type:'updateScene',sceneId:targetId,patch:{template:'media',assetId:'video-later'}});
  expect(p.scenes[1].mediaStartFrame).toBe(0);
  expect(checkQuality(p).issues.filter(issue=>issue.sceneId===targetId&&['MEDIA_START_OUTSIDE','VIDEO_TOO_SHORT'].includes(issue.code))).toHaveLength(0);
  let withUnusedOffset=createProject('기존 값 유지',120);
  withUnusedOffset=applyCommand(withUnusedOffset,{type:'updateScene',sceneId:withUnusedOffset.scenes[0].id,patch:{mediaStartFrame:90}});
  withUnusedOffset=applyCommand(withUnusedOffset,{type:'splitScene',sceneId:withUnusedOffset.scenes[0].id,atFrame:1800});
  expect(withUnusedOffset.scenes[1].mediaStartFrame).toBe(90);
 });
 it('keeps source positions continuous when moving a cut boundary',()=>{
  let p=createProject('영상 경계',20);
  p=applyCommand(p,{type:'addAsset',asset:{id:'video-continuous',name:'continuous.mp4',kind:'video',fileName:'continuous.mp4',duration:60}});
  p=applyCommand(p,{type:'updateScene',sceneId:p.scenes[0].id,patch:{template:'media',assetId:'video-continuous',mediaStartFrame:90}});
  p=applyCommand(p,{type:'splitScene',sceneId:p.scenes[0].id,atFrame:150});
  p=applyCommand(p,{type:'setBoundary',sceneId:p.scenes[0].id,endFrame:180});
  expect(p.scenes[0].mediaStartFrame).toBe(90);expect(p.scenes[1].mediaStartFrame).toBe(270);
  expect(p.scenes[1].mediaStartFrame).toBe(p.scenes[0].mediaStartFrame+p.scenes[0].durationInFrames);
  p=applyCommand(p,{type:'mergeScene',sceneId:p.scenes[0].id});expect(p.scenes[0].mediaStartFrame).toBe(90);expect(p.scenes[0].durationInFrames).toBe(600);
 });
 it('rejects expanding the next video before the beginning of its source',()=>{
  let p=createProject('원본 시작',20);
  p=applyCommand(p,{type:'addAsset',asset:{id:'video-start',name:'start.mp4',kind:'video',fileName:'start.mp4',duration:60}});
  p=applyCommand(p,{type:'splitScene',sceneId:p.scenes[0].id,atFrame:300});
  p=applyCommand(p,{type:'updateScene',sceneId:p.scenes[1].id,patch:{template:'media',assetId:'video-start',mediaStartFrame:0}});
  const before=JSON.stringify(p);
  expect(()=>applyCommand(p,{type:'setBoundary',sceneId:p.scenes[0].id,endFrame:270})).toThrow(/원본 시작/);
  expect(JSON.stringify(p)).toBe(before);
 });
 it('blocks export when extending a preceding clip past the source end',()=>{
  let p=createProject('원본 끝',20);
  p=applyCommand(p,{type:'addAsset',asset:{id:'video-end',name:'end.mp4',kind:'video',fileName:'end.mp4',duration:10}});
  p=applyCommand(p,{type:'splitScene',sceneId:p.scenes[0].id,atFrame:300});
  p=applyCommand(p,{type:'updateScene',sceneId:p.scenes[0].id,patch:{template:'media',assetId:'video-end',mediaStartFrame:0}});
  expect(checkQuality(p).issues.some(i=>i.code==='VIDEO_TOO_SHORT')).toBe(false);
  p=applyCommand(p,{type:'setBoundary',sceneId:p.scenes[0].id,endFrame:360});
  expect(checkQuality(p).issues.some(i=>i.code==='VIDEO_TOO_SHORT'&&i.severity==='error')).toBe(true);
 });
 it('finds the exact scene on either side of a frame boundary in a long project',()=>{
  const p=createDemoProject();const boundary=p.scenes[2].startFrame;
  expect(sceneAtFrame(p,boundary-1)?.id).toBe(p.scenes[1].id);expect(sceneAtFrame(p,boundary)?.id).toBe(p.scenes[2].id);
  expect(sceneAtFrame(p,p.durationInFrames)).toBeUndefined();expect(sceneAtFrame(p,-1)).toBeUndefined();
 });
});

describe('locked scene protection',()=>{
 function lockedProject(){let p=createProject('잠금',20);p=applyCommand(p,{type:'splitScene',sceneId:p.scenes[0].id,atFrame:300});return applyCommand(p,{type:'updateScene',sceneId:p.scenes[1].id,patch:{locked:true}});}
 it('protects the adjacent locked scene from merges and boundary changes',()=>{
  const p=lockedProject();const id=p.scenes[0].id;
  expect(()=>applyCommand(p,{type:'mergeScene',sceneId:id})).toThrow(/잠긴/);
  expect(()=>applyCommand(p,{type:'setBoundary',sceneId:id,endFrame:270})).toThrow(/잠긴/);
  expect(()=>applyCommand(p,{type:'regroup'})).toThrow(/잠긴/);
 });
 it('does not accept an unlock+edit bypass in the same command',()=>{
  const p=lockedProject(),id=p.scenes[1].id;
  expect(()=>applyCommand(p,{type:'updateScene',sceneId:id,patch:{locked:false,heading:'덮어쓰기'}})).toThrow(/잠긴/);
  const unlocked=applyCommand(p,{type:'updateScene',sceneId:id,patch:{locked:false}});
  expect(unlocked.scenes[1].locked).toBe(false);
 });
 it('protects subtitle edits that move into a locked scene',()=>{
  let p=lockedProject();p=applyCommand(p,{type:'addCaption',caption:{id:'caption-unlocked',text:'짧은 문장',startFrame:30,endFrame:120}});
  expect(()=>applyCommand(p,{type:'updateCaption',captionId:'caption-unlocked',patch:{endFrame:330}})).toThrow(/잠긴/);
  expect(()=>applyCommand(p,{type:'replaceCaptions',captions:[]})).toThrow(/잠긴/);
 });
});

describe('schema and narrator replacement',()=>{
 it('rejects malformed imported structures, path traversal, duplicate IDs and timeline gaps',()=>{
  const p=createProject();
  expect(projectSchema.safeParse({...p,untrusted:true}).success).toBe(false);
  expect(projectSchema.safeParse({...p,scenes:[{...p.scenes[0],startFrame:1}]}).success).toBe(false);
  expect(projectSchema.safeParse({...p,assets:[{id:'evil',name:'x',kind:'image',fileName:'../../outside.png'}]}).success).toBe(false);
  expect(projectSchema.safeParse({...p,chapters:[{id:p.scenes[0].id,title:'중복'}]}).success).toBe(false);
  expect(commandSchema.safeParse({type:'updateScene',sceneId:p.scenes[0].id,patch:{startFrame:99}}).success).toBe(false);
  expect(commandSchema.safeParse({type:'setBoundary',sceneId:p.scenes[0].id,endFrame:Infinity}).success).toBe(false);
 });
 it('keeps out-of-range captions visible to the quality gate after replacing narration',()=>{
  let p=createProject('짧은 음성',20);
  p=applyCommand(p,{type:'addCaption',caption:{id:'caption-end',text:'끝부분 문장',startFrame:450,endFrame:570}});
  p=applyCommand(p,{type:'addAsset',asset:{id:'audio-short',name:'short.wav',kind:'audio',fileName:'audio-short.wav',duration:10}});
  p=applyCommand(p,{type:'setNarration',assetId:'audio-short'});assertCoverage(p);
  expect(p.captions).toHaveLength(1);expect(checkQuality(p).issues.some(i=>i.code==='CAPTION_TIME'&&i.severity==='error')).toBe(true);
 });
 it('extends a project after a locked last scene without changing it',()=>{
  let p=createProject('더 긴 음성',10);p=applyCommand(p,{type:'updateScene',sceneId:p.scenes[0].id,patch:{locked:true}});
  p=applyCommand(p,{type:'addAsset',asset:{id:'audio-long',name:'long.wav',kind:'audio',fileName:'audio-long.wav',duration:20}});
  const before=structuredClone(p.scenes[0]);const updated=applyCommand(p,{type:'setNarration',assetId:'audio-long'});
  expect(updated.scenes[0]).toEqual(before);expect(updated.scenes).toHaveLength(2);assertCoverage(updated);
 });
 it('rejects edits containing unknown command properties',()=>{
  const p=createProject();const command={type:'updateScene',sceneId:p.scenes[0].id,patch:{heading:'안전한 제목'},arbitraryPath:'/etc/passwd'};
  expect(()=>applyCommand(p,command as EditorCommand)).toThrow(/형식/);
 });
});
