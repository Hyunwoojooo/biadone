import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {createServer, type Server} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createStudioApp} from '../server/app';
import type {Project} from '../src/shared/types';

describe('local HTTP and Codex MCP', () => {
  let server: Server;
  let directory: string;
  let baseUrl: string;
  const appDirectory = fileURLToPath(new URL('..', import.meta.url));
  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'biadone-api-'));
    const setup = await createStudioApp({appDirectory, dataDirectory: directory});
    server = createServer(setup.app);
    await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address');
    baseUrl = `http://127.0.0.1:${address.port}`;
    setup.jobs.setOrigin(baseUrl);
  });
  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, {recursive: true, force: true});
  });

  async function post(endpoint: string, body: unknown) {
    return fetch(`${baseUrl}${endpoint}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  }
  async function makeProject(title = '서버 검증'): Promise<Project> {
    const result = await post('/api/projects', {title, durationSeconds: 30});
    expect(result.status).toBe(201);
    return result.json() as Promise<Project>;
  }

  it('uses the same revision-checked edit contract and preserves saved content', async () => {
    const project = await makeProject();
    const response = await post(`/api/projects/${project.id}/commands`, {expectedRevision: project.revision, command: {type: 'updateProject', patch: {title: '저장된 새 제목'}}});
    expect(response.status).toBe(200);
    const edited = await response.json() as Project;
    const stale = await post(`/api/projects/${project.id}/commands`, {expectedRevision: project.revision, command: {type: 'updateProject', patch: {title: '오래된 수정'}}});
    expect(stale.status).toBe(409);
    const reload = await (await fetch(`${baseUrl}/api/projects/${project.id}`)).json() as Project;
    expect(reload.title).toBe('저장된 새 제목');
    expect(reload.revision).toBe(edited.revision);
  });

  it('rejects cross-origin mutations and malformed commands', async () => {
    const response = await fetch(`${baseUrl}/api/projects`, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://untrusted.example'}, body: '{}'});
    expect(response.status).toBe(403);
    const project = await makeProject();
    const invalid = await post(`/api/projects/${project.id}/commands`, {expectedRevision: project.revision, command: {type: 'runShell', command: 'echo no'}});
    expect(invalid.status).toBe(400);
  });

  it('imports timed Korean captions and exports the actual corrected subtitle text', async () => {
    const project = await makeProject();
    const response = await post(`/api/projects/${project.id}/captions`, {expectedRevision: project.revision, format: 'srt', regroup: true, text: '1\n00:00:01,000 --> 00:00:04,000\n한국어 자막을 확인합니다.\n\n2\n00:00:04,500 --> 00:00:08,000\n장면과 자막은 따로 편집합니다.\n'});
    expect(response.status).toBe(200);
    const imported = await response.json() as Project;
    expect(imported.captions).toHaveLength(2);
    const file = await fetch(`${baseUrl}/api/projects/${project.id}/captions.srt`);
    expect(file.status).toBe(200);
    expect(await file.text()).toContain('한국어 자막을 확인합니다.');
  });

  it('streams and probes real audio, binds narration and serves byte ranges', async () => {
    const project = await makeProject('자료 업로드');
    const wav = testWave();
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(wav)], {type: 'audio/wav'}), '나레이션.wav');
    const response = await fetch(`${baseUrl}/api/projects/${project.id}/assets`, {method: 'POST', body: form});
    expect(response.status).toBe(201);
    const {project: imported, asset} = await response.json() as {project: Project; asset: Project['assets'][number]};
    expect(asset.name).toBe('나레이션.wav');
    expect(asset.kind).toBe('audio');
    expect(asset.duration).toBeGreaterThan(0);
    expect(asset.waveform?.some((peak) => peak > 0)).toBe(true);
    const audio = await fetch(`${baseUrl}/api/projects/${project.id}/assets/${asset.id}`, {headers: {Range: 'bytes=0-43'}});
    expect(audio.status).toBe(206);
    expect((await audio.arrayBuffer()).byteLength).toBe(44);
    const bound = await post(`/api/projects/${project.id}/commands`, {expectedRevision: imported.revision, command: {type: 'setNarration', assetId: asset.id}});
    expect(bound.status).toBe(200);
    expect((await bound.json() as Project).audioAssetId).toBe(asset.id);
  });

  it('verifies file content instead of trusting an image extension', async () => {
    const project = await makeProject();
    const form = new FormData();
    form.set('file', new Blob(['not an image']), 'fake.png');
    const response = await fetch(`${baseUrl}/api/projects/${project.id}/assets`, {method: 'POST', body: form});
    expect(response.status).toBe(422);
    const saved = await (await fetch(`${baseUrl}/api/projects/${project.id}`)).json() as Project;
    expect(saved.assets).toHaveLength(0);
  });

  it('allows renderer-origin asset range reads without opening project data or mutations', async () => {
    const project = await makeProject('렌더러 자료 접근');
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(testWave())], {type: 'audio/wav'}), 'render-audio.wav');
    const upload = await fetch(`${baseUrl}/api/projects/${project.id}/assets`, {method: 'POST', body: form});
    expect(upload.status).toBe(201);
    const {asset} = await upload.json() as {asset: Project['assets'][number]};
    const assetUrl = `${baseUrl}/api/projects/${project.id}/assets/${asset.id}`;
    const rendererOrigin = `http://localhost:${new URL(baseUrl).port === '45001' ? '45002' : '45001'}`;
    const audio = await fetch(assetUrl, {headers: {Origin: rendererOrigin, Range: 'bytes=0-43'}});
    expect(audio.status).toBe(206);
    expect(audio.headers.get('Access-Control-Allow-Origin')).toBe(rendererOrigin);
    expect(audio.headers.get('Access-Control-Expose-Headers')).toContain('Content-Range');
    expect(audio.headers.get('Content-Range')).toMatch(/^bytes 0-43\//);
    expect((await audio.arrayBuffer()).byteLength).toBe(44);
    const head = await fetch(assetUrl, {method: 'HEAD', headers: {Origin: rendererOrigin}});
    expect(head.status).toBe(200);
    expect(head.headers.get('Access-Control-Allow-Origin')).toBe(rendererOrigin);
    const options = await fetch(assetUrl, {method: 'OPTIONS', headers: {Origin: rendererOrigin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range'}});
    expect(options.status).toBe(204);
    expect(options.headers.get('Access-Control-Allow-Headers')).toBe('Range');
    const privateData = await fetch(`${baseUrl}/api/projects/${project.id}`, {headers: {Origin: rendererOrigin}});
    expect(privateData.status).toBe(403);
    const write = await fetch(`${baseUrl}/api/projects/${project.id}/commands`, {method: 'POST', headers: {Origin: rendererOrigin, 'Content-Type': 'application/json'}, body: JSON.stringify({expectedRevision: 1, command: {type: 'updateProject', patch: {title: '바뀌면 안 됨'}}})});
    expect(write.status).toBe(403);
    const external = await fetch(assetUrl, {headers: {Origin: 'https://untrusted.example'}});
    expect(external.status).toBe(403);
    expect(external.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('does not label a missing narration or rejected export as successful', async () => {
    const project = await makeProject();
    const rejected = await post(`/api/projects/${project.id}/render`, {resolution: '720p'});
    expect(rejected.status).toBe(422);
    const analysis = await post(`/api/projects/${project.id}/transcribe`, {expectedRevision: project.revision});
    expect(analysis.status).toBe(400);
    const jobs = await (await fetch(`${baseUrl}/api/jobs?projectId=${project.id}`)).json() as unknown[];
    expect(jobs).toHaveLength(0);
  });

  it('initializes stdio MCP, lists tools and performs a real read/edit through HTTP', async () => {
    const transport = new StdioClientTransport({command: process.execPath, args: [path.join(appDirectory, 'node_modules/tsx/dist/cli.mjs'), path.join(appDirectory, 'server/mcp.ts')], cwd: appDirectory, env: {...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), STUDIO_URL: baseUrl}, stderr: 'pipe'});
    const client = new Client({name: 'studio-qa', version: '1.0.0'});
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('edit_project');
      const project = await makeProject('Codex 연결 검증');
      const read = await client.callTool({name: 'get_project', arguments: {projectId: project.id}});
      expect(read.isError).not.toBe(true);
      const changed = await client.callTool({name: 'edit_project', arguments: {projectId: project.id, expectedRevision: project.revision, command: {type: 'updateProject', patch: {title: 'MCP가 수정한 제목'}}}});
      expect(changed.isError).not.toBe(true);
      const actual = await (await fetch(`${baseUrl}/api/projects/${project.id}`)).json() as Project;
      expect(actual.title).toBe('MCP가 수정한 제목');
      expect(actual.revision).toBe(project.revision + 1);
    } finally {await client.close();}
  });
});

function testWave(): Buffer {
  const sampleRate = 16000;
  const sampleCount = sampleRate;
  const output = Buffer.alloc(44 + sampleCount * 2);
  output.write('RIFF'); output.writeUInt32LE(output.length - 8, 4); output.write('WAVE', 8);
  output.write('fmt ', 12); output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24); output.writeUInt32LE(sampleRate * 2, 28); output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34);
  output.write('data', 36); output.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index++) output.writeInt16LE(Math.round(Math.sin(index / sampleRate * 440 * Math.PI * 2) * 12000), 44 + index * 2);
  return output;
}
