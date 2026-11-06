import type {CSSProperties,ReactNode} from 'react';
import {AbsoluteFill,Audio,Sequence,staticFile,useCurrentFrame} from 'remotion';
import {fontFamily} from '../fonts';
import {TIMELINE,TOTAL_FRAMES,FPS} from '../curriculum/timing';
import type {SceneId} from '../curriculum/types';
import {COURSES} from './campus-data';
import {MapStage} from './MapStage';
import {RoomBoard} from './RoomBoard';
import {mixCamera,ROOM_NAMES,smooth,tourState} from './tour-state';

export const CAMPUS_TOUR_FRAMES=TOTAL_FRAMES;
export const CAMPUS_TOUR_FPS=FPS;
const INK='#222b32',PAPER='#f7f7f3',BLUE='#3437ee';
const SMALL_MAP={width:720,height:820};
const BOARD={width:1050,height:820};
const enter=(frame:number,at=0,length=16)=>smooth((frame-at)/length);
const courseFor=(id:string)=>{
  const c=COURSES.find(item=>item.id===id);if(!c)throw new Error(`Missing course ${id}`);return c;
};
const AsideText=({children,style}: {children:ReactNode;style?:CSSProperties})=><div style={{position:'absolute',left:1385,top:235,width:465,...style}}>{children}</div>;
const BigLine=({children}: {children:ReactNode})=><div style={{fontSize:54,lineHeight:1.24,fontWeight:730,letterSpacing:-2,wordBreak:'keep-all'}}>{children}</div>;

const Welcome=({kind,frame,duration}:{kind:'intro'|'approach'|'choice'|'closing';frame:number;duration:number})=>{
  const state=tourState(kind,frame);
  let camera={cx:600,cy:450,zoom:1.01};
  if(kind==='intro')camera=mixCamera({cx:600,cy:450,zoom:.97},{cx:600,cy:450,zoom:1.02},smooth(frame/(duration-25)));
  if(kind==='approach')camera=mixCamera({cx:620,cy:490,zoom:1.08},{cx:615,cy:650,zoom:1.15},smooth(frame/170));
  if(kind==='closing')camera=mixCamera({cx:600,cy:450,zoom:1.03},{cx:600,cy:450,zoom:1},smooth(frame/180));
  const heading=kind==='intro'?'내 사업에 필요한 AI를 한 공간에서.':kind==='approach'?'내 자료에서 시작합니다.':kind==='choice'?'필요한 방을 골라 들어갑니다.':'만들고, 써보고, 스스로 고칩니다.';
  return <>
    <div style={{position:'absolute',left:32,top:168}}>
      <MapStage width={1320} height={830} frame={frame} position={state.position} facing={state.facing} walking={state.walking} camera={camera} showLabels={kind!=='approach'} highlightRoom={kind==='approach'?'F':undefined} route={state.walking?state.remaining:[]}/>
    </div>
    <AsideText style={{opacity:enter(frame,8)}}>
      <div style={{fontSize:23,color:BLUE,fontWeight:650,marginBottom:22}}>{kind==='choice'?'목적별 선택 과정':kind==='closing'?'BiaDone Edu':'수업의 문을 열어보세요'}</div>
      <BigLine>{heading}</BigLine>
      {kind==='intro'?<div style={{marginTop:48}}>{['홍보 콘텐츠','사업 소개 웹페이지','고객 문의 · 매출 자료'].map((text,i)=><div key={text} style={{borderTop:'1px solid #cdd3d1',padding:'22px 0',fontSize:29,fontWeight:450,opacity:enter(frame,45+i*24)}}>{text}</div>)}</div>:null}
      {kind==='approach'?<div style={{marginTop:42}}>{['상품 사진 · 가격표 · 고객 질문','AI와 함께 만들고','결과를 확인하고 직접 수정'].map((text,i)=><div key={text} style={{borderTop:'1px solid #cdd3d1',padding:'24px 0',fontSize:29,lineHeight:1.5,fontWeight:i===2?700:450,opacity:enter(frame,32+i*38)}}>{text}</div>)}</div>:null}
      {kind==='choice'?<div style={{marginTop:30}}>{COURSES.filter(c=>/^[A-E]$/.test(c.id)).map((c,i)=><div key={c.id} style={{display:'flex',alignItems:'center',gap:18,padding:'17px 0',borderTop:'1px solid #cdd3d1',opacity:enter(frame,24+i*12)}}><span style={{fontSize:22,fontWeight:700,color:c.ink,width:31}}>{c.id}</span><span style={{fontSize:28,fontWeight:550,letterSpacing:-.7}}>{c.short}</span></div>)}</div>:null}
      {kind==='closing'?<>
        <div style={{fontSize:29,lineHeight:1.65,marginTop:38,wordBreak:'keep-all'}}>내 사업을 이해하는 도구와<br/>일하는 방식을 만들어갑니다.</div>
        <div style={{marginTop:55,paddingTop:26,borderTop:'1px solid #aeb8b5',fontSize:43,fontWeight:750,letterSpacing:-1.2}}>BiaDone Edu</div>
      </>:null}
    </AsideText>
  </>;
};

const RoomVisit=({id,frame,duration}:{id:SceneId;frame:number;duration:number})=>{
  const state=tourState(id,frame);
  const course=courseFor(state.common?'S':state.room!);
  const boardAt=id==='foundation'?26:state.boardAt;
  const boardEnter=enter(frame,boardAt,12);
  return <>
    <div style={{position:'absolute',left:50,top:175}}>
      <MapStage {...SMALL_MAP} frame={frame} position={state.position} facing={state.facing} walking={state.walking} camera={state.camera} highlightRoom={state.room} showLabels={false} route={state.walking?state.remaining:[]}/>
      <div style={{position:'absolute',left:25,top:25,backgroundColor:'#fffffcee',borderLeft:`4px solid ${course.ink}`,padding:'12px 18px',fontSize:24,fontWeight:600,color:course.ink,opacity:enter(frame,8)}}>{state.common?'모든 과정에서 함께':ROOM_NAMES[state.room!]}</div>
    </div>
    <div style={{position:'absolute',left:810,top:175,opacity:boardEnter,transform:`translateX(${(1-boardEnter)*22}px)`}}>
      <RoomBoard {...BOARD} course={course} frame={Math.max(0,frame-boardAt)} durationInFrames={duration-boardAt} />
    </div>
    {frame<boardAt+12?<div style={{position:'absolute',left:835,top:265,width:970,opacity:(1-boardEnter)*enter(frame,7),color:INK}}>
      <div style={{fontSize:25,fontWeight:600,color:course.ink,marginBottom:22}}>{course.group}</div>
      <div style={{fontSize:61,fontWeight:750,lineHeight:1.3,letterSpacing:-2,wordBreak:'keep-all'}}>{course.short}</div>
      <div style={{fontSize:28,marginTop:32,color:'#65717a'}}>방으로 이동하고 있습니다.</div>
    </div>:null}
  </>;
};

const TourScene=({id,duration}:{id:SceneId;duration:number})=>{
  const frame=useCurrentFrame();
  const fade=enter(frame,0,10)*(1-enter(frame,duration-7,6));
  const isWelcome=id==='intro'||id==='approach'||id==='choice'||id==='closing';
  return <AbsoluteFill style={{opacity:fade}}>
    {isWelcome?<Welcome kind={id} frame={frame} duration={duration}/>:<RoomVisit id={id} frame={frame} duration={duration}/>}
  </AbsoluteFill>;
};

export const CampusTour=()=>{
  return <AbsoluteFill style={{backgroundColor:PAPER,color:INK,fontFamily,fontWeight:400}}>
    <div style={{position:'absolute',left:64,top:53,fontSize:31,fontWeight:750,letterSpacing:-.7}}>BiaDone Edu</div>
    <div style={{position:'absolute',right:64,top:59,fontSize:23,color:'#65717a',fontWeight:450}}>내 사업에 필요한 AI를 한 공간에서.</div>
    <div style={{position:'absolute',left:64,right:64,top:120,height:1,backgroundColor:'#cdd3d1'}}/>
    {TIMELINE.map(entry=><Sequence key={entry.scene.id} from={entry.from} durationInFrames={entry.durationInFrames} name={`캠퍼스 · ${entry.scene.eyebrow}`} layout="none"><TourScene id={entry.scene.id} duration={entry.durationInFrames}/></Sequence>)}
    <Audio src={staticFile('campus-tour/narration-master.wav')}/>
  </AbsoluteFill>;
};
