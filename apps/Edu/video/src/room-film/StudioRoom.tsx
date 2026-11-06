import {memo, useEffect, useLayoutEffect, useMemo, useState} from 'react';
import {useThree, type ThreeElements} from '@react-three/fiber';
import {loadFont} from '@remotion/fonts';
import {cancelRender, continueRender, delayRender, staticFile} from 'remotion';
import {BoxGeometry, CanvasTexture, EdgesGeometry, LinearFilter, SRGBColorSpace} from 'three';

type Vec3 = [number, number, number];
type Role = 'plan' | 'make' | 'review';
type ArtKey = 'sign' | 'team-board' | 'planning-board' | 'template-board' | 'coffee' | 'paper' | `${Role}-${0 | 1 | 2}`;
type TextureSet = Record<ArtKey, CanvasTexture>;

const C = {
  ink: '#242626', white: '#fffefa', wall: '#fcfcf8', floor: '#efeee7',
  blue: '#3437ee', paleBlue: '#dfe8fa', yellow: '#f2edcf', wood: '#e5ddcb',
  green: '#71846e', blush: '#ecd8cf', muted: '#c7ccc9',
};
const FONT = 'Room Film Set Labels';
const fontReady = loadFont({family: FONT, url: staticFile('fonts/PretendardVariable.woff2'), format: 'woff2', weight: '100 900'});
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Major surfaces have one shared-shape edge outline; small legs/books do not. */
const InkBox = memo(function InkBox({position = [0, 0, 0], size, rotation, color = C.white, outline = true, castShadow = true, receiveShadow = true}: {
  position?: Vec3; size: Vec3; rotation?: Vec3; color?: string; outline?: boolean; castShadow?: boolean; receiveShadow?: boolean;
}) {
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), []);
  const edges = useMemo(() => outline ? new EdgesGeometry(geometry) : null, [geometry, outline]);
  useEffect(() => () => {geometry.dispose(); edges?.dispose();}, [geometry, edges]);
  return <group position={position} rotation={rotation} scale={size}>
    <mesh geometry={geometry} castShadow={castShadow} receiveShadow={receiveShadow}>
      <meshStandardMaterial color={color} roughness={1} metalness={0}/>
    </mesh>
    {edges ? <lineSegments geometry={edges}><lineBasicMaterial color={C.ink}/></lineSegments> : null}
  </group>;
});

const TexturePlane = ({texture, position, width, height, rotation = [0, 0, 0]}: {
  texture?: CanvasTexture; position: Vec3; width: number; height: number; rotation?: Vec3;
}) => <mesh position={position} rotation={rotation}>
  <planeGeometry args={[width, height]}/>
  <meshBasicMaterial key={texture?.uuid ?? 'empty'} color={texture ? '#fff' : C.white} map={texture ?? null} toneMapped={false}/>
</mesh>;

const text = (ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size = 37, weight = 650, color = C.ink) => {
  ctx.font = `${weight} ${size}px "${FONT}", sans-serif`;
  ctx.fillStyle = color; ctx.fillText(value, x, y);
};
const line = (ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, width = 4, color = C.ink) => {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
};
const rect = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill = C.white, border = true) => {
  ctx.fillStyle = fill; ctx.fillRect(x, y, width, height);
  if (border) {ctx.lineWidth = 4; ctx.strokeStyle = C.ink; ctx.strokeRect(x, y, width, height);}
};
const check = (ctx: CanvasRenderingContext2D, x: number, y: number, size = 30) => {
  ctx.beginPath(); ctx.moveTo(x, y + size * .45); ctx.lineTo(x + size * .34, y + size * .82); ctx.lineTo(x + size, y);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
};
function drawCoffee(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.lineWidth = 5; ctx.strokeStyle = C.ink; ctx.fillStyle = C.yellow;
  ctx.beginPath(); ctx.moveTo(20, 30); ctx.lineTo(31, 126); ctx.quadraticCurveTo(92, 148, 145, 125); ctx.lineTo(157, 30); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(88, 30, 69, 17, 0, 0, Math.PI * 2); ctx.fillStyle = C.white; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(168, 77, 27, 35, 0, -Math.PI / 2, Math.PI / 2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(88, 151, 91, 12, 0, 0, Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(63, 5); ctx.bezierCurveTo(43, -17, 83, -27, 65, -45); ctx.moveTo(107, 4); ctx.bezierCurveTo(86, -18, 127, -27, 109, -46); ctx.stroke();
  ctx.restore();
}

/** The complete low-density label/screen atlas is drawn once after font loading. */
function makeTexture(key: ArtKey): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = key === 'sign' ? 896 : key === 'coffee' || key === 'paper' ? 512 : 768;
  canvas.height = key === 'sign' ? 200 : key === 'coffee' ? 640 : key === 'paper' ? 576 : 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Room set textures require a 2D canvas context.');
  ctx.fillStyle = C.white; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (key === 'sign') {
    text(ctx, '홍보 콘텐츠 제작실', 149, 87, 64, 760);
    text(ctx, '기획 · 제작 · 검수', 255, 155, 36, 600);
  } else if (key === 'team-board') {
    text(ctx, '하나의 상품이 콘텐츠로', 42, 103, 61, 750);
    line(ctx, 43, 141, 719, 141);
    ['기획', '제작', '검수'].forEach((label, index) => {
      rect(ctx, 43 + index * 235, 205, 209, 126, index === 1 ? C.paleBlue : C.yellow);
      text(ctx, label, 88 + index * 235, 285, 50, 720);
      if (index < 2) {line(ctx, 257 + index * 235, 267, 273 + index * 235, 267);}
    });
    text(ctx, '만들고, 확인하고, 다시 쓰기', 72, 417, 39, 590);
  } else if (key === 'planning-board') {
    text(ctx, '이번 주 콘텐츠', 44, 83, 56, 720);
    rect(ctx, 45, 124, 310, 136, C.yellow); rect(ctx, 390, 124, 330, 136, C.paleBlue);
    text(ctx, '누구에게?', 75, 206, 45); text(ctx, '무엇을 알릴까?', 417, 206, 39);
    line(ctx, 49, 302, 717, 302);
    text(ctx, '상품 · 고객 · 제목', 75, 374, 43, 690);
    text(ctx, '질문을 먼저 정리합니다.', 75, 436, 32, 540);
  } else if (key === 'template-board') {
    text(ctx, '우리 브랜드의 기준', 43, 89, 54, 730);
    rect(ctx, 46, 137, 147, 98, C.blue); rect(ctx, 213, 137, 147, 98, C.paleBlue); rect(ctx, 380, 137, 147, 98, C.yellow);
    text(ctx, '가나다', 48, 331, 80, 760);
    text(ctx, '색상 · 글꼴 · 말투', 48, 420, 40, 580);
    check(ctx, 594, 148, 74);
  } else if (key === 'coffee') {
    text(ctx, '골목 커피', 126, 106, 58, 750);
    drawCoffee(ctx, 137, 238, 1.25);
    text(ctx, '드립백 세트', 90, 565, 56, 690);
  } else if (key === 'paper') {
    text(ctx, '상품 소개 초안', 37, 80, 42, 700);
    line(ctx, 37, 121, 473, 121);
    [184, 254, 324, 394].forEach((y, index) => line(ctx, 37, y, index === 3 ? 311 : 473, y, 3));
    check(ctx, 379, 464, 60);
  } else {
    const [role, stepString] = key.split('-');
    const step = Number(stepString);
    if (role === 'plan') {
      text(ctx, '기획', 37, 66, 45, 760); text(ctx, '제목과 썸네일', 207, 65, 32, 610);
      line(ctx, 38, 91, 728, 91);
      ['누가 볼까?', '첫 문장은 짧게', '썸네일 한 장'].forEach((label, index) => {
        rect(ctx, 42, 125 + index * 99, 675, 77, index === step ? C.yellow : C.white);
        text(ctx, label, 75, 177 + index * 99, 36, index === step ? 760 : 540);
        if (index < step) check(ctx, 649, 144 + index * 99, 30);
      });
    } else if (role === 'make') {
      text(ctx, '제작', 36, 66, 45, 760); text(ctx, '브랜드 템플릿', 204, 65, 32, 610);
      line(ctx, 38, 91, 728, 91);
      rect(ctx, 45, 120, 395, 313, step === 1 ? C.yellow : C.paleBlue);
      text(ctx, step === 2 ? '오늘도, 좋은 한 잔.' : '좋은 커피 한 잔.', 66, 170, 34, 760);
      drawCoffee(ctx, 139, 233, .99);
      [C.blue, C.paleBlue, C.yellow].forEach((color, index) => rect(ctx, 487 + index * 75, 136, 57, 52, color));
      text(ctx, '문구', 487, 263, 33, 650); text(ctx, '사진', 487, 327, 33, 650); text(ctx, '배치', 487, 390, 33, 650);
      if (step > 0) check(ctx, 649, 239, 27);
      if (step === 2) check(ctx, 649, 367, 27);
    } else {
      text(ctx, '검수', 37, 66, 45, 760); text(ctx, '결과를 다시 확인', 204, 65, 32, 610);
      line(ctx, 38, 91, 728, 91);
      ['상품 정보 확인', '가격·표현 확인', '사장님 승인 대기'].forEach((label, index) => {
        rect(ctx, 43, 137 + index * 103, 41, 41, C.white);
        text(ctx, label, 115, 170 + index * 103, 36, index === 2 ? 710 : 590);
        if (index <= step && index < 2) check(ctx, 44, 137 + index * 103, 39);
      });
      if (step === 2) {ctx.strokeStyle = C.blue; ctx.lineWidth = 5; ctx.strokeRect(101, 321, 578, 80);}
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; texture.minFilter = LinearFilter; texture.magFilter = LinearFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  return texture;
}

function useTextures() {
  const advance = useThree(state => state.advance);
  const [textures, setTextures] = useState<TextureSet | null>(null);
  const [handle] = useState(() => delayRender('Prepare studio labels and monitor artwork'));
  useEffect(() => {
    let active = true;
    let owned: TextureSet | null = null;
    void fontReady.then(() => {
      if (!active) return;
      const keys: ArtKey[] = ['sign', 'team-board', 'planning-board', 'template-board', 'coffee', 'paper', 'plan-0', 'plan-1', 'plan-2', 'make-0', 'make-1', 'make-2', 'review-0', 'review-1', 'review-2'];
      owned = Object.fromEntries(keys.map(key => [key, makeTexture(key)])) as TextureSet;
      setTextures(owned);
    }).catch(error => {if (active) cancelRender(error);});
    return () => {active = false; Object.values(owned ?? {}).forEach(texture => texture.dispose()); continueRender(handle);};
  }, [handle]);
  useLayoutEffect(() => {
    if (!textures) return;
    // ThreeCanvas uses frameloop="never". Loading canvas maps changes React
    // state without changing the video frame, so its frame effect will not draw
    // this commit. Render the committed, freshly keyed materials before capture.
    Object.values(textures).forEach(texture => {texture.needsUpdate = true;});
    try {
      advance(performance.now());
      continueRender(handle);
    } catch (error) {
      cancelRender(error);
    }
  }, [advance, handle, textures]);
  return textures;
}

const Shell = memo(function Shell() {
  return <group>
    <InkBox position={[0, -.09, -2]} size={[12.2, .18, 12.2]} color={C.floor}/>
    {/* The room slab already reaches z=4.1; this joins it without coplanar
        overlap, giving the entrance corridor a continuous y=0 floor to z=12. */}
    <InkBox position={[0, -.09, 8.05]} size={[12, .18, 7.9]} color={C.floor} outline={false}/>
    <InkBox position={[0, 2.15, -8]} size={[12.15, 4.3, .16]} color={C.wall}/>
    <InkBox position={[-6, 2.15, -2]} size={[.16, 4.3, 12]} color={C.wall}/>
    <InkBox position={[6, 2.15, -2]} size={[.16, 4.3, 12]} color={C.wall}/>
    {/* Entry remains genuinely open between x=-1.1 and x=1.1, y=0..3.5. */}
    <InkBox position={[-3.55, 2.15, 4]} size={[4.9, 4.3, .16]} color={C.wall}/>
    <InkBox position={[3.55, 2.15, 4]} size={[4.9, 4.3, .16]} color={C.wall}/>
    <InkBox position={[0, 3.9, 4]} size={[2.2, .8, .16]} color={C.wall}/>
    <InkBox position={[-1.16, 1.76, 4.01]} size={[.12, 3.52, .23]} color={C.paleBlue}/>
    <InkBox position={[1.16, 1.76, 4.01]} size={[.12, 3.52, .23]} color={C.paleBlue}/>
    <InkBox position={[0, 3.56, 4.01]} size={[2.44, .12, .23]} color={C.paleBlue}/>
    {/* Restrained baseboards, no added decorative shadow geometry or grid. */}
    <InkBox position={[0, .09, -7.88]} size={[11.8, .16, .06]} color={C.wood} outline={false}/>
    <InkBox position={[-5.88, .09, -2]} size={[.06, .16, 11.7]} color={C.wood} outline={false}/>
    <InkBox position={[5.88, .09, -2]} size={[.06, .16, 11.7]} color={C.wood} outline={false}/>
    {/* Back window is painted flat blue, without glass emission or a sky gradient. */}
    <InkBox position={[-3.8, 2.63, -7.86]} size={[2.35, 1.82, .07]} color={C.paleBlue}/>
    <InkBox position={[-3.8, 2.63, -7.805]} size={[.045, 1.82, .025]} color={C.ink} outline={false}/>
    <InkBox position={[-3.8, 2.63, -7.805]} size={[2.35, .045, .025]} color={C.ink} outline={false}/>
    <InkBox position={[-3.8, 1.69, -7.74]} size={[2.55, .07, .27]} color={C.white}/>
  </group>;
});

const Door = ({doorOpen, textures}: {doorOpen: number; textures: TextureSet | null}) => <group>
  <TexturePlane texture={textures?.sign} position={[0, 3.94, 4.091]} width={2.54} height={.57}/>
  {/* A negative Y rotation takes the left/free edge toward the interior (-z). */}
  <group position={[1.1, 0, 4]} rotation={[0, -clamp(doorOpen) * Math.PI * .49, 0]}>
    <InkBox position={[-1.05, 1.735, 0]} size={[2.1, 3.47, .105]} color={C.paleBlue}/>
    <InkBox position={[-1.05, 2.37, .06]} size={[1.46, 1.25, .025]} color={C.white}/>
    <InkBox position={[-1.05, 2.37, -.06]} size={[1.46, 1.25, .025]} color={C.white}/>
    <InkBox position={[-1.05, .54, .061]} size={[1.47, .47, .025]} color={C.yellow}/>
    {[-1, 1].map(side => <group key={side}>
      <InkBox position={[-1.74, 1.5, side * .085]} size={[.10, .28, .055]} color={C.ink} outline={false}/>
      <InkBox position={[-1.60, 1.57, side * .12]} size={[.33, .065, .07]} color={C.ink} outline={false}/>
    </group>)}
  </group>
</group>;

const Chair = memo(function Chair({x, z}: {x: number; z: number}) {
  return <group position={[x, 0, z]}>
    <InkBox position={[0, .56, 0]} size={[.76, .1, .72]} color={C.paleBlue}/>
    <InkBox position={[0, 1.04, .34]} size={[.76, .87, .09]} color={C.paleBlue}/>
    {[-.29, .29].flatMap(dx => [-.25, .25].map(dz => <InkBox key={`${dx}-${dz}`} position={[dx, .27, dz]} size={[.055, .5, .055]} color={C.ink} outline={false}/>))}
  </group>;
});

const DeskBody = memo(function DeskBody({x, z}: {x: number; z: number}) {
  return <group position={[x, 0, z]}>
    <InkBox position={[0, 1.05, 0]} size={[2.6, .12, 1.3]} color={C.wood}/>
    {[-1.08, 1.08].flatMap(dx => [-.43, .43].map(dz => <InkBox key={`${dx}-${dz}`} position={[dx, .5, dz]} size={[.075, .98, .075]} color={C.white} outline={false}/>))}
    <InkBox position={[0, .8, -.49]} size={[2.20, .08, .07]} color={C.muted} outline={false}/>
    <InkBox position={[0, 1.137, .25]} size={[.85, .045, .27]} color={C.white}/>
    <InkBox position={[.68, 1.142, .28]} size={[.16, .05, .21]} color={C.paleBlue}/>
  </group>;
});

const Monitor = ({position, texture, progress, caret}: {position: Vec3; texture?: CanvasTexture; progress: number; caret: boolean}) => <group position={position}>
  <InkBox position={[0, 1.14, -.32]} size={[.56, .045, .32]} color={C.muted}/>
  <InkBox position={[0, 1.38, -.36]} size={[.075, .45, .075]} color={C.muted} outline={false}/>
  <InkBox position={[0, 1.88, -.32]} size={[1.5, 1.01, .12]} color={C.ink}/>
  {/* PlaneGeometry's normal is +z: an Agent facing -z sees this front surface. */}
  <TexturePlane texture={texture} position={[0, 1.88, -.252]} width={1.35} height={.845}/>
  <InkBox position={[-.60 + progress * .51, 1.475, -.242]} size={[Math.max(.025, progress * 1.02), .017, .006]} color={C.blue} outline={false} castShadow={false} receiveShadow={false}/>
  {caret ? <InkBox position={[.6, 1.52, -.24]} size={[.013, .045, .006]} color={C.ink} outline={false} castShadow={false}/> : null}
</group>;

const Workstation = ({role, x, z, frame, fps, phase, textures}: {
  role: Role; x: number; z: number; frame: number; fps: number; phase: number; textures: TextureSet | null;
}) => {
  const offset = role === 'plan' ? 0 : role === 'make' ? 1 : 2;
  const seconds = Math.max(0, frame) / Math.max(1, fps);
  const cycle = seconds / 3.8 + offset + clamp(phase) * .5;
  const step = (Math.floor(cycle) % 3) as 0 | 1 | 2;
  const progress = cycle - Math.floor(cycle);
  const sliding = .07 * Math.sin(seconds * 1.2 + offset);
  return <group>
    <DeskBody x={x} z={z}/>
    <Chair x={x} z={z + .95}/>
    <Monitor position={[x, 0, z]} texture={textures?.[`${role}-${step}`]} progress={progress} caret={Math.floor(seconds * 2) % 2 === 0}/>
    <InkBox position={[x - .89 + sliding, 1.125, z + .19]} size={[.42, .025, .47]} rotation={[0, -.12, 0]} color={C.white} outline={false}/>
    <TexturePlane texture={textures?.paper} position={[x - .89 + sliding, 1.14, z + .19]} width={.40} height={.45} rotation={[-Math.PI / 2, 0, -.12]}/>
    {role === 'make' ? <group>
      <InkBox position={[x + 1, 1.43, z - .17]} size={[.38, .62, .12]} rotation={[0, -.12, 0]} color={C.yellow}/>
      <TexturePlane texture={textures?.coffee} position={[x + 1.008, 1.43, z - .102]} width={.33} height={.52} rotation={[0, -.12, 0]}/>
    </group> : null}
  </group>;
};

const WallArtwork = ({textures}: {textures: TextureSet | null}) => <group>
  <InkBox position={[.48, 2.96, -7.85]} size={[3.90, 1.75, .07]} color={C.wood}/>
  <TexturePlane texture={textures?.['team-board']} position={[.48, 2.96, -7.807]} width={3.69} height={1.57}/>
  <InkBox position={[-5.86, 2.6, -3.6]} size={[.08, 1.61, 2.43]} color={C.wood}/>
  <TexturePlane texture={textures?.['planning-board']} position={[-5.811, 2.6, -3.6]} width={2.26} height={1.45} rotation={[0, Math.PI / 2, 0]}/>
  <InkBox position={[5.86, 2.62, -3.6]} size={[.08, 1.61, 2.43]} color={C.wood}/>
  <TexturePlane texture={textures?.['template-board']} position={[5.811, 2.62, -3.6]} width={2.26} height={1.45} rotation={[0, -Math.PI / 2, 0]}/>
  <InkBox position={[3.62, 2.85, -7.85]} size={[1.57, 1.97, .06]} color={C.white}/>
  <TexturePlane texture={textures?.coffee} position={[3.62, 2.85, -7.813]} width={1.44} height={1.83}/>
</group>;

const Shelf = memo(function Shelf() {
  return <group position={[5.08, 0, -6.87]}>
    {[-.58, .58].map(x => <InkBox key={x} position={[x, 1.08, 0]} size={[.065, 2.16, .48]} color={C.wood}/>)}
    {[.21, .91, 1.62, 2.14].map(y => <InkBox key={y} position={[0, y, 0]} size={[1.22, .065, .48]} color={C.wood}/>)}
    {[0, 1, 2, 3, 4].map(index => <InkBox key={index} position={[-.40 + index * .18, 1.2, .025]} size={[.13, .5 + index % 2 * .06, .31]} color={[C.paleBlue, C.white, C.yellow, C.blush, C.white][index]} outline={false}/>)}
    <InkBox position={[.10, .39, 0]} size={[.67, .27, .35]} color={C.white}/>
    <InkBox position={[.10, .4, .183]} size={[.24, .10, .01]} color={C.paleBlue} outline={false}/>
    <InkBox position={[-.11, 1.79, 0]} size={[.78, .18, .35]} color={C.paleBlue} outline={false}/>
  </group>;
});

const Plant = memo(function Plant() {
  const leafProps: ThreeElements['meshStandardMaterial'] = {color: C.green, roughness: 1, metalness: 0, flatShading: true};
  return <group position={[-5.13, 0, .62]}>
    <mesh position={[0, .3, 0]} castShadow receiveShadow><cylinderGeometry args={[.3, .21, .59, 12]}/><meshStandardMaterial color={C.wood} roughness={1}/></mesh>
    <InkBox position={[0, .86, 0]} size={[.035, .64, .035]} color={C.green} outline={false}/>
    <mesh position={[-.18, 1.02, 0]} rotation={[0, 0, .72]} scale={[.13, .38, .19]} castShadow><sphereGeometry args={[1, 10, 6]}/><meshStandardMaterial {...leafProps}/></mesh>
    <mesh position={[.18, 1.11, .02]} rotation={[0, 0, -.72]} scale={[.13, .39, .19]} castShadow><sphereGeometry args={[1, 10, 6]}/><meshStandardMaterial {...leafProps}/></mesh>
    <mesh position={[0, 1.29, -.04]} rotation={[.25, 0, .06]} scale={[.13, .31, .18]} castShadow><sphereGeometry args={[1, 10, 6]}/><meshStandardMaterial {...leafProps}/></mesh>
  </group>;
});

/** A continuous 3D set; its parent provides the camera, lighting, and characters. */
export const StudioRoom = ({frame, fps, doorOpen, phase}: {frame: number; fps: number; doorOpen: number; phase: number}) => {
  const textures = useTextures();
  return <group name="AI marketing studio">
    <Shell/>
    <Door doorOpen={doorOpen} textures={textures}/>
    <WallArtwork textures={textures}/>
    <Workstation role="plan" x={-3.3} z={-2} frame={frame} fps={fps} phase={phase} textures={textures}/>
    <Workstation role="make" x={0} z={-5.2} frame={frame} fps={fps} phase={phase} textures={textures}/>
    <Workstation role="review" x={3.3} z={-2} frame={frame} fps={fps} phase={phase} textures={textures}/>
    <Shelf/>
    <Plant/>
  </group>;
};
