import {SCENES} from './scenes';
import {AUDIO_CLIPS} from './audio-timing';
import type {SceneSpec} from './types';

export const FPS = 30;
export const AUDIO_DELAY_FRAMES = 8;
export const AUDIO_TAIL_FRAMES = 20;
export type TimelineEntry = {scene: SceneSpec; from: number; durationInFrames: number; audio?: string};
let cursor = 0;
export const TIMELINE: TimelineEntry[] = SCENES.map((scene) => {
  const clip = AUDIO_CLIPS[scene.id];
  const durationInFrames = clip ? clip.sceneFrames ?? clip.frames + AUDIO_DELAY_FRAMES + AUDIO_TAIL_FRAMES : Math.round(scene.seconds * FPS);
  const entry = {scene, from: cursor, durationInFrames, audio: clip?.file};
  cursor += durationInFrames;
  return entry;
});
export const TOTAL_FRAMES = cursor;
