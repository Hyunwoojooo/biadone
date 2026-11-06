import {randomUUID} from 'node:crypto';
import {mkdir, readFile, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {projectSchema} from '../src/shared/schemas';
import type {EditorCommand, HistoryEntry, Project, ProjectSummary} from '../src/shared/types';
import {applyCommand, createDemoProject, createProject} from '../src/domain/project';
import {HttpError} from './errors';

interface Revision extends HistoryEntry {fileName: string}
interface History {entries: Revision[]; cursor: number}
const validId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/;

export function assertId(value: string): string {
  if (!validId.test(value)) throw new HttpError(400, '유효하지 않은 식별자입니다.');
  return value;
}

export function safeChild(directory: string, name: string): string {
  if (!name || name !== path.basename(name) || name === '.' || name === '..' || name.includes('\0')) {
    throw new HttpError(400, '유효하지 않은 파일 이름입니다.');
  }
  const result = path.resolve(directory, name);
  if (!result.startsWith(`${path.resolve(directory)}${path.sep}`)) throw new HttpError(400, '허용되지 않은 경로입니다.');
  return result;
}

interface CommitControl {signal?: AbortSignal; onCommit?: () => void}

export async function atomicJson(file: string, value: unknown, control: CommitControl = {}): Promise<void> {
  control.signal?.throwIfAborted();
  await mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
    // This synchronous checkpoint is the mutation's commit boundary. Cancelled
    // work waiting for a project lock or file preparation never becomes current.
    control.signal?.throwIfAborted();
    control.onCommit?.();
    control.signal?.throwIfAborted();
    await rename(temporary, file);
  } finally {await rm(temporary, {force: true});}
}

export class ProjectStore {
  readonly projectsDirectory: string;
  private locks = new Map<string, Promise<unknown>>();

  constructor(readonly dataDirectory: string) {
    this.projectsDirectory = path.join(dataDirectory, 'projects');
  }

  async init(): Promise<void> {
    await mkdir(this.projectsDirectory, {recursive: true});
  }

  directory(id: string): string {return path.join(this.projectsDirectory, assertId(id));}
  assetsDirectory(id: string): string {return path.join(this.directory(id), 'assets');}

  async locked<T>(id: string, operation: () => Promise<T>): Promise<T> {
    assertId(id);
    const previous = this.locks.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.locks.set(id, current);
    try {return await current;} finally {
      if (this.locks.get(id) === current) this.locks.delete(id);
    }
  }

  async list(): Promise<ProjectSummary[]> {
    const names = await readdir(this.projectsDirectory);
    const values = await Promise.all(names.filter((name) => validId.test(name)).map(async (name) => {
      try {
        const project = await this.get(name);
        return {id: project.id, title: project.title, updatedAt: project.updatedAt, durationInFrames: project.durationInFrames,
          fps: project.settings.fps, sceneCount: project.scenes.length};
      } catch {return undefined;}
    }));
    return values.filter((value): value is ProjectSummary => value !== undefined).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Project> {
    try {
      return projectSchema.parse(JSON.parse(await readFile(path.join(this.directory(id), 'project.json'), 'utf8'))) as Project;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, '프로젝트를 찾을 수 없습니다.');
      if (error instanceof HttpError) throw error;
      throw new HttpError(422, '프로젝트 파일을 읽을 수 없습니다. 저장 파일을 확인해 주세요.');
    }
  }

  async create(options: {title?: string; durationSeconds?: number; demo?: boolean} = {}): Promise<Project> {
    const project = options.demo ? createDemoProject() : createProject(options.title, options.durationSeconds);
    return this.import(project, false);
  }

  async import(input: unknown, assignId = true): Promise<Project> {
    const parsed = projectSchema.parse(input) as Project;
    const now = new Date().toISOString();
    const project: Project = {...parsed, id: assignId ? randomUUID() : parsed.id, revision: 0, createdAt: now, updatedAt: now};
    assertId(project.id);
    for (const asset of project.assets) safeChild(this.assetsDirectory(project.id), asset.fileName);
    return this.locked(project.id, async () => {
      try {
        await stat(path.join(this.directory(project.id), 'project.json'));
        throw new HttpError(409, '같은 식별자의 프로젝트가 이미 있습니다.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await mkdir(this.assetsDirectory(project.id), {recursive: true});
      const revision = await this.writeRevision(project, '프로젝트 만들기');
      await atomicJson(path.join(this.directory(project.id), 'project.json'), project);
      await atomicJson(path.join(this.directory(project.id), 'history.json'), {entries: [revision], cursor: 0} satisfies History);
      return project;
    });
  }

  private async readHistory(id: string): Promise<History> {
    try {return JSON.parse(await readFile(path.join(this.directory(id), 'history.json'), 'utf8')) as History;}
    catch {return {entries: [], cursor: -1};}
  }

  private async writeRevision(project: Project, title: string): Promise<Revision> {
    const id = randomUUID();
    const entry: Revision = {id, title, createdAt: new Date().toISOString(), revision: project.revision, fileName: `${id}.json`};
    await atomicJson(path.join(this.directory(project.id), 'revisions', entry.fileName), project);
    return entry;
  }

  async history(id: string): Promise<HistoryEntry[]> {
    await this.get(id);
    const history = await this.readHistory(id);
    return history.entries.map((entry) => ({id: entry.id, title: entry.title, createdAt: entry.createdAt, revision: entry.revision})).reverse();
  }

  async command(id: string, command: EditorCommand, expectedRevision: number, title?: string, control: CommitControl = {}): Promise<Project> {
    return this.locked(id, async () => {
      control.signal?.throwIfAborted();
      const current = await this.get(id);
      control.signal?.throwIfAborted();
      this.assertRevision(current, expectedRevision);
      const next = applyCommand(current, command);
      const parsed = projectSchema.parse(next) as Project;
      const history = await this.readHistory(id);
      const entry = await this.writeRevision(parsed, title ?? commandTitle(command));
      const entries = [...history.entries.slice(0, history.cursor + 1), entry].slice(-200);
      await atomicJson(path.join(this.directory(id), 'project.json'), parsed, control);
      await atomicJson(path.join(this.directory(id), 'history.json'), {entries, cursor: entries.length - 1} satisfies History);
      return parsed;
    });
  }

  private assertRevision(current: Project, expectedRevision: number): void {
    if (!Number.isSafeInteger(expectedRevision) || current.revision !== expectedRevision) {
      throw new HttpError(409, '다른 곳에서 프로젝트가 수정되었습니다. 최신 상태를 불러온 뒤 다시 시도해 주세요.');
    }
  }

  async navigate(id: string, expectedRevision: number, direction: 'undo'|'redo'|string): Promise<Project> {
    return this.locked(id, async () => {
      const current = await this.get(id);
      this.assertRevision(current, expectedRevision);
      const history = await this.readHistory(id);
      let cursor = direction === 'undo' ? history.cursor - 1 : direction === 'redo' ? history.cursor + 1 : history.entries.findIndex((entry) => entry.id === direction);
      if (cursor < 0 || cursor >= history.entries.length) throw new HttpError(409, '이동할 수정 이력이 없습니다.');
      const entry = history.entries[cursor];
      const previous = projectSchema.parse(JSON.parse(await readFile(safeChild(path.join(this.directory(id), 'revisions'), entry.fileName), 'utf8'))) as Project;
      // Revision numbers remain monotonic even when the content moves backward.
      const next: Project = {...previous, id, revision: current.revision + 1, updatedAt: new Date().toISOString()};
      cursor = Math.max(0, cursor);
      await atomicJson(path.join(this.directory(id), 'project.json'), next);
      await atomicJson(path.join(this.directory(id), 'history.json'), {...history, cursor});
      return next;
    });
  }
}

function commandTitle(command: EditorCommand): string {
  const titles: Record<EditorCommand['type'], string> = {
    updateProject: '프로젝트 설정', updateScene: '장면 수정', splitScene: '장면 나누기', mergeScene: '장면 합치기',
    setBoundary: '장면 길이 조절', updateCaption: '자막 수정', addCaption: '자막 추가', removeCaption: '자막 삭제',
    replaceCaptions: '자막 가져오기', regroup: '장면 다시 구성', updateChapter: '챕터 수정', addChapter: '챕터 추가',
    addAsset: '자료 가져오기', setNarration: '나레이션 연결', addScene: '장면 추가',
    updateSceneSetup: '장면 구성 설정', applyScenePlan: 'Codex 장면 초안 적용',
  };
  return titles[command.type];
}
