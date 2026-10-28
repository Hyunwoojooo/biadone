import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createProject, applyCommand} from '../src/domain/project';
import {codexArguments, codexLoginStatus, CodexProcessError, generateScenePlan, GENERATION_LIMITS, generationSceneIds, redactCodexError, runCodexProcess, sceneBatchPrompt, scenePlanJsonSchema} from '../server/codex';

describe('Codex CLI contract with local executable fixtures, never a model', () => {
  let directory: string;
  beforeEach(async () => {directory = await mkdtemp(path.join(os.tmpdir(), 'studio-codex-fixture-')); await mkdir(path.join(directory, 'tmp'));});
  afterEach(async () => {vi.unstubAllEnvs(); await rm(directory, {recursive: true, force: true});});

  it('uses scoped read-only/no-daemon options and a fully required JSON result shape', () => {
    const project = narratedProject(3);
    const ids = project.scenes.map((scene) => scene.id);
    const args = codexArguments(directory, path.join(directory, 'schema.json'), path.join(directory, 'plan.json'));
    expect(args).toContain('--no-daemon');
    expect(args).toContain('--ignore-user-config');
    expect(args).toContain('--ignore-rules');
    expect(args).toContain('--ephemeral');
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(args[args.indexOf('--ask-for-approval') + 1]).toBe('never');
    expect(args).toContain('web_search="disabled"');
    expect(args).not.toContain('tools.view_image=false');
    expect(args.some((arg) => arg.startsWith('sqlite_home='))).toBe(false);
    expect(args).toContain('project_doc_max_bytes=0');
    expect(args.some((arg) => /dangerously|--add-dir|--search/.test(arg))).toBe(false);
    expect(args.at(-1)).toBe('-');
    const schema = scenePlanJsonSchema(project, ids) as {additionalProperties:boolean;properties:{scenes:{items:{properties:Record<string,unknown>;required:string[];additionalProperties:boolean}}}};
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.scenes.items.additionalProperties).toBe(false);
    expect(schema.properties.scenes.items.required).toEqual(Object.keys(schema.properties.scenes.items.properties));
    const prompt = sceneBatchPrompt(project, [ids[0]], 1, 1);
    expect(prompt).toContain('단어 중간을 잘라');
    expect(prompt).toContain('보았다고 쓰지');
  });

  it('supports a 30-minute / 225-scene request in bounded sequential batches', async () => {
    const binary = await executableFixture('success');
    vi.stubEnv('STUDIO_CODEX_BIN', binary);
    const project = narratedProject(225);
    const original = JSON.stringify(project);
    const messages: string[] = [];
    const output = path.join(directory, 'output');
    await mkdir(output);
    const plan = await generateScenePlan({project, sceneIds: project.scenes.map((scene) => scene.id), outputDirectory: output, signal: new AbortController().signal, onProgress: (_progress, message) => messages.push(message)});
    expect(plan.scenes).toHaveLength(225);
    expect(new Set(plan.scenes.map((scene) => scene.sceneId)).size).toBe(225);
    expect(messages.at(-1)).toContain('23/23묶음 완료');
    expect(JSON.stringify(project)).toBe(original);
    const lastMeta = JSON.parse(await readFile(path.join(directory, 'codex-work', 'batch-023.meta.json'), 'utf8')) as {sceneCount:number};
    expect(lastMeta.sceneCount).toBe(5);
  }, 30_000);

  it('separates permanent user requirements from generated notes and honors explicit kinds over legacy defaults', async () => {
    let project = narratedProject(2);
    const ids = project.scenes.map((scene) => scene.id);
    project = applyCommand(project, {type: 'updateSceneSetup', patch: {allowedKinds: ['title']}});
    const requirements = '화면 중앙에 결론을 먼저 쓰고 핵심 단어에 밑줄을 넣어 주세요.';
    project = applyCommand(project, {type: 'updateScene', sceneId: ids[0], patch: {preferredKind: 'quote', requirements, notes: '이전 AI가 만든 연출 메모'}});
    expect(generationSceneIds(project, [ids[0]])).toEqual([ids[0]]);
    const prompt = sceneBatchPrompt(project, ids, 1, 1);
    const input = JSON.parse(prompt.split('\n\n입력 재료:\n')[1]);
    expect(input.scenes[0]).toMatchObject({sceneId: ids[0], preferredKind: 'quote', allowedKinds: ['quote'], userRequirements: requirements, previousGeneratedNotes: '이전 AI가 만든 연출 메모'});
    expect(input.scenes[1].allowedKinds).toEqual(['title']);
    expect(input.setup.allowedKinds).toEqual(['quote', 'title']);
    expect(input.catalog.quote).toBeTruthy();
    expect(prompt).toContain('최우선으로 준수');
    const schema = scenePlanJsonSchema(project, [ids[0]]) as {properties:{scenes:{items:{properties:Record<string,unknown> & {kind:{enum:string[]}}}}}};
    expect(schema.properties.scenes.items.properties.kind.enum).toEqual(['quote']);
    expect(schema.properties.scenes.items.properties).not.toHaveProperty('requirements');
    expect(schema.properties.scenes.items.properties).not.toHaveProperty('userRequirements');
    const binary = await executableFixture('success');
    vi.stubEnv('STUDIO_CODEX_BIN', binary);
    const output = path.join(directory, 'output');
    await mkdir(output);
    const plan = await generateScenePlan({project, sceneIds: [ids[0]], outputDirectory: output, signal: new AbortController().signal, onProgress: () => undefined});
    expect(plan.scenes[0].kind).toBe('quote');
    const applied = applyCommand(project, {type: 'applyScenePlan', plan, sceneIds: [ids[0]]});
    expect(applied.scenes[0].requirements).toBe(requirements);
    expect(applied.scenes[0].notes).not.toBe(project.scenes[0].notes);
    const missingMedia = applyCommand(project, {type: 'updateScene', sceneId: ids[0], patch: {preferredKind: 'image'}});
    expect(() => generationSceneIds(missingMedia, [ids[0]])).toThrow('자료가 없습니다');
  });

  it('does not return a partial plan when a later batch fails and never retries itself', async () => {
    const binary = await executableFixture('fail-second');
    vi.stubEnv('STUDIO_CODEX_BIN', binary);
    const project = narratedProject(11);
    const output = path.join(directory, 'output');
    await mkdir(output);
    await expect(generateScenePlan({project, sceneIds: project.scenes.map((scene) => scene.id), outputDirectory: output, signal: new AbortController().signal, onProgress: () => undefined})).rejects.toThrow('실패');
    const firstMeta = JSON.parse(await readFile(path.join(directory, 'codex-work', 'batch-001.meta.json'), 'utf8')) as {sceneCount:number};
    expect(firstMeta.sceneCount).toBe(10);
    await expect(readFile(path.join(output, 'plan.json'))).rejects.toThrow();
  });

  it('rejects a model result outside the exact requested scene set', async () => {
    const binary = await executableFixture('wrong-id');
    vi.stubEnv('STUDIO_CODEX_BIN', binary);
    const project = narratedProject(1);
    const output = path.join(directory, 'output');
    await mkdir(output);
    await expect(generateScenePlan({project, sceneIds: project.scenes.map((scene) => scene.id), outputDirectory: output, signal: new AbortController().signal, onProgress: () => undefined})).rejects.toThrow('없는 장면');
  });

  it('terminates a real child process on cancellation and tool-attempt events', async () => {
    const controller = new AbortController();
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {enter = resolve;});
    const processResult = runCodexProcess({binary: process.execPath, args: ['-e', `console.log(JSON.stringify({type:'turn.started'}));setInterval(()=>{},1000)`], cwd: directory, prompt: 'fixture input', signal: controller.signal, timeoutMs: 2000, onProgress: () => enter()});
    await entered;
    controller.abort();
    await expect(processResult).rejects.toThrow('취소');
    const blocked = await runCodexProcess({binary: process.execPath, args: ['-e', `console.log(JSON.stringify({type:'item.started',item:{type:'mcp_tool_call',arguments:'private fixture argument'}}));setInterval(()=>{},1000)`], cwd: directory, prompt: 'fixture input', signal: new AbortController().signal, timeoutMs: 2000, onProgress: () => undefined}).catch((error: unknown) => error);
    expect(blocked).toBeInstanceOf(CodexProcessError);
    expect(blocked).toMatchObject({message: expect.stringContaining('event=item.started, item=mcp_tool_call'), summary: {itemTypes: ['mcp_tool_call'], blockedItem: {eventType: 'item.started', itemType: 'mcp_tool_call', classification: 'tool'}}});
    expect(JSON.stringify(blocked)).not.toContain('private fixture argument');
    await expect(runCodexProcess({binary: process.execPath, args: ['-e', `console.log(JSON.stringify({type:'item.started',item:{type:'future_tool'}}));setInterval(()=>{},1000)`], cwd: directory, prompt: 'fixture input', signal: new AbortController().signal, timeoutMs: 2000, onProgress: () => undefined})).rejects.toMatchObject({message: expect.stringContaining('지원하지 않는 Codex 항목 유형'), summary: {blockedItem: {itemType: 'future_tool', classification: 'unsupported'}}});
  });

  it('accepts documented message items and bounds diagnostic fields without keeping message content', async () => {
    const summary = await runCodexProcess({binary: process.execPath, args: ['-e', `for(const type of ['agent_message','reasoning','plan_update'])console.log(JSON.stringify({type:'item.completed',item:{type,text:'private fixture message'}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:2,output_tokens:3,privateField:'private fixture usage'}}))`], cwd: directory, prompt: 'fixture', signal: new AbortController().signal, timeoutMs: 2000, onProgress: () => undefined});
    expect(summary.itemTypes).toEqual(['agent_message', 'reasoning', 'plan_update']);
    expect(summary.usage).toEqual({input_tokens: 2, output_tokens: 3});
    expect(JSON.stringify(summary)).not.toContain('private fixture');
    const blocked = await runCodexProcess({binary: process.execPath, args: ['-e', `console.log(JSON.stringify({type:'item.started',item:{type:'sk-fixture-secret-'+ 'x'.repeat(4000)}}));setInterval(()=>{},1000)`], cwd: directory, prompt: 'fixture', signal: new AbortController().signal, timeoutMs: 2000, onProgress: () => undefined}).catch((error: unknown) => error);
    expect(blocked).toMatchObject({summary: {itemTypes: ['invalid-type'], blockedItem: {itemType: 'invalid-type', classification: 'unsupported'}}});
    expect((blocked as Error).message.length).toBeLessThan(400);
    expect(JSON.stringify(blocked)).not.toContain('sk-fixture-secret');
  });

  it('keeps a bounded failed-batch diagnostic even when the event guard stops the CLI', async () => {
    const binary = await executableFixture('blocked-tool');
    vi.stubEnv('STUDIO_CODEX_BIN', binary);
    const project = narratedProject(1);
    const output = path.join(directory, 'output');
    await mkdir(output);
    await expect(generateScenePlan({project, sceneIds: project.scenes.map((scene) => scene.id), outputDirectory: output, signal: new AbortController().signal, onProgress: () => undefined})).rejects.toThrow('item=mcp_tool_call');
    const metadata = JSON.parse(await readFile(path.join(directory, 'codex-work', 'batch-001.meta.json'), 'utf8'));
    expect(metadata).toMatchObject({status: 'failed', sceneCount: 0, eventTypes: ['item.started'], itemTypes: ['mcp_tool_call'], blockedItem: {eventType: 'item.started', itemType: 'mcp_tool_call', classification: 'tool'}});
    expect(JSON.stringify(metadata)).not.toContain('private fixture argument');
    await expect(readFile(path.join(output, 'plan.json'))).rejects.toThrow();
  });

  it('accepts a recoverable ErrorItem only with a completed turn and validated final JSON', async () => {
    const binary = await executableFixture('recoverable-error');
    vi.stubEnv('STUDIO_CODEX_BIN', binary);
    const project = narratedProject(1);
    const output = path.join(directory, 'output');
    await mkdir(output);
    const plan = await generateScenePlan({project, sceneIds: project.scenes.map((scene) => scene.id), outputDirectory: output, signal: new AbortController().signal, onProgress: () => undefined});
    expect(plan.scenes).toHaveLength(1);
    const metadata = JSON.parse(await readFile(path.join(directory, 'codex-work', 'batch-001.meta.json'), 'utf8'));
    expect(metadata).toMatchObject({status: 'completed', turnCompleted: true, itemTypes: ['error'], diagnostics: [{eventType: 'item.completed', itemType: 'error', message: expect.stringContaining('Reconnecting')}], exitCode: 0});
    expect(metadata.blockedItem).toBeUndefined();
    expect(JSON.stringify(metadata)).not.toContain('sk-fixture-secret');
    expect(JSON.stringify(metadata)).not.toContain('fake-token');
  });

  it('preserves redacted CLI errors and stderr when an ErrorItem is followed by a failed turn', async () => {
    const binary = await executableFixture('terminal-error');
    vi.stubEnv('STUDIO_CODEX_BIN', binary);
    const project = narratedProject(1);
    const output = path.join(directory, 'output');
    await mkdir(output);
    await expect(generateScenePlan({project, sceneIds: project.scenes.map((scene) => scene.id), outputDirectory: output, signal: new AbortController().signal, onProgress: () => undefined})).rejects.toThrow('Unsupported fixture option');
    const metadata = JSON.parse(await readFile(path.join(directory, 'codex-work', 'batch-001.meta.json'), 'utf8'));
    expect(metadata).toMatchObject({status: 'failed', itemTypes: ['error'], failureMessage: expect.stringContaining('Unsupported fixture option'), stderrDiagnostic: expect.stringContaining('Error: fixture diagnostic'), exitCode: 1});
    expect(metadata.blockedItem).toBeUndefined();
    expect(JSON.stringify(metadata)).not.toContain('sk-fixture-secret');
    expect(JSON.stringify(metadata)).not.toContain('fake-token');
    expect(JSON.stringify(metadata)).not.toContain('private fixture reasoning');
    expect(JSON.stringify(metadata)).not.toContain('반복하는 일을 고르고 결과를 직접 확인합니다.');
  });

  it('does not treat an ErrorItem and an exit-zero partial output as a completed draft', async () => {
    const binary = await executableFixture('error-no-completion');
    vi.stubEnv('STUDIO_CODEX_BIN', binary);
    const project = narratedProject(1);
    const output = path.join(directory, 'output');
    await mkdir(output);
    await expect(generateScenePlan({project, sceneIds: project.scenes.map((scene) => scene.id), outputDirectory: output, signal: new AbortController().signal, onProgress: () => undefined})).rejects.toThrow('완료를 확인하지 못했습니다');
    const metadata = JSON.parse(await readFile(path.join(directory, 'codex-work', 'batch-001.meta.json'), 'utf8'));
    expect(metadata).toMatchObject({status: 'failed', diagnostics: [{itemType: 'error', message: expect.stringContaining('Reconnecting')}], exitCode: 0});
    await expect(readFile(path.join(output, 'plan.json'))).rejects.toThrow();
  });

  it('bounds error diagnostics and removes input echoes and message payloads from saved stderr', async () => {
    const fixture = `for(let i=0;i<20;i++)console.log(JSON.stringify({type:'item.completed',item:{type:'error',message:'Reconnecting '+i+' '+ 'private narration '+ 'x'.repeat(2000)}}));console.error('Error: private narration sk-fixture-secret');console.error(JSON.stringify({type:'reasoning',text:'private fixture reasoning ERROR'}));process.exitCode=2`;
    const error = await runCodexProcess({binary: process.execPath, args: ['-e', fixture], cwd: directory, prompt: 'fixture prompt', redactTexts: ['private narration'], signal: new AbortController().signal, timeoutMs: 2000, onProgress: () => undefined}).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(CodexProcessError);
    const summary = (error as CodexProcessError).summary;
    expect(summary.diagnostics).toHaveLength(8);
    expect(summary.diagnostics?.every((entry) => entry.message.length <= 1600)).toBe(true);
    expect(summary.stderrDiagnostic).toContain('[REDACTED_INPUT]');
    expect(JSON.stringify(summary)).not.toContain('private narration');
    expect(JSON.stringify(summary)).not.toContain('private fixture reasoning');
    expect(JSON.stringify(summary)).not.toContain('sk-fixture-secret');
  });

  it('bounds child execution and reports CLI status from exit codes without capturing credentials', async () => {
    await expect(runCodexProcess({binary: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: directory, prompt: 'fixture', signal: new AbortController().signal, timeoutMs: 40, onProgress: () => undefined})).rejects.toThrow('제한 시간');
    const success = await executableFixture('success');
    expect(await codexLoginStatus(success)).toEqual({available: true});
    expect((await codexLoginStatus(path.join(directory, 'missing'))).available).toBe(false);
    expect(redactCodexError('Bearer fake-secret sk-fixture-secret access_token=fake-token')).not.toContain('fake-secret');
    expect(redactCodexError('Bearer fake-secret sk-fixture-secret access_token=fake-token')).not.toContain('fake-token');
  });

  it('rejects absent narration and an excessive generation scope before starting Codex', () => {
    const project = createProject('나레이션 없음');
    expect(() => generationSceneIds(project, [project.scenes[0].id])).toThrow('나레이션 자막');
    expect(() => generationSceneIds(project, Array.from({length: GENERATION_LIMITS.maxScenes + 1}, (_, index) => `s_${index}`))).toThrow('2000');
  });

  async function executableFixture(behavior: 'success'|'fail-second'|'wrong-id'|'blocked-tool'|'recoverable-error'|'terminal-error'|'error-no-completion'): Promise<string> {
    const file = path.join(directory, `codex-${behavior}.mjs`);
    await writeFile(file, `#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
const args=process.argv.slice(2);
if(args.includes('login'))process.exit(0);
const output=args[args.indexOf('--output-last-message')+1];
if(${JSON.stringify(behavior)}==='fail-second'&&output.includes('batch-002')){console.error('fixture failure');process.exit(2);}
const schema=JSON.parse(readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));
const ids=schema.properties.scenes.items.properties.sceneId.enum;
const kind=schema.properties.scenes.items.properties.kind.enum[0];
process.stdin.resume();process.stdin.on('end',()=>{
if(${JSON.stringify(behavior)}==='blocked-tool'){console.log(JSON.stringify({type:'item.started',item:{type:'mcp_tool_call',arguments:'private fixture argument'}}));setInterval(()=>{},1000);return;}
const scenes=ids.map(sceneId=>({sceneId:${JSON.stringify(behavior)}==='wrong-id'?'not-a-scene':sceneId,kind,title:'작은 일부터',heading:'내 기준을 정합니다',kicker:'작업 방식',body:'결과를 직접 확인합니다.',items:[],assetId:null,mediaStartFrame:0,mediaFit:'contain',motion:'standard',showCaptions:true,notes:'executable fixture, not live AI'}));
console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-thread'}));
console.log(JSON.stringify({type:'turn.started'}));
if(['recoverable-error','terminal-error','error-no-completion'].includes(${JSON.stringify(behavior)}))console.log(JSON.stringify({type:'item.completed',item:{type:'error',message:(${JSON.stringify(behavior)}==='terminal-error'?'Unsupported fixture option':'Reconnecting')+' sk-fixture-secret access_token=fake-token'}}));
if(${JSON.stringify(behavior)}==='terminal-error'){console.error('Error: fixture diagnostic access_token=fake-token 반복하는 일을 고르고 결과를 직접 확인합니다.');console.error(JSON.stringify({type:'reasoning',text:'private fixture reasoning ERROR'}));console.log(JSON.stringify({type:'turn.failed',error:{message:'Turn failed'}}));process.exitCode=1;return;}
writeFileSync(output,JSON.stringify({scenes}));
if(${JSON.stringify(behavior)}==='error-no-completion')return;
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));
});
`);
    await chmod(file, 0o700);
    return file;
  }
});

function narratedProject(sceneCount: number) {
  const project = createProject('내 작업을 정리하는 방법', sceneCount * 8);
  return applyCommand(project, {type: 'replaceCaptions', regroup: true, captions: Array.from({length: sceneCount}, (_, index) => ({id: `cue_${index}`, text: '반복하는 일을 고르고 결과를 직접 확인합니다.', startFrame: index * 240, endFrame: (index + 1) * 240}))});
}
