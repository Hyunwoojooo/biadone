import type {Caption, Chapter, Project, Scene,SplitMode, Word} from '../shared/types';
import {captionSchema,idSeedSchema,wordSchema} from '../shared/types';
import {displayUnits,getSceneSetup,makeScene,newId,shortText,wrapCaption} from './helpers';
export {wrapCaption} from './helpers';

function plainText(text:string):string {
 return text
  .replace(/<\/?(?:b|i|u|s|font|c|v|lang|ruby|rt)(?=[\s.>])[^>]*>/gi,'')
  .replace(/<\d{2}:\d{2}(?::\d{2})?[.]\d{3}>/g,'')
  .split(String.fromCharCode(0)).join('').trim();
}
function requireNumber(value:unknown,name:string):number {
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>86_400)throw new Error(`${name} 시각이 올바르지 않습니다.`);
 return value;
}
function record(value:unknown):Record<string,unknown> {if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('자막 JSON 항목은 객체여야 합니다.');return value as Record<string,unknown>;}
function timestamp(value:string):number {
 const match=value.trim().match(/^(?:(\d{1,2}):)?(\d{2}):(\d{2})[,.](\d{1,3})$/);
 if(!match)throw new Error(`자막 시각을 읽을 수 없습니다: ${value.slice(0,40)}`);
 const hours=Number(match[1]??0),minutes=Number(match[2]),seconds=Number(match[3]);
 if(minutes>=60||seconds>=60)throw new Error('자막 시각의 분과 초는 60 미만이어야 합니다.');
 return hours*3600+minutes*60+seconds+Number(match[4].padEnd(3,'0'))/1000;
}
function timedCaption(text:string,start:number,end:number,fps:number,wordIds?:string[]):Caption {
 const startFrame=Math.round(start*fps),endFrame=Math.round(end*fps);
 const result=captionSchema.safeParse({id:newId('caption'),text:plainText(text),startFrame,endFrame,wordIds});
 if(!result.success||!result.data.text)throw new Error('자막의 문구나 시작·종료 시각을 확인해 주세요.');
 return result.data;
}
function wordFromRecord(value:unknown):Word {
 const row=record(value);const text=typeof row.text==='string'?row.text:row.word;
 if(typeof text!=='string')throw new Error('단어 JSON에 text 또는 word가 필요합니다.');
 const result=wordSchema.safeParse({id:newId('word'),text:text.trim(),start:requireNumber(row.start,'단어 시작'),end:requireNumber(row.end,'단어 종료'),confidence:typeof row.confidence==='number'?row.confidence:typeof row.probability==='number'?row.probability:undefined});
 if(!result.success)throw new Error(`단어 시간 정보가 올바르지 않습니다: ${result.error.issues[0]?.message??''}`);
 return result.data;
}
function joinWords(words:Word[]):string {return words.map(w=>w.text.trim()).filter(Boolean).join(' ').replace(/\s+([,.!?;:])/g,'$1');}

/** Word-based captions remain short enough for the fixed two-line subtitle safe area. */
function captionsFromWords(words:Word[],fps:number):Caption[] {
 const captions:Caption[]=[];let pending:Word[]=[];
 const flush=()=>{
  if(!pending.length)return;
  const start=pending[0].start,end=Math.max(pending.at(-1)!.end,start+1/fps);
  captions.push(timedCaption(joinWords(pending),start,end,fps,pending.map(w=>w.id)));pending=[];
 };
 for(const word of words) {
  if(!word.text)continue;
  const previous=pending.at(-1);
  const candidate=joinWords([...pending,word]);
  if(pending.length&&(displayUnits(candidate)>54||word.end-pending[0].start>5.5||(previous&&word.start-previous.end>0.7)))flush();
  pending.push(word);
  if(/[.!?。！？]$/u.test(word.text)&&pending.length>1)flush();
 }
 flush();return captions;
}

export function parseCaptions(text:string,format:'srt'|'vtt'|'json',fps:number):{captions:Caption[];words:Word[]} {
 if(!Number.isInteger(fps)||fps<1||fps>60)throw new Error('프로젝트 FPS를 확인해 주세요.');
 if(text.length>8_000_000)throw new Error('자막 파일은 8MB 이하로 가져와 주세요.');
 const source=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim();
 if(!source)throw new Error('자막 파일이 비어 있습니다.');
 let captions:Caption[]=[];let words:Word[]=[];
 if(format==='srt'||format==='vtt') {
  const body=format==='vtt'?source.replace(/^WEBVTT[^\n]*(?:\n|$)/,'').trim():source;
  const blocks=body.split(/\n\s*\n/);
  for(const block of blocks) {
   if(!block.trim()||/^(NOTE|STYLE|REGION)(?:\s|$)/.test(block))continue;
   const lines=block.split('\n');const timeIndex=lines.findIndex(line=>line.includes('-->'));
   if(timeIndex<0)throw new Error('자막 구간에서 시작·종료 시각을 찾지 못했습니다.');
   const time=lines[timeIndex].match(/^\s*(\S+)\s*-->\s*(\S+)(?:\s+.*)?$/);
   if(!time)throw new Error('자막 시간 구분은 시작 --> 종료 형식이어야 합니다.');
   captions.push(timedCaption(lines.slice(timeIndex+1).join('\n'),timestamp(time[1]),timestamp(time[2]),fps));
  }
 } else {
  let parsed:unknown;try{parsed=JSON.parse(source);}catch{throw new Error('자막 JSON 형식이 올바르지 않습니다.');}
  const container=Array.isArray(parsed)?{captions:parsed}:record(parsed);
  if(Array.isArray(container.segments)) {
   for(const value of container.segments) {
    const segment=record(value);const segmentWords=Array.isArray(segment.words)?segment.words.map(wordFromRecord).filter(w=>w.text):[];
    if(segmentWords.length) {words.push(...segmentWords);captions.push(...captionsFromWords(segmentWords,fps));}
    else {
     if(typeof segment.text!=='string')throw new Error('문장 JSON에 text가 필요합니다.');
     captions.push(timedCaption(segment.text,requireNumber(segment.start,'문장 시작'),requireNumber(segment.end,'문장 종료'),fps));
    }
   }
  } else if(Array.isArray(container.captions)) {
   captions=container.captions.map(value=>{
    const row=record(value);const candidate={...row,id:newId('caption')};
    const result=captionSchema.safeParse(candidate);if(!result.success)throw new Error(`자막 JSON 형식이 올바르지 않습니다: ${result.error.issues[0]?.message??''}`);
    const text=plainText(result.data.text);if(!text)throw new Error('비어 있는 자막 문구는 가져올 수 없습니다.');
    return {...result.data,text};
   });
   if(Array.isArray(container.words)) {
    const replacements=new Map<string,string>();
    words=container.words.map(value=>{const row=record(value);const word=wordFromRecord(row);if(typeof row.id==='string')replacements.set(row.id,word.id);return word;});
    captions=captions.map(c=>({...c,wordIds:c.wordIds?.map(id=>replacements.get(id)).filter((id):id is string=>Boolean(id))}));
   } else captions=captions.map(caption=>{const copy={...caption};delete copy.wordIds;return copy;});
  } else if(Array.isArray(container.words)) {
   words=container.words.map(wordFromRecord).filter(w=>w.text);captions=captionsFromWords(words,fps);
  } else throw new Error('JSON에 captions, segments 또는 words 배열이 필요합니다.');
 }
 if(!captions.length)throw new Error('가져올 자막 구간을 찾지 못했습니다.');
 if(captions.length>100_000||words.length>250_000)throw new Error('자막 구간이 너무 많습니다. 파일을 나누어 주세요.');
 captions.sort((a,b)=>a.startFrame-b.startFrame);words.sort((a,b)=>a.start-b.start);
 // Transcript punctuation can place two rounded cues on the same frame. Trim only
 // the previous cue boundary; do not change spoken text or audio timestamps.
 for(let i=1;i<captions.length;i++) {
  const before=captions[i-1],current=captions[i];
  if(format==='json'&&words.length&&before.endFrame>current.startFrame&&current.startFrame>before.startFrame)before.endFrame=current.startFrame;
 }
 return {captions,words};
}

function subtitleTime(frame:number,fps:number,separator:','|'.'):string {
 const total=Math.round(frame/fps*1000);const h=Math.floor(total/3_600_000),m=Math.floor(total/60_000)%60,s=Math.floor(total/1000)%60,ms=total%1000;
 return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}${separator}${ms.toString().padStart(3,'0')}`;
}
export function toSrt(project:Project):string {
 return project.captions.map((c,i)=>`${i+1}\n${subtitleTime(c.startFrame,project.settings.fps,',')} --> ${subtitleTime(c.endFrame,project.settings.fps,',')}\n${wrapCaption(c.text).join('\n')}`).join('\n\n')+(project.captions.length?'\n':'');
}
export function toVtt(project:Project):string {
 return 'WEBVTT\n\n'+project.captions.map(c=>`${subtitleTime(c.startFrame,project.settings.fps,'.')} --> ${subtitleTime(c.endFrame,project.settings.fps,'.')}\n${wrapCaption(c.text).join('\n')}`).join('\n\n')+'\n';
}

export function groupScenes(project:Project,targetSeconds?:number,splitMode?:SplitMode,idSeed?:string):{scenes:Scene[];chapters:Chapter[]} {
 if(idSeed!==undefined&&!idSeedSchema.safeParse(idSeed).success)throw new Error('장면 명령 ID는 영문·숫자·밑줄·하이픈으로 1~64자여야 합니다.');
 const setup=getSceneSetup(project);targetSeconds??=setup.targetSeconds;splitMode??=setup.splitMode;
 if(!Number.isFinite(targetSeconds)||targetSeconds<3||targetSeconds>60)throw new Error('장면 목표 길이는 3초에서 60초 사이로 설정해 주세요.');
 if(splitMode!=='fixed'&&splitMode!=='natural')throw new Error('장면 분할 방식을 다시 선택해 주세요.');
 const fps=project.settings.fps;const duration=project.durationInFrames;
 if(!Number.isInteger(fps)||fps<1||fps>60||!Number.isInteger(duration)||duration<1)throw new Error('프로젝트의 프레임 형식과 길이를 확인해 주세요.');
 const captions=project.captions.filter(c=>c.startFrame<duration&&c.endFrame>0).sort((a,b)=>a.startFrame-b.startFrame);
 const targetFrames=Math.max(1,Math.round(targetSeconds*fps)),maxFrames=Math.floor(targetFrames*1.2),minFrames=Math.ceil(targetFrames*.8);
 const sentenceEnd=(value:string)=>/(?:[.!?。！？]["'”’」』)]*|니다|다|요|죠)$/u.test(value.trim());
 const candidateMap=new Map<number,number>();
 const candidate=(frame:number,priority:number)=>{if(Number.isInteger(frame)&&frame>0&&frame<duration)candidateMap.set(frame,Math.max(candidateMap.get(frame)??0,priority));};
 if(splitMode==='natural') {
  for(const caption of captions)candidate(caption.endFrame,sentenceEnd(caption.text)?3:2);
  for(const word of project.words)candidate(Math.round(word.end*fps),sentenceEnd(word.text)?3:1);
 }
 const candidates=[...candidateMap].map(([frame,priority])=>({frame,priority})).sort((a,b)=>a.frame-b.frame);
 const boundaries=[0];let start=0;
 while(start<duration) {
  if(boundaries.length>10_000)throw new Error('장면이 너무 많습니다. 목표 장면 길이를 늘려 주세요.');
  const remaining=duration-start;
  if(remaining<=(splitMode==='natural'?maxFrames:targetFrames)){boundaries.push(duration);break;}
  let boundary=start+targetFrames;
  if(splitMode==='natural') {
   const lower=start+minFrames,upper=Math.min(duration-1,start+maxFrames);
   let low=0,high=candidates.length;
   while(low<high){const middle=(low+high)>>1;if(candidates[middle].frame<lower)low=middle+1;else high=middle;}
   let best:typeof candidates[number]|undefined;
   for(let index=low;index<candidates.length&&candidates[index].frame<=upper;index++) {
    const current=candidates[index];
    if(!best||current.priority>best.priority||(current.priority===best.priority&&Math.abs(current.frame-boundary)<Math.abs(best.frame-boundary)))best=current;
   }
   if(best)boundary=best.frame;
  }
  boundaries.push(boundary);start=boundary;
 }
 const chapters:Chapter[]=[];const scenes:Scene[]=[];const chapterBuckets=new Map<number,Chapter>();
 for(let i=0;i<boundaries.length-1;i++) {
  const from=boundaries[i],to=boundaries[i+1];const chapterIndex=Math.floor(from/(fps*120));
  let chapter=chapterBuckets.get(chapterIndex);
  if(!chapter){chapter={id:idSeed===undefined?newId('chapter'):`chapter-${idSeed}-${chapters.length}`,title:chapters.length===0?'도입':`챕터 ${chapters.length+1}`};chapters.push(chapter);chapterBuckets.set(chapterIndex,chapter);}
  const relevant=captions.filter(c=>c.startFrame<to&&c.endFrame>from);
  const heading=shortText(relevant[0]?.text??'나레이션을 이어가는 장면');
  const scene=makeScene(chapter.id,from,to-from,i===0?'title':i%4===2?'steps':'quote');
  if(idSeed!==undefined)scene.id=`scene-${idSeed}-${i}`;
  scene.motion=setup.motion;
  scene.title=heading||`장면 ${i+1}`;scene.heading=heading;scene.kicker=chapter.title;
  scene.body=shortText(relevant.slice(1).map(c=>c.text).join(' '),64);
  if(scene.template==='steps')scene.items=relevant.slice(0,3).map(c=>({title:shortText(c.text,18),body:''}));
  if(scene.template==='steps'&&scene.items.length<2)scene.template='quote';
  scene.notes=`${splitMode==='fixed'?'설정한 장면 간격':'목표 길이 ±20% 안의 문장·발화 경계(후보가 없으면 정확한 간격)'}로 구성한 원문 발췌 초안입니다. ‘…’로 끝나는 문구는 일부가 생략됐으니 전체 자막과 비교해 의미와 연출을 검수해 주세요.`;
  scenes.push(scene);
 }
 return {scenes,chapters};
}
