import {ArrowRightLeft, CheckCheck, Columns2, Film, Hash, ImageIcon, ListOrdered, Quote, Type, UserRound, type LucideIcon} from 'lucide-react';
import type {SceneKind} from '../shared/types';

export const sceneKinds: {id: SceneKind; label: string; description: string; icon: LucideIcon}[] = [
  {id: 'title', label: '핵심 문구', description: '한 문장을 크게 보여줍니다.', icon: Type},
  {id: 'quote', label: '인용구 강조', description: '인상적인 말과 메시지를 강조합니다.', icon: Quote},
  {id: 'compare', label: '두 항목 비교', description: '두 선택의 차이를 나란히 보여줍니다.', icon: Columns2},
  {id: 'steps', label: '단계 설명', description: '순서에 맞춰 항목을 펼칩니다.', icon: ListOrdered},
  {id: 'list', label: '체크리스트', description: '기준과 핵심 항목을 정리합니다.', icon: CheckCheck},
  {id: 'stat', label: '수치 강조', description: '대본에 나온 숫자를 부각합니다.', icon: Hash},
  {id: 'flow', label: '흐름도', description: '입력부터 결과까지 연결합니다.', icon: ArrowRightLeft},
  {id: 'character', label: '캐릭터 설명', description: '기본 캐릭터가 설명을 이어갑니다.', icon: UserRound},
  {id: 'image', label: '실제 이미지', description: '가져온 이미지와 스크린샷을 씁니다.', icon: ImageIcon},
  {id: 'video', label: '실제 영상', description: '가져온 영상을 나레이션에 맞춥니다.', icon: Film},
];

export const kindLabel = (kind: SceneKind) => sceneKinds.find(item => item.id === kind)?.label ?? kind;

export function KindPreview({kind}: {kind: SceneKind}) {
  const item = sceneKinds.find(item => item.id === kind)!;
  return <span className={`kind-preview kind-${kind}`} aria-hidden="true">
    {kind === 'title' || kind === 'quote' ? <><small>{kind === 'quote' ? '“' : '핵심 메시지'}</small><b>{kind === 'title' ? <>좋은 영상은<br/>좋은 흐름에서</> : <>작업의 기준을<br/>먼저 정합니다.</>}</b></> :
      kind === 'steps' || kind === 'compare' || kind === 'flow' ? <><small>{kind === 'flow' ? '입력에서 결과까지' : '한눈에 이해하는 기준'}</small><span className="kind-cards">{Array.from({length: kind === 'compare' ? 2 : 3}, (_, index) => <i key={index}><b>{String(index + 1).padStart(2, '0')}</b><em>{['준비', '구성', '완성'][index]}</em></i>)}</span></> :
        kind === 'list' ? <><small>확인할 세 가지</small><span className="kind-checks">✓ 목적을 분명하게<br/>✓ 핵심만 간결하게<br/>✓ 같은 기준으로</span></> :
          kind === 'stat' ? <><small>핵심을 숫자로</small><b className="kind-number">60%</b></> : <><item.icon size={26}/><small>{kind === 'character' ? '같은 캐릭터와 이어서 설명' : kind === 'image' ? '내 이미지 · 스크린샷' : '내 영상 · 화면 녹화'}</small></>}
  </span>;
}
