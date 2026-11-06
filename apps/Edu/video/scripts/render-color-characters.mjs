import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {selectComposition,renderStill,renderMedia} from '@remotion/renderer';

const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.join(root,'out/work/color-characters-v4');
fs.mkdirSync(out,{recursive:true});
const timeline=JSON.parse(fs.readFileSync(path.join(root,'content/timeline.json'),'utf8'));
const browserExecutable=process.env.REMOTION_BROWSER_EXECUTABLE??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const serveUrl=await bundle({entryPoint:path.join(root,'src/index.ts'),publicDir:path.join(root,'public')});
const logs=[];
const onBrowserLog=log=>{if(log.type==='error'||log.type==='warning')logs.push({type:log.type,text:log.text});};
const composition=await selectComposition({serveUrl,id:'CurriculumColor',browserExecutable,onBrowserLog});
if(composition.durationInFrames!==timeline.totalFrames)throw new Error('Timeline mismatch');
for(const id of ['intro','approach','closing']){
  const scene=timeline.scenes.find(s=>s.id===id);
  if(!process.argv.includes('--render-only')){
    await renderStill({serveUrl,composition,browserExecutable,frame:scene.from+Math.floor(scene.durationInFrames*.74),output:path.join(out,`${id}.png`),imageFormat:'png',onBrowserLog});
    console.log(`Still: ${id}`);
  }
  if(!process.argv.includes('--stills-only')){
    let milestone=-1;
    await renderMedia({serveUrl,composition,browserExecutable,frameRange:[scene.from,scene.from+scene.durationInFrames-1],outputLocation:path.join(out,`${id}.mp4`),codec:'h264',pixelFormat:'yuv420p',crf:18,imageFormat:'png',muted:true,concurrency:4,onBrowserLog,onProgress:({progress})=>{
      const p=Math.floor(progress*4);if(p!==milestone){milestone=p;console.log(`${id}: ${Math.round(progress*100)}%`);}
    }});
  }
}
fs.writeFileSync(path.join(out,'render-log.json'),JSON.stringify({composition:composition.id,scenes:['intro','approach','closing'],logs},null,2)+'\n');
if(logs.some(log=>log.type==='error'))process.exitCode=1;
