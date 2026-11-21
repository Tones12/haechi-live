// Netlify Function: reads the UTTC Calgary Invitational schedule from Kihapp,
// keeps every division that has a Haechi athlete, and returns each athlete's
// matches (including finals/bronze they could reach) as JSON for the page.
// Responses are cached on Netlify's CDN for 60 s, so Kihapp sees at most one
// full read per minute no matter how many people have the page open.

const KIHAPP = 'https://www.kihapp.com';
const TOURNAMENT = '/tournaments/27457-uttc-calgary-invitational/matches';
const SCHOOL = 'Haechi';
const KIDS = ['Alex Travis', 'Anastasia Travis'];

const SHORT_SCHOOL = {
  'Haechi Traditional Tae Kwon-Do': 'Haechi', 'Dragon Martial Arts Academy': 'Dragon Martial Arts',
  'Crestmont Tae Kwon-Do': 'Crestmont', 'Redwood Meadows Tae Kwon-Do': 'Redwood Meadows',
  'Trail Martial Arts': 'Trail Martial Arts', 'Dual Dragons': 'Dual Dragons',
  'Summit Martial Arts Academy': 'Summit Martial Arts', 'Legacy Tae Kwon-Do School (Lethbridge)': 'Legacy (Lethbridge)',
  'Legacy Tae Kwon-Do School (Coaldale)': 'Legacy (Coaldale)', 'Legacy Tae Kwon-Do School (Fort MacLeod)': 'Legacy (Fort MacLeod)',
  'Dragan Caoin Taekwondo': 'Dragan Caoin', 'Scott Tae Kwon-Do': 'Scott TKD', 'Quest Martial Arts School': 'Quest Martial Arts',
  'Inspire Martial Arts': 'Inspire Martial Arts',
};
const EVENT = { 'Patterns': 'Patterns', 'Continuous Sparring': 'Continuous', 'Point Sparring': 'Point' };
const ROUND = { 'Round Robin, Round 1': 'Round robin 1', 'Round Robin, Round 2': 'Round robin 2', 'Round Robin, Round 3': 'Round robin 3' };

const clean = (s) => (s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const toMin = (t) => {
  // Accepts "~10:05 am", "10:05AM" or 24-hour "22:05".
  const m = /(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?/i.exec(t || '');
  if (!m) return null;
  let h = +m[1];
  if (m[3]) { h = h % 12; if (/^p/i.test(m[3])) h += 12; }
  return h * 60 + +m[2];
};

export function parsePage(html) {
  const stamp = clean((/Times and order are current as of([^<]*)/.exec(html) || [])[1]).replace(/\.$/, '');
  const times = {};
  const timeRe = /<span class=['"]time['"]([^>]*)>([^<]*)<\/span>/g;
  let tm;
  while ((tm = timeRe.exec(html))) {
    const id = (/data-ring-assignment-id=['"](\d+)['"]/.exec(tm[1]) || [])[1];
    const t = toMin(tm[2]);
    if (id && t !== null) times[id] = t;
  }
  const chunks = html.split(/<div class=['"](match|category) schedule-item-card/);
  const matches = [], teams = [];
  for (let i = 1; i < chunks.length; i += 2) {
    const kind = chunks[i], c = chunks[i + 1];
    const raid = (/data-ring-assignment-id=['"](\d+)['"]/.exec(c) || [])[1];
    const ringInfo = (/<div class=['"]ring-information[^>]*>([\s\S]*?)<\/div>/.exec(c) || [])[1] || '';
    const ring = (/(Blue|Red|White)\s+Ring/.exec(clean(ringInfo)) || [])[1] || '';
    const sides = c.split(/<div class=['"]side (?:home|away)['"]/).slice(1).map((s) => {
      const name = clean((/competitor-name['"]>([\s\S]*?)<\/span>/.exec(s) || [])[1]) || clean((/continuation[^>]*>([\s\S]*?)<\/div>/.exec(s) || [])[1]);
      const club = clean((/club-name['"]>([\s\S]*?)<\/span>/.exec(s) || [])[1]);
      const noShow = /No Show$/i.test(name);
      return { name: name.replace(/\s*No Show$/i, ''), club, noShow };
    });
    const t = raid && times[raid] !== undefined ? times[raid] : null;
    if (kind === 'category') {
      const ev = clean((/<div class=['"]event-name[^>]*>([\s\S]*?)<\/div>/.exec(c) || [])[1]);
      const num = clean((/<div class=['"]match-number[^>]*>([\s\S]*?)<\/div>/.exec(c) || [])[1]);
      teams.push({ t, ring, ev, num, sides });
      continue;
    }
    const evText = clean((/<div class=['"]event-name[^>]*>([\s\S]*?)<\/div>/.exec(c) || [])[1]);
    const mm = /^(.*?)\s+(\d+\.\d+)$/.exec(evText);
    if (!mm) continue;
    const round = clean((/draw-position[^>]*>([\s\S]*?)<\/div>/.exec(c) || [])[1]);
    matches.push({ t, ring, ev: EVENT[mm[1]] || mm[1], m: mm[2], div: mm[2].split('.')[0], rd: ROUND[round] || round, sides });
  }
  const timeSample = ((/<span class=['"]time['"][^>]*>[^<]*\d[^<]*<\/span>/.exec(html) || [])[0] || '').replace(/\s+/g, ' ');
  return { stamp, matches, teams, hasCards: chunks.length > 1, timesFound: Object.keys(times).length, timeSample };
}

export function buildSchedule(pages) {
  const all = [], teams = [];
  let stamp = '';
  for (const p of pages) { all.push(...p.matches); teams.push(...p.teams); if (!stamp && p.stamp) stamp = p.stamp; }
  const seen = new Set();
  const rows = all.filter((x) => (seen.has(x.m) ? false : seen.add(x.m)));
  const isH = (s) => s.club.startsWith(SCHOOL);
  const names = new Map();
  for (const x of rows) for (const s of x.sides) if (isH(s)) names.set(s.name, (names.get(s.name) || false) || s.noShow);

  const byDiv = {};
  for (const x of rows) (byDiv[x.div] = byDiv[x.div] || []).push(x);

  const athletes = [];
  for (const [n, ns] of names) {
    const named = rows.filter((x) => x.sides.some((s) => s.name === n));
    const cond = new Map(named.map((x) => [x.m, []]));
    const queue = named.map((x) => x.m);
    while (queue.length) {
      const m = queue.shift();
      for (const y of byDiv[m.split('.')[0]] || []) {
        if (cond.has(y.m)) continue;
        const labels = y.sides.map((s) => s.name);
        if (labels.includes(`Winner of ${m}`)) { cond.set(y.m, [...cond.get(m), ['wins', m]]); queue.push(y.m); }
        else if (labels.includes(`Loser of ${m}`)) { cond.set(y.m, [...cond.get(m), ['loses', m]]); queue.push(y.m); }
      }
    }
    const ms = [];
    for (const [m, steps] of cond) {
      const x = rows.find((r) => r.m === m);
      let c = '';
      if (steps.length) c = steps.every(([v]) => v === 'wins') ? 'If wins ' + steps.map(([, s]) => s).join(' & ') : 'If ' + steps.map(([v, s]) => `${v} ${s}`).join(', ');
      let opp;
      if (x.sides.some((s) => s.name === n)) opp = x.sides.find((s) => s.name !== n) || { name: '', club: '' };
      else { const last = steps[steps.length - 1][1]; opp = x.sides.find((s) => !s.name.endsWith(' ' + last)) || { name: '', club: '' }; }
      ms.push({ t: x.t, ring: x.ring, ev: x.ev, m, rd: x.rd, opp: opp.name, os: SHORT_SCHOOL[opp.club] || opp.club, c, hb: isH(opp) });
    }
    ms.sort((a, b) => (a.t ?? 9999) - (b.t ?? 9999));
    athletes.push({ n, kid: KIDS.includes(n), ns, ms });
  }
  athletes.sort((a, b) => (b.kid - a.kid) || a.n.split(' ').slice(1).join(' ').localeCompare(b.n.split(' ').slice(1).join(' ')));

  const teamOut = teams.filter((tm) => tm.sides.some(isH)).map((tm) => {
    const mine = tm.sides.find(isH), others = tm.sides.filter((s) => s !== mine);
    return { n: mine.name, t: tm.t, ring: tm.ring, ev: tm.ev, note: 'vs ' + others.map((s) => s.name).join(', ') };
  });
  const debug = { pages: pages.length, matches: rows.length, matchesWithTime: rows.filter((x) => x.t !== null).length,
    timesFound: pages.reduce((a, p) => a + (p.timesFound || 0), 0), timeSample: (pages.find((p) => p.timeSample) || {}).timeSample || '' };
  return { stamp: stamp.replace(/^\s*/, ''), athletes, teams: teamOut, live: true, debug };
}

async function fetchPage(n) {
  const url = `${KIHAPP}${TOURNAMENT}?sort_by=start_time&show_completed=true&page=${n}`;
  // Kihapp formats times for the visitor's time zone, which a browser sends in a
  // time_zone cookie. Without it the times come back blank, so send Calgary's.
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Haechi family schedule page; low-volume, cached 60s)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': 'time_zone=America%2FEdmonton',
    },
  });
  if (!r.ok) throw new Error(`Kihapp page ${n} returned ${r.status}`);
  return parsePage(await r.text());
}

export default async () => {
  try {
    const pages = [];
    for (let start = 1; start <= 60; start += 8) {
      const batch = await Promise.all(Array.from({ length: 8 }, (_, i) => fetchPage(start + i)));
      pages.push(...batch);
      if (batch.some((p) => !p.hasCards)) break;
    }
    const data = buildSchedule(pages);
    if (!data.athletes.length) throw new Error('No Haechi athletes found on Kihapp');
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err.message || err) }), {
      status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
};

export const config = { path: '/api/schedule' };
