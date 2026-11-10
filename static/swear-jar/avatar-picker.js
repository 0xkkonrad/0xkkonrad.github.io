import { AVATARS, AVATAR_IDS, DEFAULT_AVATARS, avatarById } from './avatars.js';

export const HAND_SIZE = 8;
export const ROLL_MS = 720;

/** Keep the selected face, offer seven different ones, and never repeat a tile. */
export function dealAvatars(selected, previous = [], random = Math.random) {
  const chosen = AVATAR_IDS.includes(selected) ? selected : DEFAULT_AVATARS[0];
  const fresh = AVATAR_IDS.filter(id => id !== chosen && !previous.includes(id));
  const fallback = AVATAR_IDS.filter(id => id !== chosen && previous.includes(id));
  for (const pool of [fresh, fallback]) {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  }
  return [chosen, ...fresh, ...fallback].slice(0, HAND_SIZE);
}

export function createAvatarPicker({onSelect, onError = () => {}}) {
  const dialog = document.createElement('dialog');
  dialog.id = 'avatar-dialog';
  dialog.className = 'avatar-dialog';
  dialog.setAttribute('aria-labelledby', 'avatar-title');
  dialog.innerHTML = `<div class="avatar-dialog-inner"><div class="avatar-heading"><h2 id="avatar-title"></h2><button type="button" class="avatar-close" aria-label="Close avatar picker">×</button></div><div class="avatar-grid"><div class="avatar-options" role="group" aria-labelledby="avatar-title"></div><button type="button" class="avatar-roll"><svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="7" y="7" width="34" height="34" rx="8"/><g fill="currentColor" stroke="none"><circle cx="16" cy="16" r="2.7"/><circle cx="32" cy="16" r="2.7"/><circle cx="24" cy="24" r="2.7"/><circle cx="16" cy="32" r="2.7"/><circle cx="32" cy="32" r="2.7"/></g></svg><span>Roll</span></button></div><p class="avatar-error" role="alert" hidden></p><p class="avatar-announcement" aria-live="polite" aria-atomic="true"></p></div>`;
  document.body.append(dialog);
  const title = dialog.querySelector('h2');
  const options = dialog.querySelector('.avatar-options');
  const rollButton = dialog.querySelector('.avatar-roll');
  const die = rollButton.querySelector('svg');
  const error = dialog.querySelector('.avatar-error');
  const announcement = dialog.querySelector('.avatar-announcement');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let player = 0, selected = DEFAULT_AVATARS[0], hand = [], rolling = false, saving = false;
  let timer = null, turn = 0, generation = 0, opener;
  const buttons = [];
  for (let slot = 0; slot < HAND_SIZE; slot++) {
    const button = document.createElement('button');
    button.type = 'button';button.className = 'avatar-option';button.dataset.slot = slot;
    const image = document.createElement('img');image.alt = '';image.width = 100;image.height = 100;
    const name = document.createElement('span');name.className = 'avatar-name';
    const check = document.createElement('span');check.className = 'avatar-check';check.textContent = '✓';check.setAttribute('aria-hidden', 'true');
    button.append(image, name, check);options.append(button);buttons.push(button);
    button.addEventListener('click', () => void select(slot));
    button.addEventListener('keydown', event => {
      const offsets = {ArrowLeft:-1, ArrowRight:1, ArrowUp:-3, ArrowDown:3};
      let next;
      if (Object.hasOwn(offsets, event.key)) next = (slot + offsets[event.key] + HAND_SIZE) % HAND_SIZE;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = HAND_SIZE - 1;
      else return;
      event.preventDefault();buttons.forEach((b,i) => { b.tabIndex = i === next ? 0 : -1; });buttons[next].focus();
    });
  }
  function paint(slot, id) {
    const item = avatarById(id), button = buttons[slot];
    button.dataset.avatar = id;
    button.querySelector('img').src = item.src;
    button.querySelector('.avatar-name').textContent = item.name;
    button.setAttribute('aria-label', item.name);
    button.setAttribute('aria-pressed', String(id === selected));
    button.classList.toggle('selected', id === selected);
  }
  function render() {
    hand.forEach((id, slot) => paint(slot, id));
    const focus = Math.max(0, hand.indexOf(selected));
    buttons.forEach((button, slot) => {button.tabIndex = slot === focus ? 0 : -1;button.setAttribute('aria-disabled',String(rolling || saving));});
    rollButton.disabled = saving;
    options.setAttribute('aria-busy',String(rolling || saving));
  }
  function stopRoll() {
    if (timer !== null) clearInterval(timer);
    timer = null;rolling = false;
    dialog.classList.remove('is-rolling');buttons.forEach(b => b.classList.remove('avatar-settle'));
  }
  function close() {generation++;stopRoll();if(dialog.open)dialog.close();}
  async function select(slot) {
    if(rolling || saving || !dialog.open)return;
    const id = hand[slot];
    if(id === selected){close();return;}
    const ticket = generation;
    saving = true;error.hidden = true;render();
    try {
      await onSelect(player,id);
      if(ticket !== generation)return;
      selected = id;close();
    } catch (cause) {
      if(ticket !== generation)return;
      error.textContent = cause?.message || 'Could not save your avatar. Try again.';
      error.hidden = false;onError(cause);
    } finally {
      if(ticket === generation){saving = false;if(dialog.open)render();}
    }
  }
  function roll() {
    if(saving)return;
    stopRoll();error.hidden = true;
    const next = dealAvatars(selected, hand);
    if(motion.matches){hand = next;render();announcement.textContent = 'New avatars.';return;}
    // Keep the selected tile fixed. Every other new face is absent from the old
    // hand, so even the staggered intermediate frames cannot show duplicates.
    hand = [selected,...hand.filter(id => id !== selected)];
    hand = hand.slice(0,HAND_SIZE);render();
    rolling = true;render();dialog.classList.add('is-rolling');
    turn += 720;die.style.transform = `rotate(${turn}deg)`;
    const start = performance.now();let resolved = 0;
    timer = setInterval(() => {
      const elapsed = performance.now() - start;
      const slots = Math.min(7, Math.floor(Math.max(0,elapsed - 100) / 70));
      while(resolved < slots){resolved++;hand[resolved] = next[resolved];paint(resolved,hand[resolved]);buttons[resolved].classList.add('avatar-settle');}
      if(elapsed >= ROLL_MS){stopRoll();hand = next;render();announcement.textContent = 'New avatars.';}
    },30);
  }
  rollButton.addEventListener('click',roll);
  dialog.querySelector('.avatar-close').addEventListener('click',close);
  dialog.addEventListener('close',() => {generation++;stopRoll();opener?.focus?.({preventScroll:true});});
  dialog.addEventListener('click',event => {
    if(event.target !== dialog)return;
    const box = dialog.getBoundingClientRect();
    if(event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)close();
  });
  return {
    open({player:nextPlayer,name,selected:nextSelected}) {
      generation++;stopRoll();saving = false;player = nextPlayer;
      selected = AVATAR_IDS.includes(nextSelected) ? nextSelected : DEFAULT_AVATARS[player];
      title.textContent = name;error.hidden = true;announcement.textContent = '';
      hand = dealAvatars(selected);render();
      opener = document.activeElement;
      if(!dialog.open)dialog.showModal();
      buttons[0].focus({preventScroll:true});
      // Preload the small catalog without keeping it in the page's visible DOM.
      for(const item of AVATARS){const image = new Image();image.src = item.src;}
    },
    update({selected:nextSelected,name}) {
      if(name !== undefined)title.textContent = name;
      if(!AVATAR_IDS.includes(nextSelected) || nextSelected === selected)return;
      stopRoll();selected = nextSelected;
      hand = [selected,...hand.filter(id => id !== selected)].slice(0,HAND_SIZE);
      if(hand.length < HAND_SIZE)hand = dealAvatars(selected,hand);
      render();
    },
    close,
    destroy(){close();dialog.remove();}
  };
}
