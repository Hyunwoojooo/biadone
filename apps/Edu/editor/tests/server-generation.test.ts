import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProjectStore} from '../server/storage';
import * as storage from '../server/storage';
import {JobManager} from '../server/jobs';
import type {CodexAdapter, SceneGenerationContext} from '../server/codex';
import type {Project, ScenePlan} from '../src/shared/types';

function fixturePlan(context: SceneGenerationContext): ScenePlan {
  return {scenes: context.sceneIds.map((sceneId) => ({sceneId, kind: 'title', title: '확인할 기준', heading: '작은 일부터 시작', kicker: '실전 기준', body: '결과를 직접 확인합니다.', items: [], assetId: null, mediaStartFrame: 0, mediaFit: 'contain', motion: 'standard', showCaptions: true, notes: '테스트용 초안'}))};
}

async function untilTerminal(manager: JobManager, id: string) {
  for (let index = 0; index < 300; index++) {
    const job = manager.get(id);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Fixture job did not finish');
}

describe('Codex draft job lifecycle without live model calls', () => {
  let directory: string;
  let store: ProjectStore;
  let managers: JobManager[];
  const appDirectory = fileURLToPath(new URL('..', import.meta.url));
  beforeEach(async () => {managers = []; directory = await mkdtemp(path.join(os.tmpdir(), 'studio-generation-')); store = new ProjectStore(directory); await store.init();});
  afterEach(async () => {await Promise.all(managers.map((jobs) => jobs.shutdown())); vi.restoreAllMocks(); await rm(directory, {recursive: true, force: true});});

  async function source(): Promise<Project> {
    const project = await store.create({title: '검증 프로젝트', durationSeconds: 24});
    return store.command(project.id, {type: 'replaceCaptions', regroup: true, captions: [
      {id: 'cue_1', text: '반복하는 일을 고릅니다.', startFrame: 0, endFrame: 240},
      {id: 'cue_2', text: '결과를 직접 확인합니다.', startFrame: 240, endFrame: 480},
      {id: 'cue_3', text: '작은 작업부터 시작합니다.', startFrame: 480, endFrame: 720},
    ]}, project.revision);
  }
  function manager(adapter: CodexAdapter) {const jobs = new JobManager(store, appDirectory, {codexAdapter: adapter}); managers.push(jobs); return jobs;}
  const ready = async () => ({available: true, reason: '테스트용 생성기'});

  it('stores the complete plan without automatic edits, then applies exactly one revision', async () => {
    const project = await source();
    const jobs = manager({status: ready, generate: async (context) => fixturePlan(context)});
    await jobs.init();
    const original = JSON.stringify(project);
    const ids = project.scenes.map((scene) => scene.id);
    const job = await jobs.createGeneration(project.id, project.revision, ids);
    expect((await untilTerminal(jobs, job.id)).status).toBe('completed');
    expect(JSON.stringify(await store.get(project.id))).toBe(original);
    const result = await jobs.generationPlan(job.id);
    expect(result.project.revision).toBe(project.revision);
    expect(result.plan.scenes.map((scene) => scene.sceneId)).toEqual(ids);
    const beforeHistory = await store.history(project.id);
    const applied = await jobs.applyGeneration(job.id, project.revision);
    expect(applied.revision).toBe(project.revision + 1);
    expect(applied.scenes.every((scene) => scene.heading === '작은 일부터 시작')).toBe(true);
    expect(applied.captions).toEqual(project.captions);
    expect(applied.durationInFrames).toBe(project.durationInFrames);
    expect(await store.history(project.id)).toHaveLength(beforeHistory.length + 1);
    await expect(jobs.applyGeneration(job.id, applied.revision)).rejects.toMatchObject({status: 409});
  });

  it('preserves the snapshot draft when a concurrent editor changes the project', async () => {
    const project = await source();
    let finish!: () => void;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {enter = resolve;});
    const jobs = manager({status: ready, generate: async (context) => {await new Promise<void>((resolve) => {finish = resolve; enter();}); return fixturePlan(context);}});
    await jobs.init();
    const job = await jobs.createGeneration(project.id, project.revision, project.scenes.map((scene) => scene.id));
    await entered;
    const newer = await store.command(project.id, {type: 'updateProject', patch: {title: '사용자의 최신 수정'}}, project.revision);
    finish();
    expect((await untilTerminal(jobs, job.id)).status).toBe('completed');
    const result = await jobs.generationPlan(job.id);
    expect(result.project.title).toBe(project.title);
    await expect(jobs.applyGeneration(job.id, newer.revision)).rejects.toMatchObject({status: 409});
    await expect(jobs.applyGeneration(job.id, project.revision)).rejects.toMatchObject({status: 409});
    expect((await store.get(project.id)).title).toBe(newer.title);
    expect((await jobs.generationPlan(job.id)).plan.scenes).toHaveLength(project.scenes.length);
  });

  it('rejects duplicate active generation and cancellation cannot apply a late provider result', async () => {
    const project = await source();
    let finish!: () => void;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {enter = resolve;});
    const jobs = manager({status: ready, generate: async (context) => {await new Promise<void>((resolve) => {finish = resolve; enter();}); return fixturePlan(context);}});
    await jobs.init();
    const ids = project.scenes.map((scene) => scene.id);
    const job = await jobs.createGeneration(project.id, project.revision, ids);
    await entered;
    await expect(jobs.createGeneration(project.id, project.revision, ids)).rejects.toMatchObject({status: 409});
    await jobs.cancel(job.id);
    finish();
    await jobs.drain();
    expect(jobs.get(job.id).status).toBe('cancelled');
    await expect(jobs.generationPlan(job.id)).rejects.toMatchObject({status: 409});
    expect((await store.get(project.id)).revision).toBe(project.revision);
  });

  it('fails closed on an incomplete/locked/invalid scope and exposes no partial plan', async () => {
    const project = await source();
    const jobs = manager({status: ready, generate: async (context) => ({scenes: fixturePlan(context).scenes.slice(1)})});
    await jobs.init();
    const ids = project.scenes.map((scene) => scene.id);
    const job = await jobs.createGeneration(project.id, project.revision, ids);
    expect((await untilTerminal(jobs, job.id)).status).toBe('failed');
    await expect(jobs.generationPlan(job.id)).rejects.toMatchObject({status: 409});
    await expect(readFile(path.join(jobs.outputDirectory(job.id), 'plan.json'))).rejects.toThrow();
    const locked = await store.command(project.id, {type: 'updateScene', sceneId: ids[0], patch: {locked: true}}, project.revision);
    await expect(jobs.createGeneration(project.id, locked.revision, [ids[0]])).rejects.toThrow('잠긴');
    await expect(jobs.createGeneration(project.id, locked.revision, [ids[1], ids[1]])).rejects.toThrow('중복');
    await expect(jobs.createGeneration(project.id, locked.revision, ['not_a_scene'])).rejects.toThrow('찾을');
  });

  it('retry starts a new explicit job and refuses to regenerate stale source content', async () => {
    const project = await source();
    let calls = 0;
    const jobs = manager({status: ready, generate: async (context) => {calls++; if (calls === 1) throw new Error('테스트 실패'); return fixturePlan(context);}});
    await jobs.init();
    const first = await jobs.createGeneration(project.id, project.revision, project.scenes.map((scene) => scene.id));
    expect((await untilTerminal(jobs, first.id)).status).toBe('failed');
    const retried = await jobs.retry(first.id);
    expect(retried.id).not.toBe(first.id);
    expect((await untilTerminal(jobs, retried.id)).status).toBe('completed');
    expect(calls).toBe(2);
    await store.command(project.id, {type: 'updateProject', patch: {title: '변경된 프로젝트'}}, project.revision);
    await expect(jobs.retry(first.id)).rejects.toMatchObject({status: 409});
  });

  it('retains completed generation plans across app restart', async () => {
    const project = await source();
    const adapter: CodexAdapter = {status: ready, generate: async (context) => fixturePlan(context)};
    const first = manager(adapter);
    await first.init();
    const job = await first.createGeneration(project.id, project.revision, project.scenes.map((scene) => scene.id));
    await untilTerminal(first, job.id);
    const reloaded = manager(adapter);
    await reloaded.init();
    expect(reloaded.get(job.id).status).toBe('completed');
    expect((await reloaded.generationPlan(job.id)).project.revision).toBe(project.revision);
    expect((await reloaded.generationPlan(job.id)).plan.scenes).toHaveLength(project.scenes.length);
  });

  it('publishes completion only after the durable write and drops late progress behind it', async () => {
    const project = await source();
    const save = storage.atomicJson;
    let release!: () => void;
    let enter!: () => void;
    const held = new Promise<void>((resolve) => {release = resolve;});
    const entered = new Promise<void>((resolve) => {enter = resolve;});
    vi.spyOn(storage, 'atomicJson').mockImplementation(async (file, value, control) => {
      if (path.basename(file) === 'job.json' && (value as {job?: {status?: string}}).job?.status === 'completed') {enter(); await held;}
      return save(file, value, control);
    });
    let context!: SceneGenerationContext;
    const jobs = manager({status: ready, generate: async (input) => {context = input; return fixturePlan(input);}});
    await jobs.init();
    const job = await jobs.createGeneration(project.id, project.revision, project.scenes.map((scene) => scene.id));
    await entered;
    try {
      expect(jobs.get(job.id).status).toBe('running');
      const pending = JSON.parse(await readFile(path.join(jobs.directory, job.id, 'job.json'), 'utf8'));
      expect(pending.job.status).toBe('running');
      context.onProgress(0.2, 'late progress must not overwrite completed work');
    } finally {release();}
    expect((await untilTerminal(jobs, job.id)).status).toBe('completed');
    // No drain/delay before this read: the public terminal state itself is the
    // promise that a fresh app instance can recover the same completed job.
    const durable = JSON.parse(await readFile(path.join(jobs.directory, job.id, 'job.json'), 'utf8'));
    expect(durable.job.status).toBe('completed');
    await jobs.drain();
    expect(jobs.get(job.id).message).not.toContain('late progress');
    const reloaded = manager({status: ready, generate: async (input) => fixturePlan(input)});
    await reloaded.init();
    expect(reloaded.get(job.id).status).toBe('completed');
  });

  it('never exposes completed when committing that state fails', async () => {
    const project = await source();
    const save = storage.atomicJson;
    vi.spyOn(storage, 'atomicJson').mockImplementation(async (file, value, control) => {
      if (path.basename(file) === 'job.json' && (value as {job?: {status?: string}}).job?.status === 'completed') throw new Error('fixture durable write failed');
      return save(file, value, control);
    });
    const jobs = manager({status: ready, generate: async (context) => fixturePlan(context)});
    await jobs.init();
    const job = await jobs.createGeneration(project.id, project.revision, project.scenes.map((scene) => scene.id));
    const terminal = await untilTerminal(jobs, job.id);
    expect(terminal.status).toBe('failed');
    expect(terminal.error).toContain('fixture durable write failed');
    const durable = JSON.parse(await readFile(path.join(jobs.directory, job.id, 'job.json'), 'utf8'));
    expect(durable.job.status).toBe('failed');
    await expect(jobs.generationPlan(job.id)).rejects.toMatchObject({status: 409});
  });

  it('drains cancelled running and queued jobs before shutdown resolves', async () => {
    const first = await source();
    const second = await source();
    let enter!: () => void;
    let release!: () => void;
    let activeSignal!: AbortSignal;
    let calls = 0;
    const entered = new Promise<void>((resolve) => {enter = resolve;});
    const held = new Promise<void>((resolve) => {release = resolve;});
    const jobs = manager({status: ready, generate: async (context) => {calls++; activeSignal = context.signal; enter(); await held; return fixturePlan(context);}});
    await jobs.init();
    const active = await jobs.createGeneration(first.id, first.revision, first.scenes.map((scene) => scene.id));
    await entered;
    const queued = await jobs.createGeneration(second.id, second.revision, second.scenes.map((scene) => scene.id));
    const closing = jobs.shutdown();
    let closed = false;
    void closing.then(() => {closed = true;});
    try {
      expect(jobs.shutdown()).toBe(closing);
      expect(activeSignal.aborted).toBe(true);
      expect((await untilTerminal(jobs, active.id)).status).toBe('cancelled');
      expect((await untilTerminal(jobs, queued.id)).status).toBe('cancelled');
      expect(closed).toBe(false);
    } finally {release();}
    await closing;
    expect(calls).toBe(1);
    await expect(jobs.createGeneration(first.id, first.revision, first.scenes.map((scene) => scene.id))).rejects.toMatchObject({status: 503});
    for (const id of [active.id, queued.id]) {
      const durable = JSON.parse(await readFile(path.join(jobs.directory, id, 'job.json'), 'utf8'));
      expect(durable.job.status).toBe('cancelled');
    }
  });
});
