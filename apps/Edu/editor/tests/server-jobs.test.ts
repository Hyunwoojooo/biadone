import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {JobManager} from '../server/jobs';
import {atomicJson, ProjectStore} from '../server/storage';
import type {Job} from '../src/shared/types';

describe('persistent production jobs', () => {
  let directory: string;
  let store: ProjectStore;
  const appDirectory = fileURLToPath(new URL('..', import.meta.url));
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'biadone-jobs-'));
    store = new ProjectStore(directory);
    await store.init();
  });
  afterEach(async () => {await rm(directory, {recursive: true, force: true});});

  it('does not silently resume abandoned processes after app restart', async () => {
    const snapshot = await store.create({title: '재시작 검증'});
    const now = new Date().toISOString();
    const job: Job = {id: randomUUID(), projectId: snapshot.id, type: 'render', status: 'running', progress: 0.4, message: '렌더링 중', createdAt: now, updatedAt: now, projectRevision: snapshot.revision};
    await atomicJson(path.join(directory, 'jobs', job.id, 'job.json'), {job, snapshot, options: {resolution: '720p'}});
    const manager = new JobManager(store, appDirectory);
    await manager.init();
    expect(manager.get(job.id).status).toBe('failed');
    expect(manager.get(job.id).error).toBe('interrupted');
    const persisted = JSON.parse(await readFile(path.join(directory, 'jobs', job.id, 'job.json'), 'utf8')) as {job: Job};
    expect(persisted.job.status).toBe('failed');
    expect((await store.get(snapshot.id)).revision).toBe(snapshot.revision);
  });

  it('cancels queued work before rendering starts and persists the terminal state', async () => {
    const project = await store.create({title: '대기 취소 검증'});
    const manager = new JobManager(store, appDirectory);
    await manager.init();
    const job = await manager.createRender(project.id, {resolution: '720p', allowWarnings: true});
    await manager.cancel(job.id);
    // Let the already-scheduled pump observe the abort; it must not revive the job.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(manager.get(job.id).status).toBe('cancelled');
    const persisted = JSON.parse(await readFile(path.join(directory, 'jobs', job.id, 'job.json'), 'utf8')) as {job: Job};
    expect(persisted.job.status).toBe('cancelled');
    expect((await store.get(project.id)).revision).toBe(project.revision);
  });
});
