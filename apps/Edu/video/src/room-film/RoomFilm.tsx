import {useLayoutEffect} from 'react';
import {AbsoluteFill,Audio,staticFile,useCurrentFrame} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import {useThree} from '@react-three/fiber';
import {DoubleSide,NoToneMapping,PCFShadowMap,PerspectiveCamera,SRGBColorSpace} from 'three';
import {fontFamily} from '../fonts';
import {StudioRoom} from './StudioRoom';
import {Protagonist,StudioAgent} from './Characters';
import {ease,filmState,type FilmState,type Vec3} from './story';

const CameraRig=({state}:{state:FilmState})=>{
  const {camera}=useThree();
  useLayoutEffect(()=>{
    camera.position.set(...state.camera);camera.lookAt(...state.target);
    if(camera instanceof PerspectiveCamera){camera.fov=state.fov;camera.updateProjectionMatrix();}
    camera.updateMatrixWorld();
  },[camera,state]);
  return null;
};

const PaperPass=({frame,from,via,to,at}:{frame:number;from:Vec3;via:Vec3;to:Vec3;at:number})=>{
  if(frame<at||frame>at+45)return null;
  const p=ease((frame-at)/45);
  const curve=(i:number)=>(1-p)**2*from[i]+2*(1-p)*p*via[i]+p*p*to[i];
  const position:Vec3=[curve(0),curve(1),curve(2)];
  return <group position={position} rotation={[-Math.PI/2+.15*Math.sin(p*Math.PI),0,p*.2]}>
    <mesh castShadow><planeGeometry args={[.44,.58]}/><meshToonMaterial color="#fffdf6" side={DoubleSide}/></mesh>
    <mesh position={[0,.1,.006]}><planeGeometry args={[.26,.17]}/><meshBasicMaterial color="#dfe8fa" side={DoubleSide}/></mesh>
    {[0,-.08,-.16].map((y,i)=><mesh key={y} position={[-.025,y,.008]}><planeGeometry args={[i===2?.18:.29,.012]}/><meshBasicMaterial color="#242626" side={DoubleSide}/></mesh>)}
  </group>;
};

const Caption=({frame}:{frame:number})=>{
  let text='',sub='',start=0,end=0;
  if(frame>=330&&frame<414){text='홍보 콘텐츠 만들기';start=330;end=414;}
  if(frame>=425&&frame<505){text='멈춰 보게 만드는 기획';sub='첫 3초 · 제목 · 썸네일';start=425;end=505;}
  if(frame>=515&&frame<655){text='상품 사진이 홍보물로';sub='문구 · 이미지 · 우리 브랜드 템플릿';start=515;end=655;}
  if(frame>=665&&frame<775){text='확인하고, 직접 고치기';sub='가격 · 문구 · 고객 반응';start=665;end=775;}
  if(!text)return null;
  const opacity=ease((frame-start)/12)*(1-ease((frame-(end-10))/10));
  const position=frame<414?{top:34}:{bottom:64};
  return <div style={{position:'absolute',left:68,...position,color:'#242626',opacity,padding:'20px 26px 20px 0',fontFamily,pointerEvents:'none'}}>
    <div style={{fontSize:49,fontWeight:730,letterSpacing:-1.5,lineHeight:1.2}}>{text}</div>
    {sub?<div style={{fontSize:25,fontWeight:480,marginTop:13,letterSpacing:-.5}}>{sub}</div>:null}
  </div>;
};

export const RoomFilm=()=>{
  const frame=useCurrentFrame(),state=filmState(frame);
  const close=ease((frame-798)/35);
  return <AbsoluteFill style={{background:'#fafaf7',fontFamily}}>
    <ThreeCanvas width={1920} height={1080} dpr={1} shadows={{type:PCFShadowMap}} camera={{fov:49,near:.08,far:70,position:[.24,1.91,9.75]}} gl={{antialias:true,alpha:false,preserveDrawingBuffer:true}} onCreated={({gl})=>{
      gl.setClearColor('#fafaf7');gl.toneMapping=NoToneMapping;gl.outputColorSpace=SRGBColorSpace;gl.shadowMap.type=PCFShadowMap;
    }}>
      <CameraRig state={state}/>
      <ambientLight intensity={1.35}/>
      <directionalLight castShadow position={[-3,8,4]} intensity={2.0} shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} shadow-bias={-.0004} shadow-normalBias={.025}/>
      <directionalLight position={[4,5,-6]} intensity={.6}/>
      <StudioRoom frame={frame} fps={30} doorOpen={state.door} phase={state.phase}/>
      <Protagonist frame={frame} fps={30} position={state.hero} rotation={Math.PI} walking={state.walking}/>
      <StudioAgent frame={frame} fps={30} index={0} role="plan" position={[-3.3,0,-1.05]} rotation={Math.PI}/>
      <StudioAgent frame={frame} fps={30} index={1} role="make" position={[0,0,-4.25]} rotation={Math.PI}/>
      <StudioAgent frame={frame} fps={30} index={2} role="review" position={[3.3,0,-1.05]} rotation={Math.PI}/>
      <PaperPass frame={frame} from={[-3.3,1.25,-1.6]} via={[-.8,1.8,-1.6]} to={[-.85,1.25,-5]} at={485}/>
      <PaperPass frame={frame} from={[.9,1.25,-5]} via={[1.1,1.95,-1.3]} to={[2.4,1.25,-1.8]} at={645}/>
    </ThreeCanvas>
    <Caption frame={frame}/>
    <div style={{position:'absolute',right:66,top:48,fontSize:25,letterSpacing:-.8,fontWeight:730,color:'#242626',opacity:ease((frame-295)/20)*(1-ease((frame-780)/20))}}>BiaDone Edu</div>
    <div style={{position:'absolute',inset:0,background:'#fafaf7',opacity:close*.93,pointerEvents:'none'}}/>
    <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center',opacity:close,color:'#242626',transform:`translateY(${(1-close)*12}px)`}}>
      <div style={{fontSize:77,fontWeight:730,letterSpacing:-3.1,lineHeight:1.4}}>만들고, 써보고, 스스로 고칩니다.</div>
      <div style={{marginTop:45,fontSize:36,fontWeight:650,letterSpacing:-1.4}}>BiaDone Edu</div>
    </div>
    <Audio src={staticFile('room-film/room-film-master.wav')}/>
  </AbsoluteFill>;
};
