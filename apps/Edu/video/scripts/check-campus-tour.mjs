import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url));
const load=(relative,imports={})=>{
  const file=path.join(root,relative);
  const {outputText}=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  const exports={};vm.runInNewContext(outputText,{exports,require:name=>{if(name in imports)return imports[name];throw new Error(`Unexpected import ${name}`);}}, {filename:file});return exports;
};
const data=load('src/campus-tour/campus-data.ts');
const state=load('src/campus-tour/tour-state.ts',{'./campus-data':data});
const timeline=JSON.parse(fs.readFileSync(path.join(root,'content/timeline.json'),'utf8'));
const issues=[];
let previous=null;
const reading=[];
for(const entry of timeline.scenes){
  const plan=state.TOUR_PLANS[entry.id];
  const route=state.pathFor(entry.id);
  if(previous&&Math.hypot(previous.x-route[0].x,previous.y-route[0].y)>.001)issues.push(`${entry.id}: discontinuous start`);
  previous=route.at(-1);
  for(let i=1;i<plan.nodes.length;i++){
    const from=data.MAP.nodes.find(n=>n.id===plan.nodes[i-1]);
    if(!from?.links.includes(plan.nodes[i]))issues.push(`${entry.id}: disconnected route ${plan.nodes[i-1]} -> ${plan.nodes[i]}`);
  }
  if((plan.room||plan.common)&&entry.id!=='approach'){
    const showAt=entry.id==='foundation'?26:plan.travelFrames+6;
    const readableSeconds=(entry.durationInFrames-showAt-12)/timeline.fps;
    if(readableSeconds<10)issues.push(`${entry.id}: not enough reading time`);
    reading.push({scene:entry.id,seconds:readableSeconds});
  }
}
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const assets=[['campus-world-v2.png','campus-world.png'],['visitor-sprites.png','visitor-sprites.png']].map(([src,dst])=>({file:dst,sameAsSource:sha(path.join(root,'../output/biadon-edu-campus/assets',src))===sha(path.join(root,'public/campus-tour',dst))}));
const sourceFiles=['index.html','campus.js','campus.css','curriculum.js','map-layout.js','movement.js'];
const sourceHashes=sourceFiles.map(file=>({file,sha256:sha(path.join(root,'../output/biadon-edu-campus',file))}));
const report={courses:data.COURSES.length,rooms:data.MAP.portals.length,learnItems:data.COURSES.reduce((n,c)=>n+c.learn.length,0),outputItems:data.COURSES.reduce((n,c)=>n+c.outputs.length,0),routeContinuity:issues.length===0,reading,assets,sourceHashes,issues};
const out=path.join(root,'out/campus-tour');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'preflight.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(issues.length||assets.some(a=>!a.sameAsSource)||report.learnItems!==52||report.rooms!==7)process.exitCode=1;
