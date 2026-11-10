// Original Swear Jar cast, generated with Gemini. Stable IDs are synced between phones.
export const AVATARS = [
  ['devil-bunny', 'Devil Bunny'],
  ['angel-slime', 'Angel Slime'],
  ['cursed-jar', 'Cursed Jar'],
  ['ghost', 'Ghosted'],
  ['skull', 'Bonehead'],
  ['dumpster-fire', 'Dumpster Fire'],
  ['doom-kitten', 'Doom Kitten'],
  ['cryptid-frog', 'Cryptid Frog'],
  ['trash-panda', 'Trash Panda'],
  ['possum', 'Panic Possum'],
  ['moth', 'Moth Goth'],
  ['bat', 'Bat Habits'],
  ['axolotl', 'Axolittle Shit'],
  ['mushroom', 'Mushroom Doom'],
  ['hell-duck', 'Hell Duck'],
  ['plague-birb', 'Plague Birb'],
  ['void-octopus', 'Void Octopus'],
  ['sad-robot', 'Error Bot'],
  ['cursed-bear', 'Cursed Bear'],
  ['vampire-hamster', 'Vampire Hamster'],
  ['angry-toast', 'Burnt Out'],
  ['goblin', 'Little Goblin'],
  ['tiny-reaper', 'Tiny Reaper'],
  ['space-snail', 'Space Snail'],
].map(([id, name]) => Object.freeze({id, name, src: `./assets/mascots/${id}.webp`}));
export const AVATAR_IDS = AVATARS.map(avatar => avatar.id);
export const DEFAULT_AVATARS = ['devil-bunny', 'angel-slime'];
const byId = new Map(AVATARS.map(avatar => [avatar.id, avatar]));
export function avatarById(id) { return byId.get(id) || byId.get(DEFAULT_AVATARS[0]); }
