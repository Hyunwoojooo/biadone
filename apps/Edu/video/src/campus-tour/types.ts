export type Point = {x: number; y: number};

export type RoomId = 'F' | 'A' | 'B' | 'C' | 'D' | 'E' | 'T';

export type Camera = {cx: number; cy: number; zoom: number};

export type MapStageProps = {
  width: number;
  height: number;
  frame: number;
  position: Point;
  facing: 'up' | 'down' | 'left' | 'right';
  walking: boolean;
  camera: Camera;
  highlightRoom?: RoomId;
  showLabels?: boolean;
  route?: Point[];
};
