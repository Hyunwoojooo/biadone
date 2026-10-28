import {describe,it,expect} from 'vitest';
import {activeCaption,activeScene,fitVideoText,mediaAssetUrl,outputFrameRange,sceneTextLayout,textUnits,wrapVideoText} from '../src/video/layout';
import {assertNarrationMatch,chapterMetadata,signalCorrelation} from '../server/render';
import {createDemoProject} from '../src/domain/project';

describe('영상 레이아웃의 프레임 경계와 한글 조판',()=>{
  it('긴 한글을 문자 누락 없이 나누고 제목 글꼴을 영역에 맞춘다',()=>{
    const text='반복되는 업무를 줄이고 내 일에 맞는 기준으로 도구를 선택합니다.';
    const lines=wrapVideoText(text,14);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('').replace(/\s/g,'')).toBe(text.replace(/\s/g,''));
    expect(lines.every(line=>textUnits(line)<=14)).toBe(true);
    const fitted=fitVideoText(text,620,90,3,30);
    expect(fitted.fontSize).toBeLessThan(90);
    expect(fitted.lines.length).toBeLessThanOrEqual(3);
  });
  it('자막과 장면의 종료 프레임은 다음 구간에 속한다',()=>{
    const p=createDemoProject();
    const first=p.scenes[0];
    expect(activeScene(p.scenes,first.startFrame+first.durationInFrames-1)?.id).toBe(first.id);
    expect(activeScene(p.scenes,first.startFrame+first.durationInFrames)?.id).toBe(p.scenes[1].id);
    const captions=[{id:'a',text:'앞',startFrame:0,endFrame:30},{id:'b',text:'뒤',startFrame:30,endFrame:60}];
    expect(activeCaption(captions,29)?.id).toBe('a');
    expect(activeCaption(captions,30)?.id).toBe('b');
    expect(activeCaption(captions,60)).toBeUndefined();
  });
  it('API의 exclusive 범위를 Remotion inclusive 범위로 정확히 변환한다',()=>{
    expect(outputFrameRange({durationInFrames:900},{startFrame:300,endFrame:600})).toEqual([300,599]);
    expect(outputFrameRange({durationInFrames:900})).toEqual([0,899]);
    expect(()=>outputFrameRange({durationInFrames:900},{startFrame:0,endFrame:901})).toThrow();
    expect(()=>outputFrameRange({durationInFrames:900},{startFrame:300,endFrame:300})).toThrow();
  });
  it('미디어 주소는 파일 경로 대신 자산 ID만 사용한다',()=>{
    expect(mediaAssetUrl('/api/projects/p/assets/','asset-1')).toBe('/api/projects/p/assets/asset-1');
    expect(mediaAssetUrl('/api/projects/p/assets','a/b')).toBe('/api/projects/p/assets/a%2Fb');
  });
  it('개별 텍스트가 허용 길이여도 전체 블록과 입장 애니메이션을 안전 영역 안에 맞춘다',()=>{
    const base=createDemoProject().scenes[0];
    for(const template of ['title','character'] as const) {
      const layout=sceneTextLayout({...base,template,heading:'가'.repeat(54),body:'나'.repeat(126),kicker:'보조제목'});
      expect(layout?.fits).toBe(true);
      expect(layout!.bottom).toBeLessThanOrEqual(866);
      expect(layout!.bottom).toBe(layout!.staticBottom+layout!.introOffset);
      expect(layout!.blocks.every(block=>block.fontSize>=block.minFontSize&&block.lines.length<=block.maxLines)).toBe(true);
    }
  });
  it('최소 글꼴에서도 수용할 수 없는 줄 수를 숨기지 않고 검수 대상으로 남긴다',()=>{
    const base=createDemoProject().scenes[0];
    const quote=sceneTextLayout({...base,template:'quote',heading:'가'.repeat(54),body:'나'.repeat(126),kicker:'보조제목'});
    expect(quote?.fits).toBe(false);
    expect(quote?.issues).toContain('body:line-limit');
    const explicit=sceneTextLayout({...base,template:'title',heading:'첫째\n둘째\n셋째\n넷째\n다섯째',body:'',kicker:''});
    expect(explicit?.fits).toBe(false);
    expect(explicit?.issues).toContain('heading:line-limit');
    expect(fitVideoText('가'.repeat(300),100,65,1,34).fontSize).toBe(34);
  });
});

describe('출력 검증 보조 기능',()=>{
  it('실제 시간 구간에 맞춰 챕터를 자르고 메타데이터 제어문자를 이스케이프한다',()=>{
    const p=createDemoProject();
    p.title='기준; title=새 제목\n다음 줄';
    const metadata=chapterMetadata(p,0,Math.min(p.durationInFrames,900));
    expect(metadata).toContain('title=기준\\; title\\=새 제목 다음 줄');
    expect(metadata).toContain('START=0');
    expect(metadata).toContain('[CHAPTER]');
    expect(metadata).not.toContain('\n다음 줄');
  });
  it('작은 음량 변화와 알려진 지연을 상관도로 검출한다',()=>{
    const reference=Array.from({length:3000},(_,i)=>Math.sin(i*.13)*.4+Math.sin(i*.077)*.2);
    const sample=[...Array.from({length:35},()=>0),...reference.map(v=>v*.65)];
    const result=signalCorrelation(reference,sample);
    expect(result.correlation).toBeGreaterThan(.99);
    expect(result.offsetMs).toBe(35);
    expect(signalCorrelation(Array(300).fill(0),Array(300).fill(0)).silent).toBe(true);
  });
  it('원본에 음성이 있는데 출력만 무음인 경우 검증에 실패한다',()=>{
    const reference=Array.from({length:3000},(_,i)=>Math.sin(i*.13)*.4);
    const silence=signalCorrelation(reference,Array(3000).fill(0));
    expect(silence.silent).toBe(false);
    expect(silence.outputSilent).toBe(true);
    expect(()=>assertNarrationMatch(silence,0)).toThrow('출력 오디오가 무음');
    const missing=signalCorrelation(reference,[]);
    expect(()=>assertNarrationMatch(missing,0)).toThrow('출력 오디오가 무음');
    const quietReference=signalCorrelation(Array(3000).fill(0),reference);
    expect(()=>assertNarrationMatch(quietReference,0)).not.toThrow();
  });
});
