import {Img, staticFile, useVideoConfig} from 'remotion';
import {fontFamily} from '../fonts';
import type {MapStageProps, Point, RoomId} from './types';

const WORLD_WIDTH = 1200;
const WORLD_HEIGHT = 900;
const ACTOR_WIDTH = 96;
const ACTOR_HEIGHT = 128;
const ACTOR_ANCHOR = ACTOR_HEIGHT * .97;
const SOURCE_CELL_WIDTH = 384;
const SOURCE_CELL_HEIGHT = 512;

// These are the final coordinates and labels from the original HTML campus.
const ROOMS: {id: RoomId; badge: string; title: string; ink: string; color: string; label: Point; portal: Point}[] = [
  {id: 'F', badge: '기초', title: '내 사업에 AI 적용하기', ink: '#2269bd', color: '#4589e8', label: {x: 640, y: 586}, portal: {x: 615, y: 780}},
  {id: 'A', badge: 'A', title: '홍보 콘텐츠', ink: '#13759f', color: '#35a4df', label: {x: 240, y: 270}, portal: {x: 400, y: 425}},
  {id: 'B', badge: 'B', title: '소개·문의 웹페이지', ink: '#7353b9', color: '#997be0', label: {x: 520, y: 58}, portal: {x: 560, y: 310}},
  {id: 'C', badge: 'C', title: '고객 문의 자동화', ink: '#b43f58', color: '#e17b8b', label: {x: 855, y: 65}, portal: {x: 755, y: 350}},
  {id: 'D', badge: 'D', title: '매출 분석·보고서', ink: '#a56423', color: '#e5aa65', label: {x: 1100, y: 492}, portal: {x: 895, y: 450}},
  {id: 'E', badge: 'E', title: '나만의 업무 도구', ink: '#277e5b', color: '#65b89b', label: {x: 1015, y: 753}, portal: {x: 850, y: 635}},
  {id: 'T', badge: '심화', title: 'AI 업무팀', ink: '#5d45a0', color: '#8c78ce', label: {x: 220, y: 560}, portal: {x: 405, y: 610}},
];

const DIRECTION_COLUMN = {down: 0, left: 1, right: 2, up: 3} as const;
// Coordinates inside each original 384×512 cell. Keeping this correction avoids
// the feet jumping sideways or vertically when the alternate walk row appears.
const FEET: Point[][] = [
  [{x: 221, y: 500}, {x: 192.3, y: 500}, {x: 193.3, y: 500}, {x: 181.6, y: 498}],
  [{x: 211.6, y: 470}, {x: 159.9, y: 466}, {x: 220.5, y: 465}, {x: 167.3, y: 469}],
];

const WORLD_IMAGE = staticFile('campus-tour/campus-world.png');
const VISITOR_IMAGE = staticFile('campus-tour/visitor-sprites.png');

/** Displays only the supplied map/camera/route state; the tour owns movement. */
export const MapStage = ({width, height, frame, position, facing, walking, camera, highlightRoom, showLabels = true, route = []}: MapStageProps) => {
  const {fps} = useVideoConfig();
  const scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT) * camera.zoom;
  const tx = width / 2 - camera.cx * scale;
  const ty = height / 2 - camera.cy * scale;
  const labelScale = 1 / scale;
  const column = DIRECTION_COLUMN[facing];
  // The browser original alternates rows every 180ms. Remotion uses frames only.
  const row = walking ? Math.floor(Math.max(0, frame) / (fps * .18)) % 2 : 0;
  const foot = FEET[row][column];
  const spriteX = ACTOR_WIDTH / 2 - foot.x / SOURCE_CELL_WIDTH * ACTOR_WIDTH;
  const spriteY = ACTOR_ANCHOR - foot.y / SOURCE_CELL_HEIGHT * ACTOR_HEIGHT;
  const routeInk = ROOMS.find(room => room.id === highlightRoom)?.ink ?? '#3437ee';

  return <div
    data-map-stage="campus-tour"
    role="img"
    aria-label="일곱 개 교육 공간과 방문 캐릭터가 있는 Biadon Edu 캠퍼스"
    style={{position: 'relative', width, height, overflow: 'hidden', isolation: 'isolate', backgroundColor: '#f7f7f3', fontFamily, color: '#222b32'}}
  >
    <div style={{position: 'absolute', left: 0, top: 0, width: WORLD_WIDTH, height: WORLD_HEIGHT, transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin: '0 0', isolation: 'isolate'}}>
      <Img src={WORLD_IMAGE} alt="" draggable={false} style={{position: 'absolute', inset: 0, width: WORLD_WIDTH, height: WORLD_HEIGHT, maxWidth: 'none', objectFit: 'fill', zIndex: 0}}/>

      {route.length > 1 ? <svg width={WORLD_WIDTH} height={WORLD_HEIGHT} viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`} aria-hidden="true" style={{position: 'absolute', inset: 0, overflow: 'visible', zIndex: 3}}>
        <polyline points={route.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={routeInk} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="7 9" opacity={.7} vectorEffect="non-scaling-stroke"/>
      </svg> : null}

      {ROOMS.map(room => {
        const highlighted = room.id === highlightRoom;
        return <div key={`portal-${room.id}`} data-map-portal={room.id} style={{position: 'absolute', left: room.portal.x, top: room.portal.y, width: highlighted ? 29 : 21, height: highlighted ? 29 : 21, border: `${highlighted ? 3 : 2}px solid ${room.ink}`, borderRadius: '50%', backgroundColor: highlighted ? room.color : '#fffffccc', transform: 'translate(-50%, -50%)', zIndex: 4}}/>;
      })}

      <div data-map-actor="visitor" data-facing={facing} data-walk-row={row} style={{position: 'absolute', left: position.x, top: position.y, width: ACTOR_WIDTH, height: ACTOR_HEIGHT, transform: 'translate(-50%, -97%)', zIndex: 6}}>
        {/* Cropping this Img is equivalent to the original 400%×200% background
            positioned at (column/3*100)% (row*100)%, while Img waits for decoding. */}
        <div style={{position: 'absolute', left: 0, top: 0, width: ACTOR_WIDTH, height: ACTOR_HEIGHT, overflow: 'hidden', transform: `translate(${spriteX}px, ${spriteY}px)`}}>
          <Img src={VISITOR_IMAGE} alt="" draggable={false} style={{position: 'absolute', left: -column * ACTOR_WIDTH, top: -row * ACTOR_HEIGHT, width: ACTOR_WIDTH * 4, height: ACTOR_HEIGHT * 2, maxWidth: 'none', objectFit: 'fill'}}/>
        </div>
      </div>

      {showLabels ? ROOMS.map(room => {
        const highlighted = room.id === highlightRoom;
        return <div key={`label-${room.id}`} data-map-label={room.id} style={{position: 'absolute', left: room.label.x, top: room.label.y, transform: `translate(-50%, -50%) scale(${labelScale})`, transformOrigin: 'center', display: 'flex', alignItems: 'center', gap: 9, minHeight: 52, maxWidth: 250, padding: '7px 11px 7px 7px', boxSizing: 'border-box', border: `${highlighted ? 2.3 : 1.3}px solid ${highlighted ? room.ink : '#222b32'}`, borderRadius: 8, backgroundColor: '#fffffc', whiteSpace: 'nowrap', zIndex: 8}}>
          <span style={{display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, minWidth: 36, height: 36, padding: '0 8px', boxSizing: 'border-box', borderRadius: 5, color: '#fff', backgroundColor: room.ink, fontSize: room.id === 'F' || room.id === 'T' ? 16 : 23, fontWeight: 750, letterSpacing: -.6, lineHeight: 1}}>{room.badge}</span>
          <span style={{fontSize: 16, lineHeight: 1.35, fontWeight: 700, letterSpacing: -.55}}>{room.title}</span>
        </div>;
      }) : null}
    </div>
  </div>;
};
