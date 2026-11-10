import { createStore, activeEvents, localDay } from './store.js';
import { ACHIEVEMENTS, ROASTS, LEVELS } from './brand.js';
import { setupPWA } from './pwa.js';
import { avatarById } from './avatars.js';
import { createAvatarPicker } from './avatar-picker.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const format = value => new Intl.NumberFormat().format(value);
const art = id => avatarById(id).src;
const icons = {
  dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7 7h.01M17 7h.01M12 12h.01M7 17h.01M17 17h.01" stroke-width="3"/>',
  sound: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m16 9 5 6m0-6-5 6"/>',
  settings: '<path d="m9 3-.5 3-2 1.1L4 6l-2 3 2.4 2v2L2 15l2 3 2.5-1.1 2 1.1.5 3h4l.5-3 2-1.1L18 18l2-3-2.4-2v-2L20 9l-2-3-2.5 1.1-2-1.1-.5-3Z"/><circle cx="11" cy="12" r="3"/>',
  jar: '<path d="M7 3h10v4H7zM7 7c-2 1-3 3-3 5v6a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-6c0-2-1-4-3-5"/><path d="M8 13h.01M16 13h.01M9 17q3 2 6 0"/>',
  receipts: '<path d="M5 3v18l3-2 4 2 4-2 3 2V3l-3 2-4-2-4 2-3-2Z"/><path d="M9 9h6M9 13h6M9 17h3"/>',
  stickers: '<path d="M14 21H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8Z"/><path d="M14 21v-5a2 2 0 0 1 2-2h5M8 8h.01M14 8h.01M8 11q3 3 6 0"/>',
  pencil: '<path d="m14 4 6 6M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5Z"/>'
};
const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;
const store = createStore();
let state = store.getState();
let avatarPlayer = null;
const avatarPicker = createAvatarPicker({onSelect: (player,id) => store.setAvatar(player,id)});
let currentTab = 'jar', period = 'all', stickerFilter = 'all', historyLimit = 30;
let toastTimer, audioContext, pwa;
let settings = { sound: true, haptics: true };
try { settings = { ...settings, ...JSON.parse(localStorage.getItem('swearjar:preferences') || '{}') }; } catch { /* Preferences never prevent opening the jar. */ }
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function statsFor(events = activeEvents(state.events)) {
  const totals = [0, 0], days = {}, hours = Array(24).fill(0);
  for (const event of events) {
    totals[event.player]++;
    days[event.day] = (days[event.day] || 0) + 1;
    hours[event.hour]++;
  }
  return { total: events.length, totals, playerTotal: Math.max(...totals), bothTotal: Math.min(...totals),
    dayTotal: Math.max(0, ...Object.values(days)), daysActive: Object.keys(days).length,
    lateNight: events.filter(event => event.hour >= 0 && event.hour <= 4).length,
    earlyBird: events.filter(event => event.hour >= 5 && event.hour <= 8).length, days, hours, events };
}
function achievementValue(achievement, stats) { return Number(stats[achievement.rule]) || 0; }
function unlocked(achievement, stats) { return achievementValue(achievement, stats) >= achievement.threshold; }
function unlockedIds(stats) { return new Set(ACHIEVEMENTS.filter(item => unlocked(item, stats)).map(item => item.id)); }
function levelFor(count) {
  const levels = Array.isArray(LEVELS) ? LEVELS : [];
  const level = [...levels].reverse().find(item => count >= (item.threshold ?? item.min ?? 0));
  return level?.title || level?.name || (count === 0 ? 'Suspiciously innocent' : count < 10 ? 'Tiny menace' : count < 50 ? 'Certified little shit' : 'A lost fucking cause');
}
function conditionFor(achievement) {
  const n = format(achievement.threshold);
  return ({total:`${n} total`,playerTotal:`${n} by one player`,bothTotal:`${n} each`,dayTotal:`${n} in a day`,daysActive:`Log swears on ${n} different days`,lateNight:'1 swear, midnight–4:59 am',earlyBird:'1 swear, 5:00–8:59 am'})[achievement.rule] || `${n} little crimes`;
}
function weekDays() {
  const days = [];
  for (let i=6;i>=0;i--) { const date = new Date(); date.setDate(date.getDate()-i); days.push({key:localDay(date),date}); }
  return days;
}
function filteredEvents(events) {
  if (period === 'today') return events.filter(event => event.day === localDay());
  if (period === 'week') { const days = new Set(weekDays().map(day => day.key)); return events.filter(event => days.has(event.day)); }
  return events;
}
function humanDate(event) {
  const date = new Date(event.at);
  return `${date.toLocaleDateString(undefined,{month:'short',day:'numeric'})} · ${date.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}`;
}
function showToast(message, options = {}) {
  clearTimeout(toastTimer);
  const toast = document.createElement('div'); toast.className = 'toast';
  if (options.sticker) { const image = document.createElement('img'); image.src=art(options.sticker); image.alt=''; toast.append(image); }
  const copy = document.createElement('span'); copy.textContent=message;
  if (options.detail) { const small=document.createElement('small'); small.textContent=options.detail; copy.append(small); }
  toast.append(copy);
  if (options.action) { const button=document.createElement('button'); button.type='button'; button.textContent=options.actionLabel || 'Undo'; button.addEventListener('click',options.action); toast.append(button); }
  const modal=document.querySelector('dialog[open]');
  let region=$('toast-region');
  if(modal){
    region=modal.querySelector('.dialog-feedback');
    if(!region){region=document.createElement('div');region.className='dialog-feedback';region.setAttribute('role','status');modal.querySelector('.dialog-inner, .avatar-dialog-inner').prepend(region);}
  }
  region.replaceChildren(toast);
  toastTimer=setTimeout(()=>{region.replaceChildren();},options.duration || 5500);
}
function showError(error) { showToast(error?.message || 'Something went wrong. Give that another go.', {duration:8500}); }
function saveSettings() {
  try { localStorage.setItem('swearjar:preferences',JSON.stringify(settings)); }
  catch { showToast('Your browser could not save sound preferences.'); }
  renderSettings();
}
function sound(player = 0, achievement = false) {
  if (!settings.sound) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    void audioContext.resume();
    const now = audioContext.currentTime;
    const notes = achievement ? [523,659,784,1047] : player===0 ? [620,930] : [420,680];
    notes.forEach((frequency,index)=>{
      const oscillator=audioContext.createOscillator(), gain=audioContext.createGain();
      oscillator.type=achievement?'triangle':'sine';
      const start=now+index*(achievement?.085:.045);
      oscillator.frequency.setValueAtTime(frequency,start);
      if (!achievement) oscillator.frequency.exponentialRampToValueAtTime(frequency*.45,start+.16);
      gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.13,start+.008);gain.gain.exponentialRampToValueAtTime(.0001,start+.19);
      oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.start(start);oscillator.stop(start+.21);
    });
  } catch { /* A browser can decline sound without affecting a recorded swear. */ }
}
function celebrate(player, special = false) {
  if (settings.haptics && navigator.vibrate) navigator.vibrate(special?[35,30,35]:18);
  if (reducedMotion.matches) return;
  const host=$('celebration');
  const count=special?16:7;
  for (let i=0;i<count;i++) {
    const bit=document.createElement('span');bit.className='confetti';bit.textContent=['✦','✱','♡','+1'][i%4];
    bit.style.color=['#ad78d6','#8aaa3d','#e15896','#c78e25'][i%4];
    bit.style.setProperty('--x',`${(Math.random()-.5)*450}px`);bit.style.setProperty('--y',`${-50-Math.random()*320}px`);bit.style.setProperty('--r',`${(Math.random()-.5)*160}deg`);host.append(bit);setTimeout(()=>bit.remove(),950);
  }
  const card=$(`player-card-${player}`);
  if(card){card.classList.add('just-tapped');setTimeout(()=>card.classList.remove('just-tapped'),170);const label=document.createElement('span');label.className='burst-label';label.textContent='+1';card.append(label);setTimeout(()=>label.remove(),750);}
}
async function add(player) {
  const before=unlockedIds(statsFor());
  // Start audio from the trusted click so mobile Safari can unlock its audio context.
  sound(player);
  try {
    const event=await store.addSwear(player);
    const gained=ACHIEVEMENTS.filter(item=>unlocked(item,statsFor())&&!before.has(item.id));
    const undo=async()=>{try{await store.undo(event.id);showToast('Undone.');}catch(error){showError(error);}};
    celebrate(player,gained.length>0);
    if(gained.length){const sticker=gained.at(-1);sound(player,true);showToast(`Unlocked: ${sticker.title}`,{sticker:sticker.sticker,detail:gained.length>1?`${gained.length} new stickers`:undefined,action:undo,duration:6500});}
    else {const roasts=Array.isArray(ROASTS)?ROASTS:['One swear. Zero character development.'];showToast(roasts[Math.floor(Math.random()*roasts.length)] || '+1 little crime.',{action:undo});}
  } catch(error){showError(error);}
}
function renderPlayers(stats) {
  if (!$('player-card-0')) {
    $('player-grid').innerHTML=[0,1].map(player=>`<div class="player-wrap"><button class="player-card player-${player}" id="player-card-${player}" type="button"><span class="player-name" id="player-name-${player}"></span><span class="player-title" id="player-title-${player}"></span><span class="score-line"><span class="score" id="player-score-${player}">0</span><span class="score-label">total</span></span><span class="plus" aria-hidden="true">+</span></button><button class="avatar-edit" id="avatar-edit-${player}" type="button"><img id="player-mascot-${player}" width="150" height="150" alt=""><span class="avatar-edit-die" aria-hidden="true">${svg('dice')}</span></button><button class="rename-button" id="rename-${player}" type="button">${svg('pencil')}</button><div class="player-under" id="player-under-${player}"></div></div>`).join('');
    [0,1].forEach(player=>{
      $(`player-card-${player}`).addEventListener('click',()=>add(player));
      $(`rename-${player}`).addEventListener('click',()=>openSettings(player));
      $(`avatar-edit-${player}`).addEventListener('click',()=>{
        avatarPlayer=player;
        avatarPicker.open({player,name:state.names[player],selected:state.avatars[player]});
      });
    });
  }
  [0,1].forEach(player=>{
    $(`player-name-${player}`).textContent=state.names[player];
    $(`player-name-${player}`).title=state.names[player];
    $(`player-title-${player}`).textContent=levelFor(stats.totals[player]);
    $(`player-score-${player}`).textContent=format(stats.totals[player]);
    $(`player-card-${player}`).style.setProperty('--digits',String(format(stats.totals[player]).length));
    $(`player-card-${player}`).classList.toggle('big-count',stats.totals[player]>=1000);
    $(`player-card-${player}`).setAttribute('aria-label',`Add one swear for ${state.names[player]}. ${format(stats.totals[player])} so far.`);
    $(`rename-${player}`).setAttribute('aria-label',`Rename ${state.names[player]}`);
    $(`avatar-edit-${player}`).setAttribute('aria-label',`Change ${state.names[player]}'s avatar`);
    $(`player-mascot-${player}`).src=art(state.avatars[player]);
    const today=stats.events.filter(event=>event.player===player&&event.day===localDay()).length;
    $(`player-under-${player}`).innerHTML=`<span><b>${format(today)}</b> today</span>`;
  });
  const lead=Math.abs(stats.totals[0]-stats.totals[1]);
  const leader=state.names[stats.totals[0]>=stats.totals[1]?0:1];
  const caption=stats.total===0?'':lead===0?'Equally guilty.':`${leader} leads by ${format(lead)}.`;
  const ratio=stats.total?stats.totals[0]/stats.total*100:50;
  $('rivalry').hidden=stats.total===0;
  $('rivalry').innerHTML=`<div class="rivalry-bar" role="img" aria-label="${escape(state.names[0])}: ${stats.totals[0]} swears. ${escape(state.names[1])}: ${stats.totals[1]} swears."><span class="rivalry-fill" style="width:${ratio}%"></span><span class="rivalry-fill" style="width:${100-ratio}%"></span></div>${caption?`<p class="rivalry-caption">${escape(caption)}</p>`:''}`;
}
function renderJar(stats) {
  renderPlayers(stats);
  const next=ACHIEVEMENTS.find(item=>!unlocked(item,stats));
  if(next){
    const value=Math.min(achievementValue(next,stats),next.threshold);
    $('next-achievement').innerHTML=`<button class="next-link" data-go="stickers" type="button"><img src="${art(next.sticker)}" width="92" height="92" alt=""><span class="next-info"><span class="eyebrow">NEXT STICKER</span><strong class="next-title">${escape(next.title)}</strong><span class="next-condition">${escape(conditionFor(next))}</span><span class="progress-track" role="progressbar" aria-label="${escape(next.title)} progress" aria-valuemin="0" aria-valuemax="${next.threshold}" aria-valuenow="${value}"><i style="width:${value/next.threshold*100}%"></i></span><span class="progress-label">${format(value)} / ${format(next.threshold)}</span></span><span class="next-arrow" aria-hidden="true">↗</span></button>`;
  } else {
    $('next-achievement').innerHTML=`<button class="next-link" data-go="stickers" type="button"><img src="${art('goblin')}" width="92" height="92" alt=""><span class="next-info"><strong class="next-title">Collection complete.</strong><span class="next-condition">24 / 24</span></span><span aria-hidden="true">↗</span></button>`;
  }
}
function renderReceipts(stats) {
  const events=filteredEvents(stats.events),filtered=statsFor(events);
  $('big-stats').innerHTML=[{value:filtered.total,label:'Swears'},{value:filtered.totals[0],label:state.names[0]},{value:filtered.totals[1],label:state.names[1]},{value:filtered.daysActive,label:'Days with swears'}].map(item=>`<div class="stat-tile"><span class="stat-value">${format(item.value)}</span><span class="stat-name">${escape(item.label)}</span></div>`).join('');
  $('chart-legend').innerHTML=state.names.map((name,player)=>`<span><i class="player-dot ${player===0?'lavender':'lime'}"></i>${escape(name)}</span>`).join('');
  const days=weekDays().map(day=>({...day,counts:[0,1].map(player=>stats.events.filter(event=>event.day===day.key&&event.player===player).length)}));
  const max=Math.max(1,...days.flatMap(day=>day.counts));
  $('week-chart').innerHTML=days.map(day=>`<div class="chart-day ${day.key===localDay()?'today':''}"><div class="chart-bars" role="img" aria-label="${escape(day.date.toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'}))}: ${escape(state.names[0])} ${day.counts[0]}, ${escape(state.names[1])} ${day.counts[1]}">${day.counts.map(count=>`<div class="chart-bar" style="height:${count?Math.max(3,count/max*82):1}%">${count?`<b>${format(count)}</b>`:''}</div>`).join('')}</div><span class="chart-day-label">${escape(day.date.toLocaleDateString(undefined,{weekday:'short'}))}</span></div>`).join('');
  const maxHour=Math.max(...filtered.hours),peakHour=filtered.hours.indexOf(maxHour);
  const peakLabel=maxHour?new Date(2000,0,1,peakHour).toLocaleTimeString(undefined,{hour:'numeric'}):'—';
  const average=filtered.daysActive?(filtered.total/filtered.daysActive).toFixed(1):'0';
  $('insights').innerHTML=`<div class="insight"><span class="eyebrow">DAILY RECORD</span><strong>${format(filtered.dayTotal)}</strong></div><div class="insight"><span class="eyebrow">PEAK HOUR</span><strong>${escape(peakLabel)}</strong>${maxHour?`<small>${format(maxHour)} ${maxHour===1?'swear':'swears'}</small>`:''}</div><div class="insight"><span class="eyebrow">AVG / DAY WITH SWEARS</span><strong>${average}</strong></div>`;
  const recent=events.slice().sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id));
  $('history-list').innerHTML=recent.length?recent.slice(0,historyLimit).map(event=>`<div class="history-item"><span class="history-avatar ${event.player===0?'lavender':'lime'}"><img src="${art(state.avatars[event.player])}" width="35" height="35" alt=""></span><div class="history-info"><strong>${escape(state.names[event.player])}</strong><small>${escape(humanDate(event))}</small></div><span class="history-plus">+1</span><button type="button" class="undo-button" data-undo="${event.id}" aria-label="Undo ${escape(state.names[event.player])}'s swear on ${escape(humanDate(event))}">Undo</button></div>`).join(''):`<div class="empty-state"><img src="${art('angel-slime')}" width="92" height="92" alt=""><p>No swears ${period==='all'?'yet':period==='today'?'today':'in the last seven days'}.</p></div>`;
  $('history-title').textContent='History · '+({today:'Today',week:'7 days',all:'All time'})[period];
  $('history-more').hidden=recent.length<=historyLimit;
  document.querySelectorAll('[data-period]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.period===period)));
}
function renderStickers(stats) {
  const count=ACHIEVEMENTS.filter(item=>unlocked(item,stats)).length;
  $('album-count').textContent=`${count} / ${ACHIEVEMENTS.length} unlocked`;
  const items=ACHIEVEMENTS.filter(item=>stickerFilter==='all'||unlocked(item,stats));
  $('sticker-grid').innerHTML=items.length?items.map(item=>{const earned=unlocked(item,stats);return `<button type="button" class="sticker-tile ${earned?'unlocked':''}" data-sticker="${escape(item.id)}" aria-label="${escape(item.title)}. ${earned?'Unlocked':'Locked'}. ${escape(conditionFor(item))}."><span class="sticker-status" aria-hidden="true">${earned?'✓':'?'}</span><img src="${art(item.sticker)}" width="114" height="114" alt=""><strong>${escape(item.title)}</strong><small>${escape(conditionFor(item))}</small></button>`;}).join(''):`<div class="empty-state" style="grid-column:1/-1"><img src="${art('ghost')}" width="92" height="92" alt=""><p>No stickers unlocked yet.</p></div>`;
  document.querySelectorAll('[data-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filter===stickerFilter)));
}
function renderStatus() {
  const labels={local:state.pending?`${state.pending} pending`:'Saved',syncing:'Syncing',synced:'Synced',offline:'Offline',error:'Error'};
  $('sync-label').textContent=labels[state.status]||'Saved here';$('sync-status').dataset.status=state.status;
  $('sync-status').setAttribute('aria-label',`${labels[state.status]||'Saved locally'}. Tap to sync now.`);
  const warning=$('storage-warning');warning.hidden=!state.error;warning.textContent=state.error||'';
  if($('share-dialog').open){
    const notice=$('share-sync');notice.hidden=state.status==='synced';
    notice.textContent=state.error|| (state.status==='offline'?'Offline. Recent changes will sync when you reconnect.':state.status==='syncing'?'Syncing…':state.pending?`${state.pending} changes waiting to sync.`:'Waiting to sync.');
  }
}
function renderSettings() {
  $('sound-toggle').innerHTML=svg(settings.sound?'sound':'muted');$('sound-toggle').setAttribute('aria-label',settings.sound?'Mute sounds':'Enable sounds');$('sound-toggle').setAttribute('aria-pressed',String(!settings.sound));
  $('sound-switch').classList.toggle('on',settings.sound);$('haptics-switch').classList.toggle('on',settings.haptics);
  $('settings-sound').setAttribute('aria-pressed',String(settings.sound));$('settings-haptics').setAttribute('aria-pressed',String(settings.haptics));
}
function render(nextState) {
  const previousNames=state.names.join('|');state=nextState;
  renderStatus();const stats=statsFor();renderJar(stats);renderReceipts(stats);renderStickers(stats);
  if(pwa&&previousNames!==state.names.join('|'))pwa.updateNames(state.names);
  if(avatarPlayer!==null&&document.querySelector('#avatar-dialog')?.open)avatarPicker.update({name:state.names[avatarPlayer],selected:state.avatars[avatarPlayer]});
}
function setTab(tab) {
  if(!['jar','receipts','stickers'].includes(tab))return;
  currentTab=tab;
  ['jar','receipts','stickers'].forEach(name=>{$(`panel-${name}`).hidden=name!==tab;const button=$(`tab-${name}`);button.setAttribute('aria-selected',String(name===tab));button.tabIndex=name===tab?0:-1;});
  window.scrollTo({top:0,behavior:reducedMotion.matches?'instant':'smooth'});
}
function openDialog(id) { const dialog=$(id);if(!dialog.open)dialog.showModal(); }
function openSettings(player) { $('name-0').value=state.names[0];$('name-1').value=state.names[1];openDialog('settings-dialog');if(player!==undefined){$(`name-${player}`).focus();$(`name-${player}`).select();} }
function openShare() { $('invite-link').value=store.getInviteUrl();$('native-share').hidden=!navigator.share;openDialog('share-dialog');renderStatus();void store.sync(); }
function openSticker(id) {
  const item=ACHIEVEMENTS.find(achievement=>achievement.id===id);if(!item)return;
  const stats=statsFor(),earned=unlocked(item,stats),value=Math.min(achievementValue(item,stats),item.threshold);
  $('sticker-detail-content').innerHTML=`<img src="${art(item.sticker)}" width="210" height="210" alt="${escape(item.title)} collectible sticker"><h2 id="sticker-title">${escape(item.title)}</h2><p>${escape(item.description)}</p><div class="detail-condition">${escape(conditionFor(item))}<br><span>${earned?'Unlocked':`${format(value)} / ${format(item.threshold)}`}</span></div>`;openDialog('sticker-dialog');
}
function exportJar() {
  try {
    const data=store.exportData(),blob=new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`swear-jar-${localDay()}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);showToast('Backup downloaded. Keep it private: it contains your jar key.');
  }catch(error){showError(error);}
}

$('settings-open').innerHTML=svg('settings');['jar','receipts','stickers'].forEach(name=>$(`nav-${name}`).innerHTML=svg(name));
$('settings-open').addEventListener('click',()=>openSettings());
$('sound-toggle').addEventListener('click',()=>{settings.sound=!settings.sound;saveSettings();if(settings.sound)sound();});
$('settings-sound').addEventListener('click',()=>{settings.sound=!settings.sound;saveSettings();if(settings.sound)sound();});
$('settings-haptics').addEventListener('click',()=>{settings.haptics=!settings.haptics;saveSettings();if(settings.haptics&&navigator.vibrate)navigator.vibrate(18);});
$('sync-status').addEventListener('click',()=>void store.sync());
$('names-form').addEventListener('submit',async event=>{event.preventDefault();const names=[$('name-0').value.trim(),$('name-1').value.trim()];if(names.some(name=>!name||[...name].length>24)){showToast('Enter two names, up to 24 characters each.');return;}const button=event.submitter;button.disabled=true;try{for(let i=0;i<2;i++)if(names[i]!==state.names[i])await store.rename(i,names[i]);$('settings-dialog').close();showToast('Names saved.');}catch(error){showError(error);}finally{button.disabled=false;}});
$('share-open').addEventListener('click',openShare);$('settings-share').addEventListener('click',()=>{$('settings-dialog').close();openShare();});
$('copy-invite').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('invite-link').value);$('copy-invite').textContent='Copied';setTimeout(()=>$('copy-invite').textContent='Copy link',2200);}catch{$('invite-link').focus();$('invite-link').select();showToast('Copy was blocked. The link is selected—copy it manually.');}});
$('native-share').addEventListener('click',async()=>{try{await navigator.share({title:'Join my Swear Jar',text:'Cute faces. Foul mouths. Same jar?',url:store.getInviteUrl()});}catch(error){if(error.name!=='AbortError')showError(error);}});
$('join-button').addEventListener('click',async()=>{const input=$('join-link').value.trim();if(!input){$('join-link').focus();return;}const button=$('join-button');button.disabled=true;try{await store.joinJar(input);$('share-dialog').close();$('join-link').value='';showToast('Jar joined.');}catch(error){showError(error);}finally{button.disabled=false;}});
$('export-button').addEventListener('click',exportJar);$('settings-export').addEventListener('click',exportJar);
$('install-open').addEventListener('click',()=>{$('settings-dialog').close();openDialog('install-dialog');});
$('install-button').addEventListener('click',async()=>{try{await pwa?.install();}catch(error){showError(error);}});
$('history-more').addEventListener('click',()=>{historyLimit+=30;renderReceipts(statsFor());});
document.addEventListener('click',async event=>{
  const close=event.target.closest('[data-close]');if(close){$(close.dataset.close).close();return;}
  const tab=event.target.closest('[data-tab]');if(tab){setTab(tab.dataset.tab);return;}
  const go=event.target.closest('[data-go]');if(go){setTab(go.dataset.go);$(`tab-${go.dataset.go}`).focus({preventScroll:true});return;}
  const periodButton=event.target.closest('[data-period]');if(periodButton){period=periodButton.dataset.period;historyLimit=30;renderReceipts(statsFor());return;}
  const filter=event.target.closest('[data-filter]');if(filter){stickerFilter=filter.dataset.filter;renderStickers(statsFor());return;}
  const sticker=event.target.closest('[data-sticker]');if(sticker){openSticker(sticker.dataset.sticker);return;}
  const undo=event.target.closest('[data-undo]');if(undo){try{await store.undo(undo.dataset.undo);showToast('Undone.');}catch(error){showError(error);}}
});
document.querySelectorAll('[role=tab]').forEach(button=>button.addEventListener('keydown',event=>{const tabs=['jar','receipts','stickers'];let index=tabs.indexOf(currentTab);if(event.key==='ArrowRight')index=(index+1)%3;else if(event.key==='ArrowLeft')index=(index+2)%3;else if(event.key==='Home')index=0;else if(event.key==='End')index=2;else return;event.preventDefault();setTab(tabs[index]);$(`tab-${tabs[index]}`).focus();}));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}}));
renderSettings();store.subscribe(render);
void setupPWA({names:state.names,onInstallReady:()=>{$('install-button').hidden=false;},onUpdateReady:apply=>showToast('Update available.',{actionLabel:'Update',action:apply,duration:15000})}).then(client=>{
  pwa=client;void pwa.updateNames(state.names);if(pwa.canInstall())$('install-button').hidden=false;
});
const quick=new URL(location.href).searchParams.get('add');
if(quick==='0'||quick==='1'){
  const button=$(`player-card-${Number(quick)}`);
  button.classList.add('quick-target');button.focus({preventScroll:true});button.scrollIntoView({block:'center'});
  button.addEventListener('click',()=>button.classList.remove('quick-target'),{once:true});
  const clean=new URL(location.href);clean.searchParams.delete('add');history.replaceState(null,'',clean);
}
let lastDay=localDay();setInterval(()=>{if(localDay()!==lastDay){lastDay=localDay();render(state);}},30000);
