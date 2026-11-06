import React from 'react';
import {Composition, type AnyZodObject} from 'remotion';
import type {Project} from '../shared/types';
import {VideoComposition, type VideoCompositionProps} from './Composition';

const emptyProject:Project={
  schemaVersion:1,id:'preview',title:'Biadone Studio',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',revision:0,durationInFrames:30,
  settings:{width:1920,height:1080,fps:30,theme:'sage',accent:'#15856d',subtitleSize:44,subtitleBackground:true,showCaptions:true,audioGainDb:0,normalizeAudio:false},
  assets:[],words:[],captions:[],chapters:[{id:'chapter',title:'도입'}],scenes:[{id:'scene',title:'새 프로젝트',chapterId:'chapter',startFrame:0,durationInFrames:30,template:'title',heading:'이야기를 시작하세요',kicker:'',body:'',items:[],mediaStartFrame:0,mediaFit:'contain',locked:false,showCaptions:true,motion:'standard',notes:''}],
};

export function RemotionRoot() {
  return <Composition<AnyZodObject, VideoCompositionProps>
    id="BiadoneVideo"
    component={VideoComposition}
    width={1920} height={1080} fps={30} durationInFrames={30}
    defaultProps={{project:emptyProject,assetBaseUrl:''}}
    calculateMetadata={({props})=>({width:props.project.settings.width,height:props.project.settings.height,fps:props.project.settings.fps,durationInFrames:props.project.durationInFrames})}
  />;
}
