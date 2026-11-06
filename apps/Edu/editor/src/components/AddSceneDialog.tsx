import {useMemo, useState} from 'react';
import {CircleAlert, Plus} from 'lucide-react';
import type {EditorCommand, Project, Scene} from '../shared/types';
import {applyCommand, formatTime} from '../domain/project';
import {Dialog} from './Dialog';
import {sceneKinds} from './SceneKinds';

export type AddSceneCommand = Extract<EditorCommand, {type: 'addScene'}>;

export function AddSceneDialog({project, chapterId, selected, onAdd, onClose, onSource}: {
  project: Project; chapterId: string; selected: Scene; onAdd: (command: AddSceneCommand) => boolean; onClose: () => void; onSource: () => void;
}) {
  const captions = useMemo(() => [...project.captions].sort((a, b) => a.startFrame - b.startFrame), [project.captions]);
  const initial = captions.find(caption => caption.startFrame >= selected.startFrame + selected.durationInFrames)
    ?? captions.find(caption => caption.endFrame > selected.startFrame) ?? captions[0];
  const [chapter, setChapter] = useState(chapterId);
  const [first, setFirst] = useState(initial?.id ?? '');
  const [last, setLast] = useState(initial?.id ?? '');
  const [kind, setKind] = useState('');
  const [requirements, setRequirements] = useState('');
  const [submitError, setSubmitError] = useState('');
  const firstIndex = captions.findIndex(caption => caption.id === first);
  const lastIndex = captions.findIndex(caption => caption.id === last);
  const validation = useMemo(() => {
    if (!first || !last) return {error: '', scene: null};
    try {
      const next = applyCommand(project, {type: 'addScene', chapterId: chapter, firstCaptionId: first, lastCaptionId: last, idSeed: 'dialog-preview'});
      const before = new Set(project.scenes.map(scene => scene.id));
      const start = project.captions.find(caption => caption.id === first)!.startFrame;
      const end = project.captions.find(caption => caption.id === last)!.endFrame;
      return {error: '', scene: next.scenes.find(scene => !before.has(scene.id) && scene.startFrame <= start && scene.startFrame + scene.durationInFrames >= end) ?? null};
    } catch (error) {return {error: error instanceof Error ? error.message : '문장 구간을 확인해 주세요.', scene: null};}
  }, [project, chapter, first, last]);
  const selectedCaptions = firstIndex >= 0 && lastIndex >= firstIndex ? captions.slice(firstIndex, lastIndex + 1) : [];

  return <Dialog title="장면 추가" onClose={onClose} wide>
    <div className="dialog-body add-scene-dialog">
      <p className="add-scene-intro">대본에서 이 장면에 담을 문장을 선택하세요. 선택한 구간을 하나의 장면으로 묶습니다.</p>
      <label className="field"><span className="field-label">챕터</span><select aria-label="새 장면 챕터" value={chapter} onChange={event => setChapter(event.target.value)}>{project.chapters.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      {captions.length ? <>
        <div className="narration-range-fields">
          <label className="field"><span className="field-label">처음 문장</span><select aria-label="처음 문장" value={first} onChange={event => {setFirst(event.target.value); if (captions.findIndex(caption => caption.id === event.target.value) > lastIndex) setLast(event.target.value);}}>{captions.map((caption, index) => <option key={caption.id} value={caption.id}>{index + 1}. {formatTime(caption.startFrame / project.settings.fps)} · {caption.text}</option>)}</select></label>
          <label className="field"><span className="field-label">마지막 문장</span><select aria-label="마지막 문장" value={last} onChange={event => setLast(event.target.value)}>{captions.map((caption, index) => <option key={caption.id} value={caption.id} disabled={index < firstIndex}>{index + 1}. {formatTime(caption.endFrame / project.settings.fps)} · {caption.text}</option>)}</select></label>
        </div>
        <div className="narration-range-preview"><div><strong>선택한 나레이션</strong><span>{selectedCaptions.length}문장{validation.scene ? ` · ${(validation.scene.durationInFrames / project.settings.fps).toFixed(1)}초` : ''}</span></div><p>{selectedCaptions.map(caption => caption.text).join(' ')}</p></div>
        <label className="field"><span className="field-label">화면 유형</span><select aria-label="새 장면 화면 유형" value={kind} onChange={event => setKind(event.target.value)}><option value="">AI가 선택</option>{sceneKinds.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="field"><span className="field-label">필수 요구사항</span><textarea aria-label="새 장면 필수 요구사항" rows={3} maxLength={4000} value={requirements} onChange={event => setRequirements(event.target.value)} placeholder="예: 예약 → 재고 → 정산 순서로 등장하고 마지막에 하나의 대시보드로 모이게."/><span className="field-count">{requirements.length}/4000</span></label>
        <p className="small muted">녹음과 자막의 순서·시간은 유지합니다. 선택한 구간의 기존 화면 구성은 새 장면으로 바뀌며, 수정 이력에서 되돌릴 수 있습니다.</p>
      </> : <div className="inline-info"><CircleAlert size={16}/>먼저 소스 준비에서 녹음의 자막을 만들거나 시간 정보가 있는 대본을 가져오세요.</div>}
      {(validation.error || submitError) && <p className="dialog-error" role="alert">{validation.error || submitError}</p>}
      <div className="dialog-footer"><button className="secondary-button" onClick={onClose}>닫기</button>{captions.length ? <button className="primary-button" disabled={!validation.scene || !!validation.error} onClick={() => {
        const command: AddSceneCommand = {type: 'addScene', chapterId: chapter, firstCaptionId: first, lastCaptionId: last, preferredKind: kind ? kind as NonNullable<Scene['preferredKind']> : null, requirements};
        if (onAdd(command)) onClose(); else setSubmitError('저장 상태를 확인한 뒤 다시 추가해 주세요.');
      }}><Plus size={15}/>장면 추가</button> : <button className="primary-button" onClick={() => {onClose(); onSource();}}>소스 준비로</button>}</div>
    </div>
  </Dialog>;
}
