// Pure encounter model. Preset names, UI selection and reveal state never enter it.
export const KNOT = 1852 / 3600;
export const PRACTICE_RADIUS = 250;
export const TYPES = {
  sail: 'Sailing boat', power: 'Motorboat', motorsail: 'Yacht · engine + sail',
  fishing: 'Fishing · gear restricts movement', ram: 'Restricted ability to manoeuvre', nuc: 'Not under command'
};
export const norm = a => ((a % 360) + 360) % 360;
export const signed = a => norm(a + 180) - 180;
export const vector = h => ({x:Math.sin(h*Math.PI/180), y:-Math.cos(h*Math.PI/180)});
export const bearing = (a,b) => norm(Math.atan2(b.x-a.x, a.y-b.y)*180/Math.PI);
export const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const dot = (a,b) => a.x*b.x+a.y*b.y;
const cross = (a,b) => a.x*b.y-a.y*b.x;
const minus = (a,b) => ({x:a.x-b.x,y:a.y-b.y});
export function velocity(b){const v=vector(b.heading);return {x:v.x*b.speed*KNOT,y:v.y*b.speed*KNOT};}
export function positionAt(b,seconds){const v=velocity(b);return {x:b.x+v.x*seconds,y:b.y+v.y*seconds};}
export function sailSide(b,wind){
  if(b.sailSide && b.sailSide!=='auto')return b.sailSide==='unknown'?null:b.sailSide;
  const side=Math.sin((wind-b.heading)*Math.PI/180);
  return Math.abs(side)<1e-7?null:side>0?'port':'starboard';
}
export function tack(b,wind){const side=sailSide(b,wind);return side===null?null:side==='port'?'starboard':'port';}
export function setupIssue(b,wind){
  if(b.type==='sail' && b.speed>0 && Math.abs(signed(wind-b.heading))<35){
    return `Boat ${b.id} points inside the model’s 35° no-go zone while moving under sail. Change the wind, heading, speed or propulsion.`;
  }
  return null;
}
export function geometry(a,b){
  const r=minus(b,a),va=velocity(a),vb=velocity(b),rv=minus(vb,va),rv2=dot(rv,rv);
  const rawTime=rv2>1e-10?-dot(r,rv)/rv2:null;
  const time=rawTime===null?0:Math.max(0,rawTime);
  const pa=positionAt(a,time),pb=positionAt(b,time);
  const ua=vector(a.heading),ub=vector(b.heading),det=cross(ua,ub);
  let intersection=null;
  if(a.speed>0&&b.speed>0&&Math.abs(det)>1e-8){
    const da=cross(r,ub)/det,db=cross(r,ua)/det;
    if(da>=0&&db>=0){intersection={x:a.x+ua.x*da,y:a.y+ua.y*da,timeA:da/(a.speed*KNOT),timeB:db/(b.speed*KNOT)};}
  }
  return {distance:distance(a,b),rawTime,time,cpa:distance(pa,pb),pa,pb,intersection,
    bearingA:signed(bearing(a,b)-a.heading),bearingB:signed(bearing(b,a)-b.heading)};
}

// Match arrival times without changing positions or headings. Multiple vessels
// can share one meeting region; unrelated tracks keep their existing speeds.
export function syncSpeeds(world){
  if(!world.autoSpeed)return;
  const margin=world.margin??PRACTICE_RADIUS,candidates=[];
  const boats=[...world.boats].sort((a,b)=>a.id.localeCompare(b.id));
  for(let i=0;i<boats.length;i++)for(let j=i+1;j<boats.length;j++){
    const a=boats[i],b=boats[j],ua=vector(a.heading),ub=vector(b.heading),r=minus(b,a),det=cross(ua,ub);
    let da,db;
    if(Math.abs(det)>1e-8){da=cross(r,ub)/det;db=cross(r,ua)/det;}
    else if(dot(ua,ub)>0){
      const along=dot(r,ua),ahead=Math.max(100,Math.abs(along)*.6);
      da=ahead+Math.max(0,along);db=ahead+Math.max(0,-along);
      if(Math.abs(along)<1)continue; // Abreast parallel boats cannot catch each other.
    }else{da=dot(r,ua)/2;db=dot(minus(a,b),ub)/2;}
    if(!(da>=-1e-7&&db>=-1e-7)||Math.max(da,db)<1)continue;
    da=Math.max(0,da);db=Math.max(0,db);
    const pa={x:a.x+ua.x*da,y:a.y+ua.y*da},pb={x:b.x+ub.x*db,y:b.y+ub.y*db};
    if(distance(pa,pb)>margin)continue;
    candidates.push({a,b,da,db,point:{x:(pa.x+pb.x)/2,y:(pa.y+pb.y)/2},cost:da+db});
  }
  candidates.sort((a,b)=>a.cost-b.cost);
  const target=candidates[0];if(!target)return;
  const arrivals=[{boat:target.a,d:target.da},{boat:target.b,d:target.db}];
  for(const b of boats){
    if(b===target.a||b===target.b)continue;
    const u=vector(b.heading),r=minus(target.point,b),d=dot(r,u);
    if(d>1&&Math.abs(cross(r,u))<=margin/2)arrivals.push({boat:b,d});
  }
  const furthest=Math.max(...arrivals.map(a=>a.d)),pace=Math.min(20,Math.max(.1,world.autoPace??5));
  for(const a of arrivals)a.boat.speed=Math.max(.1,pace*a.d/furthest);
}
function result(g,status,title,text,rule='',giveWay=[],standOn=[]){return {geometry:g,status,title,text,rule,giveWay,standOn};}
function duty(g,give,stand,text,rule){return result(g,'duty',`${give.id} gives way to ${stand.id}`,text,rule,[give.id],[stand.id]);}
export function evaluatePair(a,b,world){
  const g=geometry(a,b),margin=world.margin??PRACTICE_RADIUS,wind=world.wind;
  const issue=setupIssue(a,wind)||setupIssue(b,wind);
  if(issue)return result(g,'setup','Check the sailing setup',issue);
  if(g.cpa>margin){return result(g,'clear','No close pass projected',`The closest projected separation is ${Math.round(g.cpa)} m, outside your ${margin} m practice margin. Keep observing; this assumes unchanged motion.`);}
  if(g.distance<2){return result(g,'judgment','The boats already overlap','Move them apart to create an approaching encounter. A priority answer is not useful at an existing collision.','2, 8');}
  if(g.rawTime===null){return result(g,'judgment','Close, with matching motion','Relative position is constant. There is no single future meeting point; assess the close situation rather than assuming a normal crossing.','7, 8');}
  if(g.rawTime<=0){return result(g,'judgment','Already close, moving apart','The closest approach is now or in the past. Keep checking until the vessels are clear; this new snapshot cannot establish any earlier overtaking obligation.','7, 8, 13');}

  // Rule 13 precedes the sailing and vessel-responsibility comparisons.
  const asternA=Math.abs(g.bearingB)>112.5+1e-6;
  const asternB=Math.abs(g.bearingA)>112.5+1e-6;
  if(asternA!==asternB){const [o,t]=asternA?[a,b]:[b,a];return duty(g,o,t,`${o.id} approaches ${t.id} from its stern sector. The overtaker stays clear until past and clear.`, '13');}
  if(asternA&&asternB)return result(g,'judgment','Check the approach','This geometry does not establish a normal crossing or a unique overtaker. More encounter history is needed.','7, 13');

  const ranks={power:0,motorsail:0,sail:1,fishing:2,ram:3,nuc:3};
  if(ranks[a.type]!==ranks[b.type]){
    const [give,stand]=ranks[a.type]<ranks[b.type]?[a,b]:[b,a];
    return duty(g,give,stand,`${TYPES[give.type]} ${give.id} keeps clear of ${TYPES[stand.type].toLowerCase()} ${stand.id} in this open-water encounter.`, '18');
  }
  if(ranks[a.type]>=2)return result(g,'judgment','No simple priority between these vessels','Their actual limitations matter. The selected statuses do not establish a unique stand-on vessel.','2, 8, 18');

  if(a.type==='sail'&&b.type==='sail'){
    const ta=tack(a,wind),tb=tack(b,wind),up=dot(minus(a,b),vector(wind));
    if(!ta||!tb){
      if(ta==='port'&&!tb&&up<0)return duty(g,a,b,`${a.id} is on port tack and cannot establish the tack of ${b.id} to windward.`, '12(a)(iii)');
      if(tb==='port'&&!ta&&up>0)return duty(g,b,a,`${b.id} is on port tack and cannot establish the tack of ${a.id} to windward.`, '12(a)(iii)');
      return result(g,'information','Establish the mainsail side','Tack cannot be determined for this arrangement. Set the mainsail side, or keep it unknown to explore uncertainty.','12');
    }
    if(ta!==tb){const [give,stand]=ta==='port'?[a,b]:[b,a];return duty(g,give,stand,`${give.id} is on port tack; ${stand.id} is on starboard tack.`, '12(a)(i)');}
    if(Math.abs(up)<.01)return result(g,'information','Neither boat is distinctly windward','Their positions are level across the wind. Move the encounter forward or establish more context.','12');
    const [give,stand]=up>0?[a,b]:[b,a];return duty(g,give,stand,`Both are on ${ta} tack. ${give.id} is windward of ${stand.id}.`, '12(a)(ii)');
  }

  // Head-on aspect, not merely reciprocal headings, is required.
  if(Math.abs(signed(a.heading-b.heading))>=174&&Math.abs(g.bearingA)<=6&&Math.abs(g.bearingB)<=6){
    return result(g,'both','Both turn to starboard','Two power-driven vessels meet nearly head-on; each alters to starboard.','14',[a.id,b.id]);
  }
  const starboardA=g.bearingA>0&&g.bearingA<=112.5+1e-6,starboardB=g.bearingB>0&&g.bearingB<=112.5+1e-6;
  if(starboardA!==starboardB){
    if(starboardA)return duty(g,a,b,`${a.id} has ${b.id} on its starboard side. Both are power-driven.`, '15');
    return duty(g,b,a,`${b.id} has ${a.id} on its starboard side. Both are power-driven.`, '15');
  }
  return result(g,'information','Check the vessel aspects','This boundary arrangement needs observation and context before assigning a crossing duty.','7, 14, 15');
}
export function evaluateWorld(world){
  const pairs=[];
  for(let i=0;i<world.boats.length;i++)for(let j=i+1;j<world.boats.length;j++){
    const a=world.boats[i],b=world.boats[j];pairs.push({ids:[a.id,b.id],...evaluatePair(a,b,world)});
  }
  return pairs;
}
