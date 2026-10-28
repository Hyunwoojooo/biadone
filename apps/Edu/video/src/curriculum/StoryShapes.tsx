import type {ReactNode, SVGProps} from 'react';

export const INK = '#242723';
// Scene accents are light paper fills; semantic marks need their own dark ink.
export const SIGNAL = '#4b5e50';
export const PAPER = '#fffefa';
export const PASTEL = {blue: '#e3ecff', green: '#e8efc8', peach: '#f7ddcc', red: '#c96a61'};

export const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const phase = (time: number, start: number, end: number) => {
  const value = clamp((time - start) / Math.max(.001, end - start));
  return value * value * (3 - 2 * value);
};

type Point = {x: number; y: number};

export const Text = ({x, y, children, size = 28, weight = 560, align = 'start', color = INK, ...rest}: {
  x: number; y: number; children: ReactNode; size?: number; weight?: number;
  align?: 'start' | 'middle' | 'end'; color?: string;
} & Omit<SVGProps<SVGTextElement>, 'x' | 'y' | 'fontSize' | 'fontWeight' | 'textAnchor' | 'children'>) => (
  <text x={x} y={y} fill={color} stroke="none" fontSize={size} fontWeight={weight} textAnchor={align} {...rest}>{children}</text>
);

export const Multiline = ({x, y, lines, size = 28, lineHeight = 42, align = 'start', weight = 560, color = INK}: {
  x: number; y: number; lines: string[]; size?: number; lineHeight?: number;
  align?: 'start' | 'middle' | 'end'; weight?: number; color?: string;
}) => <g>{lines.map((line, index) => <Text key={`${index}-${line}`} x={x} y={y + index * lineHeight} size={size} weight={weight} align={align} color={color}>{line}</Text>)}</g>;

export const Reveal = ({value, children, dx = 0, dy = 18}: {value: number; children: ReactNode; dx?: number; dy?: number}) => (
  <g opacity={clamp(value)} transform={`translate(${dx * (1 - value)} ${dy * (1 - value)})`}>{children}</g>
);

export const Paper = ({x, y, width, height, fill = PAPER, children}: {x: number; y: number; width: number; height: number; fill?: string; children?: ReactNode}) => (
  <g>
    <path d={`M${x} ${y}H${x + width - 24}L${x + width} ${y + 24}V${y + height}H${x}Z`} fill={fill}/>
    <path d={`M${x + width - 24} ${y}V${y + 24}H${x + width}`} fill="none"/>
    {children}
  </g>
);

export const Arrow = ({points, value = 1, color = INK, dashed = false, width = 3}: {points: Point[]; value?: number; color?: string; dashed?: boolean; width?: number}) => {
  const end = points[points.length - 1], before = points[points.length - 2];
  const angle = Math.atan2(end.y - before.y, end.x - before.x);
  const head = 12;
  return <g stroke={color} strokeWidth={width} opacity={value > 0 ? 1 : 0}>
    <path d={points.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' ')} fill="none" pathLength={1} strokeDasharray={dashed && value === 1 ? '7 8' : 1} strokeDashoffset={dashed && value === 1 ? 0 : 1 - clamp(value)}/>
    <path d={`M${end.x - head * Math.cos(angle - .48)} ${end.y - head * Math.sin(angle - .48)}L${end.x} ${end.y}L${end.x - head * Math.cos(angle + .48)} ${end.y - head * Math.sin(angle + .48)}`} fill="none" opacity={phase(value, .78, 1)}/>
  </g>;
};

export const Check = ({x, y, value = 1, size = 28, color = INK}: {x: number; y: number; value?: number; size?: number; color?: string}) => (
  <path d={`M${x} ${y + size * .52}L${x + size * .34} ${y + size * .86}L${x + size} ${y}`} fill="none" stroke={color} strokeWidth={3} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - clamp(value)} opacity={value > 0 ? 1 : 0}/>
);

export const Rule = ({x, y, width, opacity = 1}: {x: number; y: number; width: number; opacity?: number}) => <path d={`M${x} ${y}h${width}`} opacity={opacity} fill="none"/>;

export const Cup = ({x, y, scale = 1, fill = PAPER}: {x: number; y: number; scale?: number; fill?: string}) => (
  <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M14 39C14 39 18 80 29 87C40 94 64 92 72 84C81 75 84 39 84 39Z" fill={fill}/>
    <path d="M84 47C113 39 117 73 78 76M9 96C27 107 76 107 91 94M15 39C29 48 68 49 84 39C70 29 32 29 15 39M40 21C30 10 49 5 42 -7M60 21C50 8 69 1 63 -9" fill="none"/>
  </g>
);

export const MovingNote = ({points, value, accent}: {points: Point[]; value: number; accent: string}) => {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  let remaining = clamp(value) * lengths.reduce((total, length) => total + length, 0);
  let position = points[points.length - 1];
  for (let index = 0; index < lengths.length; index++) {
    if (remaining <= lengths[index]) {
      const amount = remaining / Math.max(1, lengths[index]);
      position = {x: points[index].x + (points[index + 1].x - points[index].x) * amount, y: points[index].y + (points[index + 1].y - points[index].y) * amount};
      break;
    }
    remaining -= lengths[index];
  }
  const opacity = phase(value, 0, .08) * (1 - phase(value, .92, 1));
  return <g transform={`translate(${position.x - 20} ${position.y - 25})`} opacity={opacity}>
    <rect x={0} y={0} width={40} height={50} fill={accent} stroke={SIGNAL}/>
    <path d="M9 14H30M9 24H30M9 34H24" stroke={SIGNAL} strokeWidth={2}/>
  </g>;
};
