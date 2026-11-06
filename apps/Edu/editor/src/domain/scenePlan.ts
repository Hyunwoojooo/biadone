import type {Project,Scene,SceneKind,ScenePlan,ScenePlanScene} from '../shared/types';
import {scenePlanSchema} from '../shared/types';
import {checkQuality} from './quality';
import {getSceneSetup,kindToTemplate} from './helpers';
export {defaultSceneSetup,getSceneSetup,kindToTemplate,sceneKind,SCENE_KIND_LABELS} from './helpers';

/** A user's per-scene choice overrides the legacy automatic-selection pool. */
export function permittedSceneKinds(project:Project,scene:Scene):SceneKind[] {
 return scene.preferredKind?[scene.preferredKind]:getSceneSetup(project).allowedKinds;
}

/** Content only: generated plans cannot change time, chapter, identity or locks. */
export function sceneWithPlan(scene:Scene,value:ScenePlanScene):Scene {
 const next={...scene,template:kindToTemplate(value.kind),title:value.title,heading:value.heading,kicker:value.kicker,body:value.body,items:structuredClone(value.items),mediaStartFrame:value.mediaStartFrame,mediaFit:value.mediaFit,motion:value.motion,showCaptions:value.showCaptions,notes:value.notes};
 if(value.assetId===null)delete next.assetId;else next.assetId=value.assetId;
 return next;
}

/** Validate the entire requested scope before applying any single scene. */
export function validateScenePlan(project:Project,value:unknown,expectedSceneIds?:string[]):ScenePlan {
 const parsed=scenePlanSchema.safeParse(value);
 if(!parsed.success)throw new Error(`장면 초안 형식이 올바르지 않습니다: ${parsed.error.issues[0]?.message??'필수 항목 확인'}`);
 const plan=parsed.data;
 const requested=new Set(expectedSceneIds??[]);
 if(expectedSceneIds&&(!expectedSceneIds.length||requested.size!==expectedSceneIds.length))throw new Error('생성할 장면 범위가 비어 있거나 중복됐습니다. 장면을 다시 선택해 주세요.');
 const seen=new Set<string>();const selected=new Set<string>();
 const scenesById=new Map(project.scenes.map(scene=>[scene.id,scene]));
 for(const item of plan.scenes) {
  if(seen.has(item.sceneId))throw new Error('장면 초안에 같은 장면이 중복됐습니다. 다시 생성해 주세요.');
  seen.add(item.sceneId);
  const original=scenesById.get(item.sceneId);
  if(!original)throw new Error('장면 초안에 현재 프로젝트에 없는 장면이 있습니다. 구성을 다시 확인해 주세요.');
  if(expectedSceneIds&&!requested.has(item.sceneId))throw new Error('선택한 범위 밖의 장면이 초안에 포함됐습니다. 다시 생성해 주세요.');
  if(original.locked)throw new Error(`‘${original.title||'선택한 장면'}’은 잠겨 있어 초안을 적용할 수 없습니다. 장면 잠금을 확인해 주세요.`);
  if(original.preferredKind&&original.preferredKind!==item.kind)throw new Error('장면에 지정한 화면 유형과 초안이 다릅니다. 지정한 유형으로 다시 생성해 주세요.');
  if(!permittedSceneKinds(project,original).includes(item.kind))throw new Error('허용하지 않은 화면 유형이 초안에 있습니다. 사용할 화면 유형을 확인하거나 다시 생성해 주세요.');
  if(!item.title.trim())throw new Error('장면 초안의 제목이 비어 있습니다. 다시 생성해 주세요.');
  const media=item.kind==='image'||item.kind==='video';
  if(media) {
   const asset=project.assets.find(candidate=>candidate.id===item.assetId);
   if(!asset)throw new Error('초안에 사용한 자료를 프로젝트에서 찾을 수 없습니다. 보유 자료를 다시 선택해 주세요.');
   if(asset.kind!==item.kind)throw new Error('초안의 화면 유형과 자료 종류가 일치하지 않습니다. 이미지·영상 선택을 확인해 주세요.');
   if(item.kind==='image'&&item.mediaStartFrame!==0)throw new Error('이미지 화면의 영상 시작 위치는 0이어야 합니다. 초안을 다시 생성해 주세요.');
   if(item.kind==='video') {
    if(asset.duration===undefined||!Number.isFinite(asset.duration)||asset.duration<=0)throw new Error('원본 영상 길이를 확인할 수 없습니다. 영상 파일을 다시 가져와 주세요.');
    const availableFrames=Math.round(asset.duration*project.settings.fps);
    if(item.mediaStartFrame+original.durationInFrames>availableFrames)throw new Error('초안의 영상 구간이 원본 영상보다 깁니다. 시작 위치를 앞당기거나 충분히 긴 영상을 선택해 주세요.');
   }
  } else if(item.assetId!==null||item.mediaStartFrame!==0)throw new Error('모션그래픽 장면에는 자료 연결과 영상 시작 위치를 지정할 수 없습니다. 초안을 다시 생성해 주세요.');
  if(!['compare','steps','list','stat','flow'].includes(item.kind)&&item.items.length)throw new Error('이 화면 유형에서는 항목 목록을 사용하지 않습니다. 초안을 다시 생성해 주세요.');
  selected.add(item.sceneId);
 }
 if(expectedSceneIds&&seen.size!==requested.size)throw new Error('선택한 장면 중 초안에서 빠진 장면이 있습니다. 전체 범위를 다시 생성해 주세요.');
 const byId=new Map(plan.scenes.map(item=>[item.sceneId,item]));
 const trial={...project,scenes:project.scenes.map(scene=>{const item=byId.get(scene.id);return item?sceneWithPlan(scene,item):scene;})};
 const error=checkQuality(trial).issues.find(issue=>issue.severity==='error'&&issue.sceneId&&selected.has(issue.sceneId));
 if(error)throw new Error(`장면 초안의 화면 구성을 확인해 주세요: ${error.message}`);
 return plan;
}
