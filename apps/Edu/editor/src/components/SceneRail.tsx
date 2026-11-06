import {memo, useState} from 'react';
import {ChevronDown, ChevronRight, Plus, LockKeyhole, TerminalSquare, FolderOpen, ImageIcon, Film, UserRound} from 'lucide-react';
import type {Project, Scene} from '../shared/types';
import {formatTime} from '../domain/project';
import {assetUrl} from '../lib/api';
import {chapterRuns} from '../lib/chapters';

export const SceneThumb = memo(function SceneThumb({scene, project}: {scene: Scene; project: Project}) {
  const asset = project.assets.find(a => a.id === scene.assetId);
  const names = scene.items.slice(0, 3);
  return <div className={`scene-thumb thumb-${scene.template} theme-${project.settings.theme}`} style={{'--thumb-accent': project.settings.accent} as React.CSSProperties}>
    {scene.template === 'media' && asset?.kind === 'image' ? <img src={assetUrl(project.id, asset.id)} alt="" loading="lazy"/> :
      scene.template === 'media' ? <div className="thumb-media">{asset?.kind === 'video' ? <Film/> : <ImageIcon/>}<span>{asset?.name || '화면 자료'}</span></div> :
      ['steps', 'compare', 'list', 'stat', 'flow'].includes(scene.template) ? <><small>{scene.heading}</small><div className="thumb-items">{names.map((item, index) => <div key={index}><b>{String(index + 1).padStart(2, '0')}</b><span>{item.title}</span></div>)}</div></> :
      scene.template === 'character' ? <><UserRound className="thumb-character"/><small>{scene.heading}</small></> :
      <><span className="thumb-kicker">{scene.kicker}</span><strong>{scene.heading || scene.title}</strong></>}
  </div>;
});

export const SceneRail = memo(function SceneRail({project, selectedId, onSelect, onProjects, onSplit, onCodex}: {
  project: Project; selectedId: string; onSelect: (scene: Scene) => void; onProjects: () => void; onSplit: () => void; onCodex: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  return <aside className="pane scene-rail" aria-label="장면 목록">
    <header className="pane-heading"><h2>장면 <span>{project.scenes.length}</span></h2><div className="button-group"><button className="icon-button" aria-label="프로젝트 열기" title="프로젝트 열기" onClick={onProjects}><FolderOpen size={16}/></button><button className="icon-button bordered" aria-label="선택 장면 나누기" title="선택 장면 나누기" onClick={onSplit}><Plus size={15}/></button></div></header>
    <div className="scene-rail-scroll">
      {chapterRuns(project).map(run => {
        const {chapter, scenes} = run;
        const chapterIndex = run.ordinal - 1;
        return <section className="chapter-group" key={run.key}>
          <button className="chapter-heading" onClick={() => setCollapsed(previous => {const next = new Set(previous); if (next.has(run.key)) next.delete(run.key); else next.add(run.key); return next;})} aria-expanded={!collapsed.has(run.key)}>
            {collapsed.has(run.key) ? <ChevronRight size={13}/> : <ChevronDown size={13}/>}<strong>{String(chapterIndex + 1).padStart(2, '0')}&nbsp; {chapter.title}{run.continued ? ' · 이어짐' : ''}</strong><span>{scenes.length}</span>
          </button>
          {!collapsed.has(run.key) && <div className="scene-rows">{scenes.map(scene => {
            const index = project.scenes.indexOf(scene);
            return <button key={scene.id} className={`scene-row ${scene.id === selectedId ? 'selected' : ''}`} onClick={() => onSelect(scene)} aria-label={`${index + 1}번 장면 ${scene.title}`} aria-pressed={scene.id === selectedId}>
              <span className="scene-number">{String(index + 1).padStart(2, '0')}</span><SceneThumb scene={scene} project={project}/>
              <span className="scene-row-copy"><strong>{scene.title || `장면 ${index + 1}`}</strong><small>{formatTime(scene.startFrame / project.settings.fps)} – {formatTime((scene.startFrame + scene.durationInFrames) / project.settings.fps)}</small>{scene.locked && <LockKeyhole size={11} className="row-lock"/>}</span>
            </button>;
          })}</div>}
        </section>;
      })}
    </div>
    <footer className="rail-footer"><button className="text-button" onClick={onCodex}><TerminalSquare size={15}/>Codex 연결<ChevronRight size={13}/></button><span>이 컴퓨터에 저장되는 프로젝트</span></footer>
  </aside>;
});
