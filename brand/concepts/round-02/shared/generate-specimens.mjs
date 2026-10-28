import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const shared = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(shared);
function resolve(tokens, name, seen = []) {
  if (seen.includes(name)) throw new Error('Circular token: ' + name);
  const node = name.split('.').reduce((value, part) => value?.[part], tokens);
  if (!node || node.$value === undefined) throw new Error('Missing token: ' + name);
  const value = node.$value;
  return typeof value === 'string' && value.startsWith('{') ? resolve(tokens, value.slice(1,-1), [...seen,name]) : value;
}
const mappings = {
 a: {bg:'semantic.color.background',text:'semantic.color.text',brand:'semantic.color.brand',soft:'semantic.color.soft'},
 b: {bg:'semantic.color.background',text:'semantic.color.text',brand:'semantic.color.brand',soft:'semantic.color.canvas-right'},
 c: {bg:'semantic.color.surface',text:'semantic.color.text',brand:'semantic.color.background',soft:'semantic.color.surface'}
};
let css = '/* Generated from each candidate tokens.json. Run node shared/generate-specimens.mjs after token changes. */\n:root {\n';
const roles = {};
for (const [id,mapping] of Object.entries(mappings)) {
 const tokens = JSON.parse(fs.readFileSync(path.join(root,id,'tokens.json'),'utf8'));
 roles[id] = Object.fromEntries(Object.entries(mapping).map(([role,name]) => [role,resolve(tokens,name)]));
 for (const [role,value] of Object.entries(roles[id])) css += '  --primitive-sample-' + id + '-' + role + ': ' + value + ';\n';
}
css += '}\n';
for (const id of Object.keys(mappings)) {
 css += '[data-concept="' + id + '"] {\n';
 for (const role of Object.keys(mappings[id])) css += '  --sample-' + role + ': var(--primitive-sample-' + id + '-' + role + ');\n';
 css += '}\n';
}
fs.writeFileSync(path.join(shared,'specimen.tokens.css'),css);
console.log('Generated specimen.tokens.css from 3 candidate token sources.');

