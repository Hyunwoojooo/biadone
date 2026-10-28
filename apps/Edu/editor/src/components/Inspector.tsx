import {LockKeyhole, UnlockKeyhole, Scissors, Combine, CircleCheck, CircleAlert, Plus, Minus, ChevronRight} from 'lucide-react';
import {useState} from 'react';
import type {EditorCommand, Project, QualityReport, Scene, SceneKind, ScenePatch, Template} from '../shared/types';
import {assetUrl} from '../lib/api';
import {Field} from './Field';
import {sceneKinds} from './SceneKinds';

export function Inspector({project, scene, frame, quality, onCommand, onUpload, onSplit, onQuality}: {project: Project; scene: Scene; frame: number; quality: QualityReport; onCommand: (command: EditorCommand) => void; onUpload: () => void; onSplit: () => void; onQuality: () => void}) {
  const [tab, setTab] = useState<'visual'|'caption'>('visual');
  const patch = (value: ScenePatch) => onCommand({type: 'updateScene', sceneId: scene.id, patch: value});
  const settings = (value: Partial<Project['settings']>) => onCommand({type: 'updateProject', patch: {settings: value}});
  const assets = project.assets.filter(a => a.kind === 'image' || a.kind === 'video');
  const attached = assets.find(a => a.id === scene.assetId);
  const issues = quality.issues.filter(i => i.sceneId === scene.id);
  const itemLimits: Partial<Record<Template, [number, number]>> = {compare: [2, 2], steps: [2, 4], list: [2, 5], stat: [1, 3], flow: [2, 4]};
  const limits = itemLimits[scene.template];
  const changeTemplate = (kind: SceneKind) => {
    const next: Template = kind === 'image' || kind === 'video' ? 'media' : kind;
    const bounds = itemLimits[next];
    let items = [...scene.items];
    if (bounds) {
      items = items.slice(0, bounds[1]);
      while (items.length < bounds[0]) items.push({title: next === 'stat' ? '수치 입력' : `${items.length + 1}번째 항목`, body: ''});
    }
    const asset = project.assets.find(value => value.kind === kind && value.id === scene.assetId) ?? project.assets.find(value => value.kind === kind);
    patch({template: next, preferredKind: kind, items, ...(next === 'media' ? {assetId: asset?.id ?? null, mediaStartFrame: 0} : {})});
  };
  return <aside className="pane inspector" aria-label="장면 설정">
    <header className="pane-heading"><h2>장면 설정</h2><span className="muted small">{String(project.scenes.indexOf(scene) + 1).padStart(2, '0')}</span></header>
    <div className="inspector-tabs"><button className={tab === 'visual' ? 'active' : ''} onClick={() => setTab('visual')}>연출</button><button className={tab === 'caption' ? 'active' : ''} onClick={() => setTab('caption')}>자막</button></div>
    <div className="inspector-scroll">
      {tab === 'visual' ? <>
        <Field label="장면 제목" value={scene.title} disabled={scene.locked} maxLength={50} onCommit={title => patch({title})}/>
        <div className="inspector-section"><span className="field-label">화면 유형</span><div className="template-grid">{sceneKinds.map(template => {
          const active = template.id === 'image' || template.id === 'video' ? scene.template === 'media' && (attached?.kind ?? scene.preferredKind) === template.id : scene.template === template.id;
          return <button key={template.id} disabled={scene.locked} className={active ? 'selected' : ''} onClick={() => changeTemplate(template.id)} aria-pressed={active}><template.icon size={22}/><span>{template.label}</span></button>;
        })}</div></div>
        <Field label="강조 문구" value={scene.heading} disabled={scene.locked} maxLength={50} onCommit={heading => patch({heading})}/>
        {limits ? <div className="inspector-section"><div className="label-row"><span className="field-label">{scene.template === 'stat' ? '수치와 설명' : '화면 항목'}</span><div className="button-group"><button className="icon-button" aria-label="항목 줄이기" disabled={scene.locked || scene.items.length <= limits[0]} onClick={() => patch({items: scene.items.slice(0, -1)})}><Minus size={13}/></button><button className="icon-button" aria-label="항목 추가" disabled={scene.locked || scene.items.length >= limits[1]} onClick={() => patch({items: [...scene.items, {title: '새 항목', body: ''}]})}><Plus size={13}/></button></div></div><div className="item-fields">{scene.items.map((item, index) => <div className="item-editor" key={index}><span>{String(index + 1).padStart(2, '0')}</span><div><Field label={`${index + 1}번 항목 제목`} value={item.title} disabled={scene.locked} onCommit={title => patch({items: scene.items.map((value, i) => i === index ? {...value, title} : value)})}/><Field label={`${index + 1}번 항목 설명`} value={item.body} disabled={scene.locked} onCommit={body => patch({items: scene.items.map((value, i) => i === index ? {...value, body} : value)})}/></div></div>)}</div></div> : <Field label="설명 문구" value={scene.body} disabled={scene.locked} multiline rows={3} maxLength={160} onCommit={body => patch({body})}/>}
        {limits && <Field label="화면 아래 설명" value={scene.body} disabled={scene.locked} maxLength={100} onCommit={body => patch({body})}/>}
        {scene.template === 'media' && <div className="inspector-section"><label className="field"><span className="field-label">화면 자료</span><select aria-label="화면 자료 선택" value={scene.assetId || ''} disabled={scene.locked} onChange={event => {const asset = assets.find(value => value.id === event.target.value); patch({assetId: asset?.id ?? null, ...(asset ? {preferredKind: asset.kind as SceneKind} : {}), mediaStartFrame: 0});}}><option value="">자료를 선택하세요</option>{assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><button className="small-button full" onClick={onUpload}><Plus size={14}/>자료 가져오기</button>{attached?.kind === 'image' && <img className="inspector-asset" src={assetUrl(project.id, attached.id)} alt={attached.name}/>}<label className="field"><span className="field-label">화면 맞춤</span><select value={scene.mediaFit} disabled={scene.locked} onChange={event => patch({mediaFit: event.target.value as Scene['mediaFit']})}><option value="contain">전체 보이기</option><option value="cover">화면 채우기</option></select></label>{attached?.kind === 'video' && <label className="field"><span className="field-label">영상 시작 위치 (초)</span><input type="number" min="0" step="0.1" disabled={scene.locked} key={`${scene.id}-${scene.mediaStartFrame}`} defaultValue={scene.mediaStartFrame / project.settings.fps} onBlur={event => patch({mediaStartFrame: Math.max(0, Math.round(Number(event.target.value) * project.settings.fps))})}/></label>}</div>}
        <details className="advanced-fields"><summary>보조 문구 · 인용 설정</summary><Field label="작은 제목" value={scene.kicker} disabled={scene.locked} maxLength={40} onCommit={kicker => patch({kicker})}/><button className={`quote-option ${scene.template === 'quote' ? 'selected' : ''}`} disabled={scene.locked} onClick={() => changeTemplate('quote')}>“ 인용 문구로 표현하기 ”</button></details>
        <div className="inspector-section"><span className="field-label">브랜드 스타일 <span className="muted">전체 장면</span></span><div className="theme-swatches">{[{id: 'sage', color: '#15856d', name: '세이지'}, {id: 'ink', color: '#213749', name: '잉크'}, {id: 'sand', color: '#a16e3c', name: '샌드'}].map(theme => <button key={theme.id} className={project.settings.theme === theme.id ? 'selected' : ''} aria-label={`${theme.name} 스타일`} title={theme.name} onClick={() => settings({theme: theme.id as Project['settings']['theme']})} style={{background: theme.color}}>{project.settings.theme === theme.id && <CircleCheck size={18}/>}</button>)}<label className="custom-color" title="강조 색상 직접 선택"><input type="color" value={project.settings.accent} aria-label="강조 색상" onChange={event => settings({accent: event.target.value})}/><span>색상</span></label></div></div>
        <label className="field"><span className="field-label">움직임</span><select value={scene.motion} disabled={scene.locked} onChange={event => patch({motion: event.target.value as Scene['motion']})}><option value="calm">차분하게</option><option value="standard">기본</option><option value="lively">경쾌하게</option></select></label>
        <label className="field"><span className="field-label">챕터</span><select value={scene.chapterId} disabled={scene.locked} onChange={event => patch({chapterId: event.target.value})}>{project.chapters.map(chapter => <option value={chapter.id} key={chapter.id}>{chapter.title}</option>)}</select></label>
      </> : <>
        <p className="inspector-help">문구와 발화 시각은 미리보기 아래에서 수정합니다. 전체 자막의 모양은 여기서 조절하세요.</p>
        <label className="toggle-row"><span>전체 자막 표시</span><input type="checkbox" checked={project.settings.showCaptions} onChange={event => settings({showCaptions: event.target.checked})}/><i/></label>
        <label className="toggle-row"><span>이 장면 자막 표시</span><input type="checkbox" disabled={scene.locked} checked={scene.showCaptions} onChange={event => patch({showCaptions: event.target.checked})}/><i/></label>
        <label className="field"><span className="field-label">글자 크기 <span>{project.settings.subtitleSize}px</span></span><input type="range" min="28" max="72" value={project.settings.subtitleSize} onChange={event => settings({subtitleSize: Number(event.target.value)})}/></label>
        <label className="toggle-row"><span>자막 배경</span><input type="checkbox" checked={project.settings.subtitleBackground} onChange={event => settings({subtitleBackground: event.target.checked})}/><i/></label>
        <div className="inspector-callout">화면 하단의 안전 영역에 최대 두 줄로 표시합니다. 긴 문구는 검수 단계에서 확인할 수 있습니다.</div>
      </>}
      <div className="inspector-divider"/>
      <label className="toggle-row lock-row"><span>{scene.locked ? <LockKeyhole size={14}/> : <UnlockKeyhole size={14}/>}장면 잠금</span><input type="checkbox" checked={scene.locked} onChange={event => patch({locked: event.target.checked})}/><i/></label>
      <div className="scene-edit-actions"><button className="small-button" disabled={scene.locked} onClick={onSplit}><Scissors size={13}/>장면 나누기</button><button className="small-button" disabled={scene.locked || project.scenes.indexOf(scene) === project.scenes.length - 1} onClick={() => onCommand({type: 'mergeScene', sceneId: scene.id})}><Combine size={13}/>다음과 합치기</button></div>
      <label className="field"><span className="field-label">장면 끝 (초)</span><input type="number" disabled={scene.locked || project.scenes.indexOf(scene) === project.scenes.length - 1} min={(scene.startFrame + 1) / project.settings.fps} step="0.1" key={`${scene.id}-${scene.durationInFrames}`} defaultValue={((scene.startFrame + scene.durationInFrames) / project.settings.fps).toFixed(2)} onBlur={event => {const endFrame = Math.round(Number(event.target.value) * project.settings.fps); if (endFrame !== scene.startFrame + scene.durationInFrames) onCommand({type: 'setBoundary', sceneId: scene.id, endFrame});}}/></label>
      <Field label="편집 메모" value={scene.notes} multiline rows={2} disabled={scene.locked} placeholder="다음 편집 때 기억할 내용" onCommit={notes => patch({notes})}/>
      <div className="inspector-divider"/>
      <div className="label-row"><strong className="field-label">편집 품질 확인</strong><button className="icon-button" title="전체 검수" aria-label="전체 품질 검사" onClick={onQuality}><ChevronRight size={14}/></button></div>
      {issues.length ? issues.slice(0, 4).map(issue => <div className={`mini-check ${issue.severity}`} key={issue.id}><CircleAlert size={15}/><span>{issue.message}</span></div>) : <><div className="mini-check success"><CircleCheck size={15}/><span>이 장면의 기본 검사를 통과했습니다.</span></div><div className="mini-check muted"><CircleCheck size={15}/><span>재생 위치 {Math.floor(frame / project.settings.fps)}초 · {scene.durationInFrames}프레임</span></div></>}
    </div>
  </aside>;
}
