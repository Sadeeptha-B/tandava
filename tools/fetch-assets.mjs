// Downloads the CC0 MakeHuman source data (base mesh, rig, weights, morph targets)
// used by tools/build-character.mjs. Data only — nothing here is executed.
// Licence: CC0 1.0 (see assets-src/makehuman/LICENSE.ASSETS.md after fetching).
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets-src', 'makehuman');
const BASE = 'https://raw.githubusercontent.com/makehumancommunity/makehuman/master/';

const T = 'makehuman/data/targets/';
const FILES = [
  ['LICENSE.ASSETS.md', 'LICENSE.ASSETS.md'],
  ['makehuman/data/3dobjs/base.obj', 'base.obj'],
  ['makehuman/data/rigs/default.mhskel', 'default.mhskel'],
  ['makehuman/data/rigs/default_weights.mhw', 'default_weights.mhw'],
  ...[
    'macrodetails/universal-male-young-averagemuscle-averageweight',
    'macrodetails/universal-male-young-maxmuscle-averageweight',
    'macrodetails/universal-male-young-averagemuscle-minweight',
    'macrodetails/universal-male-young-maxmuscle-minweight',
    'macrodetails/caucasian-male-young',
    'macrodetails/asian-male-young',
    'macrodetails/african-male-young',
    'macrodetails/proportions/male-young-maxmuscle-averageweight-idealproportions',
    'macrodetails/proportions/male-young-averagemuscle-averageweight-idealproportions',
    'torso/torso-vshape-incr',
    'torso/torso-muscle-pectoral-incr',
    'torso/torso-muscle-dorsi-incr',
    'stomach/stomach-tone-incr',
    'expression/units/caucasian/eye-left-closure',
    'expression/units/caucasian/eye-right-closure',
    'expression/units/caucasian/mouth-corner-puller',
    'expression/units/caucasian/mouth-compression',
    'nose/nose-hump-incr',
    'nose/nose-scale-vert-incr',
    'chin/chin-bones-incr',
    'chin/chin-prominent-incr',
    'cheek/l-cheek-bones-incr',
    'cheek/r-cheek-bones-incr',
    // face sculpt
    'cheek/l-cheek-volume-decr', 'cheek/r-cheek-volume-decr',
    'forehead/forehead-scale-vert-decr',
    'head/head-oval', 'head/head-fat-decr',
    'nose/nose-greek-incr', 'nose/nose-scale-depth-incr', 'nose/nose-point-down', 'nose/nose-width2-decr',
    'mouth/mouth-cupidsbow-incr', 'mouth/mouth-lowerlip-volume-incr', 'mouth/mouth-upperlip-volume-incr', 'mouth/mouth-angles-up', 'mouth/mouth-scale-horiz-incr',
    'eyes/l-eye-corner2-up', 'eyes/r-eye-corner2-up', 'eyes/l-eye-scale-incr', 'eyes/r-eye-scale-incr',
    'eyebrows/eyebrows-angle-up', 'eyebrows/eyebrows-trans-down',
    'chin/chin-width-decr',
    // expression units (runtime morphs)
    'expression/units/caucasian/eyebrows-left-down', 'expression/units/caucasian/eyebrows-right-down',
    'expression/units/caucasian/eyebrows-left-inner-up', 'expression/units/caucasian/eyebrows-right-inner-up',
    'expression/units/caucasian/eyebrows-left-extern-up', 'expression/units/caucasian/eyebrows-right-extern-up',
    'expression/units/caucasian/eye-left-slit', 'expression/units/caucasian/eye-right-slit',
    'expression/units/caucasian/mouth-parling', 'expression/units/caucasian/mouth-elevation',
  ].map((t) => [T + t + '.target', 'targets/' + t.split('/').pop() + '.target']),
];

const exists = (p) => access(p).then(() => true, () => false);

for (const [src, dst] of FILES) {
  const out = join(OUT, dst);
  if (await exists(out)) continue;
  const res = await fetch(BASE + src);
  if (!res.ok) throw new Error(`${res.status} fetching ${src}`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  console.log('fetched', dst);
}
console.log('MakeHuman source assets ready in', OUT);
