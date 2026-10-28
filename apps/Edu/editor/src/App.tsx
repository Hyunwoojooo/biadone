import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {PlayerRef} from '@remotion/player';
import {Upload, ChevronDown, Check, CheckCheck, LoaderCircle, Undo2, Redo2, History, Plus, FolderOpen, X, CircleAlert, PanelLeft, SlidersHorizontal} from 'lucide-react';
import type {HistoryEntry, QualityReport, RenderOptions, Scene} from './shared/types';
import {checkQuality} from './domain/quality';
import {formatTime, sceneAtFrame} from './domain/project';
import {api} from './lib/api';
import {useStudio} from './lib/useStudio';
import {Field} from './components/Field';
import {Dialog} from './components/Dialog';
import {CodexDialog} from './components/CodexDialog';
import {SceneRail} from './components/SceneRail';
import {Preview} from './components/Preview';
import {CaptionEditor} from './components/CaptionEditor';
import {Inspector} from './components/Inspector';
import {Timeline} from './components/Timeline';
import {QualityPanel, SourcePanel, StructurePanel} from './components/WorkflowPanels';
import {GenerationPanel} from './components/GenerationPanel';
import type {AddSceneCommand} from './components/AddSceneDialog';

type Modal = 'projects'|'history'|'export'|'codex'|null;
const steps = ['소스 준비', '장면 구성', '생성 결과', '편집', '검수 · 출력'];

export function App() {
  const studio = useStudio();
  const {project, dispatch, flush, committed, setNotice, adopt} = studio;
  const [stage, setStage] = useState(3);
  const [selectedId, setSelectedId] = useState('');
  const [frame, setFrame] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [histories, setHistories] = useState<HistoryEntry[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [quality, setQuality] = useState<QualityReport|null>(null);
  const [resolution, setResolution] = useState<'1080p'|'720p'>('1080p');
  const [renderRange, setRenderRange] = useState<'all'|'scene'>('all');
  const [ackWarnings, setAckWarnings] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const playerRef = useRef<PlayerRef>(null);
  const importCaptions = useRef<HTMLInputElement>(null);
  const importAssets = useRef<HTMLInputElement>(null);
  const importProject = useRef<HTMLInputElement>(null);
  const projectId = useRef('');
  const closeModal = useCallback(() => setModal(null), []);
  const report = useMemo(() => project ? checkQuality(project) : null, [project]);
  const selected = project?.scenes.find(scene => scene.id === selectedId) ?? project?.scenes[0];
  const readyQuality = quality && project && quality.checkedAt && studio.saveState === 'saved' ? quality : report;

  const attempt = useCallback(async (work: () => Promise<unknown>) => {try {await work();} catch (caught) {setNotice(caught instanceof Error ? caught.message : '작업을 처리하지 못했습니다.');}}, [setNotice]);
  const seek = useCallback((next: number) => {playerRef.current?.seekTo(next); setFrame(next);}, []);
  const choose = useCallback((scene: Scene) => {setSelectedId(scene.id); seek(scene.startFrame); setLeftOpen(false);}, [seek]);
  const split = useCallback(() => {
    if (!selected) return;
    const atFrame = frame > selected.startFrame + 1 && frame < selected.startFrame + selected.durationInFrames - 1 ? frame : selected.startFrame + Math.floor(selected.durationInFrames / 2);
    dispatch({type: 'splitScene', sceneId: selected.id, atFrame});
  }, [selected, frame, dispatch]);

  useEffect(() => {
    if (!project) return;
    if (projectId.current !== project.id) {projectId.current = project.id; const initial = project.scenes[Math.min(2, project.scenes.length - 1)]; const initialFrame = initial.startFrame + Math.floor(Math.min(initial.durationInFrames / 2, project.settings.fps * 6)); setSelectedId(initial.id); setFrame(initialFrame); setQuality(null); window.setTimeout(() => playerRef.current?.seekTo(initialFrame), 50);}
    else if (!project.scenes.some(scene => scene.id === selectedId)) setSelectedId(project.scenes[0].id);
  }, [project, selectedId]);

  useEffect(() => {setQuality(null);}, [project?.revision]);
  useEffect(() => {
    if (!project) return;
    const scene = sceneAtFrame(project, frame);
    if (scene) setSelectedId(scene.id);
  }, [frame, project]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const editing = target.matches('input,textarea,select') || target.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {event.preventDefault(); if (editing) target.blur(); void attempt(flush); return;}
      if (editing || document.querySelector('dialog[open]') || stage === 1 || stage === 2) return;
      if (event.code === 'Space') {event.preventDefault(); playerRef.current?.toggle();}
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {event.preventDefault(); void attempt(() => studio.historyAction(event.shiftKey ? 'redo' : 'undo'));}
      if (event.key === 'ArrowRight') {event.preventDefault(); seek(Math.min((project?.durationInFrames || 1) - 1, frame + (project?.settings.fps || 30)));}
      if (event.key === 'ArrowLeft') {event.preventDefault(); seek(Math.max(0, frame - (project?.settings.fps || 30)));}
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [attempt, flush, studio, project, frame, seek, stage]);

  const refreshQuality = useCallback(async () => {await flush(); const p = committed(); if (p) {const next = await api.quality(p.id); if (committed()?.id === p.id && committed()?.revision === p.revision) setQuality(next);}}, [flush, committed]);
  const openExport = () => {setModal('export'); setAckWarnings(false); void attempt(refreshQuality);};
  const onFiles = async (files: FileList|File[]) => {
    const selectedFiles = Array.from(files);
    if (!project || !selectedFiles.length) return;
    setBusy(true);
    try {
      await flush();
      for (const file of selectedFiles) {
        const result = await api.upload(project.id, file); adopt(result.project);
        if (result.asset.kind === 'audio' && !result.project.audioAssetId) {dispatch({type: 'setNarration', assetId: result.asset.id}); await flush();}
      }
      setNotice(`${selectedFiles.length}개 파일을 가져왔습니다.`);
    } catch (caught) {setNotice(caught instanceof Error ? caught.message : '파일을 가져오지 못했습니다.');}
    finally {setBusy(false);}
  };

  const startTranscription = () => attempt(async () => {await flush(); const p = committed(); if (!p) return; await api.transcribe(p.id, p.revision); setNotice('로컬 전사를 시작했습니다. 편집을 계속하면 결과는 별도로 보관됩니다.');});
  const readCaptions = async (file: File) => {
    if (!project) return;
    setBusy(true);
    try {await flush(); const p = committed()!; const format = file.name.toLowerCase().endsWith('.srt') ? 'srt' : file.name.toLowerCase().endsWith('.vtt') ? 'vtt' : 'json'; const result = await api.captions(p.id, {text: await file.text(), format, regroup: false, expectedRevision: p.revision}); adopt(result); setNotice(`${result.captions.length}개 자막을 가져왔습니다.`);}
    catch (caught) {setNotice(caught instanceof Error ? caught.message : '자막을 읽지 못했습니다.');}
    finally {setBusy(false);}
  };
  const startRender = () => attempt(async () => {
    await flush(); const p = committed(); if (!p || !selected) return;
    const options: RenderOptions = {resolution, allowWarnings: ackWarnings, ...(renderRange === 'scene' ? {range: {startFrame: selected.startFrame, endFrame: selected.startFrame + selected.durationInFrames}} : {})};
    await api.render(p.id, options); setModal(null); setStage(4); setNotice('출력을 시작했습니다. 작업 기록에서 진행률을 확인하세요.');
  });
  const addScene = (command: AddSceneCommand): boolean => {
    if (!project) return false;
    const before = new Set(project.scenes.map(scene => scene.id));
    const next = dispatch(command);
    if (!next) return false;
    const first = project.captions.find(caption => caption.id === command.firstCaptionId);
    const last = project.captions.find(caption => caption.id === command.lastCaptionId);
    const added = next.scenes.find(scene => !before.has(scene.id) && first && last && scene.startFrame <= first.startFrame && scene.startFrame + scene.durationInFrames >= last.endFrame);
    if (added) choose(added);
    setNotice('선택한 문장을 새 장면으로 추가했습니다.');
    return true;
  };
  const startGeneration = (sceneIds: string[]) => attempt(async () => {
    setBusy(true);
    try {await flush(); const p = committed(); if (!p) return; await api.generate(p.id, sceneIds, p.revision); setNotice('Codex가 장면 초안을 만들고 있습니다. 생성 결과를 확인한 뒤 적용하세요.');}
    finally {setBusy(false);}
  });
  const applyGeneration = (jobId: string) => attempt(async () => {
    setBusy(true);
    try {await flush(); const p = committed(); if (!p) return; const job = studio.jobs.find(item => item.id === jobId && item.projectId === p.id && item.type === 'generate'); if (!job) throw new Error('현재 프로젝트의 생성 작업을 선택해 주세요.'); const next = await api.applyScenePlan(jobId, p.revision); studio.adoptIfIdle(next, p); setStage(3); setNotice('장면 초안을 적용했습니다. 미리보기에서 확인하고 다듬으세요.');}
    finally {setBusy(false);}
  });
  const showHistory = () => attempt(async () => {await flush(); if (!project) return; setHistories(await api.history(project.id)); setModal('history');});
  const jumpIssue = (sceneId?: string, captionId?: string) => {
    if (!project) return;
    const caption = project.captions.find(c => c.id === captionId);
    const scene = project.scenes.find(s => s.id === sceneId) || (caption ? sceneAtFrame(project, caption.startFrame) : undefined);
    if (scene) {choose(scene); setStage(3); if (caption) seek(caption.startFrame);}
  };
  const projectJobs = studio.jobs.filter(job => job.projectId === project?.id);
  const activeJobs = projectJobs.filter(job => job.status === 'running' || job.status === 'queued');

  if (!project || !selected || !report || !readyQuality) return <main className="boot-screen"><div className="brand-mark"><svg viewBox="0 0 32 32"><path fill="currentColor" d="M5 3.5a3 3 0 0 1 4.5-2.6l20 12a3.6 3.6 0 0 1 0 6.2l-20 12A3 3 0 0 1 5 28.5Z"/><path fill="white" d="m13 10 10 6-10 6Z"/></svg></div><h1>Biadone Studio</h1>{studio.error ? <><p>{studio.error}</p><button className="primary-button" onClick={() => window.location.reload()}>다시 열기</button></> : <><LoaderCircle className="spin"/><p>프로젝트를 준비하고 있습니다.</p></>}</main>;

  return <div className="studio-app">
    <header className="app-header"><button className="brand" onClick={() => {setModal('projects'); void attempt(studio.refreshProjects);}} aria-label="Biadone Studio 프로젝트"><svg className="brand-logo" viewBox="0 0 32 32"><path fill="currentColor" d="M5 3.5a3 3 0 0 1 4.5-2.6l20 12a3.6 3.6 0 0 1 0 6.2l-20 12A3 3 0 0 1 5 28.5Z"/><path fill="white" d="m13 10 10 6-10 6Z"/></svg><span><strong>Biadone</strong> Studio</span></button><div className="project-title"><Field label="프로젝트 제목" value={project.title} onCommit={title => dispatch({type: 'updateProject', patch: {title}})}/><ChevronDown size={13} onClick={() => setModal('projects')}/></div><div className="header-actions"><div className="history-actions"><button className="icon-button" title="실행 취소" aria-label="실행 취소" onClick={() => void attempt(() => studio.historyAction('undo'))}><Undo2 size={16}/></button><button className="icon-button" title="다시 실행" aria-label="다시 실행" onClick={() => void attempt(() => studio.historyAction('redo'))}><Redo2 size={16}/></button><button className="icon-button" title="수정 이력" aria-label="수정 이력" onClick={() => void showHistory()}><History size={16}/></button></div><span className={`save-status save-${studio.saveState}`}>{studio.saveState === 'saving' ? <LoaderCircle size={15} className="spin"/> : studio.saveState === 'saved' ? <CheckCheck size={16}/> : <CircleAlert size={16}/>}<span>{studio.saveState === 'saved' ? '저장됨' : studio.saveState === 'saving' ? '저장 중' : '저장 확인'}</span></span><button className="primary-button export-button" onClick={openExport}><Upload size={16}/>내보내기</button></div></header>
    <nav className="workflow-nav" aria-label="제작 단계">{steps.map((step, index) => <button key={step} className={stage === index ? 'active' : ''} onClick={() => {setStage(index); if (index === 4) void attempt(refreshQuality);}} aria-current={stage === index ? 'step' : undefined}><span>{String(index + 1).padStart(2, '0')}</span>{step}</button>)}</nav>
    {(studio.saveState === 'error' || studio.saveState === 'conflict') && <div className="save-error" role="alert"><CircleAlert size={17}/><span>{studio.error} 변경 내용은 현재 화면에 남아 있습니다.</span><button onClick={() => void studio.resolveSave(true)}>내 변경 다시 적용</button><button onClick={() => {if (window.confirm('저장되지 않은 현재 변경 대신 저장된 프로젝트를 불러올까요?')) void studio.resolveSave(false);}}>저장된 상태 불러오기</button></div>}
    <div className="mobile-tools"><button className="small-button" onClick={() => setLeftOpen(!leftOpen)}><PanelLeft size={15}/>장면</button><span>{selected.title}</span><button className="small-button" onClick={() => setRightOpen(!rightOpen)}><SlidersHorizontal size={15}/>설정</button></div>
    <main className={`workspace workspace-stage-${stage} ${leftOpen ? 'left-open' : ''} ${rightOpen ? 'right-open' : ''}`}>
      <div className="rail-container"><SceneRail project={project} selectedId={selected.id} onSelect={choose} onProjects={() => {setModal('projects'); void attempt(studio.refreshProjects);}} onSplit={split} onCodex={() => setModal('codex')}/></div>
      {stage === 3 ? <div className="center-column"><Preview project={project} playerRef={playerRef} frame={frame} onFrame={setFrame}/><CaptionEditor project={project} scene={selected} frame={frame} onSeek={seek} onCommand={dispatch} onImport={() => importCaptions.current?.click()}/></div> : stage === 0 ? <SourcePanel project={project} system={studio.system} busy={busy} onFiles={files => void onFiles(files)} onCaptions={() => importCaptions.current?.click()} onTranscribe={() => void startTranscription()} onCommand={dispatch} onNext={() => setStage(1)}/> : stage === 1 ? <StructurePanel key={project.id} project={project} selectedId={selected.id} system={studio.system} jobs={projectJobs} busy={busy} onSelect={choose} onCommand={dispatch} onAddScene={addScene} onGenerate={ids => void startGeneration(ids)} onCancel={id => void attempt(() => api.cancel(id))} onRefreshSystem={() => void attempt(studio.refreshSystem)} onSource={() => setStage(0)} onNext={() => setStage(2)} results={<GenerationPanel embedded project={project} jobs={projectJobs} busy={busy} onApply={id => void applyGeneration(id)} onCancel={id => void attempt(() => api.cancel(id))} onRetry={id => void attempt(() => api.retry(id))} onNext={() => setStage(3)} onBack={() => setStage(1)}/>}/> : stage === 2 ? <GenerationPanel project={project} jobs={projectJobs} busy={busy} onApply={id => void applyGeneration(id)} onCancel={id => void attempt(() => api.cancel(id))} onRetry={id => void attempt(() => api.retry(id))} onNext={() => setStage(3)} onBack={() => setStage(1)}/> : <QualityPanel project={project} quality={readyQuality} jobs={projectJobs} onRefresh={() => void attempt(refreshQuality)} onIssue={jumpIssue} onExport={openExport} onCommand={dispatch} onCancel={id => void attempt(() => api.cancel(id))} onRetry={id => void attempt(() => api.retry(id))}/>}
      <div className="inspector-container"><Inspector project={project} scene={selected} frame={frame} quality={report} onCommand={dispatch} onUpload={() => importAssets.current?.click()} onSplit={split} onQuality={() => {setStage(4); void attempt(refreshQuality);}}/></div>
    </main>
    {stage !== 1 && stage !== 2 && <Timeline project={project} frame={frame} selectedId={selected.id} onSeek={seek} onSelect={id => {setSelectedId(id); setStage(3);}}/>}
    <footer className="app-footer"><div><Check size={13}/><span>{studio.saveState === 'saved' ? '자동 저장 켜짐' : studio.saveState === 'saving' ? '변경 내용 저장 중' : '저장 상태 확인 필요'}</span><span className="footer-dot">·</span><span>{project.scenes.length}개 장면 · {formatTime(project.durationInFrames / project.settings.fps)}</span></div><button className="footer-job" onClick={() => setStage(activeJobs[0]?.type === 'generate' ? 2 : 4)}>{activeJobs.length ? <><LoaderCircle size={13} className="spin"/>{activeJobs[0].type === 'render' ? '영상 출력' : activeJobs[0].type === 'generate' ? '장면 생성' : '음성 전사'} {Math.round(activeJobs[0].progress * 100)}%</> : <><span className="local-dot"/>프로젝트는 이 컴퓨터에 저장됩니다</>}</button></footer>
    {studio.notice && <div className="toast" role="status"><CircleAlert size={17}/><span>{studio.notice}</span><button className="icon-button" aria-label="알림 닫기" onClick={() => setNotice('')}><X size={14}/></button></div>}
    <input type="file" hidden accept=".srt,.vtt,.json" ref={importCaptions} onChange={event => {const file = event.target.files?.[0]; if (file) void readCaptions(file); event.target.value = '';}}/>
    <input type="file" hidden multiple accept="audio/*,video/*,image/*" ref={importAssets} onChange={event => {if (event.target.files) void onFiles(event.target.files); event.target.value = '';}}/>
    <input type="file" hidden accept=".json" ref={importProject} onChange={event => {const file = event.target.files?.[0]; if (file) void attempt(async () => {await flush(); adopt(await api.importProject(file)); await studio.refreshProjects(); setModal(null);}); event.target.value = '';}}/>
    {modal === 'projects' && <Dialog title="프로젝트" onClose={closeModal}><div className="dialog-body"><div className="new-project-row"><input aria-label="새 프로젝트 제목" value={newTitle} onChange={event => setNewTitle(event.target.value)} placeholder="새 영상의 제목" onKeyDown={event => {if (event.key === 'Enter') void attempt(async () => {await studio.create(newTitle || '새 롱폼 영상'); setModal(null); setStage(0); setNewTitle('');});}}/><button className="primary-button" onClick={() => void attempt(async () => {await studio.create(newTitle || '새 롱폼 영상'); setModal(null); setStage(0); setNewTitle('');})}><Plus size={15}/>만들기</button></div><div className="project-list">{studio.projects.map(item => <button key={item.id} className={`project-list-row ${item.id === project.id ? 'selected' : ''}`} onClick={() => void attempt(async () => {await studio.load(item.id); setModal(null);})}><div className="project-file-icon"><FolderOpen size={21}/></div><div><strong>{item.title}</strong><p>{item.sceneCount}개 장면 · {formatTime(item.durationInFrames / item.fps)} · {new Date(item.updatedAt).toLocaleDateString('ko-KR')}</p></div>{item.id === project.id && <Check size={17}/>}</button>)}</div><div className="dialog-footer"><button className="secondary-button" onClick={() => importProject.current?.click()}><FolderOpen size={15}/>편집 정보 가져오기</button><button className="text-button" onClick={() => void attempt(async () => {await studio.create('AI 도구, 내 일에 맞게 쓰는 법', true); setModal(null); setStage(3);})}>예제 프로젝트 만들기</button></div></div></Dialog>}
    {modal === 'history' && <Dialog title="수정 이력" onClose={closeModal}><div className="dialog-body"><p className="muted small">복원 전 현재 상태도 기록으로 남습니다.</p><div className="history-list">{histories.length ? histories.map(item => <div className="history-row" key={item.id}><History size={17}/><div><strong>{item.title}</strong><p>{new Date(item.createdAt).toLocaleString('ko-KR')} · 버전 {item.revision}</p></div><button className="small-button" onClick={() => void attempt(async () => {await studio.historyAction('undo', item.id); setModal(null); setNotice('선택한 편집 상태로 복원했습니다.');})}>복원</button></div>) : <div className="empty-inline">첫 변경을 저장하면 이력이 생깁니다.</div>}</div></div></Dialog>}
    {modal === 'export' && <Dialog title="영상 내보내기" onClose={closeModal}><div className="dialog-body"><div className="export-project"><div className="export-preview-mark"><Upload size={24}/></div><div><h3>{project.title}</h3><p>{formatTime(project.durationInFrames / project.settings.fps)} · {project.scenes.length}개 장면 · MP4</p></div></div><label className="field"><span className="field-label">해상도</span><select value={resolution} onChange={event => setResolution(event.target.value as typeof resolution)}><option value="1080p">1920×1080 · 원본 화질</option><option value="720p">1280×720 · 빠른 검토</option></select></label><label className="field"><span className="field-label">출력 범위</span><select value={renderRange} onChange={event => setRenderRange(event.target.value as typeof renderRange)}><option value="all">전체 영상</option><option value="scene">선택 장면 · {selected.title}</option></select></label><div className={`export-quality ${readyQuality.ok ? 'passed' : 'has-errors'}`}><CircleAlert size={18}/><span>{readyQuality.summary.errors ? `출력 전에 오류 ${readyQuality.summary.errors}개를 수정하세요.` : readyQuality.summary.warnings ? `확인 권장 항목이 ${readyQuality.summary.warnings}개 있습니다.` : '출력 전 검사를 통과했습니다.'}</span><button className="text-button" onClick={() => {setModal(null); setStage(4); void attempt(refreshQuality);}}>검수 보기</button></div>{readyQuality.summary.warnings > 0 && <label className="acknowledge"><input type="checkbox" checked={ackWarnings} onChange={event => setAckWarnings(event.target.checked)}/><span>확인 권장 항목을 검토했으며 이 상태로 출력합니다.</span></label>}<p className="small muted">현재 편집 버전을 고정해 출력합니다. 출력 중에도 편집할 수 있으며, 결과는 작업 기록에 남습니다.</p><div className="dialog-footer"><button className="secondary-button" onClick={closeModal}>닫기</button><button className="primary-button" disabled={!readyQuality.ok || (!!readyQuality.summary.warnings && !ackWarnings) || studio.saveState !== 'saved'} onClick={() => void startRender()}><Upload size={15}/>출력 시작</button></div></div></Dialog>}
    {modal === 'codex' && <CodexDialog system={studio.system} onClose={closeModal} onNotice={setNotice}/>}
    {activeJobs.length > 0 && stage !== 4 && !(stage === 2 && activeJobs[0].type === 'generate') && <div className="job-float"><button className="text-button" onClick={() => setStage(activeJobs[0].type === 'generate' ? 2 : 4)}><LoaderCircle size={14} className="spin"/>{activeJobs[0].message || '작업 진행 중'}<span>{Math.round(activeJobs[0].progress * 100)}%</span></button></div>}
  </div>;
}
