import React, {useEffect, useMemo, useState} from 'react';
import {AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, continueRender, delayRender, cancelRender, useCurrentFrame} from 'remotion';
import '@fontsource-variable/noto-sans-kr';
import type {Asset, Project, ProjectSettings, Scene} from '../shared/types';
import {activeCaption, activeScene, fitVideoText, mediaAssetUrl, motionGraphicLayout, motionGraphicProgress, sceneTextLayout, VIDEO_LAYOUT, videoPalette, type VideoPalette, type VideoTextGeometry} from './layout';

export type VideoCompositionProps = {project:Project;assetBaseUrl:string;showGuides?:boolean};
export interface SceneVisualProps {
  scene:Scene; settings:ProjectSettings; assets:Asset[]; assetBaseUrl:string;
  frame?:number; waveform?:number[]; globalFrame?:number; waveformProgress?:number;
}

function useLocalFonts() {
  const [handle] = useState(() => delayRender('로컬 한글 글꼴을 준비하고 있습니다.'));
  useEffect(() => {
    let disposed = false;
    Promise.all([
      document.fonts.load('400 40px "Noto Sans KR Variable"'),
      document.fonts.load('700 72px "Noto Sans KR Variable"'),
      document.fonts.load('800 112px "Noto Sans KR Variable"'),
    ]).then(() => document.fonts.ready).then(() => {
      if (!disposed) continueRender(handle);
    }).catch((error:unknown) => cancelRender(error instanceof Error ? error : new Error('글꼴을 불러오지 못했습니다.')));
    return () => { disposed = true; continueRender(handle); };
  }, [handle]);
}

const clamp = (value:number, low:number, high:number) => Math.max(low, Math.min(high, value));
const ease = (frame:number, delay=0, duration=20) => {
  const value = clamp((frame-delay)/duration, 0, 1);
  return 1 - Math.pow(1-value, 3);
};

function TextBlock({text, width, size, lines=2, min=34, style, qa}:{text:string;width:number;size:number;lines?:number;min?:number;style?:React.CSSProperties;qa?:string}) {
  const fit = fitVideoText(text, width, size, lines, min);
  return <div data-video-text={qa} style={{width,maxWidth:width,fontSize:fit.fontSize,lineHeight:1.28,whiteSpace:'pre-wrap',overflowWrap:'anywhere',...style}}>{fit.lines.join('\n')}</div>;
}

function Backdrop({palette}:{palette:VideoPalette}) {
  return <AbsoluteFill style={{backgroundColor:palette.background,overflow:'hidden'}}>
    <div style={{position:'absolute',right:-180,top:-300,width:680,height:680,borderRadius:'50%',border:`110px solid ${palette.accentWash}`,opacity:0.72}} />
    <div style={{position:'absolute',left:130,top:92,width:188,height:188,borderRadius:'50%',background:palette.accentWash,opacity:0.68}} />
    <div style={{position:'absolute',left:-140,bottom:-200,width:500,height:500,borderRadius:'50%',background:palette.accentWash,opacity:0.62}} />
  </AbsoluteFill>;
}

function Topic({text,palette,align='center',width=1688}:{text:string;palette:VideoPalette;align?:'left'|'center';width?:number}) {
  if (!text) return null;
  return <TextBlock qa="topic" text={text} width={width} size={32} lines={1} min={26} style={{fontWeight:500,color:palette.secondary,textAlign:align,letterSpacing:0.1}} />;
}

function StepSymbol({index,color}:{index:number;color:string}) {
  const common={fill:'none',stroke:color,strokeWidth:7,strokeLinecap:'round' as const,strokeLinejoin:'round' as const};
  return <svg width="80" height="80" viewBox="0 0 100 100" aria-hidden="true">
    {index%3===0 ? <g {...common}><path d="M74 28A32 32 0 0 0 20 50"/><path d="m75 12 4 21-21-4"/><path d="M26 72A32 32 0 0 0 80 50"/><path d="m25 88-4-21 21 4"/></g> : index%3===1 ? <g {...common}><path d="M69 37V15H17v65h29"/><path d="M29 30h27M29 44h18"/><circle cx="66" cy="64" r="16"/><path d="m78 76 13 13"/></g> : <g {...common}><rect x="12" y="60" width="16" height="27"/><rect x="42" y="40" width="16" height="47"/><rect x="72" y="14" width="16" height="73"/></g>}
  </svg>;
}

function SceneHeading({scene,palette,frame}:{scene:Scene;palette:VideoPalette;frame:number}) {
  const amount=ease(frame,0,scene.motion==='calm'?28:18);
  const heading=scene.heading || scene.title;
  const headingSize=fitVideoText(heading,1688,78,2,48).lines.length>1?66:78;
  return <div style={{position:'absolute',left:116,top:84,width:1688,opacity:0.35+amount*0.65,transform:`translateY(${(1-amount)*14}px)`}}>
    <Topic text={scene.kicker} palette={palette}/>
    <TextBlock qa="heading" text={heading} width={1688} size={headingSize} lines={2} min={48} style={{fontWeight:850,letterSpacing:-2.1,lineHeight:1.2,textAlign:'center',marginTop:28,color:palette.foreground}} />
  </div>;
}

function NarrativeText({scene,palette,frame}:{scene:Scene;palette:VideoPalette;frame:number}) {
  const layout=useMemo(()=>sceneTextLayout(scene),[scene]);
  if(!layout)return null;
  const intro=scene.template==='character'?1:ease(frame,0,scene.motion==='calm'?28:scene.template==='quote'?26:20);
  return <AbsoluteFill data-text-layout-fits={layout.fits} style={{transform:`translateY(${(1-intro)*layout.introOffset}px)`,opacity:0.3+intro*0.7}}>
    {layout.decorations.map((decoration,index)=>decoration.kind==='rule'
      ? <div key={index} style={{position:'absolute',left:decoration.x,top:decoration.y,width:decoration.width,height:decoration.height,background:palette.accent,borderRadius:8}}/>
      : <div key={index} style={{position:'absolute',left:decoration.x,top:decoration.y,width:decoration.width,height:decoration.height,fontSize:164,lineHeight:.9,fontWeight:800,color:palette.accent,fontFamily:'Georgia, serif'}}>“</div>)}
    {layout.blocks.map(block=><div key={block.key} data-video-text={block.key} style={{
      position:'absolute',left:block.x,top:block.y,width:block.width,fontSize:block.fontSize,lineHeight:block.lineHeight,
      whiteSpace:'pre-wrap',overflowWrap:'anywhere',color:block.key==='heading'?palette.foreground:palette.secondary,
      fontWeight:block.key==='heading'?(scene.template==='quote'?800:850):block.key==='topic'?500:450,
      letterSpacing:block.key==='heading'?(scene.template==='title'?-3.4:-2):block.key==='topic'?.1:0,
    }}>{block.lines.join('\n')}</div>)}
  </AbsoluteFill>;
}

function TitleScene(props:{scene:Scene;palette:VideoPalette;frame:number}) {return <NarrativeText {...props}/>;}
function QuoteScene(props:{scene:Scene;palette:VideoPalette;frame:number}) {return <NarrativeText {...props}/>;}

function CompareScene({scene,palette,frame}:{scene:Scene;palette:VideoPalette;frame:number}) {
  const items=scene.items.slice(0,2);
  return <>
    <SceneHeading scene={scene} palette={palette} frame={frame}/>
    <div style={{position:'absolute',left:152,right:152,top:330,height:520,display:'flex',gap:44}}>
      {[0,1].map((index)=> {
        const item=items[index];
        const intro=ease(frame,index*6+4,scene.motion==='calm'?26:20);
        return <div key={index} style={{position:'relative',width:786,padding:'38px 48px',boxSizing:'border-box',background:palette.surface,border:`2px solid ${index===1?palette.accent:palette.line}`,borderRadius:24,boxShadow:'0 12px 30px rgba(18,40,30,.04)',opacity:0.25+intro*0.75,transform:`translateY(${(1-intro)*18}px)`}}>
          <div style={{fontSize:22,lineHeight:1.2,fontWeight:700,letterSpacing:2,color:palette.accent,marginBottom:16}}>{index===0?'A':'B'}</div>
          <TextBlock qa={`item-${index}-title`} text={item?.title || '항목을 입력하세요'} width={686} size={54} lines={2} min={36} style={{fontWeight:800,lineHeight:1.25,color:palette.foreground,letterSpacing:-1.5}}/>
          {item?.body && <TextBlock qa={`item-${index}-body`} text={item.body} width={686} size={30} lines={3} min={26} style={{fontWeight:450,color:palette.secondary,lineHeight:1.45,marginTop:20}}/>}
        </div>;
      })}
    </div>
  </>;
}

function StepsScene({scene,palette,frame}:{scene:Scene;palette:VideoPalette;frame:number}) {
  const items=scene.items.slice(0,4);
  const count=Math.max(1,items.length);
  const gap=34;
  const width=(1688-(count-1)*gap)/count;
  return <>
    <SceneHeading scene={scene} palette={palette} frame={frame}/>
    <div style={{position:'absolute',left:116,right:116,top:330,height:520,display:'flex',gap}}>
      {items.map((item,index)=> {
        const intro=ease(frame,index*(scene.motion==='lively'?6:9)+5,scene.motion==='calm'?28:22);
        return <div key={index} style={{width,padding:'24px 30px 20px',boxSizing:'border-box',background:palette.surface,border:`1px solid ${palette.line}`,borderRadius:24,boxShadow:'0 12px 28px rgba(18,40,30,.055)',display:'flex',flexDirection:'column',alignItems:'center',opacity:0.25+intro*0.75,transform:`translateY(${(1-intro)*20}px)`}}>
          <div style={{fontSize:count>3?96:110,fontWeight:850,letterSpacing:-5,lineHeight:1.05,color:palette.accent}}>{String(index+1).padStart(2,'0')}</div>
          <div style={{marginTop:10,marginBottom:16,opacity:0.8,lineHeight:0}}><StepSymbol index={index} color={palette.accent}/></div>
          <TextBlock qa={`item-${index}-title`} text={item.title} width={width-60} size={count>3?36:44} lines={2} min={28} style={{textAlign:'center',lineHeight:1.22,fontWeight:800,color:palette.foreground,letterSpacing:-1.2}}/>
          {item.body && <TextBlock qa={`item-${index}-body`} text={item.body} width={width-60} size={28} lines={3} min={24} style={{textAlign:'center',fontWeight:450,color:palette.secondary,lineHeight:1.4,marginTop:14}}/>}
        </div>;
      })}
    </div>
  </>;
}

function GraphicText({block,palette,role,align='center',qa}:{block:VideoTextGeometry;palette:VideoPalette;role:'header'|'item'|'footer'|'label'|'value';align?:'left'|'center';qa:string}) {
  const heading=block.key==='heading';
  return <div data-video-text={qa} style={{
    position:'absolute',left:block.x,top:block.y,width:block.width,fontSize:block.fontSize,lineHeight:block.lineHeight,
    whiteSpace:'pre-wrap',overflowWrap:'anywhere',textAlign:align,
    color:role==='value'?palette.accent:heading||role==='label'?palette.foreground:palette.secondary,
    fontWeight:role==='value'?850:heading?(role==='header'?850:780):block.key==='topic'?500:role==='label'?550:450,
    letterSpacing:role==='value'?-4:heading?(role==='header'?-2.1:-.7):0,
  }}>{block.lines.join('\n')}</div>;
}

function MotionGraphicScene({scene,palette,frame}:{scene:Scene;palette:VideoPalette;frame:number}) {
  const layout=useMemo(()=>motionGraphicLayout(scene),[scene]);
  if(!layout)return null;
  const headingIntro=motionGraphicProgress(scene,frame,0);
  return <>
    <AbsoluteFill data-graphic-layout-fits={layout.fits} style={{opacity:.35+headingIntro*.65,transform:`translateY(${(1-headingIntro)*14}px)`}}>
      {layout.header.map(block=><GraphicText key={block.key} block={block} palette={palette} role="header" qa={block.key}/>)}
    </AbsoluteFill>
    {layout.items.map(item=>{
      const progress=motionGraphicProgress(scene,frame,item.index);
      const isList=layout.template==='list';
      const isStat=layout.template==='stat';
      return <AbsoluteFill key={item.index} data-graphic-item={item.index} style={{opacity:.25+progress*.75,transform:isList?`translateX(${(1-progress)*18}px)`:`translateY(${(1-progress)*16}px)`}}>
        <div style={{position:'absolute',left:item.x,top:item.y,width:item.width,height:item.height,boxSizing:'border-box',background:palette.surface,border:`1px solid ${palette.line}`,borderRadius:isList?14:24,boxShadow:isList?'0 4px 14px rgba(18,40,30,.025)':'0 12px 28px rgba(18,40,30,.045)'}}/>
        {isList&&<svg aria-hidden="true" style={{position:'absolute',left:item.x+28,top:item.y+21}} width="40" height="40" viewBox="0 0 40 40" fill="none">
          <rect x="2" y="2" width="36" height="36" rx="11" fill={palette.accentWash}/>
          <path d="m11 20 6 6 12-13" stroke={palette.accent} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="32" strokeDashoffset={32*(1-progress)}/>
        </svg>}
        {isStat&&<div style={{position:'absolute',left:item.x+item.width/2-22,top:item.y+24,width:44,height:4,borderRadius:4,background:palette.accent,opacity:.6}}/>}
        <GraphicText block={item.title} palette={palette} role={isStat?'value':'item'} align={isList?'left':'center'} qa={`item-${item.index}-title`}/>
        {item.body&&<GraphicText block={item.body} palette={palette} role={isStat?'label':'footer'} align={isList?'left':'center'} qa={`item-${item.index}-body`}/>}
      </AbsoluteFill>;
    })}
    {layout.connectors.map((connector,index)=>{
      const progress=motionGraphicProgress(scene,frame,index+1);
      return <svg key={index} data-graphic-arrow={index} aria-hidden="true" style={{position:'absolute',left:connector.x,top:connector.y,opacity:.2+progress*.8}} width={connector.width} height={connector.height} viewBox="0 0 56 48" fill="none">
        <path d="M5 24h44M37 12l12 12-12 12" stroke={palette.accent} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="90" strokeDashoffset={90*(1-progress)}/>
      </svg>;
    })}
    {layout.footer&&<GraphicText block={layout.footer} palette={palette} role="footer" qa="body"/>}
  </>;
}

function MediaScene({scene,palette,assetBaseUrl,assets}:{scene:Scene;palette:VideoPalette;assetBaseUrl:string;assets:Asset[]}) {
  const asset=assets.find((candidate)=>candidate.id===scene.assetId);
  const src=asset?mediaAssetUrl(assetBaseUrl,asset.id):undefined;
  return <>
    <AbsoluteFill style={{background:scene.mediaFit==='contain'?'#14201e':palette.background}}>
      {asset?.kind==='image' && src && <Img src={src} style={{width:'100%',height:'100%',objectFit:scene.mediaFit}}/>}
      {asset?.kind==='video' && src && <OffthreadVideo src={src} startFrom={scene.mediaStartFrame} muted style={{width:'100%',height:'100%',objectFit:scene.mediaFit}}/>}
      {!src && <AbsoluteFill style={{alignItems:'center',justifyContent:'center',gap:26,color:palette.secondary}}><svg width="126" height="102" viewBox="0 0 126 102" fill="none"><rect x="5" y="5" width="116" height="92" rx="14" stroke="currentColor" strokeWidth="5"/><circle cx="87" cy="31" r="10" fill="currentColor" opacity=".5"/><path d="m10 88 36-39 25 27 16-17 29 29" stroke="currentColor" strokeWidth="5" strokeLinejoin="round"/></svg><div style={{fontSize:38,fontWeight:600}}>이미지 또는 영상을 선택하세요</div></AbsoluteFill>}
    </AbsoluteFill>
    {src && (scene.heading || scene.kicker) && <div style={{position:'absolute',top:64,left:92,maxWidth:1500,padding:'22px 30px',borderRadius:16,background:'rgba(14,27,23,.8)',color:'#fff'}}>
      {scene.kicker && <div style={{fontSize:25,opacity:.75,marginBottom:10}}>{scene.kicker}</div>}
      <TextBlock qa="heading" text={scene.heading} width={1380} size={52} lines={2} min={36} style={{fontWeight:750,letterSpacing:-1}}/>
    </div>}
  </>;
}

function Presenter({frame,mouth,palette}:{frame:number;mouth:number;palette:VideoPalette}) {
  const blink=frame%151>145 ? .08 : 1;
  const breath=Math.sin(frame/28)*3;
  return <svg width="600" height="760" viewBox="0 0 600 760" aria-label="설명 캐릭터" style={{transform:`translateY(${breath}px)`}}>
    <ellipse cx="300" cy="689" rx="207" ry="30" fill={palette.foreground} opacity=".07"/>
    <path d="M149 684V491c0-88 65-139 151-139s151 51 151 139v193Z" fill={palette.accent}/>
    <path d="m262 364 38 50 40-50v-53h-78Z" fill="#e9bd9d"/>
    <path d="m262 365 38 49-43 40-35-62Zm78 0-40 49 44 40 35-62Z" fill="#fffdf5"/>
    <path d="M179 259c0-104 36-161 122-161 88 0 122 62 122 161v30c0 90-50 141-122 141-69 0-122-51-122-141Z" fill="#f0cfaf" transform="translate(0,-74)"/>
    <path d="M177 187c-17-66 22-134 94-147 50-30 111-5 142 29 23 25 33 78 9 127l-19-59c-79 18-126-2-148-38-13 37-38 48-78 58Z" fill="#24332e"/>
    <ellipse cx="176" cy="213" rx="17" ry="29" fill="#edc7a7"/><ellipse cx="425" cy="213" rx="17" ry="29" fill="#edc7a7"/>
    <g stroke="#24332e" strokeWidth="7" fill="none"><rect x="207" y="180" width="76" height="54" rx="18"/><rect x="317" y="180" width="76" height="54" rx="18"/><path d="M283 202h34M192 190l-17-8m233 8 17-8"/></g>
    <ellipse cx="246" cy="205" rx="6" ry={8*blink} fill="#26362f"/><ellipse cx="355" cy="205" rx="6" ry={8*blink} fill="#26362f"/>
    <path d="m297 210-8 38h18" stroke="#c69877" strokeWidth="5" fill="none" strokeLinecap="round"/>
    <ellipse cx="299" cy="284" rx={20+mouth*4} ry={3+mouth*16} fill="#684c43"/>
    <path d="M154 473c-58 54-60 117-25 166 12 17 40 20 56 6 17-15 14-36 1-53-18-24-10-54 17-74" stroke={palette.accent} strokeWidth="64" fill="none" strokeLinecap="round"/>
    <path d="M427 467c59-3 93-33 111-75" stroke={palette.accent} strokeWidth="65" fill="none" strokeLinecap="round"/>
    <path d="M530 399c-14-28-11-48 2-66 5-7 16-5 16 4l-1 22 14-13c8-7 18 2 14 12l-10 26c-8 20-22 23-35 15Z" fill="#f0cfaf"/>
    <circle cx="300" cy="488" r="5" fill="#fff" opacity=".65"/><circle cx="300" cy="548" r="5" fill="#fff" opacity=".65"/>
  </svg>;
}

function CharacterScene({scene,palette,frame,waveform,waveformProgress=0}:{scene:Scene;palette:VideoPalette;frame:number;waveform?:number[];waveformProgress?:number}) {
  const intro=ease(frame,0,24);
  const waveIndex=waveform?.length?Math.min(waveform.length-1,Math.floor(clamp(waveformProgress,0,1)*waveform.length)):0;
  const mouth=waveform?.length?clamp(Math.abs(waveform[waveIndex]??0)*2,0,1):clamp((Math.sin(frame*.42)+Math.sin(frame*.71))*.25+.3,0,1);
  return <>
    <div style={{position:'absolute',left:70,bottom:82,opacity:.3+.7*intro,transform:`translateX(${(1-intro)*-20}px)`}}><Presenter frame={frame} mouth={mouth} palette={palette}/></div>
    <NarrativeText scene={scene} palette={palette} frame={frame}/>
  </>;
}

/** Pure scene visual: parent controls the frame, so thumbnails can reuse the same layout. */
export function SceneVisual({scene,settings,assets,assetBaseUrl,frame=30,waveform,waveformProgress}:SceneVisualProps) {
  const palette=videoPalette(settings.theme,settings.accent);
  return <AbsoluteFill data-scene-id={scene.id} data-template={scene.template} style={{fontFamily:VIDEO_LAYOUT.fontFamily,color:palette.foreground,overflow:'hidden'}}>
    <Backdrop palette={palette}/>
    {scene.template==='title' && <TitleScene scene={scene} palette={palette} frame={frame}/>}
    {scene.template==='quote' && <QuoteScene scene={scene} palette={palette} frame={frame}/>}
    {scene.template==='compare' && <CompareScene scene={scene} palette={palette} frame={frame}/>}
    {scene.template==='steps' && <StepsScene scene={scene} palette={palette} frame={frame}/>}
    {(scene.template==='list'||scene.template==='stat'||scene.template==='flow') && <MotionGraphicScene scene={scene} palette={palette} frame={frame}/>}
    {scene.template==='media' && <MediaScene scene={scene} palette={palette} assets={assets} assetBaseUrl={assetBaseUrl}/>}
    {scene.template==='character' && <CharacterScene scene={scene} palette={palette} frame={frame} waveform={waveform} waveformProgress={waveformProgress}/>}
  </AbsoluteFill>;
}

export function VideoComposition({project,assetBaseUrl,showGuides=false}:VideoCompositionProps) {
  useLocalFonts();
  const frame=useCurrentFrame();
  const scene=activeScene(project.scenes,frame);
  const caption=activeCaption(project.captions,frame);
  const audio=project.assets.find((asset)=>asset.id===project.audioAssetId && asset.kind==='audio');
  const captionText=caption?.text??'';
  const captionFit=fitVideoText(captionText,1600,project.settings.subtitleSize,2,28);
  return <AbsoluteFill style={{background:videoPalette(project.settings.theme,project.settings.accent).background,fontFamily:VIDEO_LAYOUT.fontFamily,overflow:'hidden'}}>
    {scene && <Sequence from={scene.startFrame} durationInFrames={scene.durationInFrames} name={scene.title} layout="none">
      <SceneVisual scene={scene} settings={project.settings} assets={project.assets} assetBaseUrl={assetBaseUrl} frame={frame-scene.startFrame} globalFrame={frame} waveform={audio?.waveform} waveformProgress={frame/project.durationInFrames}/>
    </Sequence>}
    {audio && <Audio src={mediaAssetUrl(assetBaseUrl,audio.id)} volume={Math.pow(10,project.settings.audioGainDb/20)}/>}
    {caption && scene?.showCaptions && project.settings.showCaptions && <div data-video-caption={caption.id} style={{position:'absolute',left:116,right:116,bottom:48,display:'flex',justifyContent:'center',pointerEvents:'none'}}>
      <div data-video-text="caption" style={{maxWidth:1688,boxSizing:'border-box',padding:project.settings.subtitleBackground?'15px 34px 18px':'10px 18px',background:project.settings.subtitleBackground?'rgba(17,29,26,.88)':'transparent',borderRadius:12,color:project.settings.subtitleBackground||scene.template==='media'?'#fff':videoPalette(project.settings.theme,project.settings.accent).foreground,fontSize:captionFit.fontSize,fontWeight:600,lineHeight:1.45,letterSpacing:-.6,textAlign:'center',whiteSpace:'pre-wrap',textShadow:!project.settings.subtitleBackground&&scene.template==='media'?'0 2px 9px rgba(0,0,0,.9)':'none'}}>{captionFit.lines.join('\n')}</div>
    </div>}
    {showGuides && <div data-safe-area="true" style={{position:'absolute',inset:'54px 96px',border:'2px dashed rgba(21,133,109,.65)',pointerEvents:'none'}}/>}
  </AbsoluteFill>;
}
