import type {Caption, Project, Scene, ThemeId} from '../shared/types';

/** Composition-space tokens. Preview and final video use the same geometry. */
export const VIDEO_LAYOUT = {
  width: 1920,
  height: 1080,
  safeX: 116,
  safeY: 68,
  subtitleBottom: 48,
  contentBottom: 866,
  fontFamily: '"Noto Sans KR Variable", "Noto Sans KR", sans-serif',
} as const;

export interface VideoPalette {
  background: string;
  foreground: string;
  secondary: string;
  surface: string;
  line: string;
  accent: string;
  accentWash: string;
}

const palettes: Record<ThemeId, Omit<VideoPalette, 'accent'>> = {
  sage: {background: '#f7faf8', foreground: '#142523', secondary: '#5d6c6b', surface: '#ffffff', line: '#dfe9e4', accentWash: '#e0f1e9'},
  ink: {background: '#152322', foreground: '#f4f7f4', secondary: '#b2c1bb', surface: '#213632', line: '#38504a', accentWash: '#27483d'},
  sand: {background: '#f7f2e8', foreground: '#2d302a', secondary: '#746f64', surface: '#fffdf7', line: '#e8e1d4', accentWash: '#e9e9cf'},
};

export function videoPalette(theme: ThemeId, accent: string): VideoPalette {
  return {...palettes[theme], accent: /^#[\da-f]{6}$/i.test(accent) ? accent : '#15856d'};
}

/** Approximate advance widths are stable before fonts finish loading. CJK is full width. */
export function textUnits(text: string): number {
  return Array.from(text).reduce((sum, char) => {
    if (/\s/.test(char)) return sum + 0.32;
    if (/[A-Z0-9]/.test(char)) return sum + 0.65;
    if (/[a-z]/.test(char)) return sum + 0.52;
    if (/[,.:;!'"()-]/.test(char)) return sum + 0.32;
    return sum + 1;
  }, 0);
}

/** Wraps Korean without dropping characters and prefers spaces/punctuation at boundaries. */
export function wrapVideoText(text: string, maxUnits: number): string[] {
  if (!text.trim()) return [];
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let remainder = paragraph.trim();
    while (textUnits(remainder) > maxUnits) {
      const chars = Array.from(remainder);
      let units = 0;
      let end = 0;
      let preferred = 0;
      for (let index = 0; index < chars.length; index++) {
        const advance = textUnits(chars[index]);
        if (units + advance > maxUnits) break;
        units += advance;
        end = index + 1;
        if (/[\s,.!?。！？]/.test(chars[index]) && units > maxUnits * 0.6) preferred = end;
      }
      const cut = preferred || Math.max(1, end);
      lines.push(chars.slice(0, cut).join('').trimEnd());
      remainder = chars.slice(cut).join('').trimStart();
    }
    if (remainder) lines.push(remainder);
  }
  return lines;
}

export function fitVideoText(text: string, width: number, preferred: number, maxLines: number, minimum = 34): {fontSize: number; lines: string[]} {
  let fontSize = preferred;
  let lines = wrapVideoText(text, width / fontSize);
  while (lines.length > maxLines && fontSize > minimum) {
    fontSize = Math.max(minimum, fontSize - 2);
    lines = wrapVideoText(text, width / fontSize);
  }
  return {fontSize, lines};
}

export interface VideoTextGeometry {
  key:'topic'|'heading'|'body';
  text:string;
  x:number;
  y:number;
  width:number;
  fontSize:number;
  lines:string[];
  lineHeight:number;
  height:number;
  bottom:number;
  maxLines:number;
  minFontSize:number;
}

export interface SceneTextLayout {
  blocks:VideoTextGeometry[];
  decorations:{kind:'rule'|'quote';x:number;y:number;width:number;height:number}[];
  /** Includes the maximum entrance-animation translation, not just the settled frame. */
  bottom:number;
  staticBottom:number;
  limit:number;
  introOffset:number;
  fits:boolean;
  issues:string[];
}

/**
 * Narrative templates share this complete-block layout with the quality gate.
 * Fitting each field independently is insufficient: a legal title plus a legal
 * paragraph can still collide with subtitles when their heights are added.
 */
export function sceneTextLayout(scene:Scene):SceneTextLayout|null {
  if(!(['title','quote','character'] as const).includes(scene.template as 'title'|'quote'|'character'))return null;
  const kind=scene.template as 'title'|'quote'|'character';
  const introOffset=kind==='title'?22:kind==='quote'?16:0;
  const heading=scene.heading || scene.title;
  const build=(scale:number):SceneTextLayout=>{
    const blocks:VideoTextGeometry[]=[];
    const decorations:SceneTextLayout['decorations']=[];
    const add=(key:VideoTextGeometry['key'],text:string,x:number,y:number,width:number,size:number,maxLines:number,minimum:number,lineHeight:number)=>{
      const fit=fitVideoText(text,width,Math.max(minimum,Math.round(size*scale)),maxLines,minimum);
      const height=fit.lines.length*fit.fontSize*lineHeight;
      const block={key,text,x,y,width,fontSize:fit.fontSize,lines:fit.lines,lineHeight,height,bottom:y+height,maxLines,minFontSize:minimum};
      blocks.push(block);
      return block.bottom;
    };
    let cursor=kind==='title'?293:kind==='quote'?158:240;
    const x=kind==='title'?164:kind==='quote'?176:740;
    const width=kind==='title'?1592:kind==='quote'?1568:1040;
    if(kind==='title')decorations.push({kind:'rule',x:164,y:244,width:76,height:7});
    if(scene.kicker.trim())cursor=add('topic',scene.kicker,x,cursor,width,32,1,26,1.28);
    if(kind==='quote') {
      cursor+=38;
      decorations.push({kind:'quote',x,y:cursor,width:180,height:147.6});
      cursor+=147.6;
    } else cursor+=kind==='title'?30:32;
    cursor=add('heading',heading,x,cursor,width,kind==='title'?116:92,kind==='title'?3:4,kind==='title'?56:kind==='quote'?48:44,kind==='title'?1.28:kind==='quote'?1.36:1.3);
    if(scene.body.trim()) {
      cursor+=kind==='title'?44:kind==='quote'?42:38;
      cursor=add('body',scene.body,x,cursor,kind==='title'?1450:kind==='quote'?1500:990,kind==='title'?40:36,kind==='title'?3:kind==='quote'?2:4,kind==='character'?28:34,kind==='quote'?1.5:1.55);
    }
    const staticBottom=Math.max(cursor,...decorations.map(item=>item.y+item.height));
    const bottom=staticBottom+introOffset;
    const issues=blocks.filter(block=>block.lines.length>block.maxLines).map(block=>`${block.key}:line-limit`);
    if(bottom>VIDEO_LAYOUT.contentBottom)issues.push('vertical-limit');
    return {blocks,decorations,staticBottom,bottom,limit:VIDEO_LAYOUT.contentBottom,introOffset,fits:issues.length===0,issues};
  };
  let result=build(1);
  for(let step=1;!result.fits&&step<=40;step++)result=build(1-step*.02);
  return result;
}

export type MotionGraphicTemplate='list'|'stat'|'flow';
export const MOTION_GRAPHIC_LIMITS={
  list:{minItems:2,maxItems:5,itemTitleUnits:16,itemBodyUnits:32,sceneBodyUnits:60},
  stat:{minItems:1,maxItems:3,itemTitleUnitsByCount:[14,9,7],itemBodyUnits:32,sceneBodyUnits:60},
  flow:{minItems:2,maxItems:4,itemTitleUnits:18,itemBodyUnits:36,sceneBodyUnits:60},
} as const;

export interface GraphicRect {x:number;y:number;width:number;height:number}
export interface GraphicItemLayout extends GraphicRect {index:number;title:VideoTextGeometry;body:VideoTextGeometry|null}
export interface MotionGraphicLayout {
  template:MotionGraphicTemplate;
  header:VideoTextGeometry[];
  items:GraphicItemLayout[];
  connectors:GraphicRect[];
  footer:VideoTextGeometry|null;
  fits:boolean;
  issues:string[];
  bottom:number;
  limit:number;
}

function graphicText(key:VideoTextGeometry['key'],text:string,x:number,y:number,width:number,size:number,maxLines:number,minimum:number,lineHeight:number):VideoTextGeometry {
  const fit=fitVideoText(text,Math.max(1,width),size,maxLines,minimum);
  const height=fit.lines.length*fit.fontSize*lineHeight;
  return {key,text,x,y,width,fontSize:fit.fontSize,lines:fit.lines,lineHeight,height,bottom:y+height,maxLines,minFontSize:minimum};
}

/** Exact geometry shared by the three built-in graphic templates and export checks. */
export function motionGraphicLayout(scene:Scene):MotionGraphicLayout|null {
  if(scene.template!=='list'&&scene.template!=='stat'&&scene.template!=='flow')return null;
  const template=scene.template;
  const limits=MOTION_GRAPHIC_LIMITS[template];
  const count=scene.items.length;
  const issues:string[]=[];
  if(count<limits.minItems||count>limits.maxItems)issues.push('item-count');
  const header:VideoTextGeometry[]=[];
  let headingTop=84;
  if(scene.kicker.trim()) {
    const topic=graphicText('topic',scene.kicker,116,84,1688,32,1,26,1.28);
    header.push(topic);headingTop=topic.bottom;
  }
  const heading=scene.heading||scene.title;
  const headingSize=fitVideoText(heading,1688,78,2,48).lines.length>1?66:78;
  header.push(graphicText('heading',heading,116,headingTop+28,1688,headingSize,2,48,1.2));
  if(header.some(block=>block.bottom+14>330))issues.push('heading-area');

  const items:GraphicItemLayout[]=[];
  const connectors:GraphicRect[]=[];
  const safeCount=Math.max(1,count);
  for(let index=0;index<count;index++) {
    const item=scene.items[index];
    const itemIndex=Math.min(2,Math.max(0,count-1));
    const titleLimit=template==='stat'?MOTION_GRAPHIC_LIMITS.stat.itemTitleUnitsByCount[itemIndex]:MOTION_GRAPHIC_LIMITS[template].itemTitleUnits;
    if(!item.title.trim())issues.push(`item-${index}:empty-title`);
    if(textUnits(item.title)>titleLimit)issues.push(`item-${index}:title-length`);
    if(textUnits(item.body)>limits.itemBodyUnits)issues.push(`item-${index}:body-length`);
    if(template==='list') {
      const rect={x:200,y:350+index*94,width:1520,height:82};
      const title=graphicText('heading',item.title,296,0,520,38,1,32,1.25);
      title.y=rect.y+(rect.height-title.height)/2;title.bottom=title.y+title.height;
      const body=item.body.trim()?graphicText('body',item.body,852,0,840,30,1,26,1.35):null;
      if(body){body.y=rect.y+(rect.height-body.height)/2;body.bottom=body.y+body.height;}
      items.push({...rect,index,title,body});
    } else if(template==='stat') {
      const width=(1688-(safeCount-1)*32)/safeCount;
      const rect={x:116+index*(width+32),y:350,width,height:410};
      const title=graphicText('heading',item.title,rect.x+44,0,width-88,[180,152,128][itemIndex],1,[112,80,64][itemIndex],1.1);
      const body=item.body.trim()?graphicText('body',item.body,rect.x+44,0,width-88,[40,36,34][itemIndex],2,[30,28,28][itemIndex],1.35):null;
      const total=title.height+(body?32+body.height:0);
      const top=rect.y+(rect.height-total)/2;
      title.y=top;title.bottom=top+title.height;
      if(body){body.y=title.bottom+32;body.bottom=body.y+body.height;}
      if(total>rect.height-64)issues.push(`item-${index}:card-height`);
      items.push({...rect,index,title,body});
    } else {
      const width=(1688-(safeCount-1)*72)/safeCount;
      const rect={x:116+index*(width+72),y:380,width,height:380};
      const titleSize=count===2?54:count===3?46:38;
      const title=graphicText('heading',item.title,rect.x+28,0,width-56,titleSize,2,count===2?34:count===3?32:30,1.2);
      const body=item.body.trim()?graphicText('body',item.body,rect.x+28,0,width-56,count===2?30:28,3,24,1.4):null;
      const total=title.height+(body?20+body.height:0);
      const top=rect.y+(rect.height-total)/2;
      title.y=top;title.bottom=top+title.height;
      if(body){body.y=title.bottom+20;body.bottom=body.y+body.height;}
      if(total>rect.height-80)issues.push(`item-${index}:card-height`);
      items.push({...rect,index,title,body});
      if(index<count-1)connectors.push({x:rect.x+width+8,y:rect.y+rect.height/2-24,width:56,height:48});
    }
  }

  const footer=scene.body.trim()?graphicText('body',scene.body,template==='list'?200:116,template==='list'?826:810,template==='list'?1520:1688,template==='list'?26:30,1,template==='list'?24:26,template==='list'?1.35:1.4):null;
  if(textUnits(scene.body)>limits.sceneBodyUnits)issues.push('footer:length');
  const inspect=(block:VideoTextGeometry,key:string)=>{
    if(block.lines.length>block.maxLines)issues.push(`${key}:line-limit`);
    if(block.x<116||block.x+block.width>1804.01||block.y<68||block.bottom>VIDEO_LAYOUT.contentBottom)issues.push(`${key}:safe-area`);
  };
  for(const block of header)inspect(block,block.key);
  for(const item of items){inspect(item.title,`item-${item.index}:title`);if(item.body)inspect(item.body,`item-${item.index}:body`);}
  if(footer)inspect(footer,'footer');
  const itemBottom=Math.max(0,...items.map(item=>item.y+item.height+(template==='list'?0:16)));
  const bottom=Math.max(0,...header.map(block=>block.bottom+14),itemBottom,footer?.bottom??0);
  if(bottom>VIDEO_LAYOUT.contentBottom)issues.push('vertical-limit');
  return {template,header,items,connectors,footer,fits:issues.length===0,issues,bottom,limit:VIDEO_LAYOUT.contentBottom};
}

/** Every item finishes entering within the scene, including short scenes. */
export function motionGraphicProgress(scene:Scene,frame:number,itemIndex:number):number {
  if(scene.durationInFrames<=1)return 1;
  const pace=scene.motion==='calm'?.65:scene.motion==='lively'?.4:.5;
  const cap=scene.motion==='calm'?60:scene.motion==='lively'?36:48;
  const window=Math.max(1,Math.min(cap,Math.floor(Math.max(1,scene.durationInFrames-1)*pace)));
  const duration=Math.min(scene.motion==='calm'?26:20,window);
  const stagger=(window-duration)/Math.max(1,scene.items.length-1);
  const progress=Math.max(0,Math.min(1,(frame-stagger*itemIndex)/duration));
  return 1-Math.pow(1-progress,3);
}

export function activeScene(scenes: Scene[], frame: number): Scene | undefined {
  let low = 0;
  let high = scenes.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const scene = scenes[mid];
    if (frame < scene.startFrame) high = mid - 1;
    else if (frame >= scene.startFrame + scene.durationInFrames) low = mid + 1;
    else return scene;
  }
  return undefined;
}

export function activeCaption(captions: Caption[], frame: number): Caption | undefined {
  let low = 0;
  let high = captions.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const caption = captions[mid];
    if (frame < caption.startFrame) high = mid - 1;
    else if (frame >= caption.endFrame) low = mid + 1;
    else return caption;
  }
  return undefined;
}

export function mediaAssetUrl(assetBaseUrl: string, assetId: string): string {
  return `${assetBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(assetId)}`;
}

/** API ranges are [start,end); Remotion ranges are inclusive at both ends. */
export function outputFrameRange(project: Pick<Project, 'durationInFrames'>, range?: {startFrame:number;endFrame:number}): [number, number] {
  const start = range?.startFrame ?? 0;
  const end = range?.endFrame ?? project.durationInFrames;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > project.durationInFrames) {
    throw new Error('출력할 프레임 범위가 올바르지 않습니다.');
  }
  return [start, end - 1];
}
