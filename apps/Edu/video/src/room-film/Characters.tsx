import {useMemo} from 'react';
import type {} from '@react-three/fiber';
import {
  BackSide,
  BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';

type Point = [number, number, number];
type Angles = [number, number, number];

export type ProtagonistProps = {
  frame: number;
  fps: number;
  position: Point;
  rotation?: number;
  walking?: boolean;
  opacity?: number;
};

export type StudioAgentProps = {
  frame: number;
  fps: number;
  index: number;
  position: Point;
  rotation?: number;
  role: 'plan' | 'make' | 'review';
};

const OUTLINE = '#222326';
const WHITE = '#f4f3ec';
const HAIR = '#302927';
const SKIN = '#e3bda3';
const TAU = Math.PI * 2;
const UP = new Vector3(0, 1, 0);
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const smooth = (value: number) => { const p = clamp(value); return p * p * (3 - 2 * p); };
const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;
const mixPoint = (a: Point, b: Point, amount: number): Point => [mix(a[0], b[0], amount), mix(a[1], b[1], amount), mix(a[2], b[2], amount)];

/** Beveled extrusions give clothes and heads a continuous silhouette, rather than stacked balls. */
const roundedBox = (width: number, height: number, depth: number, radius: number) => {
  const bevel = Math.min(radius, width / 4, height / 4, depth / 3);
  const left = -width / 2 + bevel;
  const right = width / 2 - bevel;
  const bottom = -height / 2 + bevel;
  const top = height / 2 - bevel;
  const corner = Math.min(bevel * .7, (right - left) / 4, (top - bottom) / 4);
  const shape = new Shape();
  shape.moveTo(left + corner, bottom);
  shape.lineTo(right - corner, bottom);
  shape.quadraticCurveTo(right, bottom, right, bottom + corner);
  shape.lineTo(right, top - corner);
  shape.quadraticCurveTo(right, top, right - corner, top);
  shape.lineTo(left + corner, top);
  shape.quadraticCurveTo(left, top, left, top - corner);
  shape.lineTo(left, bottom + corner);
  shape.quadraticCurveTo(left, bottom, left + corner, bottom);
  const geometry = new ExtrudeGeometry(shape, {
    depth: depth - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 5,
    steps: 1,
  });
  geometry.center();
  return geometry;
};

const torsoGeometry = (width: number, height: number, depth: number) => {
  const shape = new Shape();
  const w = width / 2;
  const h = height / 2;
  shape.moveTo(-w * .74, -h);
  shape.quadraticCurveTo(0, -h * 1.04, w * .74, -h);
  shape.lineTo(w * .86, h * .44);
  shape.quadraticCurveTo(w * .93, h * .72, w * .68, h * .85);
  shape.lineTo(w * .34, h);
  shape.quadraticCurveTo(0, h * 1.055, -w * .34, h);
  shape.lineTo(-w * .68, h * .85);
  shape.quadraticCurveTo(-w * .93, h * .72, -w * .86, h * .44);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, {
    depth: depth - .066,
    bevelEnabled: true,
    bevelSize: .033,
    bevelThickness: .033,
    bevelSegments: 3,
    curveSegments: 8,
    steps: 1,
  });
  geometry.center();
  return geometry;
};

const hairPoint = (phi: number, fraction: number, expand = 1): Point => {
  const frontness = (Math.cos(phi) + 1) / 2;
  const border = 2.15 - frontness + Math.sin(phi * 3 + .3) * .065;
  const theta = fraction * border;
  const wave = 1 + .033 * Math.cos(phi * 5 + .3) * Math.sin(theta) ** 3
    + .016 * Math.sin(theta * 4 + phi * 2);
  return [
    Math.sin(theta) * Math.sin(phi) * .218 * wave * expand,
    Math.cos(theta) * .251 * wave * expand,
    Math.sin(theta) * Math.cos(phi) * .198 * wave * expand,
  ];
};

const hairCapGeometry = () => {
  const columns = 36;
  const rows = 16;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      positions.push(...hairPoint(column / columns * TAU, row / rows));
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + columns + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};

const hairSeamsGeometry = () => {
  const positions: number[] = [];
  // Quiet curved seams through the back and sides make the rear silhouette read as hair.
  [-2.5, -1.85, -1.1, .96, 1.7, 2.43, 3.05].forEach((phi) => {
    for (let part = 0; part < 10; part += 1) {
      const start = .23 + part * .058;
      positions.push(...hairPoint(phi + Math.sin(start * 3) * .10, start, 1.007));
      positions.push(...hairPoint(phi + Math.sin((start + .058) * 3) * .10, start + .058, 1.007));
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
};

const hairLockGeometry = () => {
  const shape = new Shape();
  shape.moveTo(-.085, .09);
  shape.bezierCurveTo(-.025, .175, .105, .08, .069, -.025);
  shape.quadraticCurveTo(.045, -.09, -.015, -.145);
  shape.quadraticCurveTo(.002, -.085, -.063, -.08);
  shape.quadraticCurveTo(-.117, -.025, -.085, .09);
  const geometry = new ExtrudeGeometry(shape, {
    depth: .025, bevelEnabled: true, bevelSize: .012, bevelThickness: .012,
    bevelSegments: 2, curveSegments: 7, steps: 1,
  });
  geometry.center();
  return geometry;
};

type OutlinedProps = {
  geometry: BufferGeometry;
  color: string;
  position?: Point;
  rotation?: Angles;
  scale?: Point;
  opacity?: number;
  outline?: number;
};

const Outlined = ({geometry, color, position, rotation, scale = [1, 1, 1], opacity = 1, outline = 1.025}: OutlinedProps) => (
  <group position={position} rotation={rotation} scale={scale}>
    <mesh geometry={geometry} scale={outline}>
      <meshBasicMaterial color={OUTLINE} side={BackSide} transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 1} />
    </mesh>
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshToonMaterial color={color} transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 1} />
    </mesh>
  </group>
);

const Bone = ({from, to, radius = .055, color, opacity = 1}: {from: Point; to: Point; radius?: number; color: string; opacity?: number}) => {
  const geometry = useMemo(() => new CylinderGeometry(radius * .91, radius, 1, 10), [radius]);
  const direction = new Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const length = direction.length();
  const rotation = new Quaternion().setFromUnitVectors(UP, direction.normalize());
  const center: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
  return (
    <group position={center} quaternion={rotation}>
      <Outlined geometry={geometry} color={color} scale={[1, length, 1]} opacity={opacity} outline={1.065} />
    </group>
  );
};

export const Protagonist = ({frame, fps, position, rotation = 0, walking = false, opacity = 1}: ProtagonistProps) => {
  const geometry = useMemo(() => ({
    torso: torsoGeometry(.55, .55, .285),
    pelvis: roundedBox(.35, .205, .265, .04),
    upperLeg: new CapsuleGeometry(.076, .248, 5, 12),
    lowerLeg: new CapsuleGeometry(.066, .238, 5, 12),
    upperArm: new CapsuleGeometry(.077, .16, 5, 12),
    forearm: new CapsuleGeometry(.065, .16, 5, 12),
    hand: roundedBox(.105, .14, .085, .027),
    shoe: roundedBox(.178, .15, .315, .035),
    sole: roundedBox(.186, .034, .324, .01),
    cuff: new CylinderGeometry(.067, .07, .044, 14),
    head: new SphereGeometry(1, 24, 18),
    neck: new CylinderGeometry(.081, .084, .145, 16),
    collar: new TorusGeometry(.102, .013, 6, 26),
    hair: hairCapGeometry(),
    locks: hairLockGeometry(),
    seams: hairSeamsGeometry(),
    eye: new SphereGeometry(1, 10, 8),
  }), []);
  const time = frame / Math.max(1, fps);
  const phase = time * TAU * 1.6;
  const stride = walking ? Math.sin(phase) : 0;
  const bob = walking ? (1 - Math.cos(phase * 2)) * .010 : 0;
  const bodyYaw = walking ? Math.sin(phase) * .035 : 0;
  const alpha = clamp(opacity);

  return (
    <group position={position} rotation={[0, rotation, 0]} visible={alpha > .001}>
      <group position={[0, bob, 0]} rotation={[walking ? .035 : 0, bodyYaw, walking ? Math.sin(phase) * .015 : 0]}>
        <Outlined geometry={geometry.pelvis} color="#2e3740" position={[0, .91, 0]} opacity={alpha} />
        <Outlined geometry={geometry.torso} color={WHITE} position={[0, 1.255, 0]} opacity={alpha} />
        <Outlined geometry={geometry.neck} color={SKIN} position={[0, 1.565, .005]} opacity={alpha} />
        <mesh geometry={geometry.collar} position={[0, 1.524, .005]} rotation={[Math.PI / 2, 0, 0]} scale={[1.04, .88, 1]}>
          <meshToonMaterial color="#a7aaa4" transparent={alpha < 1} opacity={alpha} />
        </mesh>

        {([-1, 1] as const).map((side) => {
          const legSwing = stride * side * .43;
          const kneeBend = walking ? Math.max(0, stride * side) * .57 : 0;
          return (
            <group key={`leg-${side}`} position={[side * .12, .91, 0]} rotation={[legSwing, 0, 0]}>
              <Outlined geometry={geometry.upperLeg} color="#29333e" position={[0, -.20, 0]} opacity={alpha} />
              <group position={[0, -.40, 0]} rotation={[kneeBend, 0, 0]}>
                <Outlined geometry={geometry.lowerLeg} color="#29333e" position={[0, -.185, 0]} opacity={alpha} />
                <group position={[0, -.37, 0]} rotation={[-legSwing - kneeBend, 0, 0]}>
                  <Outlined geometry={geometry.shoe} color="#d8d7d0" position={[0, -.065, .055]} opacity={alpha} outline={1.024} />
                  <Outlined geometry={geometry.sole} color="#454b4f" position={[0, -.122, .055]} opacity={alpha} outline={1.018} />
                </group>
              </group>
            </group>
          );
        })}

        {([-1, 1] as const).map((side) => (
          <group key={`arm-${side}`} position={[side * .258, 1.456, .005]} rotation={[-stride * side * .34, 0, side * .11]}>
            <Outlined geometry={geometry.upperArm} color={WHITE} position={[0, -.15, 0]} opacity={alpha} />
            <group position={[0, -.30, 0]} rotation={[-.11 - Math.max(0, -stride * side) * .18, 0, 0]}>
              <Outlined geometry={geometry.forearm} color={WHITE} position={[0, -.143, 0]} opacity={alpha} />
              <Outlined geometry={geometry.cuff} color="#d8dad3" position={[0, -.278, 0]} opacity={alpha} outline={1.02} />
              <Outlined geometry={geometry.hand} color={SKIN} position={[0, -.345, .007]} opacity={alpha} />
            </group>
          </group>
        ))}

        <group position={[0, 1.754, .01]} rotation={[walking ? Math.sin(phase * 2) * .008 : 0, -bodyYaw * .45, 0]}>
          <Outlined geometry={geometry.head} color={SKIN} scale={[.193, .221, .174]} opacity={alpha} outline={1.015} />
          <Outlined geometry={geometry.head} color={SKIN} position={[-.193, -.002, -.004]} scale={[.032, .058, .029]} opacity={alpha} />
          <Outlined geometry={geometry.head} color={SKIN} position={[.193, -.002, -.004]} scale={[.032, .058, .029]} opacity={alpha} />
          <Outlined geometry={geometry.hair} color={HAIR} opacity={alpha} outline={1.018} />
          <lineSegments geometry={geometry.seams}>
            <lineBasicMaterial color="#18191a" transparent={alpha < 1} opacity={alpha} />
          </lineSegments>
          {[
            {x: -.153, y: .112, z: .126, turn: -.55, scale: .84},
            {x: -.077, y: .151, z: .161, turn: -.25, scale: 1.04},
            {x: .018, y: .152, z: .174, turn: .14, scale: 1.08},
            {x: .104, y: .105, z: .151, turn: .46, scale: .88},
          ].map((lock, index) => (
            <Outlined key={`fringe-${index}`} geometry={geometry.locks} color={index % 2 ? '#352d29' : HAIR}
              position={[lock.x, lock.y, lock.z]} rotation={[.04, 0, lock.turn]} scale={[lock.scale, lock.scale, .9]} opacity={alpha} outline={1.018} />
          ))}
          <mesh geometry={geometry.eye} position={[-.066, .009, .165]} scale={[.019, .008, .006]}><meshBasicMaterial color={OUTLINE} transparent={alpha < 1} opacity={alpha} /></mesh>
          <mesh geometry={geometry.eye} position={[.066, .009, .165]} scale={[.019, .008, .006]}><meshBasicMaterial color={OUTLINE} transparent={alpha < 1} opacity={alpha} /></mesh>
          <Outlined geometry={geometry.head} color={SKIN} position={[0, -.043, .173]} scale={[.018, .026, .023]} opacity={alpha} outline={1.01} />
        </group>
      </group>
    </group>
  );
};

const ROLE_COLORS = {plan: '#7297b2', make: '#bea573', review: '#879b8b'} as const;

/** A soft held-paper gesture: smooth lift, a short working hold, then a different return. */
const noteGesture = (time: number) => {
  const cycle = ((time % 6.8) + 6.8) % 6.8;
  if (cycle < 1.8) return 0;
  if (cycle < 2.55) return smooth((cycle - 1.8) / .75);
  if (cycle < 3.55) return 1;
  if (cycle < 4.45) return 1 - smooth((cycle - 3.55) / .9);
  return 0;
};

export const StudioAgent = ({frame, fps, index, position, rotation = Math.PI, role}: StudioAgentProps) => {
  const geometry = useMemo(() => ({
    torso: torsoGeometry(.46, .385, .255),
    pelvis: roundedBox(.35, .18, .29, .033),
    head: roundedBox(.435, .34, .335, .054),
    neck: new CylinderGeometry(.061, .065, .10, 12),
    palm: roundedBox(.103, .056, .123, .019),
    shoe: roundedBox(.15, .125, .25, .025),
    eye: roundedBox(.044, .052, .012, .004),
    elbow: new SphereGeometry(.052, 12, 9),
    pocket: roundedBox(.097, .105, .012, .008),
    note: roundedBox(.145, .143, .009, .002),
    clipboard: roundedBox(.33, .235, .018, .006),
    page: roundedBox(.295, .194, .005, .001),
    clip: roundedBox(.072, .025, .019, .003),
    pen: new CylinderGeometry(.009, .009, .145, 8),
    line: roundedBox(.17, .005, .002, .0005),
  }), []);
  const color = ROLE_COLORS[role];
  const time = frame / Math.max(1, fps) + index * 1.37;
  const subtle = Math.sin(time * 1.23 + index * .8) * .0035;
  const note = role === 'plan' ? noteGesture(time) : 0;
  const keyboardPulse = (offset: number) => Math.max(0, Math.sin(time * (role === 'make' ? 25.3 : 19.1) + offset));
  const lookUp = role === 'make' ? Math.max(0, Math.sin(time * 1.03 - .9)) ** 9 : 0;
  const headPitch = role === 'review' ? .23 + Math.sin(time * 1.12) * .025 : .15 - lookUp * .34 - note * .12;
  const headYaw = role === 'plan' ? note * .19 : Math.sin(time * .71 + index) * .022;
  const blinkCycle = ((time + index * .41) % 4.2 + 4.2) % 4.2;
  const blink = blinkCycle > 3.92 && blinkCycle < 4.08 ? 1 - Math.sin((blinkCycle - 3.92) / .16 * Math.PI) * .91 : 1;

  // The keyboard top is y=1.1595. Palms and sleeve undersides stay above it.
  const leftBase: Point = [-.125 + Math.sin(time * 2.0) * .012, 1.208 + keyboardPulse(.7) * .010, .606 + Math.sin(time * 1.7) * .012];
  const rightBase: Point = [.13 + Math.sin(time * 1.83 + .8) * .014, 1.208 + keyboardPulse(2.2) * .011, .602 + Math.sin(time * 2.13) * .012];
  const leftHand: Point = role === 'review' ? [-.153, 1.226 + subtle, .511] : leftBase;
  const rightHand: Point = role === 'plan'
    ? mixPoint(rightBase, [.36, 1.35 + subtle, .526], note)
    : role === 'review'
      ? [.104 + Math.sin(time * 3.2) * .032, 1.243 + Math.max(0, Math.sin(time * 2.1)) * .014, .569 + Math.cos(time * 2.8) * .022]
      : rightBase;

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Seat top belongs to StudioRoom at y=.60; the clothed hips rest just above it. */}
      <Outlined geometry={geometry.pelvis} color="#49545d" position={[0, .695, 0]} />
      {([-1, 1] as const).map((side) => (
        <group key={`agent-leg-${side}`}>
          <Bone from={[side * .115, .693, .015]} to={[side * .13, .51, .34]} radius={.071} color="#45525d" />
          <Bone from={[side * .13, .51, .34]} to={[side * .13, .137, .405]} radius={.057} color="#45525d" />
          <Outlined geometry={geometry.shoe} color="#424b52" position={[side * .13, .065, .453]} outline={1.023} />
        </group>
      ))}

      <Outlined geometry={geometry.torso} color={color} position={[0, .916 + subtle, .048]} rotation={[.095, 0, 0]} />
      <Outlined geometry={geometry.pocket} color={role === 'plan' ? '#99b0bf' : role === 'make' ? '#d1bd97' : '#a6b5aa'} position={[-.108, .958 + subtle, .182]} rotation={[.095, 0, 0]} outline={1.015} />
      <Outlined geometry={geometry.neck} color="#9aabae" position={[0, 1.141 + subtle, .088]} outline={1.02} />

      <group position={[0, 1.326 + subtle, .104]} rotation={[headPitch, headYaw, Math.sin(time * .63 + index) * .012]}>
        <Outlined geometry={geometry.head} color={WHITE} outline={1.017} />
        {([-1, 1] as const).map((side) => (
          <mesh key={`eye-${side}`} geometry={geometry.eye} position={[side * .079, .016, .169]} scale={[1, blink, 1]}>
            <meshBasicMaterial color={OUTLINE} />
          </mesh>
        ))}
      </group>

      {([-1, 1] as const).map((side) => {
        const hand = side === -1 ? leftHand : rightHand;
        const shoulder: Point = [side * .226, 1.085 + subtle, .067];
        const elbow: Point = [side * (.276 + (side === 1 ? note * .044 : 0)), 1.184 + (side === 1 ? note * .065 : 0), .267 + (side === 1 ? note * .028 : 0)];
        const palmTilt = role === 'review' ? -.12 : role === 'plan' && side === 1 ? mix(.24, -.14, note) : .24;
        return (
          <group key={`agent-arm-${side}`}>
            <Bone from={shoulder} to={elbow} radius={.055} color={color} />
            <Outlined geometry={geometry.elbow} color={color} position={elbow} outline={1.027} />
            <Bone from={elbow} to={hand} radius={.043} color={color} />
            <Outlined geometry={geometry.palm} color="#eceee8" position={hand} rotation={[palmTilt, side * .06, 0]} outline={1.026} />
          </group>
        );
      })}

      {role === 'plan' ? (
        <Outlined geometry={geometry.note} color="#ded6b0"
          position={mixPoint([.275, 1.122, .517], [.372, 1.395 + subtle, .56], note)}
          rotation={[mix(-Math.PI / 2, -.14, note), 0, note * -.13]} outline={1.016} />
      ) : null}

      {role === 'review' ? (
        <>
          <group position={[-.008, 1.213 + subtle, .558]} rotation={[-1.93, 0, .025]}>
            <Outlined geometry={geometry.clipboard} color="#81908a" outline={1.018} />
            <Outlined geometry={geometry.page} color="#f5f4eb" position={[0, -.004, .013]} outline={1.005} />
            <Outlined geometry={geometry.clip} color="#526260" position={[0, .104, .02]} outline={1.02} />
            {[-.04, 0, .04].map((y) => (
              <mesh key={`paper-line-${y}`} geometry={geometry.line} position={[-.017, y, .018]}><meshBasicMaterial color="#9a9f96" /></mesh>
            ))}
          </group>
          <mesh geometry={geometry.pen} position={[rightHand[0] + .022, rightHand[1] + .029, rightHand[2] + .028]} rotation={[-.66, .1, -.43]} castShadow>
            <meshToonMaterial color="#3c4b4b" />
          </mesh>
        </>
      ) : null}
    </group>
  );
};
