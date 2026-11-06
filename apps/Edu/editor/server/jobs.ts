import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCaptions} from '../src/domain/captions';
import type {Asset, Job, Project, RenderOptions, ScenePlan} from '../src/shared/types';
import {validateScenePlan} from '../src/domain/scenePlan';
import {HttpError, errorMessage} from './errors';
import {transcriptionSetup} from './media';
import {projectQuality} from './quality';
import {assertId, atomicJson, ProjectStore, safeChild} from './storage';
import {defaultCodexAdapter, generationSceneIds, type CodexAdapter} from './codex';

interface JobRecord {job: Job; snapshot: Project; options?: RenderOptions; sceneIds?: string[]}
const finalStatuses = new Set(['completed', 'failed', 'cancelled']);

export class JobManager {
  readonly directory: string;
  private records = new Map<string, JobRecord>();
  private queue: string[] = [];
  private running = false;
  private controllers = new Map<string, AbortController>();
  private lastProgressWrite = new Map<string, number>();
  private persistence = new Map<string, Promise<void>>();
  private updates = new Map<string, Promise<void>>();
  private committing = new Set<string>();
  private finishes = new Map<string, Promise<void>>();
  private closing = false;
  private shutdownPromise?: Promise<void>;
  private serverOrigin = 'http://127.0.0.1:4317';
  private readonly codex: CodexAdapter;

  constructor(private readonly store: ProjectStore, private readonly appDirectory: string, options: {codexAdapter?: CodexAdapter} = {}) {
    this.directory = path.join(store.dataDirectory, 'jobs');
    this.codex = options.codexAdapter ?? defaultCodexAdapter;
  }

  setOrigin(origin: string): void {this.serverOrigin = origin;}
  outputDirectory(jobId: string): string {return path.join(this.directory, assertId(jobId), 'output');}
  codexStatus() {return this.codex.status();}

  /** Wait for worker completion and all already-scheduled durable state writes. */
  async drain(): Promise<void> {
    while (this.finishes.size || this.updates.size || this.persistence.size) {
      await Promise.all([...this.finishes.values(), ...this.updates.values(), ...this.persistence.values()]);
    }
  }

  /** Stop accepting work, cancel outstanding jobs, and finish their state writes. */
  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.closing = true;
    this.shutdownPromise = (async () => {
      await Promise.all(this.list().filter((job) => !finalStatuses.has(job.status)).map((job) => this.cancel(job.id)));
      await this.drain();
    })();
    return this.shutdownPromise;
  }

  async init(): Promise<void> {
    await mkdir(this.directory, {recursive: true});
    for (const name of await readdir(this.directory)) {
      try {
        assertId(name);
        const record = JSON.parse(await readFile(path.join(this.directory, name, 'job.json'), 'utf8')) as JobRecord;
        if (record.job.id !== name) continue;
        if (!finalStatuses.has(record.job.status)) {
          record.job = {...record.job, status: 'failed', message: '앱이 종료되어 작업이 중단되었습니다. 다시 시도할 수 있습니다.', error: 'interrupted', updatedAt: new Date().toISOString()};
          await this.persist(record);
        }
        this.records.set(name, record);
      } catch { /* Invalid/incomplete job files are not executable work. */ }
    }
  }

  list(projectId?: string): Job[] {
    return [...this.records.values()].map((record) => record.job).filter((job) => !projectId || job.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Job {
    assertId(id);
    const record = this.records.get(id);
    if (!record) throw new HttpError(404, '작업을 찾을 수 없습니다.');
    return record.job;
  }

  snapshotAsset(jobId: string, assetId: string): {projectId: string; asset: Asset} {
    assertId(assetId);
    this.get(jobId);
    const snapshot = this.records.get(jobId)!.snapshot;
    const asset = snapshot.assets.find((item) => item.id === assetId);
    if (!asset) throw new HttpError(404, '이 작업에서 사용한 자료를 찾을 수 없습니다.');
    return {projectId: snapshot.id, asset: structuredClone(asset)};
  }

  async createTranscription(projectId: string, expectedRevision: number): Promise<Job> {
    const project = await this.store.get(projectId);
    if (project.revision !== expectedRevision) throw new HttpError(409, '프로젝트가 변경되었습니다. 최신 상태에서 다시 시작해 주세요.');
    const asset = project.assets.find((item) => item.id === project.audioAssetId && item.kind === 'audio');
    if (!asset) throw new HttpError(400, '먼저 나레이션 녹음을 연결해 주세요.');
    const setup = await transcriptionSetup(this.appDirectory);
    if (!setup.available) throw new HttpError(503, setup.reason ?? '로컬 음성 모델을 찾을 수 없습니다.');
    return this.enqueue('transcribe', project);
  }

  async createRender(projectId: string, options: RenderOptions): Promise<Job> {
    const project = await this.store.get(projectId);
    const report = await projectQuality(this.store, project);
    if (!report.ok) throw new HttpError(422, `출력 전에 품질 오류 ${report.summary.errors}개를 해결해 주세요. ${report.issues.find((issue) => issue.severity === 'error')?.message ?? ''}`);
    if (report.summary.warnings && !options.allowWarnings) throw new HttpError(422, `품질 경고 ${report.summary.warnings}개를 확인한 뒤 출력해 주세요.`);
    if (options.range && (options.range.startFrame < 0 || options.range.endFrame > project.durationInFrames || options.range.startFrame >= options.range.endFrame)) {
      throw new HttpError(400, '출력할 프레임 범위가 올바르지 않습니다.');
    }
    return this.enqueue('render', project, options);
  }

  async createGeneration(projectId: string, expectedRevision: number, sceneIds: string[]): Promise<Job> {
    const project = await this.store.get(projectId);
    if (project.revision !== expectedRevision) throw new HttpError(409, '프로젝트가 변경되었습니다. 최신 구성에서 장면을 생성해 주세요.');
    const ids = generationSceneIds(project, sceneIds);
    const status = await this.codex.status();
    if (!status.available) throw new HttpError(503, status.reason ?? 'Codex CLI를 실행할 수 없습니다.');
    if (this.list(projectId).some((job) => job.type === 'generate' && (job.status === 'queued' || job.status === 'running'))) {
      throw new HttpError(409, '이 프로젝트의 장면 생성이 이미 진행 중입니다. 완료하거나 취소한 뒤 다시 시작해 주세요.');
    }
    return this.enqueue('generate', project, undefined, ids);
  }

  async generationPlan(id: string): Promise<{plan: ScenePlan; project: Project}> {
    const job = this.get(id);
    if (job.type !== 'generate') throw new HttpError(400, '장면 생성 작업이 아닙니다.');
    if (job.status !== 'completed') throw new HttpError(409, '장면 생성이 모두 완료된 뒤 초안을 검토할 수 있습니다.');
    const record = this.records.get(id)!;
    if (!record.sceneIds?.length) throw new HttpError(422, '생성 범위 정보가 없습니다. 장면을 다시 생성해 주세요.');
    let raw: unknown;
    try {raw = JSON.parse(await readFile(path.join(this.outputDirectory(id), 'plan.json'), 'utf8'));}
    catch {throw new HttpError(422, '저장된 장면 초안을 읽지 못했습니다. 다시 생성해 주세요.');}
    const plan = validateScenePlan(record.snapshot, raw, record.sceneIds);
    return {plan, project: structuredClone(record.snapshot)};
  }

  async applyGeneration(id: string, expectedRevision: number): Promise<Project> {
    const record = this.records.get(assertId(id));
    if (!record) throw new HttpError(404, '작업을 찾을 수 없습니다.');
    if (record.snapshot.revision !== expectedRevision) throw new HttpError(409, '생성 이후 프로젝트가 변경되었습니다. 보관된 초안은 미리볼 수 있으며 최신 구성에서 다시 생성해야 적용할 수 있습니다.');
    const {plan} = await this.generationPlan(id);
    const project = await this.store.command(record.snapshot.id, {type: 'applyScenePlan', plan, sceneIds: record.sceneIds}, expectedRevision, 'Codex 장면 초안 적용');
    await this.update(id, {status: 'completed', verification: {...record.job.verification, applied: true, appliedRevision: project.revision, appliedAt: new Date().toISOString()}});
    return project;
  }

  private async enqueue(type: Job['type'], project: Project, options?: RenderOptions, sceneIds?: string[]): Promise<Job> {
    if (this.closing) throw new HttpError(503, '앱을 종료하고 있습니다. 다시 실행한 뒤 작업을 시작해 주세요.');
    const now = new Date().toISOString();
    const id = randomUUID();
    const job: Job = {id, projectId: project.id, type, status: 'queued', progress: 0, message: '작업 순서를 기다리고 있습니다.', createdAt: now, updatedAt: now, projectRevision: project.revision};
    const record = {job, snapshot: structuredClone(project), options, sceneIds};
    this.records.set(id, record);
    await this.persist(record);
    this.queue.push(id);
    void this.pump();
    return job;
  }

  private persist(record: JobRecord): Promise<void> {
    const id = record.job.id;
    const value = structuredClone(record);
    const previous = this.persistence.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => atomicJson(path.join(this.directory, id, 'job.json'), value));
    this.persistence.set(id, current);
    return current.finally(() => {if (this.persistence.get(id) === current) this.persistence.delete(id);});
  }

  private update(id: string, patch: Partial<Job>, force = true): Promise<void> {
    const previous = this.updates.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      const record = this.records.get(id);
      if (!record) return;
      // Late progress cannot revive terminal work. Same-status updates remain
      // available for an explicit draft apply's verification metadata.
      if (finalStatuses.has(record.job.status) && patch.status !== record.job.status) return;
      if (patch.status === 'completed' && record.job.status !== 'completed' && this.controllers.get(id)?.signal.aborted) return;
      const next = {...record, job: {...record.job, ...patch, updatedAt: new Date().toISOString()}};
      if (force || patch.status !== undefined || Date.now() - (this.lastProgressWrite.get(id) ?? 0) > 600) {
        await this.persist(next);
        this.lastProgressWrite.set(id, Date.now());
      }
      // In particular, 'completed' is never visible before its atomic job.json
      // replacement. Serialize the whole transition so a progress write queued
      // during persistence cannot later overwrite it with stale running state.
      record.job = next.job;
    });
    this.updates.set(id, current);
    return current.finally(() => {if (this.updates.get(id) === current) this.updates.delete(id);});
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        const record = this.records.get(id);
        if (!record || record.job.status === 'cancelled') continue;
        const controller = new AbortController();
        this.controllers.set(id, controller);
        let finish!: () => void;
        this.finishes.set(id, new Promise<void>((resolve) => {finish = resolve;}));
        try {
          const messages: Record<Job['type'], string> = {render: '영상 출력을 준비하고 있습니다.', transcribe: '로컬 음성 분석을 준비하고 있습니다.', generate: 'Codex 장면 생성을 준비하고 있습니다.'};
          await this.update(id, {status: 'running', progress: 0.01, message: messages[record.job.type]});
          await mkdir(this.outputDirectory(id), {recursive: true});
          if (this.get(id).status === 'cancelled') controller.abort();
          if (controller.signal.aborted) throw new Error('취소됨');
          if (record.job.type === 'transcribe') await this.transcribe(record, controller.signal);
          else if (record.job.type === 'generate') await this.generate(record, controller.signal);
          else await this.render(record, controller.signal);
          if (!controller.signal.aborted) await this.update(id, {status: 'completed', progress: 1});
        } catch (error) {
          await this.update(id, controller.signal.aborted ? {status: 'cancelled', message: '작업을 취소했습니다.'} : {status: 'failed', error: errorMessage(error).slice(0, 2000), message: '작업에 실패했습니다. 편집 내용은 저장되어 있습니다.'});
        } finally {
          this.controllers.delete(id);
          this.committing.delete(id);
          finish();
          this.finishes.delete(id);
        }
      }
    } finally {this.running = false;}
  }

  private async render(record: JobRecord, signal: AbortSignal): Promise<void> {
    const {renderProject} = await import('./render');
    const result = await renderProject({project: record.snapshot, projectDirectory: this.store.directory(record.snapshot.id), outputDirectory: this.outputDirectory(record.job.id), assetBaseUrl: `${this.serverOrigin}/api/jobs/${record.job.id}/assets`, options: record.options ?? {resolution: '1080p'}, signal,
      onProgress: (progress: number, message: string) => {void this.update(record.job.id, {progress: Math.min(0.99, Math.max(0, progress)), message}, false).catch(() => undefined);},
    });
    await this.update(record.job.id, {outputUrl: `/api/outputs/${record.job.id}/${encodeURIComponent(result.fileName)}`, verification: result.verification, message: '영상 출력과 파일 검증을 마쳤습니다.'});
    await writeFile(path.join(this.outputDirectory(record.job.id), 'verification.json'), `${JSON.stringify(result.verification, null, 2)}\n`);
  }

  private async generate(record: JobRecord, signal: AbortSignal): Promise<void> {
    if (!record.sceneIds?.length) throw new Error('생성할 장면 범위가 없습니다. 구성을 확인한 뒤 다시 생성해 주세요.');
    const generated = await this.codex.generate({project: structuredClone(record.snapshot), sceneIds: [...record.sceneIds], outputDirectory: this.outputDirectory(record.job.id), signal,
      onProgress: (progress, message) => {void this.update(record.job.id, {progress: Math.min(0.94, Math.max(0.01, progress)), message}, false).catch(() => undefined);},
    });
    signal.throwIfAborted();
    const plan = validateScenePlan(record.snapshot, generated, record.sceneIds);
    await atomicJson(path.join(this.outputDirectory(record.job.id), 'plan.json'), plan, {signal});
    signal.throwIfAborted();
    await this.update(record.job.id, {progress: 0.99, outputUrl: `/api/outputs/${record.job.id}/plan.json`,
      verification: {status: 'passed', runner: this.codex === defaultCodexAdapter ? 'codex-cli' : 'injected-adapter', plannedSceneCount: plan.scenes.length, sceneIds: [...record.sceneIds], sourceRevision: record.snapshot.revision, applied: false},
      message: '장면 초안을 만들었습니다. 미리보기에서 확인한 뒤 적용해 주세요.',
    });
  }

  private async transcribe(record: JobRecord, signal: AbortSignal): Promise<void> {
    const setup = await transcriptionSetup(this.appDirectory);
    if (!setup.available) throw new Error(setup.reason);
    const project = record.snapshot;
    const asset = project.assets.find((item) => item.id === project.audioAssetId);
    if (!asset) throw new Error('연결된 나레이션이 없습니다.');
    const output = path.join(this.outputDirectory(record.job.id), 'transcript.json');
    const input = safeChild(this.store.assetsDirectory(project.id), asset.fileName);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(setup.python, [fileURLToPath(new URL('./transcribe.py', import.meta.url)), '--input', input, '--model', setup.model, '--output', output], {
        stdio: ['ignore', 'pipe', 'pipe'], signal,
        env: {...process.env, HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1', HF_HUB_DISABLE_TELEMETRY: '1'},
      });
      let buffer = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          try {
            const data = JSON.parse(line) as {progress?: number; message?: string};
            if (typeof data.progress === 'number' && Number.isFinite(data.progress)) {
              void this.update(record.job.id, {progress: Math.max(0.01, Math.min(0.96, data.progress * 0.96)), message: String(data.message ?? '나레이션 분석 중').slice(0, 300)}, false).catch(() => undefined);
            }
          } catch { /* Libraries can emit unstructured diagnostics; not progress. */ }
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {stderr = (stderr + chunk.toString()).slice(-4000);});
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(signal.aborted ? '작업이 취소되었습니다.' : `로컬 음성 분석에 실패했습니다. ${stderr.slice(-1500)}`)));
    });
    if (signal.aborted) throw new Error('취소됨');
    const transcript = await readFile(output, {encoding: 'utf8', signal});
    signal.throwIfAborted();
    const parsed = parseCaptions(transcript, 'json', project.settings.fps);
    if (!parsed.captions.length) throw new Error('녹음에서 발화를 찾지 못했습니다. 전사 JSON을 확인해 주세요.');
    let applied = false;
    let reason = '';
    try {
      await this.store.command(project.id, {type: 'replaceCaptions', captions: parsed.captions, words: parsed.words, regroup: false}, project.revision, '로컬 음성 분석 적용', {
        signal, onCommit: () => {this.committing.add(record.job.id);},
      });
      applied = true;
    } catch (error) {
      if (signal.aborted) throw error;
      reason = errorMessage(error);
    }
    await this.update(record.job.id, {
      outputUrl: `/api/outputs/${record.job.id}/transcript.json`,
      verification: {applied, captionCount: parsed.captions.length, wordCount: parsed.words.length, ...(reason ? {reason} : {})},
      message: applied ? '나레이션 분석을 마치고 자막과 장면을 구성했습니다.' : '분석을 마쳤습니다. 작업 중 편집이 변경되어 결과 파일을 따로 보관했습니다. 자막 가져오기로 적용할 수 있습니다.',
    });
  }

  async cancel(id: string): Promise<Job> {
    const job = this.get(id);
    if (finalStatuses.has(job.status)) return job;
    // Once the atomic project replacement starts, report its real completion
    // instead of labelling an already-applied transcript as cancelled.
    if (this.committing.has(id)) {
      await this.finishes.get(id);
      return this.get(id);
    }
    this.controllers.get(id)?.abort();
    this.queue = this.queue.filter((queued) => queued !== id);
    await this.update(id, {status: 'cancelled', message: '작업을 취소했습니다.'});
    return this.get(id);
  }

  async retry(id: string): Promise<Job> {
    const job = this.get(id);
    if (job.status !== 'failed' && job.status !== 'cancelled') throw new HttpError(409, '실패하거나 취소한 작업만 다시 시도할 수 있습니다.');
    const record = this.records.get(id)!;
    if (job.type === 'transcribe') {
      const current = await this.store.get(job.projectId);
      return this.createTranscription(job.projectId, current.revision);
    }
    if (job.type === 'generate') {
      const current = await this.store.get(job.projectId);
      if (current.revision !== record.snapshot.revision) throw new HttpError(409, '프로젝트가 바뀌었습니다. 최신 구성에서 생성할 장면을 선택해 새로 시작해 주세요.');
      return this.createGeneration(job.projectId, current.revision, record.sceneIds ?? []);
    }
    // Re-export exactly the saved revision, not the possibly newer current edit.
    return this.enqueue('render', record.snapshot, record.options);
  }
}
