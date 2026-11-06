import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {fontFamily} from './fonts';

const clamp = {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
} as const;

const ink = '#171717';

export const SetupCheck = () => {
  const frame = useCurrentFrame();
  const titleOpacity = interpolate(frame, [0, 12], [0, 1], clamp);
  const paperProgress = interpolate(frame, [10, 38], [0, 1], clamp);
  const linesOpacity = interpolate(frame, [30, 44], [0, 1], clamp);
  const checkOpacity = interpolate(frame, [48, 58], [0, 1], clamp);
  const checkProgress = interpolate(frame, [54, 72], [0, 1], clamp);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#fff',
        color: ink,
        fontFamily,
        fontWeight: 350,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 88,
          left: 104,
          fontSize: 28,
          fontWeight: 650,
          letterSpacing: '-0.5px',
        }}
      >
        BiaDone Edu
      </div>

      <div
        style={{
          position: 'absolute',
          top: 205,
          left: 180,
          right: 180,
          textAlign: 'center',
          fontSize: 76,
          lineHeight: 1.3,
          letterSpacing: '-2px',
          opacity: titleOpacity,
        }}
      >
        만들고, <strong style={{fontWeight: 750}}>다시 고칩니다.</strong>
      </div>

      <svg
        viewBox="0 0 600 400"
        width={600}
        height={400}
        style={{position: 'absolute', left: 660, top: 365}}
        aria-hidden="true"
      >
        <g fill="none" stroke={ink} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M180 35 H355 L420 100 V345 H180 Z"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - paperProgress}
          />
          <path d="M355 35 V100 H420" opacity={linesOpacity} />
          <g opacity={linesOpacity}>
            <path d="M222 145 H365" />
            <path d="M222 190 H365" />
            <path d="M222 235 H323" />
          </g>
          <circle cx={408} cy={310} r={57} fill="#e7f0db" opacity={checkOpacity} />
          <path
            d="M382 309 L401 328 L435 289"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - checkProgress}
            opacity={checkOpacity}
          />
        </g>
      </svg>

      <div
        style={{
          position: 'absolute',
          left: 180,
          right: 180,
          bottom: 100,
          textAlign: 'center',
          fontSize: 24,
          fontWeight: 400,
          color: '#777',
        }}
      >
        설치 확인용 · 무음 샘플
      </div>
    </AbsoluteFill>
  );
};
