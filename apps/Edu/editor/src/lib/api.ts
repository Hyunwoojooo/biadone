import type {EditorCommand, HistoryEntry, Job, Project, ProjectSummary, QualityReport, RenderOptions, ScenePlan, SystemStatus} from '../shared/types';

export class ApiError extends Error {
  constructor(message: string, public status: number) {super(message);}
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : {'Content-Type': 'application/json', ...init?.headers},
  });
  if (!response.ok) {
    let message = `요청을 처리하지 못했습니다 (${response.status}).`;
    try {message = (await response.json()).error || message;} catch { /* Retain safe default for a non-JSON response. */ }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

const post = <T>(path: string, body: unknown = {}) => request<T>(path, {method: 'POST', body: JSON.stringify(body)});

export const api = {
  system: () => request<SystemStatus>('/system'),
  projects: () => request<ProjectSummary[]>('/projects'),
  project: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (body: {title?: string; durationSeconds?: number; demo?: boolean}) => post<Project>('/projects', body),
  command: (id: string, command: EditorCommand, expectedRevision: number) => post<Project>(`/projects/${id}/commands`, {command, expectedRevision}),
  quality: (id: string) => request<QualityReport>(`/projects/${id}/quality`),
  history: (id: string) => request<HistoryEntry[]>(`/projects/${id}/history`),
  undo: (id: string, expectedRevision: number) => post<Project>(`/projects/${id}/undo`, {expectedRevision}),
  redo: (id: string, expectedRevision: number) => post<Project>(`/projects/${id}/redo`, {expectedRevision}),
  restore: (id: string, historyId: string, expectedRevision: number) => post<Project>(`/projects/${id}/restore`, {historyId, expectedRevision}),
  upload: async (id: string, file: File) => {
    const body = new FormData(); body.append('file', file);
    return request<{project: Project; asset: Project['assets'][number]}>(`/projects/${id}/assets`, {method: 'POST', body});
  },
  importProject: async (file: File) => {
    const body = new FormData(); body.append('file', file);
    return request<Project>('/projects/import', {method: 'POST', body});
  },
  captions: (id: string, body: {text: string; format: 'srt'|'vtt'|'json'; regroup?: boolean; expectedRevision: number}) => post<Project>(`/projects/${id}/captions`, body),
  jobs: (id: string) => request<Job[]>(`/jobs?projectId=${encodeURIComponent(id)}`),
  transcribe: (id: string, expectedRevision: number) => post<Job>(`/projects/${id}/transcribe`, {expectedRevision}),
  generate: (id: string, sceneIds: string[], expectedRevision: number) => post<Job>(`/projects/${id}/generate`, {sceneIds, expectedRevision}),
  scenePlan: (id: string) => request<{plan: ScenePlan; project: Project}>(`/jobs/${id}/plan`),
  applyScenePlan: (id: string, expectedRevision: number) => post<Project>(`/jobs/${id}/apply`, {expectedRevision}),
  render: (id: string, options: RenderOptions) => post<Job>(`/projects/${id}/render`, options),
  cancel: (id: string) => post<Job>(`/jobs/${id}/cancel`),
  retry: (id: string) => post<Job>(`/jobs/${id}/retry`),
};

export const assetUrl = (projectId: string, assetId: string) => `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`;
