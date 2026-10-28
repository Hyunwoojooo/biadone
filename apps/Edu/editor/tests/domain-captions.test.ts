import {describe,expect,it} from 'vitest';
import {parseCaptions,groupScenes,toSrt,toVtt} from '../src/domain/captions';
import {createProject,applyCommand} from '../src/domain/project';
import {checkQuality} from '../src/domain/quality';
import {wrapCaption,displayUnits,shortText} from '../src/domain/helpers';
import {sceneTextLayout} from '../src/video/layout';

describe('timed captions',()=>{
 it('preserves frame timing through SRT and VTT round trips',()=>{
  let p=createProject('자막',30);const parsed=parseCaptions('1\r\n00:00:00,033 --> 00:00:04,567\r\n첫 번째 문장입니다.\r\n\r\n2\r\n00:00:05,000 --> 00:00:08,100\r\n두 번째 문장입니다.','srt',30);
  p=applyCommand(p,{type:'replaceCaptions',...parsed});
  const srt=parseCaptions(toSrt(p),'srt',30),vtt=parseCaptions(toVtt(p),'vtt',30);
  for(const result of [srt,vtt])expect(result.captions.map(c=>[c.startFrame,c.endFrame,c.text])).toEqual(p.captions.map(c=>[c.startFrame,c.endFrame,c.text]));
 });
 it('accepts VTT cue IDs, settings and notes while retaining plain text',()=>{
  const text='WEBVTT\n\nNOTE author\nignored\n\nintro\n00:01.000 --> 00:04.000 align:start position:10%\n<b>중요한 문장</b>입니다.\n';
  const result=parseCaptions(text,'vtt',30);expect(result.captions[0].text).toBe('중요한 문장입니다.');expect(result.captions[0].startFrame).toBe(30);
 });
 it('preserves comparison symbols instead of treating narration as arbitrary HTML',()=>{
  const result=parseCaptions('1\n00:00:01,000 --> 00:00:05,000\n비용 < 10달러 > 기준을 확인합니다.','srt',30);
  expect(result.captions[0].text).toBe('비용 < 10달러 > 기준을 확인합니다.');
 });
 it('rejects invalid timestamps, empty cues, arbitrary JSON and non-finite word data',()=>{
  expect(()=>parseCaptions('1\n00:61:00,000 --> 00:62:00,000\n문장','srt',30)).toThrow();
  expect(()=>parseCaptions('1\n00:00:02,000 --> 00:00:01,000\n문장','srt',30)).toThrow();
  expect(()=>parseCaptions('1\n00:00:01,000 --> 00:00:02,000\n','srt',30)).toThrow();
  expect(()=>parseCaptions('{"unknown":[]}','json',30)).toThrow();
  expect(()=>parseCaptions('{"words":[{"text":"문장","start":null,"end":2}]}','json',30)).toThrow();
 });
 it('turns long faster-whisper word timing into readable cues without losing words',()=>{
  const words=Array.from({length:120},(_,i)=>({word:` 단어${i}`,start:i*.25,end:(i+1)*.25,probability:.9}));
  const result=parseCaptions(JSON.stringify({segments:[{start:0,end:30,text:'사용되지 않는 긴 원문',words}]}),'json',30);
  expect(result.words).toHaveLength(120);expect(result.captions.length).toBeGreaterThan(6);
  expect(result.captions.flatMap(c=>c.wordIds??[])).toEqual(result.words.map(w=>w.id));
  expect(result.captions.every(c=>c.endFrame-c.startFrame<=165)).toBe(true);
  const p=applyCommand(createProject('단어',30),{type:'replaceCaptions',...result});
  expect(checkQuality(p).issues.filter(i=>i.code==='CAPTION_OVERFLOW'||i.code==='CAPTION_UNREADABLE')).toHaveLength(0);
 });
 it('remaps exported word references consistently when importing JSON',()=>{
  const result=parseCaptions(JSON.stringify({words:[{id:'old-word',text:'문장',start:1,end:3}],captions:[{id:'old-caption',text:'문장',startFrame:30,endFrame:90,wordIds:['old-word']}]}),'json',30);
  expect(result.words[0].id).not.toBe('old-word');expect(result.captions[0].wordIds).toEqual([result.words[0].id]);
 });
});

describe('deterministic scene grouping',()=>{
 it('covers leading/trailing silence and every frame of a 25-minute timeline',()=>{
  const p=createProject('긴 영상',1500);
  p.captions=Array.from({length:250},(_,i)=>({id:`caption-${i}`,text:`설명 ${i}입니다.`,startFrame:(i*5+2)*30,endFrame:(i*5+6)*30}));
  const grouped=groupScenes(p,12);expect(grouped.scenes.length).toBeGreaterThan(70);
  let cursor=0;for(const scene of grouped.scenes){expect(scene.startFrame).toBe(cursor);cursor+=scene.durationInFrames;expect(grouped.chapters.some(c=>c.id===scene.chapterId)).toBe(true);}
  expect(cursor).toBe(p.durationInFrames);expect(grouped.scenes[0].startFrame).toBe(0);
 });
 it('leaves empty narration editable without pretending it was transcribed',()=>{
  const p=createProject('빈 프로젝트',300);const grouped=groupScenes(p);expect(grouped.scenes).toHaveLength(38);expect(p.captions).toHaveLength(0);
 });
 it('marks source excerpts in headings, bodies and steps without modifying the original captions',()=>{
  const p=createProject('발췌',60);const source='할인이 적용되지 않는 조건도 함께 확인해야 합니다. 전체 내용을 검토하고 상황에 맞게 적용해 주세요. '.repeat(3).trim();
  p.captions=Array.from({length:12},(_,index)=>({id:`caption-excerpt-${index}`,text:source,startFrame:index*150,endFrame:(index+1)*150}));
  const original=JSON.stringify(p.captions);const grouped=groupScenes(p,8);
  expect(grouped.scenes.some(scene=>scene.template==='steps')).toBe(true);
  for(const scene of grouped.scenes) {
   expect(scene.heading.endsWith('…')).toBe(true);expect(displayUnits(scene.heading)).toBeLessThanOrEqual(28);
   if(scene.body)expect(scene.body.endsWith('…')).toBe(true);expect(displayUnits(scene.body)).toBeLessThanOrEqual(64);
   for(const item of scene.items){expect(item.title.endsWith('…')).toBe(true);expect(displayUnits(item.title)).toBeLessThanOrEqual(18);}
   expect(scene.notes).toContain('원문 발췌 초안');
  }
  expect(JSON.stringify(p.captions)).toBe(original);
 });
});

describe('source excerpts',()=>{
 it('ends at a whole-word boundary and reserves space for the ellipsis',()=>{
  const source='할인이 적용되지 않는 조건도 함께 확인해야 합니다.';const excerpt=shortText(source,18);
  expect(excerpt).toBe('할인이 적용되지 않는 조건도 함께…');
  expect(displayUnits(excerpt)).toBeLessThanOrEqual(18);
  const prefix=excerpt.slice(0,-1);expect(source.startsWith(prefix+' ')).toBe(true);
 });
 it('leaves complete text and its ending punctuation unchanged',()=>{
  const source='확인을 마쳤습니다.';expect(shortText(source,displayUnits(source))).toBe(source);
  expect(shortText('  확인을\n 마쳤습니다.  ',28)).toBe(source);expect(shortText('   ',18)).toBe('');
 });
 it('uses a character-boundary fallback only when the first word itself is too long',()=>{
  const source='띄어쓰기없이이어지는아주긴한국어단어를여기에표시합니다';const excerpt=shortText(source,18);
  expect(excerpt.endsWith('…')).toBe(true);expect(source.startsWith(excerpt.slice(0,-1))).toBe(true);
  expect(displayUnits(excerpt)).toBeLessThanOrEqual(18);expect(excerpt.length).toBeGreaterThan(1);
 });
});

describe('subtitle layout quality',()=>{
 it('wraps unspaced Korean without deleting text',()=>{
  const text='한글문장이띄어쓰기없이계속이어져도모든글자가보존되어야합니다';const lines=wrapCaption(text,12,4);
  expect(lines.join('')).toBe(text);expect(lines.every(line=>displayUnits(line)<=12)).toBe(true);
 });
 it('blocks overflow and overlapping captions while reporting missing audio as a warning',()=>{
  const p=createProject();p.captions=[{id:'caption-a',text:'가'.repeat(150),startFrame:0,endFrame:150},{id:'caption-b',text:'겹칩니다.',startFrame:120,endFrame:240}];
  const report=checkQuality(p);expect(report.ok).toBe(false);
  expect(report.issues.some(i=>i.code==='CAPTION_OVERFLOW'&&i.severity==='error')).toBe(true);
  expect(report.issues.some(i=>i.code==='CAPTION_OVERLAP'&&i.severity==='error')).toBe(true);
  expect(report.issues.some(i=>i.code==='NO_NARRATION'&&i.severity==='warning')).toBe(true);
 });
 it('blocks missing media and invalid compare item count',()=>{
  const p=createProject();p.scenes[0].template='media';
  expect(checkQuality(p).issues.some(i=>i.code==='MISSING_MEDIA'&&i.severity==='error')).toBe(true);
  p.scenes[0].template='compare';p.scenes[0].items=[{title:'하나만',body:''}];
  expect(checkQuality(p).issues.some(i=>i.code==='ITEM_COUNT'&&i.severity==='error')).toBe(true);
 });
 it('blocks forced line breaks and invisible accent colors',()=>{
  const p=createProject();p.scenes[0].heading='한 줄\n두 줄\n세 줄\n네 줄\n다섯 줄';p.settings.accent='#ffffff';
  const report=checkQuality(p);
  expect(report.issues.some(i=>i.code==='TEXT_LINE_OVERFLOW'&&i.severity==='error')).toBe(true);
  expect(report.issues.some(i=>i.code==='ACCENT_CONTRAST'&&i.severity==='error')).toBe(true);
 });
 it('assigns distinct issue IDs when several fields in the same scene are dense',()=>{
  const p=createProject();p.scenes[0].heading='가'.repeat(48);p.scenes[0].body='나'.repeat(110);p.scenes[0].kicker='다'.repeat(38);
  const report=checkQuality(p);expect(report.issues.filter(i=>i.code==='TEXT_DENSE').length).toBeGreaterThanOrEqual(3);
  expect(new Set(report.issues.map(i=>i.id)).size).toBe(report.issues.length);
 });
 it('keeps the maximum legal title and paragraph together above the subtitle region',()=>{
  const p=createProject();p.scenes[0].heading='가'.repeat(54);p.scenes[0].body='나'.repeat(126);p.scenes[0].kicker='보조 제목';
  const layout=sceneTextLayout(p.scenes[0]);expect(layout?.fits).toBe(true);expect(layout!.bottom).toBeLessThanOrEqual(866);
  expect(checkQuality(p).ok).toBe(true);
 });
 it('blocks combined text geometry when it cannot fit at the minimum font sizes',()=>{
  const p=createProject();p.scenes[0].template='quote';p.scenes[0].heading='한 줄\n두 줄\n세 줄\n네 줄';p.scenes[0].body='첫 줄\n둘째 줄\n셋째 줄';p.scenes[0].kicker='보조 제목';
  expect(sceneTextLayout(p.scenes[0])?.fits).toBe(false);
  expect(checkQuality(p).issues.some(i=>i.code==='TEXT_LAYOUT_OVERFLOW'&&i.severity==='error')).toBe(true);
 });
 it('rejects forced line breaks in a step item even when its character count is short',()=>{
  const p=createProject();p.scenes[0].template='steps';p.scenes[0].items=[{title:'첫 번째',body:'하나\n둘\n셋\n넷'},{title:'두 번째',body:''}];
  expect(checkQuality(p).issues.some(i=>i.code==='TEXT_LINE_OVERFLOW'&&i.severity==='error')).toBe(true);
 });
});
