// C2: 같은 증상에 원인 짐작 없이 「고쳐 줘」만 이어진 구간.
// 구간 찾기는 collab.js 의 guessStreaks 를 쓰고, 여기서는 리포트에 필요한 것을 더한다:
// 같은 문제를 쫓던 전체 흐름(에피소드), 그 안에서 가장 잘 쓴 보고, 그때 모델이 바뀌었는지, 시간순 기록.
// 2026-10-02 사람 판정에서 틀린 3개가 모두 「같은 문제가 아님」(작은 수정 요청이 연달아 온 것)이었다.
// 그래서 구간마다 「같은 문제인가」를 AI 에게 묻고, 같은 문제인 가장 긴 연속 부분만 남긴다.
// Haiku 는 8개를 모두 「같은 문제」로 봐서 걸러 내지 못했다 — 한 달에 열 번 안팎이라 Sonnet 으로 엄격하게 묻는다.
import path from 'node:path';
import { promptLabel } from '../classify.js';
import { GUESS_MIN, guessStreaks } from '../collab.js';
import { projectName } from '../sessions.js';
import { HOME, clip, mask, readJson, sha1, writeJson } from '../util.js';

const MIN = 60_000;
const CACHE_FILE = () => path.join(HOME, 'streak-cache.json');
const SAME_SYSTEM = `These are consecutive messages a developer sent to an AI coding agent while something was not working (often Korean).
Decide which of them are about the SAME problem: one observed malfunction that is still there after the agent tried to fix it ("여전히", "아직도", "똑같아", the same symptom described again).
NOT the same problem: separate small change requests (move this, resize that), different bugs found one after another, or a list of issues found while testing.
Be strict: if you are not sure two messages are about the same malfunction, treat them as different.
Output only the longest consecutive range of ids about one problem as "a-b" (for example "0-4"), or "none" if no three consecutive messages are about the same problem. Nothing else.`;

// 같은 문제인 가장 긴 연속 부분. 판정을 못 받으면 구간을 그대로 둔다(캐시하지 않고 다음에 다시 묻는다).
async function sameProblem(streak, items, complete, cache) {
  const fixes = items.filter((x) => x.p.t >= streak.start && x.p.t <= streak.end && x.lab.intent === 'fix').map((x) => x.p);
  const texts = fixes.map((p) => clip(mask(p.x), 160));
  const key = sha1(texts.join('\n'));
  if (!(key in cache)) {
    try {
      const out = await complete({ model: 'sonnet', system: SAME_SYSTEM, prompt: texts.map((t, i) => `${i}: ${t}`).join('\n'), maxTokens: 30 });
      const m = out.match(/(\d+)\s*-\s*(\d+)/);
      if (m) cache[key] = [Number(m[1]), Number(m[2])];
      else if (/none/i.test(out)) cache[key] = null;
    } catch {}
  }
  const run = key in cache ? cache[key] : [0, fixes.length - 1];
  if (!run) return null;
  const [a, b] = run;
  if (b < a || b >= fixes.length || b - a + 1 < GUESS_MIN) return null;
  return { start: fixes[a].t, end: fixes[b].t, n: b - a + 1, first: fixes[a] };
}

// 수정 요청 사이가 이보다 벌어지면 다른 문제로 본다.
const EPISODE_GAP = 120 * MIN;
// 이 길이를 넘는 보고만 「잘 쓴 보고」 후보로 본다(상황을 풀어 쓴 메시지).
const GOOD_REPORT_LEN = 150;
// 해결을 알리는 말. 이 말이 나오면 그 흐름은 끝난 것으로 본다(없으면 간격으로만 끊는다).
const SOLVED = /해결(했|됐|됨|완료)|잘 ?된다|잘 ?돼|이제 ?(잘|된다|되네|돼)|됐다|되네|고쳐졌|문제 ?없(다|어|네)|(fixed|works now|it works|solved)|直った|解決|解决了|好了/i;

const quote = (e, n = 60) => clip(mask(e.x), n);

function labeled(s, labels) {
  return s.ev.filter((e) => e.k === 'p').map((p) => ({ p, lab: promptLabel(labels, p) })).filter((x) => x.lab);
}

// 구간 하나를 같은 문제를 쫓던 흐름 전체로 넓힌다: 수정 요청이 EPISODE_GAP 안에 이어지는 동안.
function episodeOf(items, streak) {
  const i = items.findIndex((x) => x.p.t === streak.start);
  let lastFix = streak.end;
  let solved = null;
  for (let j = i + 1; j < items.length; j++) {
    const x = items[j];
    if (x.p.t - lastFix > EPISODE_GAP) break;
    if (x.p.t > streak.end && SOLVED.test(x.p.x)) {
      solved = x;
      break;
    }
    if (x.lab.intent === 'fix') lastFix = x.p.t;
  }
  const end = solved ? solved.p.t : lastFix;
  const inside = items.filter((x) => x.p.t >= streak.start && x.p.t < end);
  return { start: streak.start, end, inside, resolvedAt: solved?.p.t ?? null };
}

// 해결 직전 한 시간 안에 상황을 풀어 쓴 메시지가 있고, 그 뒤로 같은 지적이 거의 없었으면 그것을 「가장 잘 쓴 보고」로 본다.
// 의도는 가리지 않는다(「이걸 해결해 줘」처럼 만들어 달라는 말로 분류되기도 한다).
function goodReport(ep) {
  if (!ep.resolvedAt) return null;
  const tail = ep.inside.filter((x) => x.p.n >= GOOD_REPORT_LEN && ep.resolvedAt - x.p.t <= 60 * MIN);
  const last = tail.at(-1);
  if (!last) return null;
  const fixesAfter = ep.inside.filter((x) => x.p.t > last.p.t && x.lab.intent === 'fix').length;
  return fixesAfter > 1 ? null : last.p;
}

// 그 보고 앞뒤로 답한 모델이 달라졌는지. 기록만으로는 해결이 어느 쪽 덕인지 가를 수 없으니 리포트에 밝힌다.
function modelChange(session, at) {
  const before = new Set();
  const after = new Set();
  for (const e of session.ev) {
    if (e.k !== 'r' || !e.m || e.m.startsWith('<')) continue;
    if (e.t < at && at - e.t <= 60 * MIN) before.add(e.m);
    if (e.t >= at && e.t - at <= 30 * MIN) after.add(e.m);
  }
  const added = [...after].filter((m) => !before.has(m));
  return added.length && before.size ? { from: [...before].join(', '), to: added.join(', ') } : null;
}

// complete 를 주면 구간마다 「같은 문제인가」를 확인한다(없으면 연속 여부만 본다).
export async function findGuessLoops(sessions, labels, { complete } = {}) {
  const all = [];
  const cache = complete ? readJson(CACHE_FILE(), {}) : {};
  let fixPrompts = 0;
  let hypothesis = 0;
  for (const s of sessions) {
    const items = labeled(s, labels);
    for (const x of items) {
      if (x.lab.intent !== 'fix') continue;
      fixPrompts++;
      if (x.lab.sig.has('hypothesis')) hypothesis++;
    }
    for (const raw of guessStreaks(items)) {
      const g = complete ? await sameProblem(raw, items, complete, cache) : raw;
      if (g) all.push({ ...g, s, items, project: projectName(s.root) });
    }
  }
  if (complete) writeJson(CACHE_FILE(), cache);
  const totalMs = all.reduce((a, g) => a + (g.end - g.start), 0);
  const result = {
    count: all.length,
    messages: all.reduce((a, g) => a + g.n, 0),
    ms: totalMs,
    fixPrompts,
    hypothesis,
    byProject: {},
    top: null,
    // 정답 붙이기에서 구간을 하나씩 보여 주려고 둔다.
    list: all.map((g) => ({ start: g.start, end: g.end, n: g.n, project: g.project, session: g.s.id })),
  };
  for (const g of all) result.byProject[g.project] = (result.byProject[g.project] || 0) + 1;
  if (!all.length) return result;

  // 가장 긴 구간을 사례로 보여 준다.
  const top = [...all].sort((a, b) => b.n - a.n || b.end - b.start - (a.end - a.start))[0];
  const ep = episodeOf(top.items, top);
  const others = all.filter((g) => g !== top && g.s === top.s && g.start > top.end && g.start <= ep.end);
  const firstAsk = ep.inside.find((x) => x.p.t > top.end && (x.lab.intent === 'why' || x.lab.sig.has('hypothesis') || x.lab.sig.has('challenge')));
  const good = goodReport(ep);
  const inTop = top.items.filter((x) => x.p.t >= top.start && x.p.t <= top.end);
  result.top = {
    project: top.project,
    n: top.n,
    ms: top.end - top.start,
    start: top.start,
    end: top.end,
    episode: { start: ep.start, end: ep.end, resolvedAt: ep.resolvedAt, messages: ep.inside.length },
    first: inTop.slice(0, 3).map((x) => ({ t: x.p.t, x: quote(x.p, 40) })),
    firstAsk: firstAsk ? { t: firstAsk.p.t, x: quote(firstAsk.p, 50) } : null,
    again: others.map((g) => ({ t: g.start, n: g.n, x: quote(g.first, 40) })),
    good: good ? { t: good.t, x: clip(mask(good.x), 420), resolvedAt: ep.resolvedAt } : null,
    modelChange: good ? modelChange(top.s, good.t) : null,
  };
  return result;
}
