import {Composition} from 'remotion';
import {SetupCheck} from './SetupCheck';
import {CurriculumIntro} from './curriculum/CurriculumIntro';
import {CurriculumColor} from './curriculum/CurriculumColor';
import {CurriculumClean} from './curriculum/CurriculumClean';
import {CurriculumJuhyunwoo} from './curriculum/CurriculumJuhyunwoo';
import {JUHYUNWOO_TOTAL_FRAMES} from './curriculum/juhyunwoo-timing';
import {FPS, TOTAL_FRAMES} from './curriculum/timing';
import {CampusTour} from './campus-tour/CampusTour';
import {RoomFilm} from './room-film/RoomFilm';

export const RemotionRoot = () => (
  <>
  <Composition
    id="CurriculumJuhyunwoo"
    component={CurriculumJuhyunwoo}
    durationInFrames={JUHYUNWOO_TOTAL_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
  <Composition
    id="CurriculumClean"
    component={CurriculumClean}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
  <Composition
    id="CurriculumColor"
    component={CurriculumColor}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
  <Composition
    id="RoomFilmStudy"
    component={RoomFilm}
    durationInFrames={900}
    fps={30}
    width={1920}
    height={1080}
  />
  <Composition
    id="CampusTour"
    component={CampusTour}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
  <Composition
    id="CurriculumIntro"
    component={CurriculumIntro}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
  <Composition
    id="SetupCheck"
    component={SetupCheck}
    durationInFrames={90}
    fps={30}
    width={1920}
    height={1080}
  />
  </>
);
