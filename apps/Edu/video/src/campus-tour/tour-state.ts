import {MAP} from './campus-data';
import type {SceneId} from '../curriculum/types';
import type {Camera, MapStageProps, Point, RoomId} from './types';

type Plan = {nodes: string[]; room?: RoomId; common?: boolean; travelFrames: number};
export const TOUR_PLANS: Record<SceneId, Plan> = {
  intro: {nodes: ['entry','front'], travelFrames: 95},
  approach: {nodes: ['front','leftFront','F-door'], room:'F', travelFrames:145},
  foundation: {nodes: ['F-door'], room:'F', travelFrames:28},
  choice: {nodes: ['F-door','leftFront','westPass','south','center'], travelFrames:118},
  content: {nodes: ['center','west','A-front','A-door'], room:'A', travelFrames:54},
  website: {nodes: ['A-door','A-front','west','north','B-front','B-door'], room:'B', travelFrames:70},
  inquiry: {nodes: ['B-door','B-front','north','east','C-front','C-door'], room:'C', travelFrames:62},
  data: {nodes: ['C-door','C-front','east','D-front','D-door'], room:'D', travelFrames:58},
  tool: {nodes: ['D-door','D-front','east','eastSouth','E-front','E-door'], room:'E', travelFrames:64},
  team: {nodes: ['E-door','E-front','eastSouth','east','center','south','westPass','T-front','T-door'], room:'T', travelFrames:94},
  operations: {nodes: ['T-door','T-front','westPass','south','center'], common:true, travelFrames:64},
  closing: {nodes: ['center'], travelFrames:1},
};

export const ROOM_CAMERAS: Record<RoomId,Camera> = {
  F:{cx:655,cy:675,zoom:2.65}, A:{cx:280,cy:365,zoom:2.65},
  B:{cx:550,cy:190,zoom:2.85}, C:{cx:865,cy:225,zoom:2.75},
  D:{cx:1005,cy:420,zoom:2.7}, E:{cx:980,cy:665,zoom:2.65},
  T:{cx:255,cy:640,zoom:2.5},
};
export const ROOM_NAMES: Record<RoomId,string> = {
  F:'기초 자료실', A:'홍보 콘텐츠 스튜디오', B:'웹페이지 제작실',
  C:'고객 문의 접수실', D:'매출 분석실', E:'업무 도구 제작실', T:'AI 업무팀 회의실',
};
export const clamp=(n:number)=>Math.max(0,Math.min(1,n));
export const smooth=(n:number)=>{const p=clamp(n);return p*p*(3-2*p);};
export const mix=(a:number,b:number,p:number)=>a+(b-a)*p;
export const mixCamera=(a:Camera,b:Camera,p:number):Camera=>({cx:mix(a.cx,b.cx,p),cy:mix(a.cy,b.cy,p),zoom:mix(a.zoom,b.zoom,p)});
export const pathFor=(id:SceneId):Point[]=>TOUR_PLANS[id].nodes.map(name=>{
  const node=MAP.nodes.find(n=>n.id===name);
  if(!node)throw new Error(`Missing campus node: ${name}`);
  return {x:node.x,y:node.y};
});
const facing=(a:Point,b:Point):MapStageProps['facing']=>Math.abs(b.x-a.x)>Math.abs(b.y-a.y)?(b.x>a.x?'right':'left'):(b.y>a.y?'down':'up');

export const sampleRoute=(points:Point[],progress:number)=>{
  if(points.length===1)return {position:points[0],facing:'up' as const,remaining:points};
  const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y));
  let distance=clamp(progress)*lengths.reduce((a,b)=>a+b,0);
  for(let i=0;i<lengths.length;i++){
    if(distance<=lengths[i]||i===lengths.length-1){
      const p=clamp(distance/Math.max(1,lengths[i]));
      const position={x:mix(points[i].x,points[i+1].x,p),y:mix(points[i].y,points[i+1].y,p)};
      return {position,facing:facing(points[i],points[i+1]),remaining:[position,...points.slice(i+1)]};
    }
    distance-=lengths[i];
  }
  return {position:points.at(-1)!,facing:'up' as const,remaining:[]};
};

export const tourState=(id:SceneId,frame:number)=>{
  const plan=TOUR_PLANS[id];
  const progress=clamp((frame-7)/Math.max(1,plan.travelFrames-7));
  const state=sampleRoute(pathFor(id),progress);
  const walking=pathFor(id).length>1&&frame>=7&&progress<1;
  const roomCamera=plan.room?ROOM_CAMERAS[plan.room]:{cx:600,cy:450,zoom:1};
  const follow={cx:state.position.x,cy:state.position.y-65,zoom:1.3};
  const settle=smooth((frame-plan.travelFrames*.68)/(plan.travelFrames*.32+20));
  return {...state,walking,room:plan.room,common:plan.common,camera:mixCamera(follow,roomCamera,settle),boardAt:plan.travelFrames+6};
};
