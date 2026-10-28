// Generated from the measured private-voice clips. Original timing is untouched.
import {SCENES} from './scenes';
import type {SceneId} from './types';
import type {TimelineEntry} from './timing';
const CLIPS: Record<SceneId,{from:number;durationInFrames:number;audio:string}>={
  "intro": {from:0, durationInFrames:326, audio:"audio/juhyunwoo-v5/01-intro.mp3"},
  "approach": {from:326, durationInFrames:355, audio:"audio/juhyunwoo-v5/02-approach.mp3"},
  "foundation": {from:681, durationInFrames:387, audio:"audio/juhyunwoo-v5/03-foundation.mp3"},
  "choice": {from:1068, durationInFrames:308, audio:"audio/juhyunwoo-v5/04-choice.mp3"},
  "content": {from:1376, durationInFrames:351, audio:"audio/juhyunwoo-v5/05-content.mp3"},
  "website": {from:1727, durationInFrames:357, audio:"audio/juhyunwoo-v5/06-website.mp3"},
  "inquiry": {from:2084, durationInFrames:378, audio:"audio/juhyunwoo-v5/07-inquiry.mp3"},
  "data": {from:2462, durationInFrames:346, audio:"audio/juhyunwoo-v5/08-data.mp3"},
  "tool": {from:2808, durationInFrames:380, audio:"audio/juhyunwoo-v5/09-tool.mp3"},
  "team": {from:3188, durationInFrames:448, audio:"audio/juhyunwoo-v5/10-team.mp3"},
  "operations": {from:3636, durationInFrames:371, audio:"audio/juhyunwoo-v5/11-operations.mp3"},
  "closing": {from:4007, durationInFrames:337, audio:"audio/juhyunwoo-v5/12-closing.mp3"},
};
export const JUHYUNWOO_TIMELINE:TimelineEntry[]=SCENES.map(scene=>({scene,...CLIPS[scene.id]}));
export const JUHYUNWOO_TOTAL_FRAMES=4344;
