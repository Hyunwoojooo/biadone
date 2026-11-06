import type {Asset,Project,ProjectSettings, Scene,SceneKind,SceneSetup, Template, ThemeId} from '../shared/types';

export function newId(prefix='id'):string {
 const random=globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
 return `${prefix}-${random}`;
}
export const THEME_COLORS:Record<ThemeId,{background:string;text:string;accent:string;muted:string;surface:string}>={
 sage:{background:'#f7fbf9',text:'#182d29',accent:'#15856d',muted:'#65766e',surface:'#ffffff'},
 ink:{background:'#142322',text:'#f5faf7',accent:'#6fe3bd',muted:'#a8bdb4',surface:'#203633'},
 sand:{background:'#faf6ee',text:'#352c22',accent:'#aa6d3e',muted:'#7c7062',surface:'#fffdf8'},
};
export const DEFAULT_SETTINGS:ProjectSettings={width:1920,height:1080,fps:30,theme:'sage',accent:'#15856d',subtitleSize:44,subtitleBackground:true,showCaptions:true,audioGainDb:0,normalizeAudio:true};
export const TEMPLATE_LABELS:Record<Template,string>={title:'핵심 문구',quote:'설명',compare:'비교',steps:'단계',media:'이미지 · 영상',character:'캐릭터',list:'체크리스트',stat:'수치 강조',flow:'흐름도'};
export const SCENE_KIND_LABELS:Record<SceneKind,string>={title:'핵심 문구',quote:'설명',compare:'비교',steps:'단계',character:'캐릭터',list:'체크리스트',stat:'수치 강조',flow:'흐름도',image:'이미지',video:'영상'};
export const defaultSceneSetup:SceneSetup={targetSeconds:8,splitMode:'fixed',allowedKinds:['title','quote','compare','steps','list','stat','flow','character','image','video'],motion:'standard',instructions:''};
export function getSceneSetup(project:Pick<Project,'sceneSetup'>):SceneSetup {return structuredClone(project.sceneSetup??defaultSceneSetup);}
export function kindToTemplate(kind:SceneKind):Template {return kind==='image'||kind==='video'?'media':kind;}
export function sceneKind(scene:Scene,assets:Asset[]):SceneKind|undefined {
 if(scene.template!=='media')return scene.template;
 const asset=assets.find(value=>value.id===scene.assetId);
 return asset?.kind==='image'||asset?.kind==='video'?asset.kind:undefined;
}

export function makeScene(chapterId:string,startFrame:number,durationInFrames:number,template:Template='title'):Scene {
 return {id:newId('scene'),title:'새 장면',chapterId,startFrame,durationInFrames,template,heading:'새로운 이야기를 시작하세요',kicker:'',body:'',items:defaultItems(template),mediaStartFrame:0,mediaFit:'contain',locked:false,showCaptions:true,motion:'standard',notes:''};
}
export function defaultItems(template:Template) {
 const titles=template==='compare'?['첫 번째 방법','두 번째 방법']:template==='list'?['첫 번째 항목','두 번째 항목','세 번째 항목']:template==='stat'?['수치']:template==='flow'?['준비','실행','확인']:['첫 번째 기준','두 번째 기준','세 번째 기준'];
 return (['compare','steps','list','stat','flow'] as Template[]).includes(template)?titles.map(title=>({title,body:''})):[];
}
export function captionIntersectsScene(start:number,end:number,scene:Scene):boolean {
 return start<scene.startFrame+scene.durationInFrames && end>scene.startFrame;
}
/** CJK glyphs take approximately twice the width of Latin glyphs. */
export function displayUnits(value:string):number {
 return Array.from(value).reduce((sum,char)=>sum+(/[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff]/u.test(char)?1:/\s/u.test(char)?0.3:0.55),0);
}

/** Plain source excerpt: keep whole words when possible and mark omitted text. */
export function shortText(text:string,max=28):string {
 const source=text.replace(/\s+/g,' ').trim();
 if(!source||max<=0||Number.isNaN(max))return '';
 if(displayUnits(source)<=max)return source;
 const ellipsis='…',budget=max-displayUnits(ellipsis);
 if(budget<0)return '';
 const words=source.split(' ');let result='';
 for(const word of words) {
  const candidate=result?`${result} ${word}`:word;
  if(displayUnits(candidate)>budget)break;
  result=candidate;
 }
 // Only a first word longer than the entire budget may be cut inside a word.
 if(!result)for(const char of words[0]){if(displayUnits(result+char)>budget)break;result+=char;}
 return result.trimEnd()+ellipsis;
}

/** Stable line wrapping for both preview and export, including unspaced Korean. */
export function wrapCaption(value:string,maxUnits=36,maxLines=2):string[] {
 const source=value.replace(/\r/g,'').trim();
 if(!source) return [];
 const lines:string[]=[];
 for(const paragraph of source.split('\n')) {
  let line='';
  for(const token of paragraph.split(/(\s+)/u)) {
   if(!token) continue;
   if(displayUnits(line+token)<=maxUnits) {line+=token;continue;}
   if(line.trim()) {lines.push(line.trim());line='';}
   let remainder=token.trimStart();
   while(displayUnits(remainder)>maxUnits) {
    let portion=''; let length=0;
    for(const char of remainder) {if(displayUnits(portion+char)>maxUnits) break;portion+=char;length+=char.length;}
    if(!portion) break;
    lines.push(portion);remainder=remainder.slice(length);
   }
   line=remainder;
  }
  if(line.trim()) lines.push(line.trim());
 }
 // Keep overflow visible for preflight/DOM checks; never silently truncate words.
 if(lines.length<=maxLines) return lines;
 return [...lines.slice(0,maxLines-1),lines.slice(maxLines-1).join(' ')];
}
