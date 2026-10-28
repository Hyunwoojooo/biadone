export const ROOM_FILM_FPS=30;
export const ROOM_FILM_FRAMES=900;
export type Vec3=[number,number,number];
export type RoomShot='entry'|'reveal'|'plan'|'make'|'review'|'wide';
export const clamp=(x:number)=>Math.min(1,Math.max(0,x));
export const ease=(x:number)=>{const t=clamp(x);return t*t*(3-2*t);};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const vector=(a:Vec3,b:Vec3,t:number):Vec3=>[mix(a[0],b[0],t),mix(a[1],b[1],t),mix(a[2],b[2],t)];
export type FilmState={shot:RoomShot;camera:Vec3;target:Vec3;fov:number;hero:Vec3;walking:boolean;door:number;phase:number};
export function filmState(frame:number):FilmState{
  const walk=ease((frame-23)/204);
  const hero:Vec3=[0,0,mix(7.6,.9,walk)];
  const common={hero,walking:frame>=24&&frame<227,door:ease((frame-65)/57),phase:clamp((frame-300)/480)};
  if(frame<227){
    const p=ease((frame-23)/204);
    return {...common,shot:'entry',camera:vector([.24,1.91,9.75],[.62,1.91,3.05],p),target:vector([0,1.9,3.9],[0,1.35,-2.5],p),fov:mix(51,49,p)};
  }
  if(frame<420){
    const p=ease((frame-227)/110),drift=clamp((frame-337)/83);
    return {...common,shot:'reveal',camera:vector([.62,1.91,3.05],[4.5-.22*drift,3.45-.1*drift,2.65-.15*drift],p),target:vector([0,1.35,-2.5],[0,1.2,-3.2],p),fov:mix(49,59,p)};
  }
  if(frame<510){const p=ease((frame-420)/89);return {...common,shot:'plan',camera:vector([.15,2.6,.5],[-.45,2.4,.15],p),target:[-3.3,1.35,-2.0],fov:48};}
  if(frame<660){const p=ease((frame-510)/149);return {...common,shot:'make',camera:vector([-2.7,2.55,-2.2],[-2.15,2.38,-2.55],p),target:[.05,1.45,-5.25],fov:48};}
  if(frame<780){const p=ease((frame-660)/119);return {...common,shot:'review',camera:vector([.5,2.65,.2],[.9,2.45,-.15],p),target:[3.3,1.3,-2.1],fov:48};}
  const p=ease((frame-780)/119);return {...common,shot:'wide',camera:vector([-4.25,3.4,2.4],[-4.6,3.65,2.8],p),target:[0,1.2,-3.2],fov:59};
}
