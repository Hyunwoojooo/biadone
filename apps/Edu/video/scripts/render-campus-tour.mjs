import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {selectComposition,renderStill,renderMedia} from '@remotion/renderer';

const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.join(root,'out/campus-tour');
const review=path.join(out,'review');
fs.mkdirSync(review,{recursive:true});fs.mkdirSync(path.join(out,'work'),{recursive:true});
const timeline=JSON.parse(fs.readFileSync(path.join(root,'content/timeline.json'),'utf8'));
const serveUrl=await bundle({entryPoint:path.join(root,'src/index.ts'),publicDir:path.join(root,'public')});
const browserExecutable=process.env.REMOTION_BROWSER_EXECUTABLE??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const logs=[];
const onBrowserLog=log=>{if(log.type==='error'||log.type==='warning')logs.push({type:log.type,text:log.text});};
const composition=await selectComposition({serveUrl,id:'CampusTour',browserExecutable,onBrowserLog});
if(!process.argv.includes('--render-only')){
  for(const entry of timeline.scenes){
    await renderStill({serveUrl,composition,browserExecutable,frame:entry.from+Math.floor(entry.durationInFrames*.76),output:path.join(review,`${entry.id}.png`),imageFormat:'png',onBrowserLog});
    console.log(`Still: ${entry.id}`);
  }
  for(const id of ['content','website','team']){
    const entry=timeline.scenes.find(s=>s.id===id);
    await renderStill({serveUrl,composition,browserExecutable,frame:entry.from+28,output:path.join(review,`${id}-walking.png`),imageFormat:'png',onBrowserLog});
  }
}
if(!process.argv.includes('--stills-only')){
  let milestone=-1;
  await renderMedia({serveUrl,composition,browserExecutable,outputLocation:path.join(out,'work/CampusTour-silent.mp4'),codec:'h264',pixelFormat:'yuv420p',crf:18,imageFormat:'jpeg',jpegQuality:95,muted:true,concurrency:4,onBrowserLog,onProgress:({progress})=>{
    const current=Math.floor(progress*20);
    if(current!==milestone){milestone=current;console.log(`CampusTour: ${Math.round(progress*100)}%`);}
  }});
}
fs.writeFileSync(path.join(out,'render-log.json'),JSON.stringify({composition:{width:composition.width,height:composition.height,fps:composition.fps,durationInFrames:composition.durationInFrames},logs},null,2));
if(logs.some(log=>log.type==='error'))process.exitCode=1;
