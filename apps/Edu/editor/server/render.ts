import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, readFile, readdir, stat, writeFile} from 'node:fs/promises';
import {bundle} from '@remotion/bundler';
import {makeCancelSignal, openBrowser, renderMedia, selectComposition} from '@remotion/renderer';
import type {Project, RenderOptions} from '../src/shared/types';
import {outputFrameRange} from '../src/video/layout';
import {ffmpegBinary, ffprobeBinary, runProcess} from './media';

export interface RenderContext {
  project:Project; projectDirectory:string; outputDirectory:string; assetBaseUrl:string;
  options:RenderOptions; signal:AbortSignal; onProgress:(progress:number,message:string)=>void;
}

interface ProbeData {
  duration:number; width:number; height:number; fps:number; videoCodec:string;
  audioCodec?:string; audioDuration?:number; frameCount?:number; method:string;
}

const appDirectory=fileURLToPath(new URL('../',import.meta.url));
let cachedBundle:{fingerprint:string;promise:Promise<string>}|undefined;

function checkCancelled(signal:AbortSignal) {
  if (signal.aborted) throw new Error('영상 출력이 취소되었습니다.');
}

async function sourceFingerprint(directory:string):Promise<string> {
  const hash=createHash('sha256');
  for (const name of (await readdir(directory)).sort()) {
    const file=path.join(directory,name);
    const details=await stat(file);
    if (details.isDirectory()) hash.update(await sourceFingerprint(file));
    else hash.update(`${name}:${details.size}:${details.mtimeMs}`);
  }
  return hash.digest('hex');
}

async function getBundle(context:RenderContext):Promise<string> {
  const fingerprint=await sourceFingerprint(path.join(appDirectory,'src','video'));
  if (!cachedBundle || cachedBundle.fingerprint!==fingerprint) {
    const output=path.join(appDirectory,'.cache','remotion',fingerprint.slice(0,16));
    const promise=bundle({
      entryPoint:path.join(appDirectory,'src','video','index.ts'),
      outDir:output,
      onProgress:(value)=>context.onProgress(.015+value/100*.065,'영상 장면과 로컬 글꼴을 준비하고 있습니다.'),
    });
    cachedBundle={fingerprint,promise};
    promise.catch(()=>{if(cachedBundle?.promise===promise)cachedBundle=undefined;});
  }
  return cachedBundle.promise;
}

function chromeExecutable():string {
  const configured=process.env.STUDIO_CHROME;
  const candidates=[configured,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome',
  ].filter((item):item is string=>Boolean(item));
  const found=candidates.find(existsSync);
  if (!found) throw new Error('로컬 Chrome/Chromium을 찾지 못했습니다. Chrome을 설치하거나 STUDIO_CHROME에 실행 파일 경로를 지정해 주세요.');
  return found;
}

function metadataEscape(value:string):string {
  return value.replace(/\\/g,'\\\\').replace(/\r?\n/g,' ').replace(/([=;#])/g,'\\$1');
}

export function chapterMetadata(project:Project,startFrame:number,endFrame:number):string {
  const lines=[';FFMETADATA1',`title=${metadataEscape(project.title)}`];
  const fps=project.settings.fps;
  let previousChapter='';
  for(let index=0;index<project.scenes.length;index++) {
    const scene=project.scenes[index];
    if(scene.chapterId===previousChapter)continue;
    previousChapter=scene.chapterId;
    const next=project.scenes.slice(index+1).find(item=>item.chapterId!==scene.chapterId);
    const start=Math.max(startFrame,scene.startFrame);
    const end=Math.min(endFrame,next?.startFrame??project.durationInFrames);
    if(end<=start)continue;
    const chapter=project.chapters.find(item=>item.id===scene.chapterId);
    lines.push('[CHAPTER]','TIMEBASE=1/1000',`START=${Math.round((start-startFrame)/fps*1000)}`,`END=${Math.round((end-startFrame)/fps*1000)}`,`title=${metadataEscape(chapter?.title??scene.title)}`);
  }
  return `${lines.join('\n')}\n`;
}

const PROBE_SCRIPT=`import av,json,sys
c=av.open(sys.argv[1]);v=next(s for s in c.streams if s.type=='video');a=next((s for s in c.streams if s.type=='audio'),None)
d=float(v.duration*v.time_base) if v.duration is not None else float(c.duration/av.time_base)
r={'duration':d,'width':v.width,'height':v.height,'fps':float(v.average_rate),'videoCodec':v.codec_context.name,'frameCount':v.frames or None,'method':'PyAV'}
if a is not None:r['audioCodec']=a.codec_context.name;r['audioDuration']=float(a.duration*a.time_base) if a.duration is not None else d
print(json.dumps(r));c.close()`;

async function probeOutput(file:string,signal:AbortSignal):Promise<ProbeData> {
  try {
    const result=await runProcess(ffprobeBinary(),['-v','error','-show_streams','-show_format','-of','json',file],{signal,timeout:30_000});
    const data=JSON.parse(result.stdout.toString()) as {format?:{duration?:string};streams?:{codec_type?:string;codec_name?:string;width?:number;height?:number;avg_frame_rate?:string;duration?:string;nb_frames?:string}[]};
    const video=data.streams?.find(stream=>stream.codec_type==='video');
    const audio=data.streams?.find(stream=>stream.codec_type==='audio');
    if(!video)throw new Error('출력 영상 스트림이 없습니다.');
    const rate=(video.avg_frame_rate??'0/1').split('/').map(Number);
    return {duration:Number(video.duration??data.format?.duration),width:video.width??0,height:video.height??0,fps:rate[0]/(rate[1]||1),videoCodec:video.codec_name??'',...(video.nb_frames?{frameCount:Number(video.nb_frames)}:{}),...(audio?{audioCodec:audio.codec_name,audioDuration:Number(audio.duration??data.format?.duration)}:{}),method:'ffprobe'};
  } catch(error) {
    checkCancelled(signal);
    const python=process.env.STUDIO_PYTHON??path.resolve(appDirectory,'..','.video-build','venv','bin','python');
    if(existsSync(python)) {
      const result=await runProcess(python,['-c',PROBE_SCRIPT,file],{signal,timeout:30_000,maxOutput:32_768});
      return JSON.parse(result.stdout.toString()) as ProbeData;
    }
    // FFmpeg is always required by the editor. Its decoded metadata is a portable fallback.
    const result=await runProcess(ffmpegBinary(),['-hide_banner','-nostdin','-i',file,'-t','0','-f','null','-'],{signal,timeout:30_000,maxOutput:8192});
    const dimensions=/Video:\s*(\w+)[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(result.stderr);
    const fps=/Video:[^\n]*?\b([\d.]+) fps/.exec(result.stderr);
    const duration=/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(result.stderr);
    const audio=/Audio:\s*(\w+)/.exec(result.stderr);
    if(!dimensions||!fps||!duration)throw new Error(`영상 메타데이터를 확인하지 못했습니다. ${error instanceof Error?error.message:''}`);
    return {width:Number(dimensions[2]),height:Number(dimensions[3]),videoCodec:dimensions[1],fps:Number(fps[1]),duration:Number(duration[1])*3600+Number(duration[2])*60+Number(duration[3]),...(audio?{audioCodec:audio[1]}:{}),method:'ffmpeg'};
  }
}

async function hasFaststart(file:string):Promise<boolean> {
  // Parse top-level MP4 atoms instead of searching inside potentially huge media payloads.
  const {open}=await import('node:fs/promises');
  const handle=await open(file,'r');
  try {
    const size=(await handle.stat()).size;
    const buffer=Buffer.alloc(16);
    let offset=0;
    let moov=-1;
    let mdat=-1;
    while(offset+8<=size) {
      await handle.read(buffer,0,16,offset);
      let atomSize=buffer.readUInt32BE(0);
      const atom=buffer.toString('ascii',4,8);
      if(atomSize===1)atomSize=Number(buffer.readBigUInt64BE(8));
      if(atomSize===0)atomSize=size-offset;
      if(atom==='moov')moov=offset;
      if(atom==='mdat')mdat=offset;
      if(moov>=0&&mdat>=0)return moov<mdat;
      if(atomSize<8||offset+atomSize>size)break;
      offset+=atomSize;
    }
    return false;
  } finally {await handle.close();}
}

function readPcm(buffer:Buffer):number[] {
  // Downsample the 8kHz analysis signal to 1kHz for bounded correlation work.
  const values:number[]=[];
  for(let offset=0;offset+3<buffer.length;offset+=32)values.push(buffer.readFloatLE(offset));
  return values;
}

export interface NarrationMatch {correlation:number;offsetMs:number;silent:boolean;outputSilent:boolean;insufficient:boolean}

export function signalCorrelation(reference:number[],sample:number[],maxLag=120):NarrationMatch {
  const length=Math.min(reference.length,sample.length);
  const refMean=reference.reduce((sum,v)=>sum+v,0)/Math.max(1,reference.length);
  const sampleMean=sample.reduce((sum,v)=>sum+v,0)/Math.max(1,sample.length);
  const refEnergy=reference.reduce((sum,v)=>sum+(v-refMean)**2,0)/Math.max(1,reference.length);
  const sampleEnergy=sample.reduce((sum,v)=>sum+(v-sampleMean)**2,0)/Math.max(1,sample.length);
  // Only a silent reference may be skipped. A silent/missing output is a failure.
  const silent=refEnergy<1e-8;
  const outputSilent=sampleEnergy<1e-8;
  const insufficient=length<20;
  if(silent||outputSilent||insufficient)return {correlation:0,offsetMs:0,silent,outputSilent,insufficient};
  let best=-1;
  let bestLag=0;
  const lagLimit=Math.max(0,Math.min(Math.floor(maxLag),Math.floor(length/3)));
  for(let lag=-lagLimit;lag<=lagLimit;lag++) {
    let product=0,refSquared=0,sampleSquared=0;
    const from=Math.max(0,-lag);
    const to=Math.min(reference.length,sample.length-lag);
    for(let index=from;index<to;index++) {
      const a=reference[index]-refMean;
      const b=sample[index+lag]-sampleMean;
      product+=a*b;refSquared+=a*a;sampleSquared+=b*b;
    }
    const correlation=product/Math.sqrt(refSquared*sampleSquared);
    if(correlation>best){best=correlation;bestLag=lag;}
  }
  return {correlation:Math.round(best*10000)/10000,offsetMs:bestLag,silent:false,outputSilent:false,insufficient:false};
}

export function assertNarrationMatch(match:NarrationMatch,startSeconds:number):void {
  if(match.silent)return;
  if(match.outputSilent)throw new Error(`나레이션 검증에 실패했습니다 (${startSeconds.toFixed(1)}초). 원본에는 음성이 있지만 출력 오디오가 무음이거나 비어 있습니다.`);
  if(match.insufficient)throw new Error(`나레이션 검증에 필요한 출력 오디오가 부족합니다 (${startSeconds.toFixed(1)}초).`);
  if(match.correlation<.72||Math.abs(match.offsetMs)>85)throw new Error(`나레이션 동기 검증에 실패했습니다 (${startSeconds.toFixed(1)}초, 상관도 ${match.correlation}, 지연 ${match.offsetMs}ms).`);
}

export function narrationPcmArguments(input:string,offset:number,duration:number):string[] {
  if(!Number.isFinite(offset)||offset<0||!Number.isFinite(duration)||duration<=0||duration>6)throw new Error('음성 검증 구간은 0초 초과, 6초 이하여야 합니다.');
  // Resample on the original clock BEFORE trimming. Even CLI output -ss can
  // apply trimming before resampling and introduce an AAC packet offset. A
  // sample-index output trim is identical to slicing a complete 8kHz decode,
  // while only the requested <=6 seconds ever leave FFmpeg's bounded pipe.
  const startSample=Math.round(offset*8000);
  const endSample=startSample+Math.round(duration*8000);
  const filter=`aresample=8000,atrim=start_sample=${startSample}:end_sample=${endSample},asetpts=PTS-STARTPTS`;
  return ['-v','error','-nostdin','-i',input,'-af',filter,'-t',duration.toFixed(4),'-vn','-ac','1','-ar','8000','-f','f32le','pipe:1'];
}

export async function readNarrationPcm(input:string,offset:number,duration:number,signal:AbortSignal):Promise<number[]> {
  const result=await runProcess(ffmpegBinary(),narrationPcmArguments(input,offset,duration),{signal,timeout:30_000,maxOutput:2*1024*1024});
  return readPcm(result.stdout);
}

export async function verifyNarration(context:RenderContext,file:string,startFrame:number,duration:number):Promise<Record<string,unknown>> {
  const asset=context.project.assets.find(candidate=>candidate.id===context.project.audioAssetId);
  if(!asset)return {status:'not-applicable',reason:'나레이션이 없는 프로젝트입니다.'};
  const source=path.resolve(context.projectDirectory,'assets',asset.fileName);
  const root=path.resolve(context.projectDirectory,'assets');
  if(path.dirname(source)!==root)throw new Error('나레이션 파일 경로가 올바르지 않습니다.');
  const sampleLength=Math.min(6,duration);
  const starts=[Math.min(1,Math.max(0,duration-sampleLength)),Math.max(0,duration/2-sampleLength/2),Math.max(0,duration-sampleLength)];
  const windows:Record<string,unknown>[]=[];
  for(const start of Array.from(new Set(starts.map(value=>Math.round(value*1000)/1000)))) {
    checkCancelled(context.signal);
    const [reference,output]=await Promise.all([
      readNarrationPcm(source,start+startFrame/context.project.settings.fps,sampleLength,context.signal),
      readNarrationPcm(file,start,sampleLength,context.signal),
    ]);
    const match=signalCorrelation(reference,output);
    windows.push({startSeconds:start,lengthSeconds:sampleLength,...match});
    assertNarrationMatch(match,start);
  }
  const evaluated=windows.filter(window=>window.silent===false);
  return {status:evaluated.length?'passed':'inconclusive',method:'PCM correlation (resample before sample-accurate output trim, bounded 6-second windows, 1 kHz analysis)',windows};
}

/** A single snapshot render. Output is returned only after metadata and whole-file decode pass. */
export async function renderProject(context:RenderContext):Promise<{fileName:string;verification:Record<string,unknown>}> {
  checkCancelled(context.signal);
  await mkdir(context.outputDirectory,{recursive:true});
  const [startFrame,lastFrame]=outputFrameRange(context.project,context.options.range);
  const frameCount=lastFrame-startFrame+1;
  const duration=frameCount/context.project.settings.fps;
  context.onProgress(.005,'출력할 프로젝트 버전을 고정하고 있습니다.');
  await writeFile(path.join(context.outputDirectory,'project-snapshot.json'),JSON.stringify(context.project,null,2));
  const serveUrl=await getBundle(context);
  checkCancelled(context.signal);
  const browser=await openBrowser('chrome',{browserExecutable:chromeExecutable(),logLevel:'error'});
  const {cancel,cancelSignal}=makeCancelSignal();
  const abort=()=>{cancel();void browser.close({silent:true}).catch(()=>{});};
  context.signal.addEventListener('abort',abort,{once:true});
  const rawOutput=path.join(context.outputDirectory,'render.mp4');
  const output=path.join(context.outputDirectory,'video.mp4');
  try {
    checkCancelled(context.signal);
    context.onProgress(.085,'미리보기와 같은 장면으로 영상을 만들고 있습니다.');
    const inputProps={project:context.project,assetBaseUrl:context.assetBaseUrl,showGuides:false};
    const composition=await selectComposition({serveUrl,id:'BiadoneVideo',inputProps,puppeteerInstance:browser,logLevel:'error',timeoutInMilliseconds:90_000});
    await renderMedia({
      serveUrl,composition,inputProps,puppeteerInstance:browser,codec:'h264',audioCodec:'aac',audioBitrate:'192k',
      outputLocation:rawOutput,frameRange:[startFrame,lastFrame],scale:context.options.resolution==='720p'?2/3:1,
      crf:19,x264Preset:'veryfast',pixelFormat:'yuv420p',imageFormat:'jpeg',jpegQuality:90,
      concurrency:2,offthreadVideoCacheSizeInBytes:128*1024*1024,mediaCacheSizeInBytes:128*1024*1024,
      cancelSignal,logLevel:'error',timeoutInMilliseconds:90_000,
      onProgress:({progress,renderedFrames})=>context.onProgress(.09+progress*.79,`장면 출력 중 · ${renderedFrames.toLocaleString()} / ${frameCount.toLocaleString()} 프레임`),
    });
  } finally {
    context.signal.removeEventListener('abort',abort);
    await browser.close({silent:true}).catch(()=>{});
  }
  checkCancelled(context.signal);
  context.onProgress(.89,'챕터와 스트리밍용 MP4 정보를 정리하고 있습니다.');
  const metadata=path.join(context.outputDirectory,'chapters.ffmetadata');
  await writeFile(metadata,chapterMetadata(context.project,startFrame,lastFrame+1));
  const normalize=context.project.settings.normalizeAudio && Boolean(context.project.audioAssetId);
  await runProcess(ffmpegBinary(),[
    '-v','error','-nostdin','-y','-i',rawOutput,'-i',metadata,'-map','0:v:0','-map','0:a?',
    '-map_metadata','1','-map_chapters','1','-c:v','copy',
    ...(normalize?['-af','loudnorm=I=-16:TP=-1.5:LRA=11','-c:a','aac','-b:a','192k']:['-c:a','copy']),
    '-movflags','+faststart',output,
  ],{signal:context.signal,timeout:Math.max(120_000,duration*1000),maxOutput:1024*1024});
  context.onProgress(.925,'영상 전체를 디코딩하고 길이·해상도를 검사하고 있습니다.');
  const probe=await probeOutput(output,context.signal);
  const expectedWidth=context.options.resolution==='720p'?1280:context.project.settings.width;
  const expectedHeight=context.options.resolution==='720p'?720:context.project.settings.height;
  if(probe.width!==expectedWidth||probe.height!==expectedHeight||Math.abs(probe.fps-context.project.settings.fps)>.01||Math.abs(probe.duration-duration)>.075) {
    throw new Error('출력 영상의 크기·프레임 속도·길이가 프로젝트 설정과 일치하지 않습니다.');
  }
  if(probe.videoCodec!=='h264')throw new Error('출력 영상의 H.264 코덱을 확인하지 못했습니다.');
  if(context.project.audioAssetId&&!probe.audioCodec)throw new Error('출력 영상에 나레이션 오디오가 없습니다.');
  const decoded=await runProcess(ffmpegBinary(),['-v','error','-nostdin','-i',output,'-map','0:v:0','-map','0:a?','-progress','pipe:1','-nostats','-f','null','-'],{signal:context.signal,timeout:Math.max(120_000,duration*1000),maxOutput:4*1024*1024});
  const frameValues=Array.from(decoded.stdout.toString().matchAll(/(?:^|\n)frame=(\d+)/g));
  const decodedFrames=Number(frameValues.at(-1)?.[1]??probe.frameCount??0);
  if(decodedFrames!==frameCount)throw new Error(`영상 프레임 수가 일치하지 않습니다 (${decodedFrames} / ${frameCount}).`);
  if(decoded.stderr.trim())throw new Error(`영상 전체 디코딩 검사에서 오류가 발견되었습니다. ${decoded.stderr.slice(-500)}`);
  if(!await hasFaststart(output))throw new Error('MP4 스트리밍 헤더 순서를 확인하지 못했습니다.');
  context.onProgress(.97,'나레이션 동기를 검사하고 있습니다.');
  const narration=await verifyNarration(context,output,startFrame,duration);
  const verification:Record<string,unknown>={
    status:'passed',projectId:context.project.id,projectRevision:context.project.revision,
    width:probe.width,height:probe.height,fps:probe.fps,durationSeconds:probe.duration,expectedDurationSeconds:duration,
    decodedFrames,expectedFrames:frameCount,videoCodec:probe.videoCodec,audioCodec:probe.audioCodec??null,
    faststart:true,fullDecode:true,narration,metadataMethod:probe.method,
    frameRange:{startFrame,endFrame:lastFrame+1},audioNormalized:normalize,checkedAt:new Date().toISOString(),
  };
  await writeFile(path.join(context.outputDirectory,'verification.json'),JSON.stringify(verification,null,2));
  checkCancelled(context.signal);
  context.onProgress(1,'영상 출력과 품질 검사가 완료되었습니다.');
  return {fileName:'video.mp4',verification};
}

/** Used by verification scripts without exercising the renderer. */
export async function readVerification(outputDirectory:string):Promise<Record<string,unknown>> {
  return JSON.parse(await readFile(path.join(outputDirectory,'verification.json'),'utf8')) as Record<string,unknown>;
}
