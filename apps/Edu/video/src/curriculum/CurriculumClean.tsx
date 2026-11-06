import {CharacterVariantContext} from './Actor';
import {CurriculumIntro} from './CurriculumIntro';
import type {TimelineEntry} from './timing';

/** Latest variants share alpha assets and the clean intro, with an optional voice timeline. */
export const CurriculumClean = ({timeline}: {timeline?: TimelineEntry[]} = {}) => (
  <CharacterVariantContext.Provider value="cutout">
    <CurriculumIntro timeline={timeline} hideWorkCaption />
  </CharacterVariantContext.Provider>
);
