import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {selectComposition,renderStill,renderMedia} from '@remotion/renderer';

const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.join(root,'out/work/cutout-voice-v5');
fs.mkdirSync(out,{recursive:true});
const original=JSON.parse(fs.readFileSync(path.join(root,'content/timeline.json'),'utf8'));
const own=JSON.parse(fs.readFileSync(path.join(root,'content/timeline-juhyunwoo.json'),'utf8'));
const browserExecutable=process.env.REMOTION_BROWSER_EXECUTABLE??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const serveUrl=await bundle({entryPoint:path.join(root,'src/index.ts'),publicDir:path.join(root,'public')});
const logs=[];
const onBrowserLog=log=>{if(log.type==='error'||log.type==='warning')logs.push({type:log.type,text:log.text});};
const june=await selectComposition({serveUrl,id:'CurriculumClean',browserExecutable,onBrowserLog});
const juhyunwoo=await selectComposition({serveUrl,id:'CurriculumJuhyunwoo',browserExecutable,onBrowserLog});
if(june.durationInFrames!==original.totalFrames||juhyunwoo.durationInFrames!==own.totalFrames)throw new Error('Composition duration mismatch');
if(!process.argv.includes('--render-only')){
  for(const id of ['intro','approach','closing']){
    const scene=original.scenes.find(s=>s.id===id);
    await renderStill({serveUrl,composition:june,browserExecutable,frame:scene.from+Math.floor(scene.durationInFrames*.74),output:path.join(out,`june-${id}.png`),imageFormat:'png',onBrowserLog});
    console.log(`Still: june ${id}`);
  }
  for(const id of ['intro','website','team','closing']){
    const scene=own.scenes.find(s=>s.id===id);
    await renderStill({serveUrl,composition:juhyunwoo,browserExecutable,frame:scene.from+Math.floor(scene.durationInFrames*.74),output:path.join(out,`juhyunwoo-${id}.png`),imageFormat:'png',onBrowserLog});
    console.log(`Still: juhyunwoo ${id}`);
  }
}
const media=async(composition,label,outputLocation,frameRange)=>{
  let milestone=-1;
  await renderMedia({serveUrl,composition,browserExecutable,frameRange,outputLocation,codec:'h264',pixelFormat:'yuv420p',crf:18,imageFormat:'png',muted:true,concurrency:4,onBrowserLog,onProgress:({progress})=>{
    const p=Math.floor(progress*10);if(p!==milestone){milestone=p;console.log(`${label}: ${Math.round(progress*100)}%`);}
  }});
};
if(!process.argv.includes('--stills-only')){
  if(!process.argv.includes('--juhyunwoo-only')){
    for(const id of ['intro','approach','closing']){
      const scene=original.scenes.find(s=>s.id===id);
      await media(june,`June ${id}`,path.join(out,`june-${id}.mp4`),[scene.from,scene.from+scene.durationInFrames-1]);
    }
  }
  if(!process.argv.includes('--june-only'))await media(juhyunwoo,'주현우',path.join(out,'juhyunwoo-silent.mp4'));
}
fs.writeFileSync(path.join(out,'render-log.json'),JSON.stringify({compositions:{june:{id:june.id,frames:june.durationInFrames},juhyunwoo:{id:juhyunwoo.id,frames:juhyunwoo.durationInFrames}},logs},null,2)+'\n');
if(logs.some(log=>log.type==='error'))process.exitCode=1;
