import {createContext, useContext} from 'react';
import type {CSSProperties} from 'react';
import {Img, staticFile} from 'remotion';
import {ColorActor} from './ColorActor';

export const CharacterVariantContext = createContext<'line' | 'color' | 'cutout'>('line');

type ActorProps = {
  pose: 'papers' | 'explain' | 'folder';
  style?: CSSProperties;
};

// Three expressions adapted from the user's own character; original PNGs are preserved.
// The source is a 1536×1024 sheet. CSS isolates a 512×780 cell without altering the image.
export const Actor = ({pose, style}: ActorProps) => {
  const variant = useContext(CharacterVariantContext);
  if (variant === 'color') return <ColorActor pose={pose} style={style} />;
  if (variant === 'cutout') return <ColorActor pose={pose} style={style} transparent />;
  const index = {papers: 0, explain: 1, folder: 2}[pose];
  return (
    <div style={{width: 380, height: 579, position: 'relative', overflow: 'hidden', ...style}}>
      <Img
        src={staticFile('character/line-poses.png')}
        alt="BiaDone character"
        style={{position: 'absolute', width: '300%', maxWidth: 'none', height: 'auto', left: `${-index * 100}%`, top: '-19.230769%'}}
      />
    </div>
  );
};
