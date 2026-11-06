import {useEffect, useMemo, useRef, useState} from 'react';
import type {PlayerRef} from '@remotion/player';
import {ArrowRight, Check, CircleAlert, LoaderCircle, WandSparkles} from 'lucide-react';
import type {Job, Project, ScenePlan} from '../shared/types';
import {sceneWithPlan} from '../domain/scenePlan';
import {api} from '../lib/api';
import {Preview} from './Preview';
import {SceneThumb} from './SceneRail';
import {kindLabel} from './SceneKinds';
import {JobList} from './WorkflowPanels';

export function GenerationPanel({project, jobs, busy, onApply, onCancel, onRetry, onNext, onBack, embedded = false}: {
  project: Project; jobs: Job[]; busy: boolean; embedded?: boolean;
  onApply: (jobId: string) => void; onCancel: (jobId: string) => void; onRetry: (jobId: string) => void; onNext: () => void; onBack: () => void;
}) {
  const [chosenJob, setChosenJob] = useState('');
  const [result, setResult] = useState<{plan: ScenePlan; project: Project}|null>(null);
  const [error, setError] = useState('');
  const [frame, setFrame] = useState(0);
  const playerRef = useRef<PlayerRef>(null);
  const resultRef = useRef<HTMLElement>(null);
  const generationJobs = jobs.filter(job => job.projectId === project.id && job.type === 'generate');
  const job = generationJobs.find(item => item.id === chosenJob) ?? generationJobs[0];
  const latestJobId = generationJobs[0]?.id;
  useEffect(() => {setChosenJob('');}, [latestJobId]);
  const applied = job?.verification?.applied === true;
  const stale = !!job && !applied && (project.id !== job.projectId || project.revision !== job.projectRevision);

  useEffect(() => {
    let stopped = false;
    setResult(null); setError('');
    if (job?.status === 'completed') {
      void api.scenePlan(job.id).then(value => {
        if (stopped) return;
        setResult(value);
        const first = value.project.scenes.find(scene => scene.id === value.plan.scenes[0]?.sceneId);
        setFrame(first ? first.startFrame + Math.min(first.durationInFrames - 1, value.project.settings.fps) : 0);
      }).catch(caught => {if (!stopped) setError(caught instanceof Error ? caught.message : '초안을 읽지 못했습니다.');});
    }
    return () => {stopped = true;};
  }, [job?.id, job?.status]);

  const previewProject = useMemo(() => {
    if (!result) return null;
    const patches = new Map(result.plan.scenes.map(scene => [scene.sceneId, scene]));
    return {...result.project, scenes: result.project.scenes.map(scene => {
      const draft = patches.get(scene.id);
      if (!draft) return scene;
      return sceneWithPlan(scene, draft);
    })};
  }, [result]);

  useEffect(() => {
    if (!result) return;
    const first = result.project.scenes.find(scene => scene.id === result.plan.scenes[0]?.sceneId);
    const timer = window.setTimeout(() => {playerRef.current?.seekTo(first ? first.startFrame + Math.min(first.durationInFrames - 1, result.project.settings.fps) : 0); resultRef.current?.scrollIntoView({block: 'start', behavior: 'smooth'});}, 80);
    return () => window.clearTimeout(timer);
  }, [result]);

  useEffect(() => {
    if (!previewProject) return;
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,select,button,a,summary,[role=button]') || target.isContentEditable || event.metaKey || event.ctrlKey || document.querySelector('dialog[open]')) return;
      if (event.code === 'Space') {event.preventDefault(); playerRef.current?.toggle();}
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); const current = playerRef.current?.getCurrentFrame() ?? 0;
        const next = Math.max(0, Math.min(previewProject.durationInFrames - 1, current + (event.key === 'ArrowRight' ? 1 : -1) * previewProject.settings.fps));
        playerRef.current?.seekTo(next); setFrame(next);
      }
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [previewProject]);

  if (embedded && !generationJobs.length) return null;
  return <section className={embedded ? 'generation-panel generation-embedded' : 'pane workflow-panel generation-panel'}>
    {!embedded && <header className="workflow-heading"><div><span className="step-number">03</span><h1>생성한 화면을 확인하세요</h1><p>장면 구성에서 요청한 초안을 재생하고 적용하세요.</p></div><div className="storyboard-actions"><button className="secondary-button" onClick={onBack}>장면 구성으로</button><button className="primary-button" onClick={onNext}>편집으로<ArrowRight size={15}/></button></div></header>}
    {generationJobs.length > 0 && <div className="generation-work"><div className="section-title"><h2>생성 작업</h2><span className="muted">{generationJobs.length}건</span></div><JobList jobs={generationJobs.slice(0, 4)} onCancel={onCancel} onRetry={id => {setChosenJob(''); onRetry(id);}}/>{generationJobs.length > 1 && <label className="field generation-history"><span className="field-label">검토할 생성 결과</span><select aria-label="생성 이력" value={job?.id || ''} onChange={event => setChosenJob(event.target.value)}>{generationJobs.map(item => <option value={item.id} key={item.id}>{new Date(item.createdAt).toLocaleString('ko-KR')} · {item.status === 'completed' ? '완료' : item.status === 'failed' ? '실패' : item.status === 'cancelled' ? '취소됨' : '진행 중'} · 버전 {item.projectRevision}</option>)}</select></label>}</div>}
    {job?.status === 'completed' && <section className="generation-result" ref={resultRef}><div className="generation-result-heading"><div><h2>생성된 화면 미리보기</h2><p>{result ? `${result.plan.scenes.length}개 장면 · 편집 버전 ${job.projectRevision} 기준` : '보관된 초안을 불러오고 있습니다.'}</p></div></div>
      {applied && <div className="inline-info applied-info"><Check size={16}/>이 초안을 프로젝트에 적용했습니다. 보관된 생성 결과를 다시 보고 있습니다.</div>}
      {stale && <div className="inline-info"><CircleAlert size={16}/>생성 이후 프로젝트가 변경되어 이 초안을 덮어쓸 수 없습니다. 초안은 보관됩니다. 현재 상태에서 다시 생성하세요.</div>}
      {error && <div className="inline-info" role="alert">{error}</div>}
      {previewProject && result && <><div className="generated-layout"><div className="generated-player"><Preview project={previewProject} playerRef={playerRef} frame={frame} onFrame={setFrame} assetBaseUrl={`${window.location.origin}/api/jobs/${job.id}/assets`}/><p className="small muted">보관된 생성 결과의 미리보기입니다. 이 화면에서 재생해도 현재 편집 내용은 바뀌지 않습니다.</p></div><div className="generated-scene-list">{result.plan.scenes.map(draft => {
        const scene = previewProject.scenes.find(item => item.id === draft.sceneId)!;
        return <button key={draft.sceneId} className={frame >= scene.startFrame && frame < scene.startFrame + scene.durationInFrames ? 'selected' : ''} onClick={() => {const target = scene.startFrame + Math.min(scene.durationInFrames - 1, previewProject.settings.fps); playerRef.current?.seekTo(target); setFrame(target);}}><SceneThumb scene={scene} project={previewProject}/><span><small>{kindLabel(draft.kind)}</small><strong>{draft.heading || draft.title}</strong><em>{draft.notes}</em></span></button>;
      })}</div></div><div className="generation-apply"><p>내용과 연출을 확인한 뒤 적용하세요. 적용한 초안은 편집 화면에서 다듬고 수정 이력으로 되돌릴 수 있습니다.</p><button className="primary-button" disabled={busy || stale || applied} onClick={() => onApply(job.id)}>{busy ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>}{applied ? '적용된 초안' : '초안 적용하고 편집'}</button></div></>}
    </section>}
    {!job && <div className="generation-empty"><WandSparkles size={32}/><h2>구성한 장면을 실제 초안으로</h2><p>Codex가 나레이션에서 핵심을 찾고 비교·과정·수치를 화면에 맞게 정리합니다. 장면 구성에서 각 장면의 ‘장면 생성’ 또는 ‘전체 생성’을 눌러 시작하세요.</p></div>}
  </section>;
}
