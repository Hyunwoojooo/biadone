/** Explicit renderer integration check; invoked manually so ordinary unit tests stay fast. */
import http from 'node:http';
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {mkdir,stat,writeFile} from 'node:fs/promises';
import {createProject} from '../src/domain/project';
import {renderProject} from '../server/render';
import {ffmpegBinary,runProcess} from '../server/media';

const source=process.argv[2];
if(!source)throw new Error('검증에 사용할 로컬 음성 파일 경로를 전달해 주세요.');
const geometryCheck=process.argv.includes('--geometry');
const directory=path.resolve('.cache',geometryCheck?'render-geometry-check':'render-audio-check');
const assets=path.join(directory,'project','assets');
await mkdir(assets,{recursive:true});
const narration=path.join(assets,'narration.wav');
await runProcess(ffmpegBinary(),['-v','error','-nostdin','-y','-i',path.resolve(source),'-t','15','-vn','-ac','1','-ar','44100',narration],{timeout:30_000});
const server=http.createServer(async(request,response)=>{
  if(request.url!=='/assets/smoke-audio'){response.writeHead(404);response.end();return;}
  const size=(await stat(narration)).size;
  response.writeHead(200,{'Content-Type':'audio/wav','Content-Length':size});
  createReadStream(narration).pipe(response);
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();
if(!address||typeof address==='string')throw new Error('검증용 로컬 미디어 주소를 만들지 못했습니다.');
const project=createProject('실제 나레이션 · 부분 출력 검증',15);
const base=project.scenes[0];
project.scenes=(['title','steps','compare','quote','character'] as const).map((template,index)=>({
  ...base,id:`smoke-scene-${index}`,startFrame:index*90,durationInFrames:90,template,
  title:['영상의 시작','세 가지 기준','두 방법 비교','기억할 한 문장','캐릭터 설명'][index],
  heading:['좋은 영상은 좋은 흐름에서','내 일에 맞는 AI를 고르는 법','지금의 방식과 새로운 방식','반복할수록 더 단순해집니다','작은 일부터 시작해 보세요'][index],
  kicker:'나레이션 기반 영상 제작',
  body:template==='steps'||template==='compare'?'':'처음부터 끝까지 일정한 화면과 자막을 유지합니다.',
  items:(template==='compare'?[{title:'직접 반복하기',body:'매번 같은 일을 다시 처리합니다.'},{title:'기준을 정해두기',body:'필요한 부분에 집중할 수 있습니다.'}]:[{title:'반복되는가',body:'지금 하는 일이\n반복적으로 발생하나요?'},{title:'확인 가능한가',body:'결과를 내가 직접\n확인할 수 있나요?'},{title:'계속 쓸 수 있는가',body:'지속적으로\n활용할 수 있나요?'}]),
}));
project.assets=[{id:'smoke-audio',name:'검증용 나레이션',kind:'audio',fileName:'narration.wav',duration:15}];
project.audioAssetId='smoke-audio';
project.captions=project.scenes.map((scene,index)=>({id:`smoke-caption-${index}`,text:scene.title,startFrame:scene.startFrame,endFrame:scene.startFrame+90}));
if(geometryCheck) {
  Object.assign(project.scenes[1],{template:'title',heading:'가'.repeat(54),body:'나'.repeat(126),kicker:'보조제목'});
  project.captions[1].text='내용을 전부 유지하면서 화면과 자막이 겹치지 않도록 제목과 본문을 함께 조절합니다.';
}
try {
  const result=await renderProject({
    project,projectDirectory:path.join(directory,'project'),outputDirectory:path.join(directory,'output'),
    assetBaseUrl:`http://127.0.0.1:${address.port}/assets`,
    options:{resolution:'720p',range:{startFrame:90,endFrame:180}},signal:new AbortController().signal,
    onProgress:(progress,message)=>{if(progress>.88)process.stdout.write(`${Math.round(progress*100)}% ${message}\n`);},
  });
  await writeFile(path.join(directory,'project.json'),JSON.stringify(project,null,2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
