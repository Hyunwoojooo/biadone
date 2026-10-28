import {useEffect, useRef, useState} from 'react';
import {Film, Mic, Type, ZoomIn, ZoomOut} from 'lucide-react';
import type {Project} from '../shared/types';
import {formatTime} from '../domain/project';
import {SceneThumb} from './SceneRail';
import {chapterRuns} from '../lib/chapters';

export function Timeline({project, frame, selectedId, onSeek, onSelect}: {project: Project; frame: number; selectedId: string; onSeek: (frame: number) => void; onSelect: (id: string) => void}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(1000);
  const [zoom, setZoom] = useState(Math.max(1, Math.min(20, project.durationInFrames / project.settings.fps / 75)));
  const fps = project.settings.fps;
  const duration = project.durationInFrames / fps;
  useEffect(() => {if (!scroll.current) return; const observer = new ResizeObserver(entries => setViewportWidth(entries[0].contentRect.width - 6)); observer.observe(scroll.current); return () => observer.disconnect();}, []);
  useEffect(() => {setZoom(Math.max(1, Math.min(20, project.durationInFrames / project.settings.fps / 75))); if (scroll.current) scroll.current.scrollLeft = 0;}, [project.id, project.durationInFrames, project.settings.fps]);
  const width = Math.max(viewportWidth, viewportWidth * zoom);
  const px = width / duration;
  useEffect(() => {const element = scroll.current; if (!element) return; const x = frame / fps * px; if (x < element.scrollLeft || x > element.scrollLeft + element.clientWidth - 15) element.scrollLeft = Math.max(0, x - element.clientWidth * .2);}, [frame, fps, px]);
  const tick = px * 15 > 65 ? 15 : px * 30 > 65 ? 30 : px * 60 > 65 ? 60 : 120;
  const narration = project.assets.find(a => a.id === project.audioAssetId);
  const waveform = narration?.waveform ?? [];
  const waveformPath = waveform.map((value, index) => `M${index * 1000 / Math.max(1, waveform.length - 1)} ${17 - value * 14}v${Math.max(0.3, value * 28)}`).join('');
  const seek = (event: React.MouseEvent<HTMLDivElement>) => {const rect = event.currentTarget.getBoundingClientRect(); onSeek(Math.min(project.durationInFrames - 1, Math.max(0, Math.round((event.clientX - rect.left) / px * fps))));};
  return <section className="pane timeline-pane" aria-label="타임라인">
    <div className="timeline-labels"><div className="timeline-zoom"><button className="icon-button" aria-label="타임라인 축소" onClick={() => setZoom(Math.max(1, zoom / 1.5))}><ZoomOut size={13}/></button><button className="icon-button" aria-label="타임라인 확대" onClick={() => setZoom(Math.min(20, zoom * 1.5))}><ZoomIn size={13}/></button></div><span/><span><Film size={13}/>비디오</span><span><Mic size={13}/>나레이션</span><span><Type size={13}/>자막</span></div>
    <div className="timeline-scroll" ref={scroll}><div className="timeline-content" style={{width}}>
      <div className="timeline-ruler" onClick={seek}>{Array.from({length: Math.floor(duration / tick) + 1}, (_, index) => <span key={index} style={{left: index * tick * px}}>{formatTime(index * tick)}</span>)}</div>
      <div className="chapter-track" onClick={seek}>{chapterRuns(project).map(run => {const {chapter, scenes} = run; const first = scenes[0]; const last = scenes[scenes.length - 1]; return <div className={`chapter-block chapter-color-${(run.ordinal - 1) % 3}`} key={run.key} style={{left: first.startFrame / fps * px, width: (last.startFrame + last.durationInFrames - first.startFrame) / fps * px}}>{String(run.ordinal).padStart(2, '0')}&nbsp; {chapter.title}{run.continued ? ' · 이어짐' : ''}</div>;})}</div>
      <div className="scene-track" onClick={seek}>{project.scenes.map((scene, index) => <button key={scene.id} className={`timeline-scene ${scene.id === selectedId ? 'selected' : ''}`} style={{left: scene.startFrame / fps * px, width: Math.max(3, scene.durationInFrames / fps * px - 2)}} onClick={event => {event.stopPropagation(); onSelect(scene.id); onSeek(scene.startFrame);}} title={scene.title} aria-label={`타임라인 ${index + 1}번 장면`}>
        {scene.durationInFrames / fps * px > 95 && <SceneThumb scene={scene} project={project}/>}<span><strong>{String(index + 1).padStart(2, '0')} {scene.title}</strong><small>{formatTime(scene.durationInFrames / fps)}</small></span>
      </button>)}</div>
      <div className="audio-track" onClick={seek}>{narration ? <><svg viewBox="0 0 1000 34" preserveAspectRatio="none" aria-label="나레이션 파형"><path d={waveformPath || 'M0 17H1000'} stroke="currentColor" strokeWidth={waveform.length > 300 ? '0.5' : '1'} fill="none"/></svg><span className="audio-track-name">{narration.name}</span></> : <span className="empty-track">소스 준비에서 나레이션을 가져오세요</span>}</div>
      <div className="subtitle-track" onClick={seek}>{project.captions.map(caption => <div className="timeline-caption" key={caption.id} style={{left: caption.startFrame / fps * px, width: Math.max(2, (caption.endFrame - caption.startFrame) / fps * px - 2)}} title={caption.text}>{caption.text}</div>)}</div>
      <div className="timeline-playhead" style={{left: frame / fps * px}}><span>{formatTime(frame / fps)}</span><i/></div>
    </div></div>
  </section>;
}
