/* Build the requested portable HTML: no server, dependencies, or external assets. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const mime={png:'image/png',woff2:'font/woff2'};
async function inlineAsset(name){
  const ext=name.split('.').at(-1);
  return 'data:'+(mime[ext]||'application/octet-stream')+';base64,'+(await readFile(resolve(root,name))).toString('base64');
}
let html=await readFile(resolve(root,'index.html'),'utf8');
for(const name of ['assets/font.css','campus.css']){
  let css=await readFile(resolve(root,name),'utf8');
  if(name==='campus.css')css=css.replaceAll('assets/visitor-sprites.png',await inlineAsset('assets/visitor-sprites.png'));
  html=html.replace('<link rel="stylesheet" href="'+name+'">',()=>'<style>'+css+'</style>');
}
html=html.replaceAll('assets/campus-world-v2.png',await inlineAsset('assets/campus-world-v2.png'));
for(const name of ['curriculum.js','map-layout.js','movement.js','campus.js']){
  const js=(await readFile(resolve(root,name),'utf8')).replaceAll('</script','<\\/script');
  html=html.replace('<script src="'+name+'"></script>',()=>'<script>'+js+'</script>');
}
const output=resolve(root,'../Biadon-Edu-Campus.html');
await writeFile(output,html);
console.log('Standalone HTML: '+output+' ('+Buffer.byteLength(html)+' bytes)');
