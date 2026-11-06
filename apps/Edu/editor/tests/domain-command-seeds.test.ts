import {describe,expect,it} from 'vitest';
import {applyCommand,createProject,withCommandSeed} from '../src/domain/project';
import {groupScenes} from '../src/domain/captions';
import {commandSchema,projectSchema} from '../src/shared/types';
import type {EditorCommand,Project} from '../src/shared/types';

const ids=(project:Project)=>({scenes:project.scenes.map(scene=>scene.id),chapters:project.chapters.map(chapter=>chapter.id)});
interface SeedCase {name:string;base:()=>Project;command:(project:Project)=>EditorCommand}
const cases:SeedCase[]=[
 {name:'regroup',base:()=>createProject('두 챕터',150),command:()=>({type:'regroup',targetSeconds:8,splitMode:'fixed'})},
 {name:'splitScene',base:()=>createProject('분할',30),command:project=>({type:'splitScene',sceneId:project.scenes[0].id,atFrame:300})},
 {name:'addChapter',base:()=>createProject('챕터',30),command:()=>({type:'addChapter',title:'새 챕터'})},
 {name:'addScene',base:()=>{
  const project=createProject('대본으로 장면 만들기',60);
  project.captions=[{id:'cue-before',text:'이전 문장',startFrame:30,endFrame:180},{id:'cue-selected',text:'선택 문장',startFrame:360,endFrame:540},{id:'cue-after',text:'다음 문장',startFrame:900,endFrame:1080}];return project;
 },command:project=>({type:'addScene',chapterId:project.chapters[0].id,firstCaptionId:'cue-selected',lastCaptionId:'cue-selected'})},
 {name:'replaceCaptions',base:()=>createProject('자막 재구성',60),command:()=>({type:'replaceCaptions',captions:[{id:'source-cue',text:'긴 원문입니다.',startFrame:0,endFrame:1800}],regroup:true})},
 {name:'setNarration',base:()=>{
  let project=createProject('잠긴 끝 장면',10);
  project=applyCommand(project,{type:'addAsset',asset:{id:'long-audio',name:'long.wav',kind:'audio',fileName:'long.wav',duration:20}});
  return applyCommand(project,{type:'updateScene',sceneId:project.scenes[0].id,patch:{locked:true}});
 },command:()=>({type:'setNarration',assetId:'long-audio'})},
];

describe('stable IDs across optimistic client and server command replay',()=>{
 it.each(cases)('$name creates the same IDs from a serialized command and base revision',({base,command})=>{
  const project=base();const original=JSON.stringify(project);const payload=withCommandSeed(command(project));
  const client=applyCommand(project,payload),server=applyCommand(project,JSON.parse(JSON.stringify(payload)));
  expect(ids(client)).toEqual(ids(server));expect(client.scenes.map(scene=>[scene.startFrame,scene.durationInFrames,scene.chapterId])).toEqual(server.scenes.map(scene=>[scene.startFrame,scene.durationInFrames,scene.chapterId]));
  expect(JSON.stringify(client)).not.toContain('"idSeed"');expect(JSON.stringify(server)).not.toContain('"idSeed"');
  expect(JSON.stringify(project)).toBe(original);expect(projectSchema.safeParse(client).success).toBe(true);
 });
 it.each(cases.filter(value=>value.name!=='addChapter'))('$name accepts the immediately queued edit targeting a newly created scene',({base,command})=>{
  const project=base();const payload=withCommandSeed(command(project));const client=applyCommand(project,payload),server=applyCommand(project,JSON.parse(JSON.stringify(payload)));
  const existing=new Set(project.scenes.map(scene=>scene.id));const created=client.scenes.find(scene=>!existing.has(scene.id));expect(created).toBeDefined();
  const follow:EditorCommand={type:'updateScene',sceneId:created!.id,patch:{preferredKind:'list'}};
  const clientEdited=applyCommand(client,follow),serverEdited=applyCommand(server,JSON.parse(JSON.stringify(follow)));
  expect(serverEdited.scenes.find(scene=>scene.id===created!.id)?.preferredKind).toBe('list');expect(ids(serverEdited)).toEqual(ids(clientEdited));
 });
 it('accepts the immediately queued chapter rename using the optimistic chapter ID',()=>{
  const project=createProject('챕터',30),payload=withCommandSeed({type:'addChapter',title:'새 챕터'});
  const client=applyCommand(project,payload),server=applyCommand(project,JSON.parse(JSON.stringify(payload)));const chapterId=client.chapters.at(-1)!.id;
  const follow:EditorCommand={type:'updateChapter',chapterId,title:'즉시 바꾼 이름'};const updated=applyCommand(server,follow);
  expect(updated.chapters.find(chapter=>chapter.id===chapterId)?.title).toBe('즉시 바꾼 이름');
 });
});

describe('command seed lifecycle and compatibility',()=>{
 it('keeps one seed across queue normalization and JSON transport',()=>{
  const original:EditorCommand={type:'regroup',targetSeconds:8};const payload=withCommandSeed(original);
  expect('idSeed' in payload&&typeof payload.idSeed==='string').toBe(true);
  expect(withCommandSeed(payload)).toEqual(payload);expect(commandSchema.parse(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  expect(original).not.toHaveProperty('idSeed');
 });
 it('leaves commands that do not create IDs unchanged',()=>{
  const project=createProject();const update:EditorCommand={type:'updateScene',sceneId:project.scenes[0].id,patch:{heading:'수정'}};
  const captions:EditorCommand={type:'replaceCaptions',captions:[],regroup:false};
  expect(withCommandSeed(update)).toBe(update);expect(withCommandSeed(captions)).toBe(captions);
 });
 it('bounds the generated IDs and rejects unsafe or overlong seeds',()=>{
  const project=createProject('한도',150);const seed='a'.repeat(64);const grouped=groupScenes(project,8,'fixed',seed);
  const generated=[...grouped.scenes,...grouped.chapters].map(item=>item.id);
  expect(new Set(generated).size).toBe(generated.length);expect(generated.every(id=>id.length<=100)).toBe(true);
  expect(ids({...project,...grouped})).toEqual(ids({...project,...groupScenes(project,8,'fixed',seed)}));
  for(const invalid of ['../outside','has space','a'.repeat(65),'']) {
   expect(()=>applyCommand(project,{type:'regroup',idSeed:invalid})).toThrow();expect(()=>groupScenes(project,8,'fixed',invalid)).toThrow();
  }
 });
 it('continues accepting legacy commands without a seed',()=>{
  const project=createProject();const command:EditorCommand={type:'regroup',targetSeconds:8};
  expect(commandSchema.safeParse(command).success).toBe(true);expect(projectSchema.safeParse(applyCommand(project,command)).success).toBe(true);
 });
});
