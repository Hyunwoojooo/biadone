import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const original=JSON.parse(fs.readFileSync(path.join(root,'content/timeline.json'),'utf8'));
const production=JSON.parse(fs.readFileSync(path.join(root,'content/voice-juhyunwoo-production.json'),'utf8'));
if(production.voice_id!=='OPFjzL0JpsgltRkDljyO')throw new Error('Unexpected voice production');
const ffprobe=path.join(root,'node_modules/@remotion/compositor-darwin-arm64/ffprobe');
const fps=30,leadFrames=8,tailFrames=20;
let cursor=0;
const scenes=original.scenes.map(scene=>{
  const clip=production.scenes.find(item=>item.id===scene.id&&item.status==='complete');
  if(!clip)throw new Error(`Missing completed voice clip ${scene.id}`);
  const raw=JSON.parse(fs.readFileSync(path.join(root,'public',clip.alignment),'utf8'));
  if(raw.alignment.characters.join('')!==scene.narration)throw new Error(`${scene.id}: alignment differs`);
  const info=JSON.parse(execFileSync(ffprobe,['-v','error','-show_entries','format=duration','-of','json',path.join(root,'public',clip.audio)],{encoding:'utf8',env:{...process.env,DYLD_LIBRARY_PATH:path.dirname(ffprobe)}}));
  const durationSeconds=Number(info.format.duration);
  const audioFrames=Math.ceil(durationSeconds*fps);
  const durationInFrames=Math.max(300,audioFrames+leadFrames+tailFrames);
  const result={id:scene.id,audio:clip.audio,alignment:clip.alignment,narration:scene.narration,from:cursor,audioFrames,durationSeconds,durationInFrames};
  cursor+=durationInFrames;return result;
});
const timeline={fps,leadFrames,tailFrames,totalFrames:cursor,durationSeconds:cursor/fps,voice_id:production.voice_id,voice_name:production.voice_name,scenes};
fs.writeFileSync(path.join(root,'content/timeline-juhyunwoo.json'),JSON.stringify(timeline,null,2)+'\n');
const rows=scenes.map(s=>`  ${JSON.stringify(s.id)}: {from:${s.from}, durationInFrames:${s.durationInFrames}, audio:${JSON.stringify(s.audio)}},`);
fs.writeFileSync(path.join(root,'src/curriculum/juhyunwoo-timing.ts'),`// Generated from the measured private-voice clips. Original timing is untouched.\nimport {SCENES} from './scenes';\nimport type {SceneId} from './types';\nimport type {TimelineEntry} from './timing';\nconst CLIPS: Record<SceneId,{from:number;durationInFrames:number;audio:string}>={\n${rows.join('\n')}\n};\nexport const JUHYUNWOO_TIMELINE:TimelineEntry[]=SCENES.map(scene=>({scene,...CLIPS[scene.id]}));\nexport const JUHYUNWOO_TOTAL_FRAMES=${cursor};\n`);
const stamp=seconds=>{const n=Math.max(0,Math.round(seconds*1000));return `${String(Math.floor(n/3600000)).padStart(2,'0')}:${String(Math.floor(n/60000)%60).padStart(2,'0')}:${String(Math.floor(n/1000)%60).padStart(2,'0')},${String(n%1000).padStart(3,'0')}`;};
const captions=[];
for(const clip of scenes){
  const alignment=JSON.parse(fs.readFileSync(path.join(root,'public',clip.alignment),'utf8')).alignment;
  let start=0;
  for(let i=0;i<alignment.characters.length;i++){
    const char=alignment.characters[i],size=i-start+1;
    if((/[.!?]/.test(char)&&size>=8)||(size>=27&&/[ ,]/.test(char))||size>=38||i===alignment.characters.length-1){
      const text=alignment.characters.slice(start,i+1).join('').trim();
      if(text)captions.push({start:(clip.from+leadFrames)/fps+alignment.character_start_times_seconds[start],end:(clip.from+leadFrames)/fps+alignment.character_end_times_seconds[i],text});
      start=i+1;
    }
  }
}
fs.writeFileSync(path.join(root,'out/BiaDone-Edu-Curriculum-v5-Juhyunwoo.ko.srt'),captions.map((c,i)=>`${i+1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n'));
console.log(JSON.stringify({voice:production.voice_name,scenes:scenes.length,totalFrames:cursor,durationSeconds:cursor/fps,captionCues:captions.length,sceneSeconds:scenes.map(s=>({id:s.id,seconds:s.durationInFrames/fps}))},null,2));
