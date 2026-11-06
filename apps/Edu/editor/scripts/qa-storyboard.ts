import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {chromium} from 'playwright';
import {createStudioApp} from '../server/app';
import type {CodexAdapter} from '../server/codex';
import type {Caption, Job, Project, ScenePlan} from '../src/shared/types';

const live = process.argv.includes('--live-codex');
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(path.join(os.tmpdir(), 'biadone-storyboard-qa-'));
const checks: {name: string; passed: boolean; detail?: string}[] = [];
const errors: string[] = [];
const calls: {sceneIds: string[]; requirements: string[]}[] = [];
let fixtureDelay = 700;
const fixture: CodexAdapter = {
  status: async () => ({available: true}),
  generate: async ({project, sceneIds, signal, onProgress}) => {
    calls.push({sceneIds: [...sceneIds], requirements: sceneIds.map(id => project.scenes.find(scene => scene.id === id)?.requirements ?? '')});
    onProgress(0.2, '명시적으로 주입한 UI 검증용 생성기');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, fixtureDelay);
      signal.addEventListener('abort', () => {clearTimeout(timer); reject(new Error('cancelled'));}, {once: true});
    });
    signal.throwIfAborted();
    return {scenes: sceneIds.map((id, index) => {
      const scene = project.scenes.find(item => item.id === id)!;
      const kind = scene.preferredKind ?? 'title';
      return {sceneId: id, kind, title: `검증 초안 ${index + 1}`, heading: scene.requirements?.includes('준비에서 확인까지') ? '준비에서 확인까지' : '한눈에 보는 제작 과정', kicker: '화면 구성', body: '', items: ['flow', 'steps', 'list', 'compare', 'stat'].includes(kind) ? Array.from({length: kind === 'stat' ? 1 : 2}, (_, n) => ({title: `${n + 1}번 항목`, body: '핵심 내용'})) : [], assetId: null, mediaStartFrame: 0, mediaFit: 'contain' as const, motion: 'standard' as const, showCaptions: true, notes: '실제 AI가 아닌 UI 검증 데이터'};
    })};
  },
};
const {app, jobs} = await createStudioApp({appDirectory: root, dataDirectory: path.join(directory, 'data'), ...(live ? {} : {codexAdapter: fixture})});
const dist = process.env.STUDIO_QA_DIST || path.join(root, 'dist');
app.use(express.static(dist));
app.get('/{*splat}', (_request, response) => response.sendFile(path.join(dist, 'index.html')));
const server = createServer(app);
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); assert(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`; jobs.setOrigin(origin);
const browser = await chromium.launch({executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true});
const page = await browser.newPage({viewport: {width: 1536, height: 1024}});
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {if (message.type() === 'error' && !/status of (409|400)/.test(message.text())) errors.push(message.text());});
async function json<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${origin}/api${route}`, body === undefined ? undefined : {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}
async function until(test: () => Promise<boolean>, message: string, timeout = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {if (await test()) return; await new Promise(resolve => setTimeout(resolve, 150));}
  throw new Error(`Timed out: ${message}`);
}
async function saved() {await until(async () => await page.locator('.save-status').innerText() === '저장됨', 'autosave');}
async function check(name: string, work: () => Promise<void>) {
  try {await work(); checks.push({name, passed: true}); console.log(`PASS ${name}`);}
  catch (error) {checks.push({name, passed: false, detail: String(error)}); throw error;}
}
let project = await json<Project>('/projects', {title: live ? '[검증] 실제 Codex 필수 요구' : '[검증] 간단한 장면 구성', durationSeconds: 24});
const projectId = project.id;
const originalCaptions: Caption[] = [
  {id: 'cue-prepare', text: '작업을 준비하고 흐름을 구성한 뒤 결과를 확인합니다.', startFrame: 0, endFrame: 240},
  {id: 'cue-steps', text: '준비, 구성, 검토 세 단계로 진행합니다.', startFrame: 240, endFrame: 480},
  {id: 'cue-standard', text: '같은 기준을 사용하면 반복 작업을 줄일 수 있습니다.', startFrame: 480, endFrame: 720},
];
project = await json<Project>(`/projects/${projectId}/commands`, {expectedRevision: project.revision, command: {type: 'replaceCaptions', captions: originalCaptions, regroup: false}});
// A legacy auto-selection pool must not prevent an explicit per-scene type.
project = await json<Project>(`/projects/${projectId}/commands`, {expectedRevision: project.revision, command: {type: 'updateSceneSetup', patch: {allowedKinds: ['title']}}});
await page.addInitScript(id => localStorage.setItem('biadone-project', id), projectId);
const firstRequirement = '제목은 반드시 “준비에서 확인까지”로 표시하세요.\n준비 → 구성 → 확인을 세 카드로 연결하세요.';
const middleRequirement = '준비·구성·검토를 순서대로 보여주세요.\n원문 요청은 재생성 후에도 유지합니다.';
let chapterId = '';
async function addRange(captionId: string, kind: string, requirements: string) {
  await page.locator('.storyboard-heading').getByRole('button', {name: '장면 추가', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '장면 추가', exact: true});
  await dialog.getByLabel('새 장면 챕터', {exact: true}).selectOption(chapterId);
  await dialog.getByLabel('처음 문장', {exact: true}).selectOption(captionId);
  await dialog.getByLabel('마지막 문장', {exact: true}).selectOption(captionId);
  await dialog.getByLabel('새 장면 화면 유형', {exact: true}).selectOption(kind);
  await dialog.getByLabel('새 장면 필수 요구사항', {exact: true}).fill(requirements);
  await dialog.getByRole('button', {name: '장면 추가', exact: true}).click();
  await dialog.waitFor({state: 'hidden'});
}
try {
  await check('composition has only chapter/scene actions and per-scene controls', async () => {
    await page.goto(origin, {waitUntil: 'networkidle'});
    assert.equal(await page.title(), 'Biadone Studio — 롱폼 영상 에디터');
    await page.locator('.workflow-nav button').nth(1).click();
    await page.getByRole('heading', {name: '장면마다 원하는 화면을 적으세요'}).waitFor();
    assert.equal(await page.getByLabel('목표 장면 길이', {exact: true}).count(), 0);
    assert.equal(await page.getByLabel('기본 움직임', {exact: true}).count(), 0);
    assert.equal(await page.locator('.kind-options').count(), 0);
    assert.equal(await page.locator('.timeline-pane').count(), 0);
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
    await page.getByRole('button', {name: '챕터 추가', exact: true}).click();
    await saved();
    const heading = page.getByLabel('챕터 2 제목', {exact: true});
    await heading.fill('제작 과정'); await heading.press('Tab'); await saved();
    chapterId = (await json<Project>(`/projects/${projectId}`)).chapters.find(chapter => chapter.title === '제작 과정')!.id;
  });
  await check('manual range insertion and rapid edits preserve narration and playback order', async () => {
    await page.route(`**/api/projects/${projectId}/commands`, async route => {
      if (route.request().postDataJSON().command.type !== 'addScene') {await route.continue(); return;}
      const response = await route.fetch(); await new Promise(resolve => setTimeout(resolve, 800)); await route.fulfill({response});
    });
    await addRange('cue-steps', 'steps', '초기 요구');
    const requirement = page.getByLabel('2번 장면 필수 요구사항', {exact: true});
    await requirement.fill(middleRequirement); await requirement.press('Tab'); await saved();
    await page.unroute(`**/api/projects/${projectId}/commands`);
    project = await json<Project>(`/projects/${projectId}`);
    assert.deepEqual(project.scenes.map(scene => scene.startFrame), [0, 240, 480]);
    assert.equal(project.scenes[1].requirements, middleRequirement);
    assert.deepEqual(await page.locator('.storyboard-scene').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-scene-id'))), project.scenes.map(scene => scene.id));
    const railNumbers = await page.locator('.scene-rail .scene-number').allTextContents();
    assert.deepEqual(railNumbers, ['01', '02', '03']);
    assert.equal(await page.getByText('이어지는 구간', {exact: true}).count(), 1);
    await page.locator('.workflow-nav button').nth(3).click();
    const blocks = await page.locator('.chapter-block').evaluateAll(nodes => nodes.map(node => ({left: parseFloat((node as HTMLElement).style.left), width: parseFloat((node as HTMLElement).style.width)})));
    assert.equal(blocks.length, 3);
    assert(blocks[0].left + blocks[0].width <= blocks[1].left + 1);
    assert(blocks[1].left + blocks[1].width <= blocks[2].left + 1);
    await page.locator('.workflow-nav button').nth(1).click();
    await addRange('cue-prepare', 'flow', firstRequirement); await saved();
    await addRange('cue-standard', 'title', '같은 기준으로 반복을 줄인다는 메시지를 크게 보여주세요.'); await saved();
    project = await json<Project>(`/projects/${projectId}`);
    assert.deepEqual(project.captions, originalCaptions);
    assert.deepEqual(project.scenes.map(scene => scene.startFrame), [0, 240, 480]);
    assert.deepEqual(project.scenes.map(scene => scene.durationInFrames), [240, 240, 240]);
    assert.equal(project.scenes[0].requirements, firstRequirement);
    await page.reload({waitUntil: 'networkidle'}); await page.locator('.workflow-nav button').nth(1).click();
    assert.equal(await page.getByLabel('1번 장면 필수 요구사항', {exact: true}).inputValue(), firstRequirement);
    assert.equal(await page.getByLabel('1번 장면 화면 유형', {exact: true}).inputValue(), 'flow');
    await page.screenshot({path: path.join(directory, 'storyboard-desktop.png')});
  });
  let firstJob: Job;
  await check(live ? 'LIVE Codex respects scene requirements and explicit types' : 'inline whole generation uses saved per-scene requirements', async () => {
    await page.getByRole('button', {name: '전체 생성', exact: true}).click();
    await until(async () => (await json<Job[]>(`/jobs?projectId=${projectId}`)).length > 0, 'generation enqueued');
    firstJob = (await json<Job[]>(`/jobs?projectId=${projectId}`))[0];
    await until(async () => {const job = await json<Job>(`/jobs/${firstJob.id}`); if (job.status === 'failed') throw new Error(job.error); return job.status === 'completed';}, 'generation completed', live ? 600_000 : 20_000);
    const result = await json<{plan: ScenePlan; project: Project}>(`/jobs/${firstJob.id}/plan`);
    assert.equal(result.plan.scenes.length, 3);
    assert.deepEqual(result.plan.scenes.map(scene => scene.kind), ['flow', 'steps', 'title']);
    assert.equal(result.plan.scenes[0].heading, '준비에서 확인까지');
    assert.equal(result.project.scenes[0].requirements, firstRequirement);
    assert.equal((await json<Project>(`/projects/${projectId}`)).revision, firstJob.projectRevision);
    await page.getByRole('button', {name: '초안 적용하고 편집', exact: true}).waitFor({timeout: 15_000});
    assert.equal(await page.locator('.workflow-nav button').nth(1).getAttribute('aria-current'), 'step');
    const box = await page.locator('.generated-player .video-frame').boundingBox(); assert(box && box.height > 150);
    await page.locator('.generation-result').scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
    await page.screenshot({path: path.join(directory, live ? 'live-required-draft.png' : 'inline-draft.png')});
    await writeFile(path.join(directory, 'generated-plan.json'), JSON.stringify(result, null, 2));
    if (!live) {assert.equal(calls[0].sceneIds.length, 3); assert.equal(calls[0].requirements[0], firstRequirement);}
  });
  await check('apply/reopen retains verbatim requirements and captions', async () => {
    await page.getByRole('button', {name: '초안 적용하고 편집', exact: true}).click();
    await until(async () => (await json<Project>(`/projects/${projectId}`)).revision === firstJob.projectRevision + 1, 'plan applied');
    await page.getByLabel('강조 문구', {exact: true}).waitFor();
    project = await json<Project>(`/projects/${projectId}`);
    assert.equal(project.scenes[0].requirements, firstRequirement);
    assert.equal(project.scenes[1].requirements, middleRequirement);
    assert.deepEqual(project.captions, originalCaptions);
    await page.locator('.workflow-nav button').nth(1).click();
    await page.getByRole('button', {name: '적용된 초안', exact: true}).waitFor();
    const card = page.locator(`.storyboard-scene[data-scene-id="${project.scenes[0].id}"]`);
    assert.equal(await card.getByRole('button', {name: '재생성', exact: true}).count(), 1);
    assert.equal(await page.getByLabel('1번 장면 필수 요구사항', {exact: true}).inputValue(), firstRequirement);
    await page.screenshot({path: path.join(directory, 'applied-storyboard.png')});
  });
  if (!live) {
    await check('per-card regeneration preserves a newer edit and all requirements', async () => {
      fixtureDelay = 3500;
      const id = project.scenes[0].id;
      await page.locator(`.storyboard-scene[data-scene-id="${id}"]`).getByRole('button', {name: '재생성', exact: true}).click();
      await until(async () => (await json<Job[]>(`/jobs?projectId=${projectId}`)).length === 2, 'selected generation');
      const nextRequest = page.getByLabel('2번 장면 필수 요구사항', {exact: true});
      await nextRequest.fill(middleRequirement + '\n추가한 요구를 유지합니다.'); await nextRequest.press('Tab'); await saved();
      await until(async () => (await json<Job[]>(`/jobs?projectId=${projectId}`))[0].status === 'completed', 'selected completion');
      await page.getByText('생성 이후 프로젝트가 변경되어', {exact: false}).waitFor();
      assert(await page.getByRole('button', {name: '초안 적용하고 편집', exact: true}).isDisabled());
      assert.deepEqual(calls[1].sceneIds, [id]); assert.equal(calls[1].requirements[0], firstRequirement);
      const latest = await json<Project>(`/projects/${projectId}`);
      assert.equal(latest.scenes[0].requirements, firstRequirement);
      assert(latest.scenes[1].requirements?.endsWith('추가한 요구를 유지합니다.'));
    });
    await check('active generation cancellation and retry', async () => {
      await page.getByRole('button', {name: '전체 생성', exact: true}).click();
      await page.locator('.storyboard-progress').getByRole('button', {name: '취소', exact: true}).click();
      await until(async () => (await json<Job[]>(`/jobs?projectId=${projectId}`))[0].status === 'cancelled', 'cancelled');
      fixtureDelay = 250;
      await page.locator('.generation-work .job-row').first().getByRole('button', {name: '다시 시도', exact: true}).click();
      await until(async () => (await json<Job[]>(`/jobs?projectId=${projectId}`))[0].status === 'completed', 'retry');
    });
    await check('locked scene rejects overlapping manual insertion in the dialog', async () => {
      let latest = await json<Project>(`/projects/${projectId}`);
      const id = latest.scenes[2].id;
      latest = await json<Project>(`/projects/${projectId}/commands`, {expectedRevision: latest.revision, command: {type: 'updateScene', sceneId: id, patch: {locked: true}}});
      await until(async () => await page.locator(`.storyboard-scene[data-scene-id="${id}"]`).getByLabel('3번 장면 필수 요구사항', {exact: true}).isDisabled(), 'locked card');
      await page.locator('.storyboard-heading').getByRole('button', {name: '장면 추가', exact: true}).click();
      const dialog = page.getByRole('dialog', {name: '장면 추가', exact: true});
      await dialog.getByLabel('처음 문장', {exact: true}).selectOption('cue-standard');
      await dialog.getByLabel('마지막 문장', {exact: true}).selectOption('cue-standard');
      assert(await dialog.getByRole('button', {name: '장면 추가', exact: true}).isDisabled());
      assert((await dialog.getByRole('alert').innerText()).includes('잠긴'));
      await dialog.locator('.dialog-footer').getByRole('button', {name: '닫기', exact: true}).click();
      await json<Project>(`/projects/${projectId}/commands`, {expectedRevision: latest.revision, command: {type: 'updateScene', sceneId: id, patch: {locked: false}}});
      await until(async () => await page.getByLabel('3번 장면 필수 요구사항', {exact: true}).isEnabled(), 'unlock poll adopted');
    });
  }
  if (!live) await check('requirements input limit cannot silently generate from old text', async () => {
    const field = page.getByLabel('1번 장면 필수 요구사항', {exact: true});
    assert.equal(await field.getAttribute('maxlength'), '4000');
    await field.fill('가'.repeat(4001));
    assert.equal((await field.inputValue()).length, 4000);
    await field.press('Tab'); await saved();
    const latest = await json<Project>(`/projects/${projectId}`);
    assert.equal(latest.scenes[0].requirements, '가'.repeat(4000));
    const previous = (await json<Job[]>(`/jobs?projectId=${projectId}`)).length;
    await page.locator(`.storyboard-scene[data-scene-id="${latest.scenes[0].id}"]`).getByRole('button', {name: '재생성', exact: true}).click();
    await until(async () => {const list = await json<Job[]>(`/jobs?projectId=${projectId}`); return list.length > previous && list[0].status === 'completed';}, 'generation of current bounded request');
    assert.equal(calls.at(-1)?.requirements[0], '가'.repeat(4000));
    await field.fill(firstRequirement); await field.press('Tab'); await saved();
  });
  await check('responsive storyboard controls and console health', async () => {
    await page.setViewportSize({width: 425, height: 950});
    await page.locator('.storyboard-panel').evaluate(element => element.scrollTo(0, 0));
    assert(await page.getByRole('button', {name: '전체 생성', exact: true}).isVisible());
    const sizes = await page.evaluate(() => ({width: document.documentElement.scrollWidth, viewport: innerWidth}));
    assert(sizes.width <= sizes.viewport + 1, JSON.stringify(sizes));
    await page.screenshot({path: path.join(directory, 'storyboard-mobile.png')});
    await page.locator('.storyboard-heading').getByRole('button', {name: '장면 추가', exact: true}).focus();
    await page.keyboard.press('Space');
    const dialog = page.getByRole('dialog', {name: '장면 추가', exact: true});
    const range = await dialog.getByLabel('처음 문장', {exact: true}).boundingBox();
    assert(range && range.x >= 0 && range.x + range.width <= 425);
    await dialog.screenshot({path: path.join(directory, 'add-scene-mobile.png')});
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
  });
  if (!live) await check('switching projects cannot expose or apply another project draft', async () => {
    await page.setViewportSize({width: 1536, height: 1024});
    const previousJobs = await json<Job[]>(`/jobs?projectId=${projectId}`);
    let other = await json<Project>('/projects', {title: '[검증] 다른 장면 프로젝트', durationSeconds: 16});
    const revision = previousJobs[0].projectRevision;
    while (other.revision < revision) other = await json<Project>(`/projects/${other.id}/commands`, {expectedRevision: other.revision, command: {type: 'updateProject', patch: {title: other.title}}});
    await page.route(`**/api/jobs?projectId=${other.id}`, async route => {await route.fulfill({json: previousJobs});});
    await page.getByRole('button', {name: 'Biadone Studio 프로젝트', exact: true}).click();
    await page.locator('.project-list-row').filter({hasText: other.title}).click();
    await page.locator('.workflow-nav button').nth(1).click();
    await page.waitForTimeout(2200);
    assert.equal(await page.locator('.generation-work .job-row').count(), 0);
    assert.equal(await page.getByRole('button', {name: '초안 적용하고 편집', exact: true}).count(), 0);
    await page.locator('.storyboard-heading').getByRole('button', {name: '장면 추가', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: '장면 추가', exact: true});
    await dialog.getByRole('button', {name: '소스 준비로', exact: true}).waitFor();
    assert.equal((await json<Project>(`/projects/${other.id}`)).revision, revision);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => localStorage.getItem('biadone-project')), other.id);
    await page.unroute(`**/api/jobs?projectId=${other.id}`);
  });
} finally {
  const report = {mode: live ? 'actual Codex CLI' : 'explicit injected fixture, not live AI', origin, directory, browser: 'Browser plugin not available; installed Playwright + Chrome', checks, errors};
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  await browser.close(); await jobs.shutdown(); await new Promise<void>(resolve => server.close(() => resolve()));
}
