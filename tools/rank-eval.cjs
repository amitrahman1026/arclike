// Measures the command bar's ranking against the choices recorded in Arc's command bar, and
// tunes its weights. Arc keeps the last choice for each text typed into its bar; this replays
// each one against Arc's history as it was at that moment, with only the earlier choices
// remembered, and checks whether Arclike's first row is what was chosen.
//
//   node tools/rank-eval.cjs prepare <dir>        read Arc's data into <dir> (needs sqlite3)
//   node tools/rank-eval.cjs run <dir> [--old]    score the ranking, or the one in git HEAD
//   node tools/rank-eval.cjs tune <dir>           search for better weights
//
// <dir> holds copies of personal data. Keep it outside the repository.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { load } = require('../tests/harness.cjs');

const ARC = path.join(os.homedir(), 'Library/Application Support/Arc');
const DAY = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 90;
const APPLE_EPOCH_MS = 978307200000;
const CHROME_EPOCH_OFFSET_MS = 11644473600000;   // 1601-01-01 to 1970-01-01

// Arc's archetype -> { type, url, title, search }.
function flattenPick(query, value) {
  const archetype = value.archetype || {};
  let type = archetype.type;
  let values = (archetype.associatedValues || {}).associatedValue0 || archetype.associatedValues || {};
  if (type === 'chromiumArchetype') {
    type = values.type;
    values = values.associatedValues || {};
  }
  return { query, type, url: values.url, title: values.title || values.siteName,
    search: values.query || values.search, selectedAt: value.selectedAt };
}

function prepare(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = path.join(dir, 'history.sqlite');
  fs.copyFileSync(path.join(ARC, 'User Data/Default/History'), db);
  const sql = (query) => execFileSync('sqlite3', ['-separator', '\t', db, query], { maxBuffer: 1 << 30 }).toString();
  const urls = new Map();
  sql("select id, replace(replace(url,char(9),' '),char(10),' '), replace(replace(coalesce(title,''),char(9),' '),char(10),' ') from urls")
    .split('\n').filter(Boolean).forEach((line) => {
      const [id, url, title] = line.split('\t');
      urls.set(id, { url, title, visitCount: 0, typedCount: 0, lastVisitTime: 0 });
    });
  const visits = sql('select url, visit_time, transition & 255 from visits order by visit_time')
    .split('\n').filter(Boolean).map((line) => line.split('\t'));
  const saved = JSON.parse(fs.readFileSync(path.join(ARC, 'StorableCommandBarAdditionalRanking.json'), 'utf8'));
  const profile = saved.dataByProfile.Default || Object.values(saved.dataByProfile)[0];
  const picks = Object.entries(profile.queriesToSelectedArchetype)
    .map(([query, value]) => flattenPick(query, value))
    .map((pick) => Object.assign(pick, { at: APPLE_EPOCH_MS + pick.selectedAt * 1000 }))
    .sort((a, b) => a.at - b.at);

  // Walk the visits in time order, so each pick sees the history as it was then. Keep the pages
  // the query matches exactly, or by typo when fewer than three match exactly, as the bar does.
  const h = load();
  let next = 0;
  const cases = picks.map((pick, i) => {
    while (next < visits.length) {
      const [id, time, transition] = visits[next];
      const at = Number(time) / 1000 - CHROME_EPOCH_OFFSET_MS;
      if (at >= pick.at) break;
      const item = urls.get(id);
      if (item) {
        item.visitCount++;
        if (transition === '1') item.typedCount++;
        item.lastVisitTime = at;
      }
      next++;
    }
    const words = pick.query.trim().toLowerCase().split(/\s+/);
    const since = pick.at - HISTORY_DAYS * DAY;
    const recent = [...urls.values()].filter((item) => item.lastVisitTime >= since);
    let pool = recent.filter((item) => {
      const text = (item.title + ' ' + item.url).toLowerCase();
      return words.every((word) => text.includes(word));
    });
    if (pool.length < 3 && pick.query.trim().length >= 4) {
      h.set('__q', pick.query);
      pool = pool.concat(recent.filter((item) => !pool.includes(item) &&
        (h.set('__item', item), h.call('commandBarFuzzyScore(__q, __item, __item.title, __item.url)')) >= 0));
    }
    if (i % 100 === 0) process.stderr.write(`prepared ${i}/${picks.length}\n`);
    return { pick, history: pool.map((item) => Object.assign({}, item)) };
  });
  fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cases));
  console.log(`${cases.length} picks from ${picks[0] && new Date(picks[0].at).toISOString()} to ` +
    `${picks.length && new Date(picks[picks.length - 1].at).toISOString()}`);
}

// What a pick asks of the first row: the chosen page, or searching what was typed.
function goal(pick) {
  if (/search/i.test(pick.type || '') || pick.type === 'searchWhatYouTyped') {
    return { search: true, same: (pick.search || '').trim().toLowerCase() === pick.query.trim().toLowerCase() };
  }
  return pick.url ? { url: pick.url } : null;
}

// Arc and Chrome often hold the same page with and without www or https.
const urlKey = (url) => url.replace(/#.*$/, '').replace(/\/$/, '').replace(/^https?:\/\/(www\.)?/i, '');

function evaluate(cases, options = {}) {
  const h = options.h || load(options.dir ? { dir: options.dir } : {});
  const remember = !options.old && options.memory !== false;
  const counts = { page: [0, 0], search: [0, 0], suggestion: [0, 0], top3: [0, 0], offered: [0, 0] };
  const misses = [];
  const earlier = [];
  if (options.tuning) setTuning(h, options.tuning);
  cases.forEach(({ pick, history }) => {
    const want = goal(pick);
    if (remember) {
      h.set('__picks', earlier);
      h.call('rankMemory = rankFromArcPicks(__picks)');
    }
    earlier.push(pick);
    if (!want) return;
    h.set('__history', history);
    h.set('__query', pick.query);
    h.set('__now', pick.at);
    const context = options.old ? '{}' : '{ now: __now, recalled: rankRecall(__query, __now) }';
    const results = JSON.parse(JSON.stringify(h.call(
      `commandBarRank(__query, { history: __history, context: ${context} })`)));
    const first = results[0] || {};
    let bucket;
    let hit;
    if (want.url) {
      bucket = 'page';
      const index = results.findIndex((row) => row.url && urlKey(row.url) === urlKey(want.url));
      hit = index === 0;
      counts.top3[1]++;
      if (index >= 0 && index < 3) counts.top3[0]++;
    } else {
      bucket = want.same ? 'search' : 'suggestion';
      hit = first.kind === 'search';
      if (!want.same) {
        // A past search is offered as its own row.
        const search = (pick.search || '').trim().toLowerCase();
        counts.offered[1]++;
        if (results.some((row) => row.kind === 'search' && (row.text || '').trim().toLowerCase() === search)) counts.offered[0]++;
      }
    }
    counts[bucket][1]++;
    if (hit) counts[bucket][0]++;
    else if (options.misses) misses.push({ query: pick.query, want: want.url || 'search', got: first.url || first.kind });
  });
  const total = counts.page[0] + counts.search[0] + counts.suggestion[0];
  const all = counts.page[1] + counts.search[1] + counts.suggestion[1];
  return { counts, accuracy: total / all, misses };
}

function report(name, result) {
  const pct = ([hit, n]) => `${hit}/${n} (${(100 * hit / Math.max(1, n)).toFixed(1)}%)`;
  console.log(`${name}: first row right ${(100 * result.accuracy).toFixed(1)}%`);
  console.log(`  page picks, first row ${pct(result.counts.page)}, in top 3 ${pct(result.counts.top3)}`);
  console.log(`  searches of the typed text, search row first ${pct(result.counts.search)}`);
  console.log(`  search suggestions, search row first ${pct(result.counts.suggestion)}`);
  console.log(`  search suggestions offered as a past search ${pct(result.counts.offered)}`);
}

// The weights, bonuses and lead score a ranking uses.
function getTuning(h) {
  return JSON.parse(JSON.stringify(h.call('({ weights: RANK_WEIGHTS, bonuses: RANK_BONUSES, lead: RANK_LEAD })')));
}

function setTuning(h, tuning) {
  h.set('RANK_WEIGHTS', tuning.weights);
  h.set('RANK_BONUSES', tuning.bonuses);
  h.set('RANK_LEAD', tuning.lead);
}

// Coordinate search: scale one value at a time, keep what helps, until nothing does. Only what
// Arc's data can tell apart is tuned: it has no open tabs, closed tabs or bookmarks.
function tune(cases) {
  const h = load();
  const tuning = getTuning(h);
  const knobs = Object.keys(tuning.weights).map((name) => ['weights', name])
    .concat([['bonuses', 'remembered'], ['lead']]);
  const get = ([group, name]) => name ? tuning[group][name] : tuning[group];
  const put = ([group, name], value) => { if (name) tuning[group][name] = value; else tuning[group] = value; };
  const score = () => evaluate(cases, { h, tuning }).accuracy;
  let best = score();
  console.log(`start ${(100 * best).toFixed(2)}%`);
  for (let round = 0; round < 6; round++) {
    let improved = false;
    for (const knob of knobs) {
      for (const factor of [0, 0.5, 0.8, 1.25, 2]) {
        const before = get(knob);
        put(knob, before * factor || (factor ? 0.05 : 0));
        const now = score();
        if (now > best + 1e-9) {
          best = now;
          improved = true;
          console.log(`${knob.join('.')} ${before.toFixed(3)} -> ${get(knob).toFixed(3)}: ${(100 * best).toFixed(2)}%`);
        } else {
          put(knob, before);
        }
      }
    }
    if (!improved) break;
  }
  console.log(JSON.stringify(tuning, null, 1));
}

module.exports = { evaluate, report };

function main([command, dir, flag]) {
  if (!command || !dir) {
    console.error('usage: node tools/rank-eval.cjs prepare|run|tune <dir> [--old|--misses]');
    process.exit(1);
  }
  if (command === 'prepare') {
    prepare(dir);
    return;
  }
  const cases = JSON.parse(fs.readFileSync(path.join(dir, 'cases.json'), 'utf8'));
  if (command === 'run' && flag === '--old') {
    const old = path.join(dir, 'old-extension');
    fs.rmSync(old, { recursive: true, force: true });
    fs.mkdirSync(old);
    const files = execFileSync('git', ['ls-tree', '--name-only', 'HEAD', 'extension/']).toString().split('\n').filter(Boolean);
    files.forEach((file) => fs.writeFileSync(path.join(old, path.basename(file)), execFileSync('git', ['show', 'HEAD:' + file])));
    report('git HEAD', evaluate(cases, { dir: old, old: true }));
  } else if (command === 'run') {
    const result = evaluate(cases, { misses: flag === '--misses' });
    report('working tree', result);
    report('working tree without memory', evaluate(cases, { memory: false }));
    if (flag === '--misses') result.misses.slice(0, 60).forEach((m) => console.log(' ', JSON.stringify(m)));
  } else if (command === 'tune') {
    tune(cases);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}
