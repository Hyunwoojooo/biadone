import {fontFamily} from '../fonts';

export interface CampusCourse {
  id: string;
  badge: string;
  group: string;
  short: string;
  title: string;
  result: string;
  learn: string[];
  outputs: string[];
  color: string;
  ink: string;
  summary: string;
  takeaway: string;
}

type RoomBoardProps = {
  course: CampusCourse;
  frame: number;
  durationInFrames: number;
  width: number;
  height: number;
};

const INK = '#222b32';
const PAPER = '#fffffc';
const LINE = '#d9ddda';

/** Conservative text widths keep the full Korean source visible in a fixed board. */
const textUnits = (text: string) => Array.from(text).reduce((total, character) => {
  if (/\s/.test(character)) return total + 0.29;
  if (/[A-Z]/.test(character)) return total + 0.69;
  if (/[a-z0-9]/.test(character)) return total + 0.59;
  if (/[.,:;·()]/.test(character)) return total + 0.36;
  if (/[+→]/.test(character)) return total + 0.8;
  return total + 1.04;
}, 0);

const wrappedLines = (text: string, fontSize: number, width: number) => {
  const limit = Math.max(1, width / fontSize);
  let lines = 1;
  let used = 0;
  text.split(/\s+/).forEach((word) => {
    const length = textUnits(word);
    const space = used > 0 ? 0.29 : 0;
    if (used > 0 && used + space + length > limit) {
      lines += 1;
      used = length;
    } else {
      used += space + length;
    }
    if (used > limit) {
      lines += Math.max(0, Math.ceil(used / limit) - 1);
      used %= limit;
    }
  });
  return lines;
};

const boardLayout = (course: CampusCourse, width: number, height: number) => {
  const padding = Math.min(44, Math.max(30, Math.round(width * 0.04)));
  const innerWidth = width - padding * 2;
  const resultText = course.outputs.length > 0 ? course.outputs.join(' · ') : course.result;
  const count = Math.max(1, course.learn.length);
  let chosen = {
    padding, titleSize: 42, titleLineHeight: 52, fontSize: 25,
    lineHeight: 38, rowGap: 8, resultSize: 25, resultLineHeight: 37,
    resultText,
  };

  for (let fontSize = 32; fontSize >= 25; fontSize -= 1) {
    const titleSize = Math.round(fontSize * 1.5);
    const titleLineHeight = titleSize * 1.25;
    const lineHeight = fontSize * 1.48;
    const resultSize = 28;
    const resultLineHeight = resultSize * 1.45;
    const titleLines = wrappedLines(course.short, titleSize, innerWidth);
    const bodyLines = course.learn.map((text) => wrappedLines(text, fontSize, innerWidth - 57));
    const resultLines = wrappedLines(resultText, resultSize, innerWidth);
    const headerHeight = 44 + 16 + titleLines * titleLineHeight
      + 12 + resultLines * resultLineHeight + 24 + 1;
    const available = height - padding * 2 - headerHeight - 22;
    const gap = count > 1 ? (available - bodyLines.reduce((total, lines) => total + lines * lineHeight, 0)) / (count - 1) : 0;
    chosen = {
      padding, titleSize, titleLineHeight, fontSize, lineHeight,
      rowGap: Math.max(8, Math.min(18, gap)), resultSize, resultLineHeight, resultText,
    };
    if (gap >= 8 || count === 1) break;
  }
  return chosen;
};

/** A paper guide only: the parent owns the map, entry transition, and scene timing. */
export const RoomBoard = ({course, frame, durationInFrames, width, height}: RoomBoardProps) => {
  const layout = boardLayout(course, width, height);
  const stableDuration = Math.max(1, durationInFrames - 32);
  const readingProgress = Math.min(1, Math.max(0, frame - 16) / stableDuration);
  const highlightedIndex = Math.min(course.learn.length - 1, Math.floor(readingProgress * course.learn.length));
  const category = /^[A-E]$/.test(course.id) ? '목적별 선택 과정' : course.group;

  return (
    <section
      aria-label={`${course.short} 수업 안내`}
      style={{
        width,
        height,
        padding: layout.padding,
        boxSizing: 'border-box',
        border: '1.5px solid #68737b',
        backgroundColor: PAPER,
        color: INK,
        fontFamily,
        fontWeight: 400,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header style={{paddingBottom: 24, borderBottom: `1px solid ${LINE}`, flexShrink: 0}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 15, minHeight: 44}}>
          <span
            style={{
              minWidth: 44,
              height: 44,
              padding: '0 10px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box',
              backgroundColor: course.ink,
              color: '#fff',
              fontSize: 25,
              lineHeight: 1,
              fontWeight: 700,
              letterSpacing: '-0.5px',
            }}
          >
            {course.badge}
          </span>
          <span style={{fontSize: 26, lineHeight: '32px', fontWeight: 500, color: '#64717a', letterSpacing: '-0.6px'}}>
            {category}
          </span>
        </div>
        <h2
          style={{
            margin: '16px 0 0',
            fontSize: layout.titleSize,
            lineHeight: `${layout.titleLineHeight}px`,
            letterSpacing: '-1.6px',
            fontWeight: 760,
            wordBreak: 'keep-all',
            overflowWrap: 'anywhere',
          }}
        >
          {course.short}
        </h2>
        <p
          style={{
            margin: '12px 0 0',
            fontSize: layout.resultSize,
            lineHeight: `${layout.resultLineHeight}px`,
            fontWeight: 550,
            letterSpacing: '-0.6px',
            color: course.ink,
            wordBreak: 'keep-all',
            overflowWrap: 'anywhere',
          }}
        >
          {layout.resultText}
        </p>
      </header>

      <ol
        aria-label="배우는 내용"
        style={{
          margin: '22px 0 0',
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: layout.rowGap,
          flexShrink: 0,
        }}
      >
        {course.learn.map((item, index) => (
          <li
            key={`${course.id}-${index}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '39px minmax(0,1fr)',
              columnGap: 18,
              alignItems: 'start',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                position: 'relative',
                paddingTop: 1,
                height: layout.lineHeight,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 25,
                lineHeight: 1,
                fontWeight: highlightedIndex === index ? 650 : 450,
                fontVariantNumeric: 'tabular-nums',
                color: highlightedIndex === index ? course.ink : '#839099',
              }}
            >
              {String(index + 1).padStart(2, '0')}
              {highlightedIndex === index ? (
                <span
                  style={{position: 'absolute', left: 6, right: 6, bottom: 0, height: 2, backgroundColor: course.color}}
                />
              ) : null}
            </span>
            <span
              style={{
                fontSize: layout.fontSize,
                lineHeight: `${layout.lineHeight}px`,
                fontWeight: 430,
                letterSpacing: '-0.65px',
                wordBreak: 'keep-all',
                overflowWrap: 'anywhere',
              }}
            >
              {item}
            </span>
          </li>
        ))}
      </ol>

    </section>
  );
};
