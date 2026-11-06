import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {createProject} from '../src/domain/project';
import type {Scene} from '../src/shared/types';
import {SceneVisual} from '../src/video/Composition';
import {MOTION_GRAPHIC_LIMITS,motionGraphicLayout,motionGraphicProgress} from '../src/video/layout';

function scene(template:'list'|'stat'|'flow',count:number):Scene {
  const base=createProject('모션그래픽 검증',4).scenes[0];
  return {...base,template,heading:'같은 기준으로 만드는 영상',kicker:'제작 흐름',body:'내용을 확인하고 필요한 부분에 집중합니다.',items:Array.from({length:count},(_,index)=>({title:template==='stat'?['37%','3배','월 2시간'][index]??'1':`항목 ${index+1}`,body:'같은 기준으로\n확인합니다.'}))};
}

describe('내장 list/stat/flow 모션그래픽',()=>{
  it('각 허용 항목 수에서 모든 문구와 도형이 안전 영역에 들어간다',()=>{
    for(const template of ['list','stat','flow'] as const) {
      const limits=MOTION_GRAPHIC_LIMITS[template];
      for(let count=limits.minItems;count<=limits.maxItems;count++) {
        const value=scene(template,count);
        // Checklist rows deliberately use one-line descriptions.
        if(template==='list')value.items=value.items.map(item=>({...item,body:'같은 기준으로 확인합니다.'}));
        const layout=motionGraphicLayout(value)!;
        expect(layout.fits,`${template}/${count}: ${layout.issues.join(', ')}`).toBe(true);
        expect(layout.items).toHaveLength(count);
        expect(layout.bottom).toBeLessThanOrEqual(866);
        for(const item of layout.items) {
          expect(item.title.fontSize).toBeGreaterThanOrEqual(item.title.minFontSize);
          expect(item.title.lines.length).toBeLessThanOrEqual(item.title.maxLines);
          expect(item.body?.lines.length??0).toBeLessThanOrEqual(item.body?.maxLines??0);
        }
        expect(layout.connectors).toHaveLength(template==='flow'?count-1:0);
      }
    }
  });
  it('수치 문구를 계산하거나 카운트업하지 않고 시작과 끝 프레임에 그대로 표시한다',()=>{
    const project=createProject('수치 검증',4);
    const value=scene('stat',3);
    const markup=(frame:number)=>renderToStaticMarkup(React.createElement(SceneVisual,{scene:value,settings:project.settings,assets:[],assetBaseUrl:'',frame}));
    for(const frame of [0,37,value.durationInFrames-1]) {
      const html=markup(frame);
      for(const text of ['37%','3배','월 2시간'])expect(html).toContain(text);
      expect((html.match(/data-graphic-item=/g)??[]).length).toBe(3);
    }
  });
  it('흐름도 화살표와 체크리스트의 모든 항목을 실제 마크업에 보존한다',()=>{
    const project=createProject('연결과 목록 검증',4);
    const flow=scene('flow',4);
    const markup=renderToStaticMarkup(React.createElement(SceneVisual,{scene:flow,settings:project.settings,assets:[],assetBaseUrl:'',frame:90}));
    expect((markup.match(/data-graphic-arrow=/g)??[]).length).toBe(3);
    for(let index=0;index<4;index++)expect(markup).toContain(`항목 ${index+1}`);
    const list=scene('list',5);
    list.items=list.items.map(item=>({...item,body:'확인합니다.'}));
    const checklist=renderToStaticMarkup(React.createElement(SceneVisual,{scene:list,settings:project.settings,assets:[],assetBaseUrl:'',frame:90}));
    expect((checklist.match(/data-graphic-item=/g)??[]).length).toBe(5);
    expect((checklist.match(/확인합니다\./g)??[]).length).toBe(5);
  });
  it('목록/흐름도/수치의 잘못된 수와 넘치는 문구는 잘라 숨기지 않는다',()=>{
    expect(motionGraphicLayout(scene('list',6))?.fits).toBe(false);
    expect(motionGraphicLayout(scene('flow',1))?.fits).toBe(false);
    expect(motionGraphicLayout(scene('stat',4))?.fits).toBe(false);
    const long=scene('list',5);long.items[4].title='가'.repeat(50);
    const layout=motionGraphicLayout(long)!;
    expect(layout.fits).toBe(false);
    expect(layout.items[4].title.lines.join('')).toBe('가'.repeat(50));
    const footer=scene('flow',4);footer.body='설명\n설명';
    expect(motionGraphicLayout(footer)?.issues).toContain('footer:line-limit');
  });
  it('짧은 장면과 모든 움직임에서 마지막 항목까지 결정적으로 입장을 마친다',()=>{
    for(const motion of ['calm','standard','lively'] as const)for(const duration of [15,24,60,180]) {
      const value={...scene('list',5),motion,durationInFrames:duration};
      for(let index=0;index<5;index++) {
        expect(motionGraphicProgress(value,0,index)).toBe(0);
        expect(motionGraphicProgress(value,duration-1,index)).toBe(1);
        const middle=motionGraphicProgress(value,Math.floor(duration/3),index);
        motionGraphicProgress(value,duration-1,index);
        motionGraphicProgress(value,0,index);
        expect(motionGraphicProgress(value,Math.floor(duration/3),index)).toBe(middle);
      }
    }
    expect(motionGraphicProgress({...scene('list',5),durationInFrames:1},0,4)).toBe(1);
  });
});
