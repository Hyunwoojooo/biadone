import {CharacterVariantContext} from './Actor';
import {CurriculumIntro} from './CurriculumIntro';

/** Keep the original film intact; substitute only the three actor placements. */
export const CurriculumColor = () => (
  <CharacterVariantContext.Provider value="color">
    <CurriculumIntro />
  </CharacterVariantContext.Provider>
);
