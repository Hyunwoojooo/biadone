import type {Chapter, Project, Scene} from '../shared/types';

export interface ChapterRun {key: string; chapter: Chapter; chapterId: string; scenes: Scene[]; continued: boolean; ordinal: number}

/** A chapter can recur after a manually inserted chapter. Keep playback order. */
export function chapterRuns(project: Project, includeEmpty = false): ChapterRun[] {
  const chapters = new Map(project.chapters.map(chapter => [chapter.id, chapter]));
  const ordinals = new Map<string, number>();
  const runs: ChapterRun[] = [];
  for (const scene of project.scenes) {
    const last = runs.at(-1);
    if (last?.chapterId === scene.chapterId) {last.scenes.push(scene); continue;}
    const continued = ordinals.has(scene.chapterId);
    if (!continued) ordinals.set(scene.chapterId, ordinals.size + 1);
    runs.push({key: `${scene.chapterId}-${scene.id}`, chapter: chapters.get(scene.chapterId)!, chapterId: scene.chapterId, scenes: [scene], continued, ordinal: ordinals.get(scene.chapterId)!});
  }
  if (includeEmpty) for (const chapter of project.chapters) {
    if (ordinals.has(chapter.id)) continue;
    ordinals.set(chapter.id, ordinals.size + 1);
    runs.push({key: `${chapter.id}-empty`, chapter, chapterId: chapter.id, scenes: [], continued: false, ordinal: ordinals.get(chapter.id)!});
  }
  return runs;
}
