import type {Caption,EditorCommand, Project, Scene, Template} from '../shared/types';
import {commandSchema, projectSchema} from '../shared/types';
import {groupScenes} from './captions';
import {captionIntersectsScene, DEFAULT_SETTINGS, defaultItems,getSceneSetup,kindToTemplate, makeScene, newId,shortText, THEME_COLORS} from './helpers';
import {sceneWithPlan,validateScenePlan} from './scenePlan';
export {TEMPLATE_LABELS, THEME_COLORS, wrapCaption} from './helpers';

export function createProject(title='새 롱폼 프로젝트',durationSeconds=60):Project {
 if(!Number.isFinite(durationSeconds)||durationSeconds<=0||durationSeconds>86_400) throw new Error('영상 길이는 0초보다 크고 24시간 이하여야 합니다.');
 const now=new Date().toISOString(); const chapter={id:newId('chapter'),title:'도입'};
 const durationInFrames=Math.max(1,Math.round(durationSeconds*DEFAULT_SETTINGS.fps));
 return projectSchema.parse({schemaVersion:1,id:newId('project'),title:title.trim()||'새 롱폼 프로젝트',createdAt:now,updatedAt:now,revision:0,durationInFrames,settings:{...DEFAULT_SETTINGS},assets:[],words:[],captions:[],chapters:[chapter],scenes:[makeScene(chapter.id,0,durationInFrames)]});
}

export function createDemoProject():Project {
 const p=createProject('AI 도구, 내 일에 맞게 쓰는 법',512);
 p.chapters=[{id:newId('chapter'),title:'도입'},{id:newId('chapter'),title:'활용 방법'},{id:newId('chapter'),title:'실전 적용'}];
 const titles=['질문으로 시작하기','반복되는 업무','세 가지 선택 기준','실제 화면으로 확인','내 일에 적용하기','업무별로 나누기','자료를 정리하는 방법','결과를 검토하는 습관','반복 작업부터 시작하기','작은 실험의 기준','도구를 비교하는 방법','시간과 비용 살펴보기','내 기준을 만드는 법','기록을 남기는 이유','팀과 함께 쓰는 방법','주의할 점','자주 하는 실수','첫 프로젝트 정하기','과정을 기록하기','결과를 검토하기','내 작업에 맞게 다듬기','다음 작업에 재사용하기','꾸준히 개선하기','작게 시작해 보세요'];
 const sentences=['왜 늘 바쁠까요?','반복되는 업무를 아직도 직접 하고 계신가요?','중요한 것은 도구의 수가 아니라, 내 일에 맞는 기준입니다.','실제 화면으로 자세히 살펴보겠습니다.','이제 여러분의 일에 적용해 볼 차례입니다.'];
 const templates:Template[]=['title','quote','steps','compare','character','steps','quote','compare'];
 const durations=[8,10,12,14,13,...Array.from({length:18},()=>24),23];
 let cursor=0;
 p.scenes=titles.map((title,index)=>{
  const chapterId=p.chapters[index<5?0:index<17?1:2].id;
  const template=templates[index%templates.length];
  const scene=makeScene(chapterId,cursor,durations[index]*30,template);cursor+=scene.durationInFrames;
  scene.title=title;scene.heading=index===2?'내 일에 맞는 AI를 고르는 법':title;
  scene.kicker=index===2?'도구를 고르는 기준':index<5?'나의 일을 바꾸는 작은 시작':'반복할 수 있는 작업 방식';
  scene.body=index===1?'자료 정리, 일정 관리, 반복되는 문서 작성.\n자주 하는 업무부터 하나씩 살펴보세요.':index===2?'': '내가 직접 확인할 수 있는 작은 작업부터 시작합니다.';
  if(template==='steps') scene.items=[{title:'반복되는가',body:'지금 하는 일이\n반복적으로 발생하나요?'},{title:'확인 가능한가',body:'결과를 내가 직접\n확인할 수 있나요?'},{title:'계속 쓸 수 있는가',body:'지속적으로\n활용할 수 있나요?'}];
  if(template==='compare') scene.items=[{title:'직접 반복하기',body:'같은 작업을 매번\n처음부터 시작합니다.'},{title:'도구와 함께하기',body:'기준을 저장하고\n다음 작업에 재사용합니다.'}];
  scene.notes='예제 장면입니다. 나레이션을 가져오면 실제 음성에 맞춰 장면을 구성할 수 있습니다.';
  return scene;
 });
 p.captions=[];
 for(let i=0;i<p.scenes.length;i++) {
  const scene=p.scenes[i];
  const count=Math.max(1,Math.ceil(scene.durationInFrames/(30*5)));
  for(let j=0;j<count;j++) {
   const startFrame=scene.startFrame+Math.floor(j*scene.durationInFrames/count);
   const endFrame=scene.startFrame+Math.floor((j+1)*scene.durationInFrames/count);
   const text=sentences[i]??(j%2===0?`${scene.title}. 작은 작업부터 차근차근 시작합니다.`:'결과를 확인하고 내 작업 방식에 맞게 조정해 보세요.');
   p.captions.push({id:newId('caption'),text,startFrame,endFrame});
  }
 }
 return projectSchema.parse(p);
}

export function formatTime(seconds:number):string {
 const value=Math.max(0,Math.floor(Number.isFinite(seconds)?seconds:0));
 const s=String(value%60).padStart(2,'0'); const m=String(Math.floor(value/60)%60).padStart(2,'0');
 return value>=3600?`${Math.floor(value/3600)}:${m}:${s}`:`${Math.floor(value/60).toString().padStart(2,'0')}:${s}`;
}
export function sceneAtFrame(project:Project,frame:number):Scene|undefined {
 if(!Number.isFinite(frame)||frame<0||frame>=project.durationInFrames) return undefined;
 // Binary search keeps seeking inexpensive in long projects.
 let low=0,high=project.scenes.length-1;
 while(low<=high) {const mid=(low+high)>>1;const scene=project.scenes[mid];if(frame<scene.startFrame)high=mid-1;else if(frame>=scene.startFrame+scene.durationInFrames)low=mid+1;else return scene;}
 return undefined;
}

function requireScene(project:Project,id:string):Scene {
 const scene=project.scenes.find(s=>s.id===id);if(!scene) throw new Error('장면을 찾을 수 없습니다. 프로젝트를 다시 열어 주세요.');return scene;
}
function assertUnlocked(scene:Scene) {if(scene.locked) throw new Error('잠긴 장면입니다. 장면 잠금을 해제한 뒤 수정해 주세요.');}
function assertCaptionUnlocked(project:Project,start:number,end:number) {for(const scene of project.scenes)if(scene.locked&&captionIntersectsScene(start,end,scene))assertUnlocked(scene);}
function validateCaptionRange(project:Project,start:number,end:number) {if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>project.durationInFrames)throw new Error('자막 시간은 영상 범위 안에서 시작보다 끝이 뒤에 오도록 설정해 주세요.');}

/** Select source cues without changing narration; silence is split at its midpoint. */
export function getSceneCaptionRange(project:Project,firstCaptionId:string,lastCaptionId:string):{startFrame:number;endFrame:number;captions:Caption[]} {
 const captions=[...project.captions].sort((a,b)=>a.startFrame-b.startFrame||a.endFrame-b.endFrame);
 if(!captions.length)throw new Error('먼저 나레이션을 전사하거나 자막을 가져와 주세요.');
 if(new Set(captions.map(caption=>caption.id)).size!==captions.length)throw new Error('대본의 문장 식별자가 중복됐습니다. 자막을 다시 확인해 주세요.');
 for(const caption of captions)validateCaptionRange(project,caption.startFrame,caption.endFrame);
 const firstIndex=captions.findIndex(caption=>caption.id===firstCaptionId),lastIndex=captions.findIndex(caption=>caption.id===lastCaptionId);
 if(firstIndex<0||lastIndex<0)throw new Error('선택한 대본 문장을 찾을 수 없습니다. 대본을 다시 선택해 주세요.');
 if(firstIndex>lastIndex)throw new Error('대본의 시작 문장은 마지막 문장보다 앞에 있어야 합니다.');
 const selected=captions.slice(firstIndex,lastIndex+1);const first=selected[0],last=selected.at(-1)!;
 let precedingEnd=0;for(let index=0;index<firstIndex;index++)precedingEnd=Math.max(precedingEnd,captions[index].endFrame);
 const followingStart=lastIndex<captions.length-1?captions[lastIndex+1].startFrame:project.durationInFrames;
 let previousEnd=first.endFrame;
 for(const caption of selected.slice(1)) {if(caption.startFrame<previousEnd)throw new Error('선택한 대본의 문장 시간이 겹칩니다. 자막 시간을 정리한 뒤 장면을 만들어 주세요.');previousEnd=caption.endFrame;}
 if(precedingEnd>first.startFrame||followingStart<last.endFrame)throw new Error('선택한 대본과 앞뒤 문장의 시간이 겹칩니다. 자막 시간을 정리한 뒤 장면을 만들어 주세요.');
 const startFrame=firstIndex===0?0:Math.floor((precedingEnd+first.startFrame)/2);
 const endFrame=lastIndex===captions.length-1?project.durationInFrames:Math.floor((last.endFrame+followingStart)/2);
 if(endFrame<=startFrame)throw new Error('선택한 대본으로 만들 수 있는 장면 길이가 없습니다. 문장 범위를 다시 선택해 주세요.');
 return {startFrame,endFrame,captions:structuredClone(selected)};
}

/** Attach once before optimistic apply; keep this same payload in the save queue. */
export function withCommandSeed(command:EditorCommand):EditorCommand {
 switch(command.type) {
  case 'regroup':case 'splitScene':case 'addChapter':case 'addScene':case 'setNarration':return {...command,idSeed:command.idSeed??newId('command')};
  case 'replaceCaptions':return command.regroup?{...command,idSeed:command.idSeed??newId('command')}:command;
  default:return command;
 }
}

export function applyCommand(project:Project,input:EditorCommand):Project {
 const parsed=commandSchema.safeParse(input);
 if(!parsed.success) throw new Error(`편집 요청 형식이 올바르지 않습니다: ${parsed.error.issues[0]?.message??'입력값 확인'}`);
 const command=parsed.data; const next:Project=structuredClone(project);
 switch(command.type) {
  case 'updateProject': {
   if(command.patch.title!==undefined)next.title=command.patch.title.trim()||'새 롱폼 프로젝트';
   if(command.patch.settings) {
    const patch=command.patch.settings;
    if(patch.fps!==undefined&&patch.fps!==project.settings.fps)throw new Error('음성 시간 보존을 위해 프로젝트의 FPS는 변경할 수 없습니다.');
    next.settings={...next.settings,...patch};
    if(patch.theme&&patch.accent===undefined)next.settings.accent=THEME_COLORS[patch.theme].accent;
   }
   break;
  }
  case 'updateScene': {
   const scene=requireScene(next,command.sceneId);
   const keys=Object.keys(command.patch);
   if(scene.locked && !(keys.length===1&&command.patch.locked===false))assertUnlocked(scene);
   if(command.patch.chapterId&&!next.chapters.some(c=>c.id===command.patch.chapterId))throw new Error('선택한 챕터가 없습니다.');
   if(command.patch.assetId&&!next.assets.some(a=>a.id===command.patch.assetId))throw new Error('선택한 미디어가 없습니다. 먼저 파일을 가져와 주세요.');
   const {assetId,...patch}=command.patch;
   Object.assign(scene,patch);
   if(assetId===null)delete scene.assetId;else if(assetId!==undefined)scene.assetId=assetId;
   if(command.patch.template&&command.patch.items===undefined) {
    const needed=command.patch.template==='compare'?2:command.patch.template==='steps'||command.patch.template==='list'||command.patch.template==='flow'?3:command.patch.template==='stat'?1:0;
    if(needed&&scene.items.length!==needed)scene.items=defaultItems(command.patch.template);
   }
   break;
  }
  case 'splitScene': {
   const scene=requireScene(next,command.sceneId);assertUnlocked(scene);
   const end=scene.startFrame+scene.durationInFrames;
   if(command.atFrame<=scene.startFrame||command.atFrame>=end)throw new Error('나눌 위치는 장면의 시작과 끝 사이여야 합니다.');
   const sourceAsset=next.assets.find(asset=>asset.id===scene.assetId);
   const preserveVideo=scene.template==='media'&&sourceAsset?.kind==='video';
   const right={...structuredClone(scene),id:command.idSeed===undefined?newId('scene'):`scene-${command.idSeed}-0`,startFrame:command.atFrame,durationInFrames:end-command.atFrame,title:scene.title,mediaStartFrame:scene.mediaStartFrame+(preserveVideo?command.atFrame-scene.startFrame:0)};
   scene.durationInFrames=command.atFrame-scene.startFrame;
   next.scenes.splice(next.scenes.findIndex(s=>s.id===scene.id)+1,0,right);break;
  }
  case 'mergeScene': {
   const scene=requireScene(next,command.sceneId);const index=next.scenes.indexOf(scene);const other=next.scenes[index+1];
   if(!other)throw new Error('마지막 장면에는 합칠 다음 장면이 없습니다.');
   assertUnlocked(scene);assertUnlocked(other);
   const body=Array.from(new Set([scene.body,other.body].filter(Boolean))).join('\n\n');
   const notes=Array.from(new Set([scene.notes,`합친 장면: ${other.title}`,other.notes].filter(Boolean))).join('\n');
   if(body.length>4000||notes.length>10000)throw new Error('합친 장면의 문구가 너무 깁니다. 설명이나 메모를 먼저 정리해 주세요.');
   scene.durationInFrames+=other.durationInFrames;scene.body=body;scene.notes=notes;
   next.scenes.splice(index+1,1);break;
  }
  case 'setBoundary': {
   const scene=requireScene(next,command.sceneId);const index=next.scenes.indexOf(scene);const other=next.scenes[index+1];
   if(!other)throw new Error('마지막 장면의 끝은 나레이션 길이로 고정됩니다.');
   assertUnlocked(scene);assertUnlocked(other);const end=other.startFrame+other.durationInFrames;
   if(command.endFrame<=scene.startFrame||command.endFrame>=end)throw new Error('두 장면이 각각 1프레임 이상 남도록 경계를 설정해 주세요.');
   const nextAsset=next.assets.find(asset=>asset.id===other.assetId);
   const preserveVideo=other.template==='media'&&nextAsset?.kind==='video';
   const mediaOffset=other.mediaStartFrame+command.endFrame-other.startFrame;
   if(preserveVideo&&mediaOffset<0)throw new Error('다음 영상의 원본 시작보다 앞까지 늘릴 수 없습니다. 경계를 뒤로 옮기거나 다음 영상의 시작 위치를 먼저 조정해 주세요.');
   if(preserveVideo)other.mediaStartFrame=mediaOffset;
   scene.durationInFrames=command.endFrame-scene.startFrame;other.startFrame=command.endFrame;other.durationInFrames=end-command.endFrame;break;
  }
  case 'updateCaption': {
   const caption=next.captions.find(c=>c.id===command.captionId);if(!caption)throw new Error('자막을 찾을 수 없습니다.');
   assertCaptionUnlocked(next,caption.startFrame,caption.endFrame);
   const value={...caption,...command.patch};validateCaptionRange(next,value.startFrame,value.endFrame);assertCaptionUnlocked(next,value.startFrame,value.endFrame);
   Object.assign(caption,command.patch);next.captions.sort((a,b)=>a.startFrame-b.startFrame);break;
  }
  case 'addCaption': {
   validateCaptionRange(next,command.caption.startFrame,command.caption.endFrame);assertCaptionUnlocked(next,command.caption.startFrame,command.caption.endFrame);
   next.captions.push(command.caption);next.captions.sort((a,b)=>a.startFrame-b.startFrame);break;
  }
  case 'removeCaption': {
   const caption=next.captions.find(c=>c.id===command.captionId);if(!caption)throw new Error('자막을 찾을 수 없습니다.');assertCaptionUnlocked(next,caption.startFrame,caption.endFrame);
   next.captions=next.captions.filter(c=>c.id!==command.captionId);break;
  }
  case 'replaceCaptions': {
   if(next.scenes.some(s=>s.locked))throw new Error('잠긴 장면이 있어 자막을 전체 교체할 수 없습니다. 먼저 잠금을 해제해 주세요.');
   for(const caption of command.captions)validateCaptionRange(next,caption.startFrame,caption.endFrame);
   next.captions=[...command.captions].sort((a,b)=>a.startFrame-b.startFrame);next.words=command.words??[];
   if(command.regroup)Object.assign(next,groupScenes(next,undefined,undefined,command.idSeed));break;
  }
  case 'regroup': {
   if(next.scenes.some(s=>s.locked))throw new Error('잠긴 장면이 있어 전체 구성을 바꿀 수 없습니다. 먼저 잠금을 해제해 주세요.');
   const setup=getSceneSetup(next);next.sceneSetup={...setup,targetSeconds:command.targetSeconds??setup.targetSeconds,splitMode:command.splitMode??setup.splitMode};
   Object.assign(next,groupScenes(next,next.sceneSetup.targetSeconds,next.sceneSetup.splitMode,command.idSeed));break;
  }
  case 'updateSceneSetup':next.sceneSetup={...getSceneSetup(next),...command.patch};break;
  case 'applyScenePlan': {
   const plan=validateScenePlan(next,command.plan,command.sceneIds);const byId=new Map(plan.scenes.map(value=>[value.sceneId,value]));
   next.scenes=next.scenes.map(scene=>{const value=byId.get(scene.id);return value?sceneWithPlan(scene,value):scene;});break;
  }
  case 'updateChapter': {
   const chapter=next.chapters.find(c=>c.id===command.chapterId);if(!chapter)throw new Error('챕터를 찾을 수 없습니다.');chapter.title=command.title.trim()||'새 챕터';break;
  }
  case 'addChapter':next.chapters.push({id:command.idSeed===undefined?newId('chapter'):`chapter-${command.idSeed}-0`,title:command.title.trim()||'새 챕터'});break;
  case 'addScene': {
   if(!next.chapters.some(chapter=>chapter.id===command.chapterId))throw new Error('장면을 추가할 챕터를 찾을 수 없습니다. 챕터를 다시 선택해 주세요.');
   const range=getSceneCaptionRange(next,command.firstCaptionId,command.lastCaptionId);
   for(const scene of next.scenes)if(captionIntersectsScene(range.startFrame,range.endFrame,scene))assertUnlocked(scene);
   const created=makeScene(command.chapterId,range.startFrame,range.endFrame-range.startFrame,command.preferredKind?kindToTemplate(command.preferredKind):'title');
   if(command.idSeed!==undefined)created.id=`scene-${command.idSeed}-0`;
   const firstLine=range.captions[0].text.split(/\r?\n/).find(line=>line.trim())??range.captions[0].text;
   created.title=shortText(firstLine,28)||'새 장면';created.heading=created.title;
   created.body=shortText(range.captions.slice(1).map(caption=>caption.text).join(' '),60);
   created.motion=getSceneSetup(next).motion;
   if(command.preferredKind!==undefined)created.preferredKind=command.preferredKind;
   if(command.requirements!==undefined)created.requirements=command.requirements;
   created.notes='선택한 대본 구간으로 만든 원문 발췌 초안입니다. 화면 유형과 필수 요구를 정한 뒤 장면을 생성해 주세요.';
   const scenes:Scene[]=[];let inserted=false;
   for(const scene of next.scenes) {
    const end=scene.startFrame+scene.durationInFrames;
    if(end<=range.startFrame||scene.startFrame>=range.endFrame){scenes.push(scene);continue;}
    const hasLeft=scene.startFrame<range.startFrame,hasRight=end>range.endFrame;
    if(hasLeft)scenes.push({...scene,durationInFrames:range.startFrame-scene.startFrame});
    if(!inserted){scenes.push(created);inserted=true;}
    if(hasRight) {
     const right={...structuredClone(scene),startFrame:range.endFrame,durationInFrames:end-range.endFrame};
     if(hasLeft)right.id=command.idSeed===undefined?newId('scene'):`scene-${command.idSeed}-1`;
     const asset=next.assets.find(candidate=>candidate.id===scene.assetId);
     if(scene.template==='media'&&asset?.kind==='video')right.mediaStartFrame=scene.mediaStartFrame+(range.endFrame-scene.startFrame);
     scenes.push(right);
    }
   }
   next.scenes=scenes;break;
  }
  case 'addAsset': {
   if(next.assets.some(a=>a.id===command.asset.id))throw new Error('이미 등록된 미디어입니다.');next.assets.push(command.asset);break;
  }
  case 'setNarration': {
   const asset=next.assets.find(a=>a.id===command.assetId);
   if(!asset||asset.kind!=='audio'||!asset.duration||asset.duration<=0)throw new Error('길이를 확인할 수 있는 음성 파일을 선택해 주세요.');
   const duration=Math.max(1,Math.round(asset.duration*next.settings.fps));
   if(duration<next.durationInFrames&&next.scenes.some(s=>s.locked&&s.startFrame+s.durationInFrames>duration))throw new Error('짧은 음성을 적용하면 잠긴 장면이 잘립니다. 해당 장면의 잠금을 먼저 해제해 주세요.');
   if(duration<next.durationInFrames) {
    next.scenes=next.scenes.filter(s=>s.startFrame<duration);
    const last=next.scenes.at(-1);if(last)last.durationInFrames=duration-last.startFrame;
   } else if(duration>next.durationInFrames) {
    const last=next.scenes.at(-1)!;
    if(last.locked){const added=makeScene(last.chapterId,next.durationInFrames,duration-next.durationInFrames,'quote');if(command.idSeed!==undefined)added.id=`scene-${command.idSeed}-0`;next.scenes.push(added);}
    else last.durationInFrames+=duration-next.durationInFrames;
   }
   next.durationInFrames=duration;next.audioAssetId=asset.id;break;
  }
 }
 next.revision=project.revision+1;next.updatedAt=new Date().toISOString();
 const checked=projectSchema.safeParse(next);
 if(!checked.success)throw new Error(`편집 결과를 저장할 수 없습니다: ${checked.error.issues[0]?.message??'프로젝트 형식 확인'}`);
 return checked.data;
}
