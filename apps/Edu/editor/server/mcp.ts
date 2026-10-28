import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {commandSchema, renderOptionsSchema} from '../src/shared/schemas';
import type {Project} from '../src/shared/types';

const address = new URL(process.env.STUDIO_URL ?? 'http://127.0.0.1:4317');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname) || address.protocol !== 'http:') throw new Error('STUDIO_URL은 이 컴퓨터의 HTTP 에디터 주소여야 합니다.');
const baseUrl = address.origin;
const projectId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/);
const readonly = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};
const writes = {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false};
const server = new McpServer({name: 'biadone-studio', version: '0.1.0'}, {
  instructions: 'Biadone Studio narration-first editor with local project storage. Read the project and revision before edits. Respect locks and preserve narration timing. start_scene_generation sends selected narration and layout metadata through the existing Codex CLI login and stores a JSON draft; it is not offline AI. Read get_scene_plan and apply only after review with the exact source revision. Run get_quality before start_export. Poll get_job until completed; queued generation/export is not a completed result. Never modify project files around the editor commands.',
});

async function request(endpoint: string, body?: unknown, transform?: (data: unknown) => unknown) {
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000)});
    const raw: unknown = await response.json();
    const result = response.ok && transform ? transform(raw) : raw;
    const failed = !response.ok || Boolean(result && typeof result === 'object' && 'error' in result);
    return {content: [{type: 'text' as const, text: JSON.stringify(result)}], structuredContent: {result}, ...(failed ? {isError: true} : {})};
  } catch (error) {
    return {isError: true, content: [{type: 'text' as const, text: `로컬 에디터 연결에 실패했습니다. 먼저 에디터를 실행해 주세요. ${error instanceof Error ? error.message : ''}`} ]};
  }
}

server.registerTool('list_projects', {title: '프로젝트 목록', description: '로컬 에디터에 저장된 프로젝트 목록을 읽습니다.', annotations: readonly}, async () => request('/api/projects'));
server.registerTool('get_project', {title: '프로젝트 읽기', description: '장면·자막·자료와 최신 revision을 읽습니다. 수정 전에 호출하세요. 긴 영상의 파형과 단어별 시간은 기본적으로 생략하며 단어가 필요하면 includeWords를 지정합니다.', inputSchema: {projectId, includeWords: z.boolean().optional()}, annotations: readonly}, async ({projectId: id, includeWords}) => request(`/api/projects/${id}`, undefined, (data) => {
  const project = data as Project;
  return {...project, assets: project.assets.map((asset) => ({...asset, waveform: undefined})), words: includeWords ? project.words : undefined};
}));
server.registerTool('get_scene', {title: '선택 장면 읽기', description: '한 장면의 설정·나레이션 자막과 프로젝트 리비전을 읽습니다. 롱폼의 일부를 수정할 때 사용합니다.', inputSchema: {projectId, sceneId: projectId}, annotations: readonly}, async ({projectId: id, sceneId}) => request(`/api/projects/${id}`, undefined, (data) => {
  const project = data as Project;
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) return {error: '장면을 찾을 수 없습니다.', projectId: id, revision: project.revision};
  return {projectId: id, revision: project.revision, settings: project.settings, scene, captions: project.captions.filter((caption) => caption.startFrame < scene.startFrame + scene.durationInFrames && caption.endFrame > scene.startFrame), asset: project.assets.find((asset) => asset.id === scene.assetId)};
}));
server.registerTool('create_project', {title: '프로젝트 만들기', description: '새 로컬 프로젝트를 만듭니다.', inputSchema: {title: z.string().min(1).max(180), durationSeconds: z.number().positive().max(14400).optional()}, annotations: writes}, async (input) => request('/api/projects', input));
server.registerTool('edit_project', {title: '장면·자막 편집', description: '화면과 동일한 검증된 편집 명령을 적용합니다. expectedRevision에 방금 읽은 revision을 넣습니다. 잠긴 장면은 변경할 수 없습니다.', inputSchema: {projectId, expectedRevision: z.number().int().nonnegative(), command: commandSchema}, annotations: writes}, async ({projectId: id, ...body}) => request(`/api/projects/${id}/commands`, body));
server.registerTool('get_quality', {title: '품질 검사', description: '타이밍·화면·자막·자료 누락을 검사합니다. 출력 오류를 먼저 해결하세요.', inputSchema: {projectId}, annotations: readonly}, async ({projectId: id}) => request(`/api/projects/${id}/quality`));
server.registerTool('import_captions', {title: '시간 자막 가져오기', description: 'SRT·VTT·faster-whisper JSON 자막을 가져옵니다. regroup은 장면을 다시 구성하므로 잠긴 장면이 있으면 먼저 편집 의도를 확인하세요.', inputSchema: {projectId, expectedRevision: z.number().int().nonnegative(), text: z.string().max(8_000_000), format: z.enum(['srt', 'vtt', 'json']), regroup: z.boolean().optional()}, annotations: writes}, async ({projectId: id, ...body}) => request(`/api/projects/${id}/captions`, body));
server.registerTool('start_export', {title: '영상 출력 시작', description: '저장된 리비전의 출력 작업을 시작합니다. 반환된 작업은 아직 완성 영상이 아닙니다. get_job을 조회하세요.', inputSchema: {projectId, options: renderOptionsSchema}, annotations: writes}, async ({projectId: id, options}) => request(`/api/projects/${id}/render`, options));
server.registerTool('start_scene_generation', {title: 'Codex 장면 초안 생성', description: '선택한 미잠금 장면의 대본·화면 유형·자료 목록을 기존 Codex CLI 로그인으로 분석합니다. 별도 API 키를 설정하지 않으며 초안은 자동 적용되지 않습니다. get_job을 조회한 뒤 검토하세요.', inputSchema: {projectId, expectedRevision: z.number().int().nonnegative(), sceneIds: z.array(projectId).min(1).max(2000)}, annotations: writes}, async ({projectId: id, ...body}) => request(`/api/projects/${id}/generate`, body));
server.registerTool('get_scene_plan', {title: '생성한 장면 초안 읽기', description: '완료된 초안과 생성 당시 프로젝트 스냅샷을 읽습니다. 현재 편집과 시간이 달라져도 보관된 초안은 유지됩니다.', inputSchema: {jobId: projectId}, annotations: readonly}, async ({jobId}) => request(`/api/jobs/${jobId}/plan`, undefined, (data) => {
  const result = data as {plan: unknown; project: Project};
  return {...result, project: {...result.project, words: undefined, assets: result.project.assets.map((asset) => ({...asset, waveform: undefined}))}};
}));
server.registerTool('apply_scene_plan', {title: '장면 초안 적용', description: '검토한 초안을 한 수정 이력으로 적용합니다. 생성 기준 리비전과 현재 리비전이 정확히 같아야 합니다. 충돌 시 보관된 초안을 덮어쓰지 않습니다.', inputSchema: {jobId: projectId, expectedRevision: z.number().int().nonnegative()}, annotations: writes}, async ({jobId, ...body}) => request(`/api/jobs/${jobId}/apply`, body));
server.registerTool('get_job', {title: '작업 진행 읽기', description: '분석·출력 진행, 실패 사유, 결과 URL과 검증 결과를 읽습니다.', inputSchema: {jobId: projectId}, annotations: readonly}, async ({jobId}) => request(`/api/jobs/${jobId}`));
server.registerTool('cancel_job', {title: '작업 취소', description: '실행 중인 분석·출력을 취소합니다. 편집 내용은 유지됩니다.', inputSchema: {jobId: projectId}, annotations: writes}, async ({jobId}) => request(`/api/jobs/${jobId}/cancel`, {}));

await server.connect(new StdioServerTransport());
