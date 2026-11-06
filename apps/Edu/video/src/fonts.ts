import {loadFont} from '@remotion/fonts';
import {staticFile} from 'remotion';

export const fontFamily = 'BiaDone Pretendard';

loadFont({
  family: fontFamily,
  url: staticFile('fonts/PretendardVariable.woff2'),
  format: 'woff2',
  weight: '100 900',
});
