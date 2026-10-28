import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {selectComposition, renderStill, renderMedia} from '@remotion/renderer';

const root=fileURLToPath(new URL('../',import.meta.url));
const timeline=JSON.parse(fs.readFileSync(path.join(root,'content/timeline.json'),'utf8'));
const out=path.join(root,'out/work/line-fixes-v3');
fs.mkdirSync(out,{recursive:true});
const browserExecutable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const serveUrl=await bundle({entryPoint:path.join(root,'src/index.ts'),publicDir:path.join(root,'public')});
const logs=[];
const onBrowserLog=(log)=>{if(log.type==='error'||log.type==='warning')logs.push({type:log.type,text:log.text});};
const composition=await selectComposition({serveUrl,id:'CurriculumIntro',browserExecutable,onBrowserLog});
for(const id of ['approach','choice']){
  const scene=timeline.scenes.find(s=>s.id===id);
  const frameRange=[scene.from,scene.from+scene.durationInFrames-1];
  for(const amount of [.5,.84]){
    const frame=scene.from+Math.floor(scene.durationInFrames*amount);
    await renderStill({serveUrl,composition,browserExecutable,frame,output:path.join(out,`${id}-${amount}.png`),imageFormat:'png',onBrowserLog});
  }
  let milestone=-1;
  await renderMedia({serveUrl,composition,browserExecutable,frameRange,outputLocation:path.join(out,`${id}.mp4`),codec:'h264',pixelFormat:'yuv420p',crf:18,muted:true,concurrency:4,onBrowserLog,onProgress:({progress})=>{
    const current=Math.floor(progress*5);
    if(current!==milestone){milestone=current;console.log(`${id}: ${Math.round(progress*100)}%`);}
  }});
  console.log(`${id}: rendered ${scene.durationInFrames} frames (${frameRange.join('..')})`);
}
fs.writeFileSync(path.join(out,'render-log.json'),JSON.stringify({logs,scenes:['approach','choice']},null,2));
if(logs.some(log=>log.type==='error'))process.exitCode=1;
