import {Plus, Play, Trash2, Captions} from 'lucide-react';
import type {EditorCommand, Project, Scene} from '../shared/types';
import {formatTime} from '../domain/project';
import {Field} from './Field';

export function CaptionEditor({project, scene, frame, onSeek, onCommand, onImport}: {project: Project; scene: Scene; frame: number; onSeek: (frame: number) => void; onCommand: (command: EditorCommand) => void; onImport: () => void}) {
  const captions = project.captions.filter(c => c.endFrame > scene.startFrame && c.startFrame < scene.startFrame + scene.durationInFrames);
  const fps = project.settings.fps;
  return <section className="pane captions-pane" aria-label="자막 편집">
    <header className="pane-heading"><h2>나레이션 · 자막 <span>{captions.length ? `${captions.length}문장` : ''}</span></h2><div className="button-group"><button className="small-button" onClick={onImport}><Captions size={14}/>가져오기</button><button className="small-button" onClick={() => {const start = Math.max(scene.startFrame, Math.min(frame, scene.startFrame + scene.durationInFrames - fps)); onCommand({type: 'addCaption', caption: {id: `caption_${crypto.randomUUID()}`, text: '새 자막', startFrame: start, endFrame: Math.min(project.durationInFrames, start + fps * 3)}});}}><Plus size={14}/>문장 추가</button></div></header>
    <div className="caption-scroll">{captions.length ? captions.map((caption, index) => <div className={`caption-row ${frame >= caption.startFrame && frame < caption.endFrame ? 'current' : ''}`} key={caption.id}>
      <button className="caption-seek" aria-label={`${index + 1}번 자막으로 이동`} onClick={() => onSeek(caption.startFrame)}>{frame >= caption.startFrame && frame < caption.endFrame ? <Play size={12} fill="currentColor"/> : index + 1}</button>
      <div className="caption-times"><input aria-label={`${index + 1}번 자막 시작 초`} type="number" step="0.1" min="0" defaultValue={(caption.startFrame / fps).toFixed(2)} key={`${caption.id}-start-${caption.startFrame}`} onBlur={event => {const value = Math.round(Number(event.target.value) * fps); if (Number.isFinite(value) && value !== caption.startFrame) onCommand({type: 'updateCaption', captionId: caption.id, patch: {startFrame: value}});}}/><span>–</span><input aria-label={`${index + 1}번 자막 종료 초`} type="number" step="0.1" min="0" defaultValue={(caption.endFrame / fps).toFixed(2)} key={`${caption.id}-end-${caption.endFrame}`} onBlur={event => {const value = Math.round(Number(event.target.value) * fps); if (Number.isFinite(value) && value !== caption.endFrame) onCommand({type: 'updateCaption', captionId: caption.id, patch: {endFrame: value}});}}/></div>
      <Field value={caption.text} label={`${index + 1}번 자막 문구`} onCommit={text => onCommand({type: 'updateCaption', captionId: caption.id, patch: {text}})}/>
      <button className="icon-button subtle danger-on-hover" aria-label={`${index + 1}번 자막 삭제`} onClick={() => onCommand({type: 'removeCaption', captionId: caption.id})}><Trash2 size={13}/></button>
    </div>) : <div className="empty-inline"><Captions size={22}/><div><strong>이 장면의 자막을 준비하세요</strong><p>음성을 전사하거나 SRT·VTT 자막을 가져올 수 있습니다.</p></div><button className="small-button" onClick={onImport}>자막 가져오기</button></div>}</div>
    <div className="caption-footer">{formatTime(scene.startFrame / fps)} – {formatTime((scene.startFrame + scene.durationInFrames) / fps)}<span>문구 수정 후 다른 곳을 누르면 자동 저장됩니다.</span></div>
  </section>;
}
