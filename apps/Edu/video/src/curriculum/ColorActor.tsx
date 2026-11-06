import type {CSSProperties} from 'react';
import {Img, staticFile} from 'remotion';

type ColorActorProps = {
  pose: 'papers' | 'explain' | 'folder';
  style?: CSSProperties;
  transparent?: boolean;
};

const POSE_IMAGES = {
  papers: '04-thinking.png',
  explain: '08-explaining.png',
  folder: '07-thumbs-up.png',
} as const;

/** Preserve original RGB assets by default; clean versions use the prepared alpha PNGs. */
export const ColorActor = ({pose, style, transparent = false}: ColorActorProps) => (
  <div style={{width: 380, height: 579, position: 'relative', ...style, overflow: 'visible'}}>
    <Img
      src={staticFile(`character/${transparent ? 'cutout-v5' : 'color-v4'}/${POSE_IMAGES[pose]}`)}
      alt="BiaDone character"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        maxWidth: 'none',
        objectFit: 'contain',
        transform: 'scale(1.25)',
        transformOrigin: 'center',
      }}
    />
  </div>
);
