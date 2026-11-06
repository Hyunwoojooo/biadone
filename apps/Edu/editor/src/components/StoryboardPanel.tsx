import {useMemo, useState} from 'react';
import {ArrowRight, Check, CircleAlert, LoaderCircle, LockKeyhole, Plus, RefreshCw, Sparkles} from 'lucide-react';
import type {EditorCommand, Job, Project, Scene, SceneKind, SystemStatus} from '../shared/types';
import {formatTime} from '../domain/project';
import {chapterRuns} from '../lib/chapters';
import {Field} from './Field';
import {SceneThumb} from './SceneRail';
import {kindLabel, sceneKinds} from './SceneKinds';
import {AddSceneDialog, type AddSceneCommand} from './AddSceneDialog';

export function StructurePanel({project, selectedId, system, jobs, busy, onSelect, onCommand, onAddScene, onGenerate, onCancel, onRefreshSystem, onSource, onNext, results}: {
  project: Project; selectedId: string; system: SystemStatus|null; jobs: Job[]; busy: boolean;
  onSelect: (scene: Scene) => void; onCommand: (command: EditorCommand) => void; onAddScene: (command: AddSceneCommand) => boolean;
  onGenerate: (ids: string[]) => void; onCancel: (id: string) => void; onRefreshSystem: () => void; onSource: () => void; onNext: () => void; results: React.ReactNode;
}) {
  const [addingTo, setAddingTo] = useState<string|null>(null);
  const generationJobs = jobs.filter(job => job.projectId === project.id && job.type === 'generate');
  const activeJob = generationJobs.find(job => job.status === 'running' || job.status === 'queued');
  const working = busy || !!activeJob;
  const selected = project.scenes.find(scene => scene.id === selectedId) ?? project.scenes[0];
  const unlocked = project.scenes.filter(scene => !scene.locked);
  const canGenerate = !!system?.codex && !!project.captions.length;
  const runs = useMemo(() => chapterRuns(project, true), [project]);

  return <section className="pane workflow-panel structure-panel storyboard-panel">
    <header className="workflow-heading storyboard-heading"><div><span className="step-number">02</span><h1>장면마다 원하는 화면을 적으세요</h1><p>챕터와 장면을 만들고, 유형과 필수 요구사항을 지정하세요.</p></div><div className="storyboard-actions"><button className="secondary-button" onClick={() => onCommand({type: 'addChapter', title: `챕터 ${project.chapters.length + 1}`})}><Plus size={15}/>챕터 추가</button><button className="secondary-button" onClick={() => setAddingTo(selected.chapterId)}><Plus size={15}/>장면 추가</button><button className="primary-button" disabled={working || !canGenerate || !unlocked.length} onClick={() => onGenerate(unlocked.map(scene => scene.id))}>{working ? <LoaderCircle className="spin" size={15}/> : <Sparkles size={15}/>}전체 생성</button></div></header>
    <div className="storyboard-status"><span>{project.chapters.length}개 챕터 · {project.scenes.length}개 장면 · 녹음 순서대로</span><div><span className={`codex-state ${system?.codex ? 'ready' : ''}`}>{system?.codex ? <Check size={13}/> : <CircleAlert size={13}/>} {system?.codex ? 'Codex 연결됨' : 'Codex 확인 필요'}</span><button className="text-button" onClick={onNext}>생성 결과 보기<ArrowRight size={13}/></button></div></div>
    {!system?.codex && <div className="inline-info"><CircleAlert size={15}/><span>{system?.codexReason || 'Codex 설치와 로그인 상태를 확인하고 있습니다.'}</span><button className="text-button" onClick={onRefreshSystem}><RefreshCw size={13}/>다시 확인</button></div>}
    {!project.captions.length && <div className="inline-info"><CircleAlert size={15}/><span>소스 준비에서 자막을 만들면 대본의 문장을 선택해 장면을 추가할 수 있습니다.</span><button className="text-button" onClick={onSource}>소스 준비로<ArrowRight size={13}/></button></div>}
    {activeJob && <div className="storyboard-progress" role="status"><LoaderCircle className="spin" size={16}/><span>{activeJob.message}</span><span>{Math.round(activeJob.progress * 100)}%</span><button className="small-button" onClick={() => onCancel(activeJob.id)}>취소</button></div>}
    <div className="storyboard-chapters">{runs.map((run, runIndex) => {
      const chapter = run.chapter;
      const chapterIndex = run.ordinal - 1;
      return <section className="storyboard-chapter" key={run.key} data-chapter-id={chapter.id}>
        <header className="storyboard-chapter-heading"><span>{String(chapterIndex + 1).padStart(2, '0')}</span><Field label={`챕터 ${chapterIndex + 1} 제목`} value={chapter.title} onCommit={title => onCommand({type: 'updateChapter', chapterId: chapter.id, title})}/>{run.continued && <small className="chapter-continued">이어지는 구간</small>}<small>{run.scenes.length}개 장면</small><button className="text-button" onClick={() => setAddingTo(chapter.id)} aria-label={`${chapter.title}에 장면 추가`}><Plus size={14}/>장면 추가</button></header>
        <div className="storyboard-scene-list">{run.scenes.map(scene => {
          const number = project.scenes.indexOf(scene) + 1;
          const narration = project.captions.filter(caption => caption.startFrame < scene.startFrame + scene.durationInFrames && caption.endFrame > scene.startFrame).map(caption => caption.text).join(' ');
          const hasGenerated = generationJobs.some(job => job.status === 'completed' && job.verification?.applied === true && Array.isArray(job.verification.sceneIds) && job.verification.sceneIds.includes(scene.id));
          return <article key={scene.id} data-scene-id={scene.id} className={`storyboard-scene ${scene.id === selectedId ? 'selected' : ''}`}>
            <div className="storyboard-scene-heading"><button className="storyboard-thumb" aria-label={`${number}번 장면 선택`} onClick={() => onSelect(scene)}><SceneThumb scene={scene} project={project}/><span>{String(number).padStart(2, '0')}</span></button><div className="storyboard-scene-title"><Field label={`${number}번 장면 제목`} value={scene.title} disabled={scene.locked} onCommit={title => onCommand({type: 'updateScene', sceneId: scene.id, patch: {title}})}/><span>{formatTime(scene.startFrame / project.settings.fps)} – {formatTime((scene.startFrame + scene.durationInFrames) / project.settings.fps)} · {(scene.durationInFrames / project.settings.fps).toFixed(1)}초{scene.locked && <><LockKeyhole size={12}/>잠김</>}</span></div><label className="field storyboard-kind"><span className="field-label">화면 유형</span><select aria-label={`${number}번 장면 화면 유형`} disabled={scene.locked} value={scene.preferredKind || ''} onChange={event => onCommand({type: 'updateScene', sceneId: scene.id, patch: {preferredKind: event.target.value ? event.target.value as SceneKind : null}})}><option value="">AI가 선택</option>{sceneKinds.map(kind => <option key={kind.id} value={kind.id}>{kind.label}</option>)}</select></label><button className="primary-button storyboard-generate" disabled={working || scene.locked || !canGenerate || !narration} onClick={() => {onSelect(scene); onGenerate([scene.id]);}}><Sparkles size={14}/>{hasGenerated ? '재생성' : '장면 생성'}</button></div>
            <div className="storyboard-scene-body"><div className="storyboard-narration"><span className="field-label">연결된 나레이션</span><p>{narration || '이 구간에 연결된 자막이 없습니다.'}</p><span className="storyboard-current">현재 화면 · {kindLabel(scene.template === 'media' ? project.assets.find(asset => asset.id === scene.assetId)?.kind === 'video' ? 'video' : 'image' : scene.template)}</span></div><Field label={`${number}번 장면 필수 요구사항`} value={scene.requirements ?? ''} disabled={scene.locked} multiline rows={3} maxLength={4000} enforceMaxLength placeholder="이 장면에서 꼭 지킬 내용을 적어주세요. 예: 세 카드를 차례로 보여주고 마지막에 하나로 모이게." onCommit={requirements => onCommand({type: 'updateScene', sceneId: scene.id, patch: {requirements}})}/></div>
          </article>;
        })}</div>
        {!run.scenes.length && <div className="empty-storyboard-chapter"><p>이 챕터에 들어갈 대본의 문장을 골라 첫 장면을 추가하세요.</p><button className="secondary-button" onClick={() => setAddingTo(chapter.id)}><Plus size={15}/>첫 장면 추가</button></div>}
        {runIndex === runs.length - 1 && run.scenes.length > 0 && <button className="text-button storyboard-add-bottom" onClick={() => setAddingTo(chapter.id)}><Plus size={15}/>이 챕터에 장면 추가</button>}
      </section>;
    })}</div>
    {results}
    {addingTo && <AddSceneDialog project={project} chapterId={addingTo} selected={selected} onAdd={onAddScene} onClose={() => setAddingTo(null)} onSource={onSource}/>}
  </section>;
}
