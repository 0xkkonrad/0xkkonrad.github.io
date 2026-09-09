// Scenarios are starting data only. Every answer is calculated by engine.mjs.
import {PRACTICE_RADIUS,syncSpeeds} from './engine.mjs';
const boat=(id,x,y,heading,speed=5,type='sail',sailSide='auto')=>({id,x,y,heading,speed,type,sailSide});
export const PRESETS=[
  {name:'Opposite tacks',wind:0,boats:[boat('A',270,475,45),boat('B',730,475,315)]},
  {name:'Same tack',wind:0,boats:[boat('A',300,180,120),boat('B',300,480,60)]},
  {name:'Overtaking',wind:0,boats:[boat('A',220,380,90,8),boat('B',520,380,90,3)]},
  {name:'Sail + power',wind:0,boats:[boat('A',270,475,45),boat('B',730,475,315,5,'power')]},
  {name:'Power crossing',wind:0,boats:[boat('A',270,475,45,5,'power'),boat('B',730,475,315,5,'power')]},
  {name:'Head-on',wind:0,boats:[boat('A',240,350,90,5,'power'),boat('B',760,350,270,5,'power')]},
  {name:'Sail overtakes motor',wind:0,boats:[boat('A',220,380,90,8),boat('B',520,380,90,3,'power')]},
  {name:'Working vessel',wind:0,boats:[boat('A',270,475,45),boat('B',730,475,315,5,'fishing')]},
  {name:'Three boats',wind:0,boats:[boat('A',270,475,45),boat('B',730,475,315),boat('C',174.73,245,90,5,'power')]},
  {name:'Unclear tack',wind:0,boats:[boat('A',300,480,60),boat('B',300,180,120,5,'sail','unknown')]}
];
export const presetWorld=index=>{
  const p=PRESETS[index],world={wind:p.wind,margin:PRACTICE_RADIUS,autoSpeed:true,autoPace:Math.max(...p.boats.map(b=>b.speed)),boats:structuredClone(p.boats)};
  syncSpeeds(world);return world;
};
