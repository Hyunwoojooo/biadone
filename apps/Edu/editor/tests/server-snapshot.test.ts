import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {createServer, type Server} from 'node:http';
import {mkdtemp, rm, symlink, unlink, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStudioApp} from '../server/app';
import {atomicJson, ProjectStore} from '../server/storage';
import type {Asset, Job} from '../src/shared/types';

describe('render snapshot media', () => {
  let server: Server;
  let directory: string;
  let baseUrl: string;
  let projectId: string;
  let jobId: string;
  let asset: Asset;
  let assetPath: string;
  const wave = waveFixture();

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'biadone-snapshot-'));
    const store = new ProjectStore(directory);
    await store.init();
    const project = await store.create({title: '출력 중 되돌리기', durationSeconds: 1});
    projectId = project.id;
    asset = {id: randomUUID(), name: 'snapshot.wav', fileName: `${randomUUID()}.wav`, kind: 'audio', duration: 1};
    assetPath = path.join(store.assetsDirectory(project.id), asset.fileName);
    await writeFile(assetPath, wave);
    const snapshot = await store.command(project.id, {type: 'addAsset', asset}, project.revision);
    jobId = randomUUID();
    const now = new Date().toISOString();
    const job: Job = {id: jobId, projectId, type: 'render', status: 'failed', progress: 0.5, message: '보관된 출력 작업', createdAt: now, updatedAt: now, projectRevision: snapshot.revision};
    await atomicJson(path.join(directory, 'jobs', jobId, 'job.json'), {job, snapshot, options: {resolution: '720p'}});
    // Undo removes the asset's current registration, but not its immutable bytes.
    const undone = await store.navigate(projectId, snapshot.revision, 'undo');
    expect(undone.assets).toHaveLength(0);
    const setup = await createStudioApp({appDirectory: fileURLToPath(new URL('..', import.meta.url)), dataDirectory: directory});
    server = createServer(setup.app);
    await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, {recursive: true, force: true});
  });

  it('serves the saved job media after the current project was undone, including renderer CORS and ranges', async () => {
    const current = await fetch(`${baseUrl}/api/projects/${projectId}/assets/${asset.id}`);
    expect(current.status).toBe(404);
    const rendererOrigin = 'http://localhost:45123';
    const saved = await fetch(`${baseUrl}/api/jobs/${jobId}/assets/${asset.id}`, {headers: {Origin: rendererOrigin, Range: 'bytes=0-43'}});
    expect(saved.status).toBe(206);
    expect(saved.headers.get('Access-Control-Allow-Origin')).toBe(rendererOrigin);
    expect(Buffer.from(await saved.arrayBuffer())).toEqual(wave.subarray(0, 44));
    const preflight = await fetch(`${baseUrl}/api/jobs/${jobId}/assets/${asset.id}`, {method: 'OPTIONS', headers: {Origin: rendererOrigin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Range'}});
    expect(preflight.status).toBe(204);
  });

  it('does not resolve IDs outside the snapshot or follow an asset symlink', async () => {
    const absent = await fetch(`${baseUrl}/api/jobs/${jobId}/assets/${randomUUID()}`);
    expect(absent.status).toBe(404);
    const escape = await fetch(`${baseUrl}/api/jobs/${jobId}/assets/${encodeURIComponent('../project.json')}`);
    expect([400, 404]).toContain(escape.status);
    const unrelated = path.join(directory, 'private.txt');
    await writeFile(unrelated, 'not an asset');
    await unlink(assetPath);
    await symlink(unrelated, assetPath);
    const unsafe = await fetch(`${baseUrl}/api/jobs/${jobId}/assets/${asset.id}`);
    expect(unsafe.status).toBe(404);
  });
});

function waveFixture(): Buffer {
  const sampleRate = 16000;
  const output = Buffer.alloc(44 + sampleRate * 2);
  output.write('RIFF'); output.writeUInt32LE(output.length - 8, 4); output.write('WAVE', 8);
  output.write('fmt ', 12); output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24); output.writeUInt32LE(sampleRate * 2, 28); output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34);
  output.write('data', 36); output.writeUInt32LE(sampleRate * 2, 40);
  return output;
}
