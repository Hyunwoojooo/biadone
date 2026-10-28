import {existsSync} from 'node:fs';
import {Config} from '@remotion/cli/config';

const chrome = process.env.REMOTION_BROWSER_EXECUTABLE ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (existsSync(chrome)) {
  Config.setBrowserExecutable(chrome);
}

Config.setVideoImageFormat('png');
Config.setOverwriteOutput(true);
