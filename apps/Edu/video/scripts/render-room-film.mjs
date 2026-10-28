import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {renderMedia,renderStill,selectComposition} from '@remotion/renderer';

const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.join(root,'out/room-film');
const review=path.join(out,'review');
fs.mkdirSync(review,{recursive:true});fs.mkdirSync(path.join(out,'work'),{recursive:true});
const serveUrl=await bundle({entryPoint:path.join(root,'src/index.ts'),publicDir:path.join(root,'public')});
const browserExecutable=process.env.REMOTION_BROWSER_EXECUTABLE??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromiumOptions={gl:'angle'};
const logs=[];
const onBrowserLog=log=>{if(log.type==='error'||log.type==='warning'){logs.push({type:log.type,text:log.text});console.log(`${log.type}: ${log.text.slice(0,250)}`);}};
const composition=await selectComposition({serveUrl,id:'RoomFilmStudy',browserExecutable,chromiumOptions,onBrowserLog});
if(!process.argv.includes('--render-only')){
  const one=process.argv.find(arg=>arg.startsWith('--still-frame='));
  const shots=one?[[`test-${Number(one.split('=')[1])}`,Number(one.split('=')[1])]]:[['back-of-head',15],['door-opening',113],['threshold',195],['reveal',375],['planning',470],['making',570],['reviewing',710],['closing',855]];
  for(const [name,frame] of shots){
    await renderStill({serveUrl,composition,browserExecutable,chromiumOptions,frame,output:path.join(review,`${name}.png`),imageFormat:'png',onBrowserLog});
    console.log(`Still: ${name} (${frame})`);
  }
}
if(!process.argv.includes('--stills-only')){
  let milestone=-1;
  await renderMedia({serveUrl,composition,browserExecutable,chromiumOptions,outputLocation:path.join(out,'work/RoomFilm-silent.mp4'),codec:'h264',pixelFormat:'yuv420p',crf:18,imageFormat:'png',muted:true,concurrency:2,onBrowserLog,onProgress:({progress})=>{
    const current=Math.floor(progress*20);if(current!==milestone){milestone=current;console.log(`RoomFilm: ${Math.round(progress*100)}%`);}
  }});
}
fs.writeFileSync(path.join(out,'render-log.json'),JSON.stringify({composition:{width:composition.width,height:composition.height,fps:composition.fps,durationInFrames:composition.durationInFrames},logs},null,2));
if(logs.some(log=>log.type==='error'))process.exitCode=1;
