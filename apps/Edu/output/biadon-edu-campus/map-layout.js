/* Coordinates are original map-space pixels (1200x900), measured at the feet. */
(() => {
  'use strict';
  const points = {
    entry:[615,835], front:[615,805], leftFront:[525,770], westPass:[490,675],
    south:[540,565], center:[625,455], west:[480,450], north:[630,360],
    east:[795,435], eastSouth:[800,545],
    'F-door':[615,780], 'A-door':[400,425], 'B-door':[560,310],
    'C-door':[755,350], 'D-door':[895,450], 'E-door':[850,635], 'T-door':[405,610],
    'A-front':[440,445], 'B-front':[565,355], 'C-front':[748,395],
    'D-front':[850,460], 'E-front':[812,610], 'T-front':[450,630]
  };
  const edges = [
    ['entry','front'],['front','leftFront'],['leftFront','F-door'],
    ['leftFront','westPass'],['westPass','south'],['south','center'],
    ['south','west'],['center','west'],['center','north'],['center','east'],
    ['north','west'],['north','east'],['east','eastSouth'],
    ['west','A-front'],['A-front','A-door'],['north','B-front'],['B-front','B-door'],
    ['east','C-front'],['C-front','C-door'],['east','D-front'],['D-front','D-door'],
    ['eastSouth','E-front'],['E-front','E-door'],['westPass','T-front'],['T-front','T-door']
  ];
  const nodes=Object.entries(points).map(([id,[x,y]])=>({id,x,y,links:[]}));
  const byId=Object.fromEntries(nodes.map(node=>[node.id,node]));
  edges.forEach(([a,b])=>{byId[a].links.push(b);byId[b].links.push(a);});
  function circle(x,y,r){return Array.from({length:16},(_,i)=>[x+Math.cos(i*Math.PI/8)*r,y+Math.sin(i*Math.PI/8)*r]);}
  function lane(a,b,width=24){
    const length=Math.hypot(b.x-a.x,b.y-a.y),nx=-(b.y-a.y)/length*width,ny=(b.x-a.x)/length*width;
    return [[a.x+nx,a.y+ny],[b.x+nx,b.y+ny],[b.x-nx,b.y-ny],[a.x-nx,a.y-ny]];
  }
  const walkable=[
    [[390,450],[565,315],[640,315],[765,355],[902,450],[830,535],[745,590],[625,625],[480,670],[430,615],[450,550]],
    [[545,835],[693,835],[704,790],[648,747],[525,772]],
    ...edges.map(([a,b])=>lane(byId[a],byId[b])),
    ...nodes.map(({x,y})=>circle(x,y,26))
  ];
  const portals = [
    {id:'F',x:615,y:780,exit:{x:615,y:825},node:'F-door',radius:52},
    {id:'A',x:400,y:425,exit:{x:440,y:445},node:'A-door',radius:52},
    {id:'B',x:560,y:310,exit:{x:565,y:355},node:'B-door',radius:52},
    {id:'C',x:755,y:350,exit:{x:748,y:395},node:'C-door',radius:52},
    {id:'D',x:895,y:450,exit:{x:850,y:460},node:'D-door',radius:52},
    {id:'E',x:850,y:635,exit:{x:812,y:610},node:'E-door',radius:52},
    {id:'T',x:405,y:610,exit:{x:450,y:630},node:'T-door',radius:56}
  ];
  const labels={F:[640,586],A:[240,270],B:[520,58],C:[855,65],D:[1100,492],E:[1015,753],T:[220,560]};
  window.CAMPUS_MAP={width:1200,height:900,start:{x:615,y:835},nodes,edges,walkable,portals,labels};
})();
