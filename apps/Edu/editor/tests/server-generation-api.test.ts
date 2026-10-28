import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {createServer, type Server} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createStudioApp} from '../server/app';
import type {Job, Project, ScenePlan} from '../src/shared/types';

describe('scene generation HTTP and MCP contracts using an explicit test adapter', () => {
  let directory: string;
  let server: Server;
  let baseUrl: string;
  const appDirectory = fileURLToPath(new URL('..', import.meta.url));
  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'studio-generation-api-'));
    const setup = await createStudioApp({appDirectory, dataDirectory: directory, codexAdapter: {
      status: async () => ({available: true, reason: '명시적 테스트용 생성기'}),
      generate: async ({sceneIds}) => ({scenes: sceneIds.map((sceneId) => ({sceneId, kind: 'quote', title: '핵심 메시지', heading: '직접 확인하는 기준', kicker: '작업 방식', body: '작게 시작합니다.', items: [], assetId: null, mediaStartFrame: 0, mediaFit: 'contain', motion: 'calm', showCaptions: true, notes: 'HTTP fixture, not live AI'}))}),
    }});
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
  const post = (url: string, body: unknown) => fetch(baseUrl + url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  async function project() {
    const original = await (await post('/api/projects', {title: '생성 계약', durationSeconds: 8})).json() as Project;
    const response = await post(`/api/projects/${original.id}/captions`, {expectedRevision: original.revision, format: 'srt', regroup: true, text: '1\n00:00:00,000 --> 00:00:08,000\n결과를 직접 확인하는 작은 일부터 시작합니다.\n'});
    expect(response.status).toBe(200);
    return response.json() as Promise<Project>;
  }
  async function completed(id: string) {
    for (let index = 0; index < 200; index++) {
      const job = await (await fetch(`${baseUrl}/api/jobs/${id}`)).json() as Job;
      if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('Fixture did not complete');
  }

  it('returns a previewable snapshot and only changes the project on explicit apply', async () => {
    const source = await project();
    const started = await post(`/api/projects/${source.id}/generate`, {expectedRevision: source.revision, sceneIds: source.scenes.map((scene) => scene.id)});
    expect(started.status).toBe(202);
    const job = await started.json() as Job;
    const terminal = await completed(job.id);
    expect(terminal.status).toBe('completed');
    expect(terminal.verification?.runner).toBe('injected-adapter');
    const resultResponse = await fetch(`${baseUrl}/api/jobs/${job.id}/plan`);
    expect(resultResponse.status).toBe(200);
    const result = await resultResponse.json() as {plan: ScenePlan; project: Project};
    expect(result.project).toEqual(source);
    expect(result.plan.scenes[0].heading).toBe('직접 확인하는 기준');
    const unchanged = await (await fetch(`${baseUrl}/api/projects/${source.id}`)).json() as Project;
    expect(unchanged.revision).toBe(source.revision);
    const applied = await post(`/api/jobs/${job.id}/apply`, {expectedRevision: source.revision});
    expect(applied.status).toBe(200);
    const value = await applied.json() as Project;
    expect(value.revision).toBe(source.revision + 1);
    expect(value.scenes[0].heading).toBe(result.plan.scenes[0].heading);
    expect(value.captions).toEqual(source.captions);
    expect((await post(`/api/jobs/${job.id}/apply`, {expectedRevision: value.revision})).status).toBe(409);
  });

  it('does not let HTTP input select a fixture or silently apply a stale draft', async () => {
    const source = await project();
    const invalid = await post(`/api/projects/${source.id}/generate`, {expectedRevision: source.revision, sceneIds: [source.scenes[0].id], runner: 'fixture'});
    expect(invalid.status).toBe(400);
    const started = await (await post(`/api/projects/${source.id}/generate`, {expectedRevision: source.revision, sceneIds: [source.scenes[0].id]})).json() as Job;
    await completed(started.id);
    const edited = await (await post(`/api/projects/${source.id}/commands`, {expectedRevision: source.revision, command: {type: 'updateProject', patch: {title: '새 편집'}}})).json() as Project;
    expect((await post(`/api/jobs/${started.id}/apply`, {expectedRevision: edited.revision})).status).toBe(409);
    const retained = await (await fetch(`${baseUrl}/api/jobs/${started.id}/plan`)).json() as {project: Project};
    expect(retained.project.title).toBe(source.title);
  });

  it('preserves per-scene user requirements through explicit generation and regeneration', async () => {
    let current = await project();
    const sceneId = current.scenes[0].id;
    const requirements = '결론부터 크게 보여 주고 나레이션 자막을 유지해 주세요.';
    current = await (await post(`/api/projects/${current.id}/commands`, {expectedRevision: current.revision,
      command: {type: 'updateSceneSetup', patch: {allowedKinds: ['title']}}})).json() as Project;
    const configured = await post(`/api/projects/${current.id}/commands`, {expectedRevision: current.revision,
      command: {type: 'updateScene', sceneId, patch: {preferredKind: 'quote', requirements, notes: '이전 생성기의 연출 메모'}}});
    expect(configured.status).toBe(200);
    current = await configured.json() as Project;
    for (let generation = 0; generation < 2; generation++) {
      const started = await post(`/api/projects/${current.id}/generate`, {expectedRevision: current.revision, sceneIds: [sceneId]});
      expect(started.status).toBe(202);
      const job = await started.json() as Job;
      expect((await completed(job.id)).status).toBe('completed');
      const draft = await (await fetch(`${baseUrl}/api/jobs/${job.id}/plan`)).json() as {project: Project; plan: ScenePlan};
      expect(draft.project.scenes[0].requirements).toBe(requirements);
      expect(draft.plan.scenes[0].kind).toBe('quote');
      expect(draft.plan.scenes[0]).not.toHaveProperty('requirements');
      const applied = await post(`/api/jobs/${job.id}/apply`, {expectedRevision: current.revision});
      expect(applied.status).toBe(200);
      current = await applied.json() as Project;
      expect(current.scenes[0].requirements).toBe(requirements);
      expect(current.scenes[0].preferredKind).toBe('quote');
      expect(current.scenes[0].notes).toBe('HTTP fixture, not live AI');
    }
    const persisted = await (await fetch(`${baseUrl}/api/projects/${current.id}`)).json() as Project;
    expect(persisted.scenes[0].requirements).toBe(requirements);
  });

  it('exposes and executes generation/review/apply over real stdio MCP transport', async () => {
    const source = await project();
    const transport = new StdioClientTransport({command: process.execPath, args: [path.join(appDirectory, 'node_modules/tsx/dist/cli.mjs'), path.join(appDirectory, 'server/mcp.ts')], cwd: appDirectory,
      env: {...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), STUDIO_URL: baseUrl}, stderr: 'pipe'});
    const client = new Client({name: 'generation-contract-test', version: '1.0.0'});
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['start_scene_generation', 'get_scene_plan', 'apply_scene_plan']));
      const started = await client.callTool({name: 'start_scene_generation', arguments: {projectId: source.id, expectedRevision: source.revision, sceneIds: [source.scenes[0].id]}});
      expect(started.isError).not.toBe(true);
      const result = started.structuredContent as {result: Job};
      expect((await completed(result.result.id)).status).toBe('completed');
      const plan = await client.callTool({name: 'get_scene_plan', arguments: {jobId: result.result.id}});
      expect(plan.isError).not.toBe(true);
      const applied = await client.callTool({name: 'apply_scene_plan', arguments: {jobId: result.result.id, expectedRevision: source.revision}});
      expect(applied.isError).not.toBe(true);
      expect((await (await fetch(`${baseUrl}/api/projects/${source.id}`)).json() as Project).scenes[0].heading).toBe('직접 확인하는 기준');
    } finally {await client.close();}
  });
});
