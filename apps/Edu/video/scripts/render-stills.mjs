import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {selectComposition, renderStill} from '@remotion/renderer';

const root=fileURLToPath(new URL('../',import.meta.url));
const timeline=JSON.parse(fs.readFileSync(path.join(root,'content/timeline.json'),'utf8'));
const out=path.join(root,'out/review');
fs.mkdirSync(out,{recursive:true});
const browserExecutable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const serveUrl=await bundle({entryPoint:path.join(root,'src/index.ts'),publicDir:path.join(root,'public')});
const logs=[];
const onBrowserLog=(log)=>{if(log.type==='error'||log.type==='warning')logs.push({type:log.type,text:log.text});};
const composition=await selectComposition({serveUrl,id:'CurriculumIntro',browserExecutable,onBrowserLog});
for(const scene of timeline.scenes){
  const frame=scene.from+Math.floor(scene.durationInFrames*.84);
  await renderStill({serveUrl,composition,browserExecutable,frame,output:path.join(out,`${scene.id}.png`),imageFormat:'png',onBrowserLog});
  console.log(`Reviewed frame ${frame}: ${scene.id}`);
}
fs.writeFileSync(path.join(out,'render-log.json'),JSON.stringify({composition:{width:composition.width,height:composition.height,fps:composition.fps,durationInFrames:composition.durationInFrames},logs},null,2));
if(logs.some(log=>log.type==='error'))process.exitCode=1;
