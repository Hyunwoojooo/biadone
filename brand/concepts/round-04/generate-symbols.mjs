import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const proposals=JSON.parse(fs.readFileSync(path.join(root,'symbols.json'),'utf8'));
const requestedIds=new Set(process.argv.slice(2));
for(const id of requestedIds)if(!proposals.some(p=>p.id===id))throw Error('Unknown symbol id '+id);
const selected=requestedIds.size?proposals.filter(p=>requestedIds.has(p.id)):proposals;
const tokens=JSON.parse(fs.readFileSync(path.join(root,'../../design-system/tokens.json'),'utf8'));
function resolve(p,seen=[]){if(seen.includes(p))throw Error('Circular token '+p);const n=p.split('.').reduce((o,k)=>o?.[k],tokens);if(!n||n.$value===undefined)throw Error('Missing token '+p);return typeof n.$value==='string'&&n.$value.startsWith('{')?resolve(n.$value.slice(1,-1),[...seen,p]):n.$value;}
const colors={'':resolve('semantic.color.brand'),'-white':resolve('semantic.color.on-brand'),'-ink':resolve('semantic.color.text-primary')};
fs.mkdirSync(path.join(root,'assets'),{recursive:true});
const escape=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function writeIfChanged(file,content){if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==content)fs.writeFileSync(file,content);}
for(const p of selected)for(const [suffix,color]of Object.entries(colors)){
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="'+color+'" color="'+color+'"><title>'+escape('Biadone 심벌 '+p.id.toUpperCase()+' '+p.title)+'</title>'+p.body+'</svg>\n';
 writeIfChanged(path.join(root,'assets','symbol-'+p.id+suffix+'.svg'),svg);
}
const data=proposals.map(({body,...rest})=>rest);
writeIfChanged(path.join(root,'symbols.data.js'),'window.BIADONE_SYMBOLS = '+JSON.stringify(data,null,2)+';\n');
console.log('Generated '+selected.length*Object.keys(colors).length+' SVG candidates and display metadata from canonical brand colors.');

