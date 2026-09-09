import {TYPES,norm,signed,vector,bearing,distance,sailSide,tack,setupIssue,evaluateWorld,syncSpeeds} from './engine.mjs';
import {PRESETS,presetWorld} from './presets.mjs';
const $=s=>document.querySelector(s);
const COLORS={A:'#44766b',B:'#bd765a',C:'#637ca0',D:'#9c7398'};
const ICONS={
  previous:'<path d="m14 5-7 7 7 7"/>',next:'<path d="m10 5 7 7-7 7"/>',
  add:'<path d="M12 4v16M4 12h16"/>',reset:'<path d="M5 8a8 8 0 1 1-1 7M5 3v6h6"/>',
  help:'<path d="M9 8a3.2 3.2 0 1 1 4.6 3c-1.2.6-1.6 1.3-1.6 2.7M12 17.5v.2"/><path d="M12 2.5a9.5 9.5 0 1 1-.1 0Z"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',trash:'<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'
};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const asset=b=>['sail','motorsail'].includes(b.type)?'assets/sailboat-hull.png':b.type==='power'?'assets/motorboat.png':'assets/fishing-boat.png';
const shortTypes={sail:'Sail',power:'Motor',motorsail:'Motor + sail',fishing:'Fishing · restricted by gear',ram:'Restricted manoeuvrability',nuc:'Not under command'};
const state={world:presetWorld(0),preset:0,selected:null,revealed:false,changed:false,point:null};
const sea=$('#sea'),map=$('#playground'),boatPop=$('#boat-popover'),pointPop=$('#point-popover');let drag=null,windDrag=null,camera=null;
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const compact=()=>matchMedia('(max-width:660px)').matches;
const boat=id=>state.world.boats.find(b=>b.id===(id||state.selected));
function updateCamera(){
  const r=sea.getBoundingClientRect(),ratio=r.width/r.height;
  const minX=Math.min(0,...state.world.boats.map(b=>b.x-95)),maxX=Math.max(1000,...state.world.boats.map(b=>b.x+95));
  const minY=Math.min(0,...state.world.boats.map(b=>b.y-95)),maxY=Math.max(650,...state.world.boats.map(b=>b.y+95));
  const width=Math.max(maxX-minX,(maxY-minY)*ratio),height=width/ratio;
  camera={x:(minX+maxX-width)/2,y:(minY+maxY-height)/2,width,height};
  sea.setAttribute('viewBox',`${camera.x} ${camera.y} ${width} ${height}`);
}
const view=()=>{if(!camera)updateCamera();return {...camera,right:camera.x+camera.width,bottom:camera.y+camera.height};};
const mapScale=()=>{const v=view();return sea.getBoundingClientRect().width/v.width;};
function moveBoat(b,x,y){const v=view(),pad=48/mapScale();b.x=clamp(x,v.x+pad,v.right-pad);b.y=clamp(y,v.y+pad,v.bottom-pad);}

const visualScale=()=>((compact()?75:100)/(126*mapScale()));
const speedText=n=>Number(n.toFixed(1));
const dirName=d=>['N','NE','E','SE','S','SW','W','NW'][Math.round(norm(d)/45)%8];
const formatTime=t=>!Number.isFinite(t)?'—':t<1?'Now':t<3600?`${Math.floor(Math.round(t)/60)}m ${Math.round(t)%60}s`:`${(t/3600).toFixed(1)} h`;
const pairs=()=>evaluateWorld(state.world);
function svgPoint(x,y){const p=sea.createSVGPoint();p.x=x;p.y=y;return p;}
function toMap(e){return svgPoint(e.clientX,e.clientY).matrixTransform(sea.getScreenCTM().inverse());}
function localPoint(p){const q=svgPoint(p.x,p.y).matrixTransform(sea.getScreenCTM()),r=map.getBoundingClientRect();return {x:q.x-r.left,y:q.y-r.top};}
function renderScenario(){
  $('#scenario-name').innerHTML=state.changed?'Scenarios':`<span class="scenario-num">${String(state.preset+1).padStart(2,'0')}</span>${PRESETS[state.preset].name}`;
  $('#scenario-menu').innerHTML=PRESETS.map((p,i)=>`<button data-preset="${i}" class="${!state.changed&&state.preset===i?'active':''}" aria-pressed="${!state.changed&&state.preset===i}"><span class="scenario-num">${String(i+1).padStart(2,'0')}</span>${p.name}${!state.changed&&state.preset===i?'<span class="check">✓</span>':''}</button>`).join('');
}
function closeScenario(){ $('#scenario-menu').hidden=true;$('#scenario-button').setAttribute('aria-expanded','false'); }
function closePopover(){boatPop.hidden=true;pointPop.hidden=true;state.point=null;}
function loadPreset(i){state.world=presetWorld(i);Object.assign(state,{preset:i,selected:null,revealed:false,changed:false,point:null});closePopover();closeScenario();$('#margin').value=state.world.margin;updateCamera();renderScenario();renderAnswer();paint();}
function changed(){syncSpeeds(state.world);state.revealed=false;state.changed=true;pointPop.hidden=true;state.point=null;renderAnswer();renderScenario();}
function mutate(fn){fn();changed();paint();syncPopover();}
function boatSVG(b){
  const c=COLORS[b.id],s=visualScale(),active=state.selected===b.id,side=sailSide(b,state.world.wind),sign=side==='port'?-1:1,hasSail=['sail','motorsail'].includes(b.type),warning=setupIssue(b,state.world.wind);
  const unknownSail=`<path d="M0 -4Q-30 0 -47 32L0 18 47 32Q30 0 0 -4Z" fill="#f7f8ef" fill-opacity=".38" stroke="#7f9386" stroke-width="1.1" stroke-dasharray="3 4"/><text x="0" y="10" text-anchor="middle" font-size="22" font-family="Caveat,cursive" fill="#536e63">?</text>`;
  const sails=hasSail?(side===null?unknownSail:`<path d="M0 -2Q${sign*30} -5 ${sign*49} 34Q${sign*21} 24 0 19Z" fill="#fffdf0" stroke="#38545a" stroke-width="1.35" stroke-linejoin="round" ${side?'':'stroke-dasharray="4 4"'}/><path d="M${sign*3} 0Q${sign*32} 7 ${sign*45} 31M${sign*3} 15 ${sign*41} 29" fill="none" stroke="#acb4a0" stroke-width=".6"/><path d="M0 -48Q${sign*10} -23 ${sign*21} -8L0 -7Z" fill="#fffced" stroke="#3a565a" stroke-width="1.1" stroke-linejoin="round"/><path d="M0 -46V23M0 19 ${'L'+sign*49} 34" stroke="#354c53" stroke-width="1.5" fill="none" stroke-linecap="round"/>`):'';
  const h=vector(b.heading),arm=88*s,v=view(),edge=14/mapScale();let d=arm;
  if(h.x>0)d=Math.min(d,(v.right-edge-b.x)/h.x);if(h.x<0)d=Math.min(d,(v.x+edge-b.x)/h.x);if(h.y>0)d=Math.min(d,(v.bottom-edge-b.y)/h.y);if(h.y<0)d=Math.min(d,(v.y+edge-b.y)/h.y);d=Math.max(14,d);
  const handle={x:b.x+h.x*d,y:b.y+h.y*d},u=1/mapScale(),r=78*s;
  const label={x:clamp(b.x+36*s,v.x+25*u,v.right-80*u),y:clamp(b.y+62*s,v.y+25*u,v.bottom-18*u)};
  return `<g class="boat-item ${active?'selected':''}"><g class="boat-ring"><ellipse cx="${b.x}" cy="${b.y}" rx="${r}" ry="${r*1.02}" fill="none" stroke="${c}" stroke-width="${1.1*u}" stroke-dasharray="${3*u} ${6*u}"/></g><circle data-drag="heading" data-relative="true" data-boat="${b.id}" cx="${b.x}" cy="${b.y}" r="${r}" fill="none" stroke="transparent" stroke-width="${22*u}" pointer-events="stroke"/><g data-drag="boat" data-boat="${b.id}" role="button" tabindex="0" aria-label="Boat ${b.id}, ${TYPES[b.type]}, ${speedText(b.speed)} knots. Drag to move; click to edit."><circle cx="${b.x}" cy="${b.y}" r="${64*s}" fill="transparent"/><g transform="translate(${b.x} ${b.y}) rotate(${b.heading}) scale(${s})"><path d="M-17 64q-10 11-11 20M0 68q-3 15 0 25M17 64q8 9 10 20" stroke="#7c9b8c" stroke-opacity=".3" stroke-width="1.1" stroke-linecap="round" fill="none"/><image href="${asset(b)}" x="-53" y="-73" width="106" height="141" pointer-events="none"/>${sails}${b.type==='motorsail'?'<rect x="-6" y="52" width="12" height="12" rx="4" fill="#667a74" stroke="#354c53" stroke-width="1.2"/>':''}</g><g transform="translate(${label.x} ${label.y})"><text class="boat-name-svg" font-size="${28*u}" fill="${c}" x="0" y="0">${b.id}</text><text class="boat-speed-svg" font-size="${11*u}" x="${24*u}" y="${-3*u}">${speedText(b.speed)} kn</text>${warning?`<text x="${65*u}" y="${-2*u}" font-size="${16*u}" fill="#a06d4e">!</text><title>${warning}</title>`:''}</g></g><g data-drag="heading" data-boat="${b.id}" role="button" tabindex="0" aria-label="Rotate boat ${b.id}; arrow keys turn by five degrees"><circle cx="${handle.x}" cy="${handle.y}" r="${22*u}" fill="transparent"/><circle cx="${handle.x}" cy="${handle.y}" r="${12*u}" fill="#f6f7eb" stroke="${c}" stroke-width="${1.2*u}"/><g transform="translate(${handle.x} ${handle.y}) scale(${u})"><path d="M-5 -3a6 6 0 1 1-1 5M-5 -7v5h5" fill="none" stroke="${c}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></g>${drag?.mode==='heading'&&drag.id===b.id?`<text x="${handle.x+18*u}" y="${handle.y+5*u}" font-family="Caveat,cursive" font-size="${20*u}" fill="${c}">${Math.round(b.heading)}°</text>`:""}<title>Turn boat ${b.id}</title></g></g>`;
}
function encounterPoint(g){
  return g.rawTime>0&&g.cpa<=state.world.margin?{x:(g.pa.x+g.pb.x)/2,y:(g.pa.y+g.pb.y)/2}:g.intersection;
}
function markers(results){
  const u=1/mapScale(),v=view(),inside=p=>p.x>v.x+20*u&&p.x<v.right-20*u&&p.y>v.y+20*u&&p.y<v.bottom-20*u;let output='';
  for(const p of results){const g=p.geometry,meeting=g.rawTime>0&&g.cpa<=state.world.margin,marker=encounterPoint(g);
    if(marker&&inside(marker)){output+=`<g data-point="${p.ids.join('-')}" tabindex="0" role="button" aria-label="${p.ids.join(' and ')}: ${meeting?'projected close pass':'path crossing'}. Click for timing."><circle class="encounter-zone" cx="${marker.x}" cy="${marker.y}" r="${state.world.margin/2}" fill="#d4bb8e" fill-opacity=".1" stroke="#b59d77" stroke-opacity=".28" stroke-width="${u}" stroke-dasharray="${3*u} ${7*u}" pointer-events="none"/><circle cx="${marker.x}" cy="${marker.y}" r="${34*u}" fill="transparent"/><circle cx="${marker.x}" cy="${marker.y}" r="${21*u}" fill="${meeting?'#ecd8b9':'#eef3e8'}" fill-opacity=".8" stroke="${meeting?'#b48963':'#8da08c'}" stroke-width="${u}" ${meeting?'':`stroke-dasharray="${3*u} ${4*u}"`}/><path d="M${marker.x-5*u} ${marker.y-5*u}q${5*u} ${4*u} ${10*u} ${10*u}M${marker.x+5*u} ${marker.y-5*u}l${-10*u} ${10*u}" stroke="${meeting?'#a77954':'#83957f'}" stroke-width="${1.4*u}" stroke-linecap="round" fill="none"/></g>`;}
    if(g.cpa>.5&&g.rawTime>0&&g.cpa<=state.world.margin&&inside(g.pa)&&inside(g.pb)){output+=`<path d="M${g.pa.x} ${g.pa.y}L${g.pb.x} ${g.pb.y}" stroke="#b4926e" stroke-width="${u}" stroke-dasharray="${3*u} ${5*u}"/><circle cx="${g.pa.x}" cy="${g.pa.y}" r="${4*u}" fill="#fff8e9" stroke="${COLORS[p.ids[0]]}"/><circle cx="${g.pb.x}" cy="${g.pb.y}" r="${4*u}" fill="#fff8e9" stroke="${COLORS[p.ids[1]]}"/>`;}
  }return output;
}
function windField(){
  const u=1/mapScale(),v=view(),tile=112*u;
  return `<defs><pattern id="wind-arrows" width="${tile}" height="${tile}" patternUnits="userSpaceOnUse"><path d="M0 -14Q-1 0 0 14M-5 8 0 15 5 8" transform="translate(${tile/2} ${tile/2}) rotate(${state.world.wind}) scale(${u})" fill="none" stroke="#789987" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" opacity=".3"/></pattern></defs><rect class="wind-field" x="${v.x}" y="${v.y}" width="${v.width}" height="${v.height}" fill="url(#wind-arrows)" pointer-events="none" aria-hidden="true"/>`;
}
function paint(){
  const u=1/mapScale(),s=visualScale(),v=view(),rayLength=Math.hypot(v.width,v.height)*1.5;
  const tracks=state.world.boats.map(b=>{const h=vector(b.heading),end={x:b.x+h.x*rayLength,y:b.y+h.y*rayLength},start={x:b.x+h.x*60*s,y:b.y+h.y*60*s};return `<path d="M${start.x} ${start.y}L${end.x} ${end.y}" fill="none" stroke="${COLORS[b.id]}" stroke-width="${1.2*u}" stroke-opacity="${b.speed?'.48':'.2'}" stroke-dasharray="${7*u} ${9*u}" stroke-linecap="round"/><path class="path-hit" data-drag="heading" data-boat="${b.id}" d="M${start.x} ${start.y}L${end.x} ${end.y}" style="stroke-width:${24*u}"/>`;}).join('');
  const ordered=[...state.world.boats.filter(b=>b.id!==state.selected),...state.world.boats.filter(b=>b.id===state.selected)];
  sea.innerHTML=windField()+tracks+markers(pairs())+ordered.map(boatSVG).join('');
  paintWind();$('#add-boat').disabled=state.world.boats.length>=4;$('.map-scale i').style.width=`${mapScale()*100}px`;
  if(!boatPop.hidden)positionBoatPopover();if(!pointPop.hidden)positionPointPopover();
}
function paintWind(){
  const wind=state.world.wind,h=vector(wind),tip={x:56+h.x*43,y:56+h.y*43};
  $('#wind-compass').innerHTML=`<path d="M56 13C80 12 100 32 100 56S80 100 56 99 12 81 13 56 33 12 56 13Z" fill="#f6f7e9" fill-opacity=".9" stroke="#97ac96" stroke-width="1.15"/><path d="M56 17v7M56 88v7M17 56h7M88 56h7" stroke="#b7c7b0" stroke-width=".9"/><g transform="translate(56 56) rotate(${wind})"><path d="M0 -25Q-1 0 0 27M-8 17 0 28 8 17" fill="none" stroke="#456b60" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/></g><circle cx="${tip.x}" cy="${tip.y}" r="5" fill="#658674" stroke="#f6f7e9" stroke-width="1.5"/>`;
  $('#wind-value').textContent=dirName(wind);$('#wind-control').setAttribute('aria-valuenow',Math.round(wind));$('#wind-control').setAttribute('aria-valuetext',`${Math.round(wind)} degrees, from ${dirName(wind)}`);
}
function openBoat(id){state.selected=id;state.revealed=false;renderAnswer();pointPop.hidden=true;state.point=null;renderBoatPopover();boatPop.hidden=false;paint();}
function renderBoatPopover(){
  const b=boat();if(!b)return;
  boatPop.style.setProperty('--boat-color',COLORS[b.id]);
  boatPop.innerHTML=`<div class="popover-top"><h2 id="boat-name" style="color:var(--boat-color)">Boat ${b.id}</h2><button class="icon-button" id="close-boat" title="Close" aria-label="Close boat controls">${icon('close')}</button></div><div class="type-row"><img src="${asset(b)}" alt=""><select id="type" aria-label="Boat type">${Object.entries(shortTypes).map(([key,name])=>`<option value="${key}" ${b.type===key?'selected':''}>${name}</option>`).join('')}</select></div><div class="field"><div class="field-top"><div class="speed-label"><label for="speed">Speed</label><label class="auto-speed" title="Match boat arrival times"><input aria-label="Automatically match boat arrival times" id="auto-speed" type="checkbox" ${state.world.autoSpeed?'checked':''}>Auto</label></div><div class="value-input"><input id="speed-number" type="number" min="0" max="20" step=".1" value="${speedText(b.speed)}" aria-label="Speed in knots"><span>kn</span></div></div><input id="speed" type="range" min="0" max="20" step=".1" value="${speedText(b.speed)}" aria-label="Boat speed"></div><div class="field"><div class="field-top"><label for="heading">Heading</label><div class="value-input"><input id="heading-number" type="number" min="0" max="359" step="1" value="${Math.round(b.heading)}" aria-label="Heading in degrees"><span>°</span></div></div><input id="heading" type="range" min="0" max="359" step="1" value="${Math.round(b.heading)}" aria-label="Boat heading"></div><div id="boat-context"></div><details class="boat-more"><summary>More</summary>${['sail','motorsail'].includes(b.type)?`<div class="advanced-field"><label for="sail-side">Mainsail side</label><select id="sail-side"><option value="auto">Auto</option><option value="port">Port</option><option value="starboard">Starboard</option><option value="unknown">Unknown</option></select></div>`:''}<div class="coords"><label for="pos-x">X <input id="pos-x" type="number" min="${Math.ceil(view().x)}" max="${Math.floor(view().right)}" step="1" value="${Math.round(b.x)}"></label><label for="pos-y">Y <input id="pos-y" type="number" min="${Math.ceil(view().y)}" max="${Math.floor(view().bottom)}" step="1" value="${Math.round(b.y)}"></label></div>${state.world.boats.length>2?`<div class="remove-row"><button class="icon-button" id="remove-boat" title="Remove boat ${b.id}" aria-label="Remove boat ${b.id}">${icon('trash')}</button></div>`:''}</details>`;
  if($('#sail-side'))$('#sail-side').value=b.sailSide;
  $('#close-boat').addEventListener('click',()=>{boatPop.hidden=true;sea.querySelector(`[data-drag="boat"][data-boat="${state.selected}"]`)?.focus();});
  $('#type').addEventListener('change',e=>{mutate(()=>boat().type=e.target.value);renderBoatPopover();positionBoatPopover();$('#type').focus();});
  $('#auto-speed').addEventListener('change',e=>mutate(()=>{state.world.autoSpeed=e.target.checked;state.world.autoPace=Math.max(1,...state.world.boats.map(b=>b.speed));}));
  $('#speed').addEventListener('input',e=>mutate(()=>{state.world.autoSpeed=false;boat().speed=Number(e.target.value);}));
  $('#heading').addEventListener('input',e=>mutate(()=>boat().heading=Number(e.target.value)));
  $('#speed-number').addEventListener('change',e=>{const n=Number(e.target.value);if(Number.isFinite(n))mutate(()=>{state.world.autoSpeed=false;boat().speed=clamp(Math.round(n*10)/10,0,20);});});
  $('#heading-number').addEventListener('change',e=>{const n=Number(e.target.value);if(Number.isFinite(n))mutate(()=>boat().heading=norm(n));});
  $('#sail-side')?.addEventListener('change',e=>mutate(()=>boat().sailSide=e.target.value));
  for(const [id,key] of [['pos-x','x'],['pos-y','y']])$('#'+id).addEventListener('change',e=>{const n=Number(e.target.value);if(Number.isFinite(n))mutate(()=>moveBoat(boat(),key==='x'?n:boat().x,key==='y'?n:boat().y));});
  $('#remove-boat')?.addEventListener('click',()=>{if(state.world.boats.length<=2)return;state.world.boats=state.world.boats.filter(b=>b.id!==state.selected);state.selected=null;closePopover();changed();paint();});
  $('.boat-more').addEventListener('toggle',()=>positionBoatPopover());syncPopover();
}
function syncPopover(){
  const b=boat();if(!b||!$('#boat-context'))return;
  for(const [id,val] of [['speed',speedText(b.speed)],['speed-number',speedText(b.speed)],['heading',Math.round(b.heading)],['heading-number',Math.round(b.heading)],['pos-x',Math.round(b.x)],['pos-y',Math.round(b.y)]])if($('#'+id))$('#'+id).value=val;
  $('#auto-speed').checked=state.world.autoSpeed;
  const t=tack(b,state.world.wind),issue=setupIssue(b,state.world.wind);
  $('#boat-context').innerHTML=`${b.type==='sail'?`<p class="tack-note">${t?`${t[0].toUpperCase()+t.slice(1)} tack`:'Tack unknown'}</p>`:''}${issue?'<p class="setup-note">Inside the sailing no-go zone.</p>':''}`;
}
function positionFloating(el,p,gap=65){
  if(el.hidden)return;const q=localPoint(p),r=map.getBoundingClientRect(),w=el.offsetWidth,h=el.offsetHeight;let x,y;
  if(!compact()&&q.x+gap+w<r.width-14){x=q.x+gap;y=q.y-h/2;}
  else if(!compact()&&q.x-gap-w>14){x=q.x-gap-w;y=q.y-h/2;}
  else {x=q.x-w/2;y=q.y-h-gap;if(y<12&&q.y+gap+h<r.height-12)y=q.y+gap;}
  el.style.left=`${clamp(x,9,r.width-w-9)}px`;el.style.top=`${clamp(y,9,r.height-h-104)}px`;
}
function positionBoatPopover(){const b=boat();if(b)positionFloating(boatPop,b,compact()?53:75);}
function openPoint(ids){
  const p=pairs().find(p=>p.ids.join('-')===ids);if(!p)return;boatPop.hidden=true;state.point=ids;const g=p.geometry;
  pointPop.innerHTML=`<div class="popover-top"><h2>${p.ids.join(' & ')}</h2><button class="icon-button" id="close-point" title="Close" aria-label="Close geometry">${icon('close')}</button></div><dl><dt>Closest pass</dt><dd>${Math.round(g.cpa)} m</dd><dt>In</dt><dd>${formatTime(g.time)}</dd>${g.intersection?`<dt>${p.ids[0]} at crossing</dt><dd>${formatTime(g.intersection.timeA)}</dd><dt>${p.ids[1]} at crossing</dt><dd>${formatTime(g.intersection.timeB)}</dd>`:''}</dl>`;
  pointPop.hidden=false;$('#close-point').addEventListener('click',()=>{pointPop.hidden=true;state.point=null;});positionPointPopover();
}
function positionPointPopover(){const p=pairs().find(p=>p.ids.join('-')===state.point);if(!p)return;const g=p.geometry,q=encounterPoint(g)||{x:(g.pa.x+g.pb.x)/2,y:(g.pa.y+g.pb.y)/2};positionFloating(pointPop,q,37);}
function renderAnswer(){
  const tray=$('#answer-tray');
  if(!state.revealed){tray.innerHTML=`<button class="reveal-button" id="reveal">${icon('eye')} Reveal</button>`;$('#reveal').addEventListener('click',()=>{state.revealed=true;closePopover();renderAnswer();});return;}
  const results=pairs();
  tray.innerHTML=`<div class="floating answer-card"><button class="icon-button" id="hide-answer" title="Hide answer" aria-label="Hide answer">${icon('close')}</button><div role="status">${results.map(p=>`<article class="answer-row">${results.length>1&&!p.ids.every(id=>new RegExp(`\\b${id}\\b`).test(p.title))?`<span class="pair-id">${p.ids.join(" ↔ ")}</span>`:""}<h3>${p.title}</h3><details><summary>Why?</summary><p>${p.text}</p>${results.length>1?'<p class="context-note">Check all boats before choosing a manoeuvre.</p>':''}${p.standOn.length?'<p class="context-note">Stand on initially means maintaining course and speed while monitoring. Rule 17 can permit or require intervention.</p>':''}${p.rule?`<a href="https://www.navcen.uscg.gov/navigation-rules-amalgamated" target="_blank" rel="noreferrer">Rule ${p.rule} ↗</a>`:''}</details></article>`).join('')}</div></div>`;
  $('#hide-answer').addEventListener('click',()=>{state.revealed=false;renderAnswer();$('#reveal').focus();});
}
sea.addEventListener('pointerdown',e=>{
  if(drag||windDrag||e.button>0)return;closeScenario();const hit=e.target.closest('[data-drag]'),point=e.target.closest('[data-point]');
  if(point){openPoint(point.dataset.point);return;}
  if(!hit){closePopover();state.selected=null;paint();return;}
  const id=hit.dataset.boat,b=boat(id),p=toMap(e);sea.setPointerCapture(e.pointerId);
  drag={mode:hit.dataset.drag,id,pointer:e.pointerId,start:p,offset:{x:p.x-b.x,y:p.y-b.y},headingOffset:hit.dataset.relative==='true'?bearing(b,p)-b.heading:0,moved:false};state.selected=id;closePopover();paint();e.preventDefault();
});
sea.addEventListener('pointermove',e=>{
  if(!drag||drag.pointer!==e.pointerId)return;const p=toMap(e);if(!drag.moved&&distance(p,drag.start)<3/mapScale())return;
  drag.moved=true;const b=boat(drag.id);sea.classList.add('dragging');
  if(drag.mode==='boat'){moveBoat(b,p.x-drag.offset.x,p.y-drag.offset.y);}
  else {if(distance(b,p)<8)return;b.heading=norm(Math.round(bearing(b,p)-drag.headingOffset));}
  changed();paint();
});
function endDrag(e){
  if(!drag||drag.pointer!==e.pointerId)return;const d=drag;drag=null;if(sea.hasPointerCapture(e.pointerId))sea.releasePointerCapture(e.pointerId);sea.classList.remove('dragging');
  if(e.type==='pointerup'&&!d.moved&&d.mode==='boat')openBoat(d.id);else paint();
}
sea.addEventListener('pointerup',endDrag);sea.addEventListener('pointercancel',endDrag);sea.addEventListener('lostpointercapture',()=>{drag=null;sea.classList.remove('dragging');});
sea.addEventListener('keydown',e=>{
  const point=e.target.closest('[data-point]');if(point&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openPoint(point.dataset.point);return;}
  const hit=e.target.closest('[data-drag]');if(!hit)return;const id=hit.dataset.boat,mode=hit.dataset.drag;
  if(e.key==='Enter'||e.key===' '){e.preventDefault();openBoat(id);$('#type').focus();return;}
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();state.selected=id;closePopover();
  mutate(()=>{const b=boat(id),step=e.shiftKey?20:5;if(mode==='boat'){moveBoat(b,b.x+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),b.y+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0));}else b.heading=norm(b.heading+(['ArrowRight','ArrowDown'].includes(e.key)?step:-step));});
  sea.querySelector(`[data-drag="${mode}"][data-boat="${id}"][tabindex]`)?.focus();
});
const windControl=$('#wind-control');
windControl.addEventListener('pointerdown',e=>{if(e.button>0||drag)return;closePopover();closeScenario();windControl.setPointerCapture(e.pointerId);windDrag={pointer:e.pointerId};e.preventDefault();});
windControl.addEventListener('pointermove',e=>{if(!windDrag||windDrag.pointer!==e.pointerId)return;const r=$('#wind-compass').getBoundingClientRect(),cx=r.x+r.width/2,cy=r.y+r.height/2;if(Math.hypot(e.clientX-cx,e.clientY-cy)<8)return;mutate(()=>state.world.wind=norm(Math.round(Math.atan2(e.clientX-cx,cy-e.clientY)*180/Math.PI)));});
for(const evt of ['pointerup','pointercancel','lostpointercapture'])windControl.addEventListener(evt,e=>{if(!windDrag)return;windDrag=null;if(windControl.hasPointerCapture(e.pointerId))windControl.releasePointerCapture(e.pointerId);});
windControl.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();mutate(()=>state.world.wind=e.key==='Home'?0:e.key==='End'?359:norm(state.world.wind+(['ArrowRight','ArrowDown'].includes(e.key)?1:-1)*(e.shiftKey?15:5)));});
$('#scenario-button').addEventListener('click',()=>{const menu=$('#scenario-menu');menu.hidden=!menu.hidden;$('#scenario-button').setAttribute('aria-expanded',!menu.hidden);closePopover();});
$('#scenario-menu').addEventListener('click',e=>{const b=e.target.closest('[data-preset]');if(b)loadPreset(Number(b.dataset.preset));});
$('#previous').addEventListener('click',()=>loadPreset((state.preset+PRESETS.length-1)%PRESETS.length));$('#next').addEventListener('click',()=>loadPreset((state.preset+1)%PRESETS.length));$('#reset').addEventListener('click',()=>loadPreset(state.preset));
$('#add-boat').addEventListener('click',()=>{if(state.world.boats.length>=4)return;const id=Object.keys(COLORS).find(id=>!state.world.boats.some(b=>b.id===id));state.world.boats.push({id,x:500,y:540,heading:0,speed:4,type:'power',sailSide:'auto'});changed();openBoat(id);});
$('#help-button').addEventListener('click',()=>{closeScenario();closePopover();$('#help-dialog').showModal();});$('#close-help').addEventListener('click',()=>$('#help-dialog').close());$('#help-dialog').addEventListener('click',e=>{if(e.target===$('#help-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('#margin').addEventListener('change',e=>mutate(()=>state.world.margin=Number(e.target.value)));
window.addEventListener('keydown',e=>{if(e.key==='Escape'){const id=!boatPop.hidden&&state.selected;closeScenario();closePopover();if(id)sea.querySelector(`[data-drag="boat"][data-boat="${id}"]`)?.focus();}});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.scenario-anchor'))closeScenario();});
for(const [id,name] of [['previous','previous'],['next','next'],['add-boat','add'],['reset','reset'],['help-button','help'],['close-help','close']])$('#'+id).innerHTML=icon(name);
new ResizeObserver(()=>{if(!drag&&!windDrag){updateCamera();paint();}}).observe(map);
loadPreset(0);
