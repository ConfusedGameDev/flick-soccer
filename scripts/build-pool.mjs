// Builds src/data/players.json from docs/player-names.csv.
//
// The CSV is the one place real names live: it maps each real player to the
// fake name the game ships with. Edit the CSV, then `npm run pool`.
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../docs/player-names.csv', import.meta.url);
const OUT = new URL('../src/data/players.json', import.meta.url);
const LEAGUES = ['mx', 'en', 'it', 'es', 'de'];
const PER_LEAGUE = 26;

const [head, ...lines] = readFileSync(SRC, 'utf8').trim().split(/\r?\n/);
const cols = head.split(',');
const rows = lines.map((line) => Object.fromEntries(line.split(',').map((v, i) => [cols[i], v])));

const players = rows.map((r) => ({
  id: r.id,
  name: r.name,
  short: r.short,
  league: r.league,
  club: r.club,
  position: r.position,
  pass: +r.pass,
  shot: +r.shot,
  speed: +r.speed,
  tackle: +r.tackle,
  keeping: +r.keeping,
}));

const ids = new Set(players.map((p) => p.id));
if (ids.size !== players.length) throw new Error('duplicate player ids');
for (const league of LEAGUES) {
  const n = players.filter((p) => p.league === league).length;
  if (n !== PER_LEAGUE) throw new Error(`${league}: ${n} players, expected ${PER_LEAGUE}`);
}
for (const p of players) {
  if (!LEAGUES.includes(p.league)) throw new Error(`${p.id}: unknown league ${p.league}`);
  if (!['GK', 'DF', 'MF', 'FW'].includes(p.position)) throw new Error(`${p.id}: bad position`);
  for (const k of ['pass', 'shot', 'speed', 'tackle', 'keeping']) {
    if (!(p[k] >= 1 && p[k] <= 5)) throw new Error(`${p.id}: ${k} out of range`);
  }
}

writeFileSync(OUT, JSON.stringify(players, null, 2) + '\n');
console.log(`wrote ${players.length} players to src/data/players.json`);
