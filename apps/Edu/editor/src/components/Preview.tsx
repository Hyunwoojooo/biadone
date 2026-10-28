import {useEffect, useRef, useState} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Maximize, Scan} from 'lucide-react';
import type {Project} from '../shared/types';
import {VideoComposition} from '../video/Composition';
import {formatTime} from '../domain/project';

export function Preview({project, playerRef, frame, onFrame, assetBaseUrl}: {project: Project; playerRef: React.RefObject<PlayerRef|null>; frame: number; onFrame: (frame: number) => void; assetBaseUrl?: string}) {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [guides, setGuides] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const frameCallback = useRef(onFrame);
  frameCallback.current = onFrame;
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    let last = -1;
    const update = (event: {detail: {frame: number}}) => {if (event.detail.frame % 3 === 0 || Math.abs(event.detail.frame - last) > 3) {last = event.detail.frame; frameCallback.current(event.detail.frame);}};
    const play = () => {setPlaying(true);};
    const pause = () => {setPlaying(false); frameCallback.current(player.getCurrentFrame());};
    player.addEventListener('frameupdate', update); player.addEventListener('play', play); player.addEventListener('pause', pause); player.addEventListener('ended', pause);
    return () => {player.removeEventListener('frameupdate', update); player.removeEventListener('play', play); player.removeEventListener('pause', pause); player.removeEventListener('ended', pause);};
  }, [playerRef, project.id]);

  const jump = (direction: number) => {
    const index = project.scenes.findIndex(s => frame >= s.startFrame && frame < s.startFrame + s.durationInFrames);
    const target = project.scenes[Math.min(project.scenes.length - 1, Math.max(0, index + direction))];
    playerRef.current?.seekTo(target.startFrame); onFrame(target.startFrame);
  };
  return <section className="pane preview-pane" ref={container} aria-label="영상 미리보기">
    <header className="pane-heading"><div className="inline"><h2>미리보기</h2><span className="muted small">{project.settings.width} × {project.settings.height} · {project.settings.fps} fps</span></div><div className="button-group"><button className={`icon-button ${guides ? 'active' : ''}`} title="안전 영역 표시" aria-label="안전 영역 표시" aria-pressed={guides} onClick={() => setGuides(!guides)}><Scan size={16}/></button><button className="icon-button" aria-label="미리보기 전체 화면" onClick={() => {void container.current?.requestFullscreen();}}><Maximize size={15}/></button></div></header>
    <div className="preview-stage"><div className="video-frame">
      <Player key={project.id} ref={playerRef} component={VideoComposition} inputProps={{project, assetBaseUrl: assetBaseUrl ?? `${window.location.origin}/api/projects/${project.id}/assets`, showGuides: guides}}
        durationInFrames={project.durationInFrames} compositionWidth={project.settings.width} compositionHeight={project.settings.height} fps={project.settings.fps}
        controls={false} style={{width: '100%', height: '100%'}} clickToPlay doubleClickToFullscreen={false} acknowledgeRemotionLicense />
    </div></div>
    <div className="player-controls">
      <input className="seek-range" type="range" min="0" max={Math.max(1, project.durationInFrames - 1)} value={Math.min(frame, project.durationInFrames - 1)} aria-label="재생 위치" onChange={event => {const next = Number(event.target.value); playerRef.current?.seekTo(next); onFrame(next);}} style={{'--progress': `${frame / project.durationInFrames * 100}%`} as React.CSSProperties}/>
      <div className="player-control-row"><span className="player-spacer"/><div className="playback-buttons"><button className="icon-button" aria-label="이전 장면" onClick={() => jump(-1)}><SkipBack size={17} fill="currentColor"/></button><button className="play-button" aria-label={playing ? '일시 정지' : '재생'} onClick={() => playerRef.current?.toggle()}>{playing ? <Pause size={24} fill="currentColor"/> : <Play size={24} fill="currentColor"/>}</button><button className="icon-button" aria-label="다음 장면" onClick={() => jump(1)}><SkipForward size={17} fill="currentColor"/></button><span className="timecode" aria-live="off">{formatTime(frame / project.settings.fps)} <span>/ {formatTime(project.durationInFrames / project.settings.fps)}</span></span></div><div className="volume-controls"><button className="icon-button" aria-label={muted ? '소리 켜기' : '음소거'} onClick={() => {if (muted) playerRef.current?.unmute(); else playerRef.current?.mute(); setMuted(!muted);}}>{muted ? <VolumeX size={17}/> : <Volume2 size={17}/>}</button><input type="range" aria-label="미리보기 음량" min="0" max="1" step="0.05" defaultValue="1" onChange={event => playerRef.current?.setVolume(Number(event.target.value))}/><span className="fit-label">화면 맞춤</span></div></div>
    </div>
  </section>;
}
