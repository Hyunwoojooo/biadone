/* All candidates use identical copy and the approved brand lockup. */
(async()=>{
 const response=await fetch(new URL('content.json',document.currentScript.src));
 if(!response.ok)throw new Error('비교 문구를 불러오지 못했습니다.');
 const copy=await response.json();
 document.querySelectorAll('[data-copy]').forEach(node=>{
  const value=node.dataset.copy.split('.').reduce((value,key)=>value?.[key],copy);
  if(typeof value!=='string')throw new Error('알 수 없는 비교 문구: '+node.dataset.copy);
  node.replaceChildren();
  value.split('\n').forEach((line,index)=>{if(index){node.append(document.createElement('br'));node.append(document.createTextNode(' '));}node.append(document.createTextNode(line));});
 });
 document.querySelectorAll('[data-brand-logo]').forEach(node=>{
  const inverse=node.dataset.brandLogo==='inverse';
  node.classList.add('biadone-logo');if(inverse)node.classList.add('biadone-logo--inverse');
  node.setAttribute('aria-label','Biadone');
  node.innerHTML='<span class="biadone-logo__symbol"><img src="../../../design-system/assets/logo/biadone-symbol'+(inverse?'-white':'')+'.svg" width="64" height="64" alt=""></span><span class="biadone-logo__name" aria-hidden="true">Biadone</span>';
 });
 document.documentElement.dataset.contentReady='true';
})().catch(error=>{document.documentElement.dataset.contentReady='error';console.error(error);});
