import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateWorld,evaluatePair,geometry,positionAt,vector,norm,KNOT,tack,syncSpeeds,PRACTICE_RADIUS} from '../static/give-way/engine.mjs';
import {PRESETS,presetWorld} from '../static/give-way/presets.mjs';
const boat=(id,x,y,heading,speed=5,type='power',sailSide='auto')=>({id,x,y,heading,speed,type,sailSide});
const world=boats=>({boats,wind:0,margin:50});
const rotate=(w,angle)=>{const t=angle*Math.PI/180,c=Math.cos(t),s=Math.sin(t);return {...w,wind:norm(w.wind+angle),boats:w.boats.map(b=>({...b,x:500+(b.x-500)*c-(b.y-325)*s,y:325+(b.x-500)*s+(b.y-325)*c,heading:norm(b.heading+angle)}))};};

test('all presets flow through one evaluator, with expected encounter rules',()=>{
 const rules=['12(a)(i)','12(a)(ii)','13','18','15','14','13','18','12(a)(i)','12(a)(iii)'];
 rules.forEach((rule,i)=>assert.equal(evaluateWorld(presetWorld(i))[0].rule,rule,PRESETS[i].name));
 assert.deepEqual(evaluateWorld(presetWorld(6))[0].giveWay,['A']);
 assert.equal(evaluateWorld(presetWorld(5))[0].status,'both');
 assert.equal(evaluateWorld(presetWorld(8)).length,3);
});
test('360° rigid rotation preserves duties, CPA and time for every preset',()=>{
 for(let i=0;i<PRESETS.length;i++){
  const w=presetWorld(i),base=evaluateWorld(w);
  for(let angle=0;angle<360;angle+=7){const rotated=evaluateWorld(rotate(w,angle));rotated.forEach((r,j)=>{
    assert.equal(r.rule,base[j].rule,`${i} rotation ${angle}`);
    assert.deepEqual(r.giveWay,base[j].giveWay);
    assert.ok(Math.abs(r.geometry.cpa-base[j].geometry.cpa)<1e-7);
    assert.ok(Math.abs(r.geometry.time-base[j].geometry.time)<1e-7);
  });}
 }
});
test('boat array order and translation do not determine the answer',()=>{
 for(let i=0;i<PRESETS.length;i++){
  const w=presetWorld(i),base=evaluateWorld(w)[0],a=w.boats[0],b=w.boats[1];
  const reversed=evaluatePair(b,a,w);
  assert.equal(reversed.rule,base.rule);assert.deepEqual([...reversed.giveWay].sort(),[...base.giveWay].sort());
  const shifted={...w,boats:[{...a,x:a.x-105,y:a.y+28},{...b,x:b.x-105,y:b.y+28}]};
  assert.equal(evaluateWorld(shifted)[0].rule,base.rule);
 }
});
test('a wind reversal changes the responsible sailboat',()=>{
 for(const i of [0,1]){const w=presetWorld(i);assert.deepEqual(evaluateWorld(w)[0].giveWay,['A']);w.wind=180;assert.deepEqual(evaluateWorld(w)[0].giveWay,['B']);}
});
test('crossing rays can have different arrival times and a distant CPA',()=>{
 const g=geometry(boat('A',270,475,45,8),boat('B',730,475,315,2));
 assert.ok(g.intersection);assert.ok(Math.abs(g.intersection.timeA-g.intersection.timeB)>100);assert.ok(g.cpa>200);
 assert.ok(Math.abs(g.intersection.x-500)<1e-7);assert.ok(Math.abs(g.intersection.y-245)<1e-7);
});
test('overtaking on a parallel track is detected without a ray intersection',()=>{
 const w=presetWorld(2),r=evaluateWorld(w)[0];assert.equal(r.geometry.intersection,null);assert.equal(r.rule,'13');assert.ok(r.geometry.cpa<1e-6);
 assert.ok(Math.abs(r.geometry.time-300/(5*KNOT))<1e-7);
 w.boats[1].type='power';assert.equal(evaluateWorld(w)[0].rule,'13');
});
test('engine propulsion changes the yacht’s classification',()=>{
 const w=presetWorld(3);assert.deepEqual(evaluateWorld(w)[0].giveWay,['B']);w.boats[0].type='motorsail';assert.equal(evaluateWorld(w)[0].rule,'15');assert.deepEqual(evaluateWorld(w)[0].giveWay,['A']);
});
test('reciprocal courses with distant passing lines are not treated as head-on risk',()=>{
 const r=evaluateWorld(world([boat('A',100,100,90),boat('B',800,400,270)]))[0];assert.equal(r.status,'clear');assert.ok(Math.abs(r.geometry.cpa-300)<1e-7);
});
test('nonmoving, receding and overlapping arrangements return contextual results',()=>{
 const cases=[world([boat('A',100,100,0,0),boat('B',120,100,0,0)]),world([boat('A',100,100,270),boat('B',130,100,90)]),world([boat('A',100,100,90),boat('B',100,100,270)])];
 for(const w of cases){const r=evaluateWorld(w)[0];assert.equal(r.status,'judgment');assert.deepEqual(r.standOn,[]);}
});
test('unrealistic powered-upwind sailing is flagged, with no forced duty',()=>{
 const w=presetWorld(0);w.boats[0].heading=0;assert.equal(evaluateWorld(w)[0].status,'setup');w.boats[0].type='power';assert.notEqual(evaluateWorld(w)[0].status,'setup');
});
test('mainsail placement determines tack when directly downwind or by the lee',()=>{
 const b=boat('A',0,0,180,5,'sail');assert.equal(tack(b,0),null);b.sailSide='port';assert.equal(tack(b,0),'starboard');b.sailSide='starboard';assert.equal(tack(b,0),'port');
});
test('unknown tack is not guessed; the specific port-to-windward case is handled',()=>{
 const w=presetWorld(9);assert.equal(evaluateWorld(w)[0].rule,'12(a)(iii)');w.boats[0].sailSide='unknown';assert.equal(evaluateWorld(w)[0].status,'information');
});
test('equal special statuses do not get an invented priority hierarchy',()=>{
 const w=presetWorld(4);w.boats[0].type='ram';w.boats[1].type='nuc';assert.equal(evaluateWorld(w)[0].status,'judgment');
});
test('reported CPA is simultaneous and a minimum, not a geometric crossing',()=>{
 for(const i of [0,2,6]){const w=presetWorld(i),[a,b]=w.boats,g=geometry(a,b);const dist=t=>{const pa=positionAt(a,t),pb=positionAt(b,t);return Math.hypot(pa.x-pb.x,pa.y-pb.y);};assert.ok(Math.abs(dist(g.time)-g.cpa)<1e-7);assert.ok(dist(Math.max(0,g.time-5))>=g.cpa-1e-7);assert.ok(dist(g.time+5)>=g.cpa-1e-7);}
});


test('automatic timing joins arbitrary forward crossings and remains idempotent',()=>{
 for(const [x,y,h] of [[500,600,315],[760,300,250],[650,500,290]]){
  const w={...world([boat('A',200,600,45),boat('B',x,y,h)]),autoSpeed:true};
  syncSpeeds(w);const g=geometry(...w.boats);
  assert.ok(g.intersection);assert.ok(g.cpa<1e-6);assert.ok(Math.abs(g.intersection.timeA-g.intersection.timeB)<1e-6);
  const before=structuredClone(w);syncSpeeds(w);assert.deepEqual(w,before);
  const reversed={...w,boats:[...w.boats].reverse()};syncSpeeds(reversed);assert.deepEqual(reversed.boats,[...w.boats].reverse());
 }
});
test('automatic timing supports overtaking and a shared three-boat meeting',()=>{
 for(const i of [2,5,6,8]){const w=presetWorld(i);for(const r of evaluateWorld(w))assert.ok(r.geometry.cpa<.02,PRESETS[i].name);}
 const w={...world([boat('A',0,0,90,3),boat('B',300,0,90,8)]),autoSpeed:true};syncSpeeds(w);
 assert.ok(w.boats[0].speed>w.boats[1].speed);assert.ok(geometry(...w.boats).cpa<1e-6);
});
test('auto leaves impossible and manually controlled worlds alone',()=>{
 for(const boats of [[boat('A',100,0,90),boat('B',0,0,270)],[boat('A',0,0,90),boat('B',0,400,90)]]){
  const w={...world(boats),autoSpeed:true},before=structuredClone(w);syncSpeeds(w);assert.deepEqual(w,before);
 }
 const w=presetWorld(0);w.autoSpeed=false;w.boats[0].speed=0;const before=structuredClone(w);syncSpeeds(w);assert.deepEqual(w,before);
});
test('speed bounds remain finite for extreme crossing ratios',()=>{
 const w={...world([boat('A',0,0,90),boat('B',10000,2,0)]),autoSpeed:true};syncSpeeds(w);
 for(const b of w.boats)assert.ok(Number.isFinite(b.speed)&&b.speed>=.1&&b.speed<=20);
 // A speed bound may prevent an exact collision; the geometry must still report the real CPA.
 assert.ok(geometry(...w.boats).cpa>0);
});
test('parallel neighbours do not stop synchronization of other eligible pairs',()=>{
 const w={...world([boat('A',0,0,90),boat('B',0,1000,90),boat('C',300,300,0,2)]),autoSpeed:true};syncSpeeds(w);
 assert.ok(geometry(w.boats[0],w.boats[2]).cpa<1e-6);
});
test('the enlarged practice radius includes near passes without inventing exact collisions',()=>{
 const w={boats:[boat('A',0,0,90),boat('B',800,200,270)],wind:0,margin:PRACTICE_RADIUS};
 const a=evaluateWorld(w)[0],b=evaluateWorld({...w,boats:[...w.boats].reverse()})[0];
 assert.equal(PRACTICE_RADIUS,250);assert.ok(Math.abs(a.geometry.cpa-200)<1e-6);
 assert.equal(a.status,'information');assert.deepEqual(a.giveWay,b.giveWay);assert.equal(a.rule,b.rule);
 w.margin=50;assert.equal(evaluateWorld(w)[0].status,'clear');
});
test('dragging a boat onto or just before a crossing still creates a close pass',()=>{
 for(const y of [0,-.5]){
  const w={boats:[boat('A',0,0,90),boat('B',500,y,180)],wind:0,autoSpeed:true,margin:PRACTICE_RADIUS};
  syncSpeeds(w);assert.ok(geometry(...w.boats).cpa<11);assert.notEqual(evaluateWorld(w)[0].status,'clear');
 }
});
