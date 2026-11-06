import type {Project, QualityIssue, QualityReport, Scene} from '../shared/types';
import {displayUnits,wrapCaption} from './helpers';
import {fitVideoText,motionGraphicLayout,sceneTextLayout,videoPalette} from '../video/layout';

function luminance(hex:string):number {
 const parts=[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)/255).map(channel=>channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4);
 return parts[0]*.2126+parts[1]*.7152+parts[2]*.0722;
}

export function checkQuality(project:Project):QualityReport {
 const issues:QualityIssue[]=[];
 const add=(severity:QualityIssue['severity'],code:string,message:string,ref?:{sceneId?:string;captionId?:string})=>issues.push({id:`${code}-${ref?.sceneId??ref?.captionId??'project'}-${issues.length}`,severity,code,message,...ref});
 const fps=project.settings.fps; const duration=project.durationInFrames;
 if(project.settings.width!==1920||project.settings.height!==1080||fps!==30)add('error','PROJECT_FORMAT','롱폼 기본 출력은 1920 × 1080, 30fps입니다. 프로젝트 형식을 확인해 주세요.');
 const palette=videoPalette(project.settings.theme,project.settings.accent);
 const a=luminance(palette.accent),b=luminance(palette.surface),contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
 if(contrast<2.5)add('error','ACCENT_CONTRAST','강조색이 배경과 구분되지 않습니다. 더 진하거나 밝은 색을 선택해 주세요.');
 if(project.settings.showCaptions&&project.settings.subtitleSize<34)add('warning','SMALL_SUBTITLES','자막이 작아 작은 화면에서 읽기 어려울 수 있습니다. 미리보기를 확인해 주세요.');
 if(!Number.isInteger(duration)||duration<=0)add('error','PROJECT_DURATION','프로젝트 길이가 올바르지 않습니다.');
 if(!project.scenes.length)add('error','NO_SCENES','출력할 장면이 없습니다.');
 const chapterIds=new Set(project.chapters.map(c=>c.id));
 const assetIds=new Set(project.assets.map(a=>a.id));
 const wordIds=new Set(project.words.map(w=>w.id));
 const allIds=new Set<string>();
 for(const list of [project.assets,project.scenes,project.captions,project.chapters,project.words])for(const entry of list){if(allIds.has(entry.id))add('error','DUPLICATE_ID',`중복된 항목 ID가 있습니다: ${entry.id}`);allIds.add(entry.id);}
 let cursor=0;
 const checkLength=(scene:Scene,value:string,max:number,field:string)=>{
  const units=displayUnits(value);
  if(units>max)add('error','TEXT_OVERFLOW',`${field}가 화면에 들어가기에는 깁니다. 문구를 줄이거나 장면을 나눠 주세요.`,{sceneId:scene.id});
  else if(units>max*.86)add('warning','TEXT_DENSE',`${field}가 길어 읽기 어려울 수 있습니다. 미리보기를 확인해 주세요.`,{sceneId:scene.id});
 };
 const checkFit=(scene:Scene,value:string,width:number,size:number,maxLines:number,minimum:number,field:string)=>{
  const fit=fitVideoText(value,width,size,maxLines,minimum);
  if(fit.lines.length>maxLines)add('error','TEXT_LINE_OVERFLOW',`${field}가 화면의 줄 수를 넘습니다. 줄바꿈이나 문구를 줄여 주세요.`,{sceneId:scene.id});
  return fit;
 };
 for(const scene of project.scenes) {
  const ref={sceneId:scene.id};
  if(!Number.isInteger(scene.startFrame)||!Number.isInteger(scene.durationInFrames)||scene.durationInFrames<=0)add('error','SCENE_TIME','장면 시작과 길이는 유효한 프레임이어야 합니다.',ref);
  if(scene.startFrame!==cursor)add('error',scene.startFrame<cursor?'SCENE_OVERLAP':'SCENE_GAP',scene.startFrame<cursor?'장면 시간이 겹칩니다.':'장면 사이에 빈 구간이 있습니다.',ref);
  cursor=scene.startFrame+scene.durationInFrames;
  if(cursor>duration)add('error','SCENE_OUTSIDE','장면이 프로젝트 끝을 넘어갑니다.',ref);
  if(!chapterIds.has(scene.chapterId))add('error','MISSING_CHAPTER','장면에 연결된 챕터가 없습니다.',ref);
  const seconds=scene.durationInFrames/fps;
  if(seconds<.75)add('warning','SCENE_TOO_SHORT','장면이 0.75초보다 짧아 내용을 읽기 어렵습니다.',ref);
  if(seconds>35)add('warning','SCENE_TOO_LONG','같은 화면이 35초 넘게 유지됩니다. 필요한 경우 장면을 나눠 주세요.',ref);
  if(scene.template!=='media'&&!scene.heading.trim())add('error','EMPTY_HEADING','이 장면에 표시할 핵심 문구를 입력해 주세요.',ref);
  checkLength(scene,scene.heading,scene.template==='title'?54:48,'핵심 문구');
  checkLength(scene,scene.kicker,42,'보조 제목');
  const topicWidth=scene.template==='title'?1592:scene.template==='quote'?1568:scene.template==='character'?1040:scene.template==='media'?1380:1688;
  checkFit(scene,scene.kicker,topicWidth,scene.template==='media'?25:32,1,scene.template==='media'?25:26,'보조 제목');
  if(scene.template==='title') {checkLength(scene,scene.body,126,'설명 문구');checkFit(scene,scene.heading,1592,116,3,56,'핵심 문구');checkFit(scene,scene.body,1450,40,3,34,'설명 문구');}
  if(scene.template==='quote') {checkLength(scene,scene.body,84,'설명 문구');checkFit(scene,scene.heading,1568,92,4,48,'핵심 문구');checkFit(scene,scene.body,1500,36,2,34,'설명 문구');}
  if(scene.template==='character') {checkLength(scene,scene.body,100,'설명 문구');checkFit(scene,scene.heading,1040,92,4,44,'핵심 문구');checkFit(scene,scene.body,990,36,4,28,'설명 문구');}
  if(scene.template==='steps'||scene.template==='compare')checkFit(scene,scene.heading,1688,78,2,48,'핵심 문구');
  if(scene.template==='media')checkFit(scene,scene.heading,1380,52,2,36,'핵심 문구');
  const textLayout=sceneTextLayout(scene);
  if(textLayout&&!textLayout.fits)add('error','TEXT_LAYOUT_OVERFLOW','제목과 설명을 함께 배치하면 안전 영역을 넘습니다. 문구나 줄바꿈을 줄이거나 장면을 나눠 주세요.',ref);
  const graphicLayout=motionGraphicLayout(scene);
  if(graphicLayout&&!graphicLayout.fits) {
   const first=graphicLayout.issues[0];
   const message=first==='item-count'?`${scene.template==='list'?'체크리스트에는 2~5개':scene.template==='stat'?'수치 강조에는 1~3개':'흐름도에는 2~4개'} 항목이 필요합니다.`:first?.endsWith('empty-title')?'항목의 문구가 비어 있습니다. 표시할 문구를 입력해 주세요.':first?.includes('length')?'항목이나 설명 문구가 깁니다. 핵심 문구만 남기거나 장면을 나눠 주세요.':'모션그래픽의 문구가 화면 안전 영역을 넘습니다. 문구나 줄바꿈을 줄여 주세요.';
   add('error','MOTION_GRAPHIC_LAYOUT',message,ref);
  }
  if(scene.template==='steps'||scene.template==='compare') {
   const min=2,max=scene.template==='compare'?2:4;
   if(scene.items.length<min||scene.items.length>max)add('error','ITEM_COUNT',scene.template==='compare'?'비교 화면에는 항목이 정확히 2개 필요합니다.':'단계 화면에는 항목이 2~4개 필요합니다.',ref);
   for(const item of scene.items) {
    if(!item.title.trim())add('error','EMPTY_ITEM','항목 이름을 입력해 주세요.',ref);
    checkLength(scene,item.title,scene.template==='steps'?20:24,'항목 이름');
    checkLength(scene,item.body,scene.template==='steps'?48:64,'항목 설명');
    if(scene.template==='steps') {
     const count=Math.max(1,Math.min(4,scene.items.length)),width=(1688-(count-1)*34)/count-60;
     checkFit(scene,item.title,width,count>3?36:44,2,28,'항목 이름');checkFit(scene,item.body,width,28,3,24,'항목 설명');
    } else {checkFit(scene,item.title,686,54,2,36,'항목 이름');checkFit(scene,item.body,686,30,3,26,'항목 설명');}
   }
  }
  const asset=scene.assetId?project.assets.find(a=>a.id===scene.assetId):undefined;
  if(scene.template==='media') {
   if(!asset)add('error','MISSING_MEDIA','이미지 또는 영상 파일을 선택해 주세요.',ref);
   else if(asset.kind==='audio')add('error','WRONG_MEDIA_TYPE','장면 화면에는 이미지나 영상 파일이 필요합니다.',ref);
  }
  if(scene.assetId&&!assetIds.has(scene.assetId))add('error','MISSING_ASSET','장면에 연결된 미디어를 찾을 수 없습니다.',ref);
  if(asset?.kind==='video'&&asset.duration!==undefined) {
   if(scene.mediaStartFrame>=asset.duration*fps)add('error','MEDIA_START_OUTSIDE','영상 시작 위치가 원본 영상 끝을 넘어갑니다.',ref);
   else if(scene.mediaStartFrame+scene.durationInFrames>asset.duration*fps+1)add('error','VIDEO_TOO_SHORT','장면 끝이 원본 영상 길이를 넘습니다. 영상 시작 위치를 앞당기거나 장면 길이를 줄여 주세요.',ref);
  }
  if(scene.template==='media'&&asset?.kind==='video'&&asset.duration===undefined)add('error','VIDEO_DURATION','원본 영상 길이를 확인할 수 없습니다. 영상 파일을 다시 가져와 주세요.',ref);
 }
 if(project.scenes.length&&cursor!==duration)add('error','SCENE_END','마지막 장면의 끝과 프로젝트 길이가 다릅니다.');
 const audio=project.audioAssetId?project.assets.find(a=>a.id===project.audioAssetId):undefined;
 if(!project.audioAssetId)add('warning','NO_NARRATION','나레이션이 없습니다. 현재 프로젝트는 무음으로 출력됩니다.');
 else if(!audio||audio.kind!=='audio')add('error','MISSING_NARRATION','연결된 나레이션 파일을 찾을 수 없습니다.');
 else if(audio.duration===undefined)add('error','NARRATION_DURATION','나레이션 길이를 확인할 수 없습니다.');
 else if(Math.abs(Math.round(audio.duration*fps)-duration)>1)add('error','NARRATION_LENGTH','나레이션과 프로젝트 길이가 일치하지 않습니다. 음성을 다시 적용해 주세요.');
 if(project.settings.showCaptions&&!project.captions.length)add('warning','NO_CAPTIONS','표시할 자막이 없습니다. 로컬 전사를 실행하거나 자막을 가져와 주세요.');
 const captions=[...project.captions].sort((a,b)=>a.startFrame-b.startFrame);
 const maxLineUnits=Math.floor(1600/project.settings.subtitleSize);let previousEnd=0;
 for(let index=0;index<captions.length;index++) {
  const caption=captions[index];const ref={captionId:caption.id};
  if(!Number.isInteger(caption.startFrame)||!Number.isInteger(caption.endFrame)||caption.startFrame<0||caption.endFrame<=caption.startFrame||caption.endFrame>duration)add('error','CAPTION_TIME','자막 시각이 영상 범위를 벗어나거나 시작·끝이 올바르지 않습니다.',ref);
  if(index&&caption.startFrame<previousEnd)add('error','CAPTION_OVERLAP','자막 시간이 겹쳐 두 문장이 동시에 표시됩니다.',ref);
  if(index&&caption.startFrame-previousEnd>fps*15&&audio)add('warning','CAPTION_GAP','15초 넘게 자막이 없는 구간이 있습니다. 실제 무음인지 확인해 주세요.',ref);
  previousEnd=Math.max(previousEnd,caption.endFrame);
  if(!caption.text.trim())add('warning','EMPTY_CAPTION','비어 있는 자막이 있습니다.',ref);
  if(caption.wordIds?.some(id=>!wordIds.has(id)))add('warning','MISSING_WORD_REFERENCE','자막의 단어 연결이 일부 없습니다. 시간을 확인해 주세요.',ref);
  if(project.settings.showCaptions) {
   const lines=wrapCaption(caption.text,maxLineUnits,2);
   if(lines.some(line=>displayUnits(line)>maxLineUnits+.5))add('error','CAPTION_OVERFLOW','자막이 안전 영역의 두 줄을 넘습니다. 문장을 나누거나 글자 크기를 줄여 주세요.',ref);
   const seconds=(caption.endFrame-caption.startFrame)/fps;
   const rate=displayUnits(caption.text)/Math.max(seconds,1/fps);
   if(rate>22)add('error','CAPTION_UNREADABLE','자막 표시 시간이 너무 짧습니다. 문구나 시간을 조정해 주세요.',ref);
   else if(rate>12)add('warning','CAPTION_FAST','자막이 빠르게 지나갑니다. 재생하며 읽기 쉬운지 확인해 주세요.',ref);
  }
 }
 if(audio&&captions.length&&captions[0].startFrame>fps*15)add('warning','CAPTION_LEAD_GAP','영상 시작 후 15초 넘게 자막이 없습니다. 도입부의 실제 무음인지 확인해 주세요.',{captionId:captions[0].id});
 if(audio&&captions.length&&duration-previousEnd>fps*15)add('warning','CAPTION_TRAIL_GAP','영상 끝부분에 15초 넘게 자막이 없습니다. 마무리 구간을 확인해 주세요.',{captionId:captions.at(-1)!.id});
 for(const word of project.words) {
  if(!Number.isFinite(word.start)||!Number.isFinite(word.end)||word.start<0||word.end<word.start||word.end>duration/fps+.1){add('error','WORD_TIME','단어 시간 정보가 나레이션 범위를 벗어납니다.');break;}
 }
 const errors=issues.filter(i=>i.severity==='error').length,warnings=issues.filter(i=>i.severity==='warning').length;
 return {ok:errors===0,issues,checkedAt:new Date().toISOString(),summary:{scenes:project.scenes.length,captions:project.captions.length,durationSeconds:duration/fps,errors,warnings}};
}
