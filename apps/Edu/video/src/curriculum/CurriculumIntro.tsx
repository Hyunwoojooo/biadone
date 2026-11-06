import type {CSSProperties, ReactNode} from 'react';
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {fontFamily} from '../fonts';
import {Actor} from './Actor';
import {StoryArt} from './StoryArt';
import {FPS, TIMELINE, TOTAL_FRAMES} from './timing';
import type {TimelineEntry} from './timing';
import type {ChapterId, SceneSpec} from './types';

export const CURRICULUM_DURATION_IN_FRAMES = TOTAL_FRAMES;
export const CURRICULUM_FPS = FPS;
export const getCurriculumDurationInFrames = () => TOTAL_FRAMES;

const INK = '#171717';
const MUTED = '#858585';
const AUDIO_DELAY_FRAMES = 8;
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const STAGE = {left: 300, top: 314, width: 1400, height: 600} as const;

const CHAPTERS: ReadonlyArray<{id: ChapterId; label: string}> = [
  {id: 'prepare', label: '준비'},
  {id: 'foundation', label: '기초'},
  {id: 'choose', label: '선택'},
  {id: 'team', label: '업무팀'},
  {id: 'operate', label: '운영'},
  {id: 'start', label: '시작'},
];

const progress = (frame: number, from: number, duration = 18) =>
  interpolate(frame, [from, from + duration], [0, 1], CLAMP);
const easeOut = (value: number) => 1 - (1 - value) ** 3;

const ChapterRail = ({active}: {active: ChapterId}) => (
  <div
    style={{
      position: 'absolute',
      left: 67,
      top: 332,
      width: 180,
      height: 530,
    }}
  >
    <div
      style={{
        position: 'absolute',
        top: 24,
        bottom: 24,
        left: 39,
        width: 1,
        backgroundColor: '#dedede',
      }}
    />
    {CHAPTERS.map((chapter, index) => {
      const selected = chapter.id === active;
      const size = selected ? 76 : 24;
      return (
        <div
          key={chapter.id}
          style={{position: 'absolute', left: 0, top: index * 96, width: 180, height: 52}}
        >
          <div
            style={{
              position: 'absolute',
              left: 40 - size / 2,
              top: 26 - size / 2,
              width: size,
              height: size,
              borderRadius: '50%',
              border: `1.5px solid ${selected ? INK : '#bdbdbd'}`,
              backgroundColor: selected ? INK : '#fff',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: chapter.id === 'team' ? 20 : 23,
              fontWeight: 650,
              letterSpacing: '-0.7px',
            }}
          >
            {selected ? chapter.label : null}
          </div>
          {!selected ? (
            <span
              style={{
                position: 'absolute',
                left: 78,
                top: 12,
                fontSize: 21,
                lineHeight: '28px',
                fontWeight: 400,
                color: MUTED,
                whiteSpace: 'nowrap',
                letterSpacing: '-0.5px',
              }}
            >
              {chapter.label}
            </span>
          ) : null}
        </div>
      );
    })}
  </div>
);

type WorkKind = 'content' | 'website' | 'inquiry' | 'data';

/** Line artwork belongs to the deliverable it represents; it is never fake UI. */
const WorkGlyph = ({kind, accent}: {kind: WorkKind; accent: string}) => {
  const shared = {
    fill: 'none',
    stroke: INK,
    strokeWidth: 2.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (kind === 'content') {
    return (
      <g {...shared}>
        <rect x={18} y={13} width={116} height={100} rx={2} />
        <path d="M33 33H116M33 49H94M154 24H205M154 44H218M154 65H209M154 92H222" />
        <path d="M43 86h56v18H43z" fill={accent} />
        <path d="M54 83V67h34v16M88 69h8c12 0 12 13-8 13" />
      </g>
    );
  }
  if (kind === 'website') {
    return (
      <g {...shared}>
        <rect x={17} y={12} width={207} height={104} rx={3} />
        <path d="M17 32H224M29 22H31M40 22H42M51 22H53M35 49H113M35 65H100M35 81H87" />
        <rect x={146} y={48} width={57} height={47} fill={accent} />
        <path d="M35 101H104M159 80l12-12 10 8 10-16" />
      </g>
    );
  }
  if (kind === 'inquiry') {
    return (
      <g {...shared}>
        <path d="M23 20H111V82H64L43 99V82H23Z" fill={accent} />
        <path d="M39 38H95M39 54H78M135 49H161M152 40l10 9-10 9" />
        <rect x={179} y={22} width={45} height={85} rx={2} />
        <path d="M189 40H214M189 57H214M189 74H204M191 94l5 5 12-15" />
      </g>
    );
  }
  return (
    <g {...shared}>
      <path d="M24 109H226M24 109V17" />
      <rect x={47} y={65} width={30} height={44} fill={accent} />
      <rect x={100} y={40} width={30} height={69} fill={accent} />
      <rect x={153} y={24} width={30} height={85} fill={accent} />
      <path d="M49 127H76M101 127H129M154 127H181" />
    </g>
  );
};

const TaskPaper = ({
  title,
  kind,
  left,
  top,
  frame,
  at,
  accent,
}: {
  title: string;
  kind: WorkKind;
  left: number;
  top: number;
  frame: number;
  at: number;
  accent: string;
}) => {
  const enter = easeOut(progress(frame, at, 19));
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: 300,
        height: 210,
        backgroundColor: '#fff',
        border: `2px solid ${INK}`,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 24}px)`,
      }}
    >
      <div
        style={{
          height: 57,
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          borderBottom: '1px solid #d3d3d3',
          fontSize: 25,
          fontWeight: 650,
          letterSpacing: '-0.6px',
        }}
      >
        {title}
      </div>
      <svg width={260} height={140} viewBox="0 0 244 140" style={{margin: '5px 18px 0'}}>
        <WorkGlyph kind={kind} accent={accent} />
      </svg>
    </div>
  );
};

const IntroStage = ({frame, durationInFrames, accent, hideWorkCaption = false}: {frame: number; durationInFrames: number; accent: string; hideWorkCaption?: boolean}) => {
  const actorEnter = easeOut(progress(frame, 4, 20));
  const line = progress(frame, durationInFrames * .1, durationInFrames * .4);
  return (
    <AbsoluteFill>
      <svg width={1400} height={600} viewBox="0 0 1400 600" style={{position: 'absolute', inset: 0}}>
        <g fill="none" stroke="#b4b4b4" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M400 300H503V135H590M503 300H922V135H965M503 300V438H590M922 300V438H965"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - line}
          />
        </g>
      </svg>
      <Actor
        pose="papers"
        style={{
          position: 'absolute',
          left: 125,
          top: 60,
          width: 315,
          height: 480,
          opacity: actorEnter,
          transform: `translateY(${(1 - actorEnter) * 14}px)`,
        }}
      />
      {!hideWorkCaption ? <div
        style={{
          position: 'absolute',
          left: 84,
          top: 555,
          width: 402,
          textAlign: 'center',
          fontSize: 27,
          fontWeight: 400,
          color: '#555',
          opacity: progress(frame, 13, 18),
          letterSpacing: '-0.7px',
        }}
      >
        내 사업의 실제 업무
      </div> : null}
      <TaskPaper title="홍보 콘텐츠" kind="content" left={594} top={25} frame={frame} at={durationInFrames * .12} accent={accent} />
      <TaskPaper title="웹페이지" kind="website" left={970} top={25} frame={frame} at={durationInFrames * .23} accent={accent} />
      <TaskPaper title="고객 문의" kind="inquiry" left={594} top={329} frame={frame} at={durationInFrames * .34} accent={accent} />
      <TaskPaper title="매출 자료" kind="data" left={970} top={329} frame={frame} at={durationInFrames * .45} accent={accent} />
    </AbsoluteFill>
  );
};

const CycleIcon = ({index, accent}: {index: number; accent: string}) => (
  <g fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
    {index === 0 ? (
      <>
        <path d="M-36-49H19L42-25V51H-36Z" fill="#fff" />
        <path d="M19-49V-25H42M-19-7H25M-19 11H25M-19 29H8" />
        <path d="M-19 29H8" strokeWidth={7} stroke={accent} />
      </>
    ) : index === 1 ? (
      <>
        <rect x={-54} y={-39} width={108} height={73} rx={3} fill="#fff" />
        <path d="M-54-20H54M-39-30H-37M-28-30H-26M-8 34V51M-35 52H35" />
        <path d="M-19-4 25 12-2 19-9 43Z" fill={accent} />
      </>
    ) : (
      <>
        <path d="M-42-48H25V49H-42Z" fill="#fff" />
        <path d="M-25-27H9M-25-8H1M-25 12H-7" />
        <path d="M-8 39 2 13 40-25 56-9 18 29Z" fill={accent} />
        <path d="M30-15 46 1M2 13 18 29" />
      </>
    )}
  </g>
);

const ApproachStage = ({frame, durationInFrames, accent}: {frame: number; durationInFrames: number; accent: string}) => {
  const phase = interpolate(frame, [30, Math.max(150, durationInFrames - 45)], [0, 3], CLAMP);
  const centers = [465, 805, 1145];
  const actionLabels = ['만들고', '써보고', '고칩니다'];
  return (
    <AbsoluteFill>
      <Actor
        pose="explain"
        style={{position: 'absolute', left: 1, top: 105, width: 280, height: 427, opacity: progress(frame, 5, 18)}}
      />
      <svg width={1400} height={600} viewBox="0 0 1400 600" style={{position: 'absolute', inset: 0}}>
        <g fill="none" stroke={INK} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M573 218H681M669 207l14 11-14 11M913 218H1021M1009 207l14 11-14 11" opacity={progress(frame, 32, 18)} />
          <path
            d="M1145 415V440Q1145 486 1099 486H500Q465 486 465 450V415M453 429l12-15 12 15"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - progress(frame, 78, Math.min(80, Math.max(30, durationInFrames - 130)))}
          />
        </g>
        {centers.map((center, index) => {
          const enter = easeOut(progress(frame, 12 + index * 14, 20));
          return (
            <g key={actionLabels[index]} opacity={enter} transform={`translate(${center},${218 + (1 - enter) * 17})`}>
              <circle r={94} fill={phase >= index ? accent : '#fff'} stroke={INK} strokeWidth={2.5} />
              <CycleIcon index={index} accent={accent} />
              <text y={160} textAnchor="middle" fontFamily={fontFamily} fontSize={38} fontWeight={index === 2 ? 760 : 450} letterSpacing={-1.1} fill={INK}>
                {actionLabels[index]}
              </text>
            </g>
          );
        })}
      </svg>
      <div
        style={{
          position: 'absolute', left: 580, top: 467, width: 470,
          backgroundColor: '#fff', textAlign: 'center',
          fontSize: 27, fontWeight: 450, color: '#666',
          letterSpacing: '-0.6px', opacity: progress(frame, 103, 18),
        }}
      >
        다음 업무에도 다시 활용
      </div>
    </AbsoluteFill>
  );
};

const ClosingStage = ({frame, durationInFrames, accent}: {frame: number; durationInFrames: number; accent: string}) => {
  const takeaways = ['내 사업 자료로 시작', '결과를 확인하고 직접 수정', '다음 업무에 반복 활용'];
  return (
    <AbsoluteFill>
      <Actor
        pose="folder"
        style={{
          position: 'absolute', left: 183, top: 106, width: 285, height: 434,
          opacity: progress(frame, 4, 18),
          transform: `translateY(${(1 - easeOut(progress(frame, 4, 20))) * 16}px)`,
        }}
      />
      <div
        style={{
          position: 'absolute', left: 620, top: 81,
          fontSize: 69, fontWeight: 730, letterSpacing: '-1.8px',
          opacity: progress(frame, 12, 17),
        }}
      >
        BiaDone Edu
      </div>
      <div style={{position: 'absolute', left: 620, top: 206, width: 605}}>
        {takeaways.map((takeaway, index) => {
          const enter = easeOut(progress(frame, durationInFrames * (.18 + index * .18), 20));
          return (
            <div
              key={takeaway}
              style={{
                display: 'flex', alignItems: 'center', gap: 21,
                borderTop: '1px solid #d4d4d4', padding: '24px 0',
                fontSize: 31, lineHeight: 1.35, fontWeight: 400,
                letterSpacing: '-0.9px', opacity: enter,
                transform: `translateX(${(1 - enter) * 15}px)`,
              }}
            >
              <svg width={34} height={34} viewBox="0 0 34 34" style={{flexShrink: 0}}>
                <rect x={2} y={2} width={30} height={30} fill={accent} />
                <path d="m9 17 6 6 11-13" fill="none" stroke={INK} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {takeaway}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const SceneFrame = ({scene, durationInFrames, audio, hideWorkCaption = false}: {scene: SceneSpec; durationInFrames: number; audio?: string; hideWorkCaption?: boolean}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fadeFrames = Math.max(1, Math.round(fps / 3));
  const opacity = Math.min(
    progress(frame, 0, fadeFrames),
    interpolate(frame, [durationInFrames - 7, durationInFrames - 1], [1, 0], CLAMP),
  );
  const headlineOpacity = progress(frame, 3, 12);
  let art: ReactNode;
  if (scene.id === 'intro') art = <IntroStage frame={frame} durationInFrames={durationInFrames} accent={scene.accent} hideWorkCaption={hideWorkCaption} />;
  else if (scene.id === 'approach') art = <ApproachStage frame={frame} durationInFrames={durationInFrames} accent={scene.accent} />;
  else if (scene.id === 'closing') art = <ClosingStage frame={frame} durationInFrames={durationInFrames} accent={scene.accent} />;
  else art = <StoryArt kind={scene.id} frame={frame} durationInFrames={durationInFrames} accent={scene.accent} />;

  const stageStyle: CSSProperties = {position: 'absolute', ...STAGE};
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{opacity}}>
        {scene.id !== 'intro' && scene.id !== 'closing' ? (
          <div
            style={{
              position: 'absolute', left: 300, right: 220, top: 91,
              textAlign: 'center', fontSize: 22, fontWeight: 400,
              color: '#777', letterSpacing: '-0.45px',
            }}
          >
            {scene.eyebrow}
          </div>
        ) : null}
        <div
          style={{
            position: 'absolute', left: 284, right: 174, top: 173,
            textAlign: 'center', fontSize: 64, lineHeight: 1.3,
            fontWeight: 350, letterSpacing: '-2.1px',
            opacity: headlineOpacity, wordBreak: 'keep-all', textWrap: 'balance',
          }}
        >
          {scene.headline.lead}
          <strong style={{fontWeight: 760}}>{scene.headline.strong}</strong>
          {scene.headline.tail}
        </div>
        <div style={stageStyle}>{art}</div>
      </AbsoluteFill>
      {audio ? (
        <Sequence from={AUDIO_DELAY_FRAMES} durationInFrames={Math.max(1, durationInFrames - AUDIO_DELAY_FRAMES)} layout="none">
          <Audio src={staticFile(audio)} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

export const CurriculumIntro = ({timeline = TIMELINE, hideWorkCaption = false}: {timeline?: TimelineEntry[]; hideWorkCaption?: boolean} = {}) => {
  const frame = useCurrentFrame();
  const current = timeline.find((entry) => frame >= entry.from && frame < entry.from + entry.durationInFrames)
    ?? timeline[timeline.length - 1];
  return (
    <AbsoluteFill style={{backgroundColor: '#fff', color: INK, fontFamily, fontWeight: 350}}>
      <div
        style={{
          position: 'absolute', top: 69, left: 86,
          fontSize: 27, lineHeight: 1.3, fontWeight: 650,
          letterSpacing: '-0.55px',
        }}
      >
        BiaDone Edu
      </div>
      <ChapterRail active={current?.scene.chapter ?? 'prepare'} />
      {timeline.map((entry) => (
        <Sequence
          key={entry.scene.id}
          name={entry.scene.eyebrow}
          from={entry.from}
          durationInFrames={entry.durationInFrames}
          layout="none"
        >
          <SceneFrame scene={entry.scene} durationInFrames={entry.durationInFrames} audio={entry.audio} hideWorkCaption={hideWorkCaption} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
