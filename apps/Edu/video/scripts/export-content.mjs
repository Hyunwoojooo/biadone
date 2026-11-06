import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/curriculum/scenes.ts', import.meta.url), 'utf8');
const {outputText} = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext}});
const {SCENES} = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
fs.mkdirSync(new URL('../content/', import.meta.url), {recursive: true});
fs.writeFileSync(new URL('../content/narration-scenes.json', import.meta.url), JSON.stringify(SCENES, null, 2) + '\n');
console.log(`Exported ${SCENES.length} scenes for narration.`);
