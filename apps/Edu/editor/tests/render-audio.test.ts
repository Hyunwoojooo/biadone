import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ffmpegBinary,runProcess} from '../server/media';
import {assertNarrationMatch,narrationPcmArguments,readNarrationPcm,signalCorrelation} from '../server/render';

describe('AAC 검증의 정확한 구간 추출',()=>{
  let directory:string;
  let reference:string;
  let encoded:string;
  beforeAll(async()=>{
    directory=await mkdtemp(path.join(tmpdir(),'biadone-pcm-test-'));
    reference=path.join(directory,'reference.wav');
    encoded=path.join(directory,'encoded.m4a');
    const rate=44_100;
    const samples=rate*14;
    const data=Buffer.alloc(44+samples*2);
    data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*2,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(samples*2,40);
    for(let index=0;index<samples;index++){
      const t=index/rate;
      const value=.32*Math.sin(2*Math.PI*(137*t+31*t*t))+.15*Math.sin(2*Math.PI*(271*t+17*t*t))+.08*Math.sin(2*Math.PI*641*t);
      data.writeInt16LE(Math.round(value*32767),44+index*2);
    }
    await writeFile(reference,data);
    await runProcess(ffmpegBinary(),['-v','error','-nostdin','-y','-i',reference,'-af','loudnorm=I=-16:TP=-1.5:LRA=11','-ar','96000','-c:a','aac','-b:a','192k','-movflags','+faststart',encoded],{timeout:30_000});
  });
  afterAll(async()=>{if(directory)await rm(directory,{recursive:true,force:true});});

  it('디코드·리샘플 뒤에 샘플 단위로 자르고 출력 PCM 길이를 최대 6초로 제한한다',()=>{
    const args=narrationPcmArguments('recording.m4a',12.1,1.8);
    expect(args.indexOf('-ss')).toBe(-1);
    expect(args.indexOf('-af')).toBeGreaterThan(args.indexOf('-i'));
    expect(args[args.indexOf('-af')+1]).toBe('aresample=8000,atrim=start_sample=96800:end_sample=111200,asetpts=PTS-STARTPTS');
    expect(args[args.indexOf('-t')+1]).toBe('1.8000');
    expect(()=>narrationPcmArguments('recording.m4a',0,7)).toThrow();
  });
  it('12.1초의 96kHz·음량 정규화 AAC를 패킷 오프셋 없이 원본과 비교한다',async()=>{
    const signal=new AbortController().signal;
    const [a,b]=await Promise.all([readNarrationPcm(reference,12.1,1.8,signal),readNarrationPcm(encoded,12.1,1.8,signal)]);
    expect(a.length).toBeLessThanOrEqual(1801);
    expect(b.length).toBeLessThanOrEqual(1801);
    const match=signalCorrelation(a,b);
    expect(match.correlation).toBeGreaterThan(.99);
    expect(match.offsetMs).toBe(0);
    expect(()=>assertNarrationMatch(match,12.1)).not.toThrow();
  });
});
