export const SCENE_IDS = [
  'intro', 'approach', 'foundation', 'choice', 'content', 'website',
  'inquiry', 'data', 'tool', 'team', 'operations', 'closing',
] as const;

export type SceneId = typeof SCENE_IDS[number];
export type ChapterId = 'prepare' | 'foundation' | 'choose' | 'team' | 'operate' | 'start';

export type SceneSpec = {
  id: SceneId;
  chapter: ChapterId;
  eyebrow: string;
  headline: {lead: string; strong: string; tail: string};
  narration: string;
  seconds: number;
  accent: string;
  result: string;
};

export type StoryArtProps = {
  kind: SceneId;
  frame: number;
  durationInFrames: number;
  accent: string;
};
