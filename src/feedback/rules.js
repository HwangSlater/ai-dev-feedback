// C12·C13: 작업 방식에 대한 일반 규칙(「한국어로 답해」, 「커밋 하나로 합쳐」 같은 것)을 서로 다른 대화에서
// 되풀이했는지, 그 규칙이 이미 지침 파일·메모리에 적혀 있는데도 되풀이됐는지 찾는다.
//
// 순서: 후보 고르기(코드) → 일반화(AI, 배치) → 같은 뜻끼리 묶기(AI 한 번) → 대화 수로 거르기(코드)
//       → 묶음마다 메시지를 그 규칙에 다시 대 보기(AI) → 규칙 파일 줄과 대조(AI 한 번) → 그 줄이 처음 생긴 날.
// AI 로 보내는 것은 mask() 를 거친 짧은 사용자 문장과 규칙 파일의 짧은 줄뿐이다. 결과는 HOME/rules-cache.json 에 캐시한다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promptLabel } from '../classify.js';
import { projectName } from '../sessions.js';
import { HOME, clip, mask, readJson, sha1, writeJson } from '../util.js';

const CACHE_FILE = () => path.join(HOME, 'rules-cache.json');
// 2: 일반화 기준을 「앞으로 에이전트의 행동」으로 좁히고, 묶음마다 다시 대 보는 단계를 더함.
//    판정에서 틀린 것이 모두 「이번 작업에만 한 지시」를 규칙으로 읽은 것이었다(docs/accuracy.md).
const CACHE_VERSION = 2;
const GEN_BATCH = 40;
const MAX_LEN = 240;
// 대조에 보낼 규칙 파일 줄의 총량(글자). 넘으면 짧은 줄부터 남긴다.
const LINE_BUDGET = 24_000;
const LINE_MAX = 200;

// 지금 작업이 아니라 「늘」 지킬 것을 말할 때 자주 붙는 말.
export const RULE_CUE =
  /앞으로|항상|무조건|매번|언제나|절대|하지 ?마|하지 ?말|말라고|라고 했|랬잖|말했잖|했잖아|몇 번|또 |다시는|부터는|말고는|말해|해라|하라고|금지|한국어|영어로|존댓말|답해|답변|대답|[가-힣]라[.!]?$|\b(always|never|don't|do not|stop|from now on|every time|again)\b/i;
const RULE_INTENTS = new Set(['build', 'other', 'go', 'inform']);

// ---------- 규칙 파일 ----------

// 읽을 규칙 파일: 각 루트의 CLAUDE.md·AGENTS.md, ~/.claude/CLAUDE.md, ~/.claude/projects/*/memory/*.md
export function ruleFiles(projectRoots = [], { claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude') } = {}) {
  const out = [];
  const add = (f) => {
    if (fs.existsSync(f) && fs.statSync(f).isFile() && !out.includes(f)) out.push(f);
  };
  for (const root of new Set(projectRoots.filter(Boolean))) {
    add(path.join(root, 'CLAUDE.md'));
    add(path.join(root, 'AGENTS.md'));
  }
  add(path.join(claudeDir, 'CLAUDE.md'));
  const projects = path.join(claudeDir, 'projects');
  if (fs.existsSync(projects)) {
    for (const p of fs.readdirSync(projects)) {
      const mem = path.join(projects, p, 'memory');
      if (!fs.existsSync(mem)) continue;
      for (const f of fs.readdirSync(mem)) if (f.endsWith('.md')) add(path.join(mem, f));
    }
  }
  return out;
}

// 파일에서 규칙으로 볼 만한 줄: 빈 줄·코드 블록·frontmatter(description 만 남김)·표 구분선은 뺀다.
export function ruleLines(file, text = fs.readFileSync(file, 'utf8')) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let fence = false;
  let front = lines[0]?.trim() === '---';
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (front) {
      if (i > 0 && line === '---') front = false;
      else if (/^description:/.test(line)) out.push({ line: i + 1, text: line.replace(/^description:\s*/, '') });
      return;
    }
    if (line.startsWith('```')) return void (fence = !fence);
    if (fence || line.length < 4 || /^[|\-\s:]+$/.test(line)) return;
    out.push({ line: i + 1, text: line });
  });
  return out;
}

// ---------- 후보 ----------

// 사용자 메시지 중 일반 규칙일 수 있는 것. 넓게 고르고, 거르는 일은 일반화 단계의 AI 가 한다.
export function pickCandidates(sessions, labels) {
  const out = [];
  for (const s of sessions) {
    for (const e of s.ev) {
      if (e.k !== 'p' || e.s === 'sug' || !e.x) continue;
      if ((e.n || e.x.length) > MAX_LEN) continue;
      const lab = labels ? promptLabel(labels, e) : null;
      // 만들기·바꾸기 요청(build)은 신호와 상관없이 넣는다. 「좋아, 그리고 커밋은 합쳐」처럼 승인에 섞여 오는 규칙이 많다.
      const byLabel =
        lab && (lab.intent === 'build' || (RULE_INTENTS.has(lab.intent) && (lab.sig.has('change_req') || lab.sig.has('direction'))));
      if (!byLabel && !RULE_CUE.test(e.x)) continue;
      out.push({ e, s, text: mask(clip(e.x, MAX_LEN)) });
    }
  }
  return out;
}

// ---------- AI 출력 파싱 ----------

// "id|내용" 줄만 받는다. 형식이 깨진 줄은 버린다.
export function parseIdLines(out) {
  const res = new Map();
  for (const line of String(out).split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s*[|:]\s*(.+)$/);
    if (m) res.set(Number(m[1]), m[2].trim());
  }
  return res;
}

// 묶기 출력: 한 줄에 "id,id,id"(첫 id 가 대표). 한 id 는 처음 나온 묶음에만 넣는다.
export function parseGroups(out, n) {
  const groups = [];
  const used = new Set();
  for (const line of String(out).split(/\r?\n/)) {
    const t = line.trim();
    if (!/^\d+(\s*,\s*\d+)*$/.test(t)) continue;
    const ids = t.split(',').map((x) => Number(x.trim())).filter((i) => i < n && !used.has(i));
    ids.forEach((i) => used.add(i));
    if (ids.length) groups.push(ids);
  }
  return groups;
}

const GEN_SYSTEM = `You read short messages a developer typed to an AI coding agent (mostly Korean). For each input line "id: message" output exactly one line "id|result", nothing else.
result: if the message states a GENERAL working rule the agent should always follow across tasks (language of answers, commit/push habits, testing, deploying, data handling, asking before acting, style of work), rewrite it as ONE short Korean rule ending in a verb noun form like "~하기" (e.g. "한국어로 답하기", "커밋은 작업 단위로 하나로 합치기", "허락 없이 배포하지 않기", "확인 없이 데이터를 지우지 않기"). Drop project-specific names; keep it general.
Output a rule ONLY when the message asks the agent to change ITS OWN behavior from now on, or corrects something the agent keeps doing (cues: "앞으로", "항상", "매번", "또", "왜 또", "~라고 했잖아", "from now on", "again").
A one-time decision about the current task is "-", even when it mentions commits, pushing, deploying, language or data: e.g. "이 브랜치는 아직 푸시하지 마" -> "-", "이번 커밋은 그대로 올려" -> "-", "이 파일의 영어 문장만 번역해 줘" -> "-", "이 로그는 지우지 말고 남겨 둬" -> "-".
Examples that ARE rules: "앞으로 커밋은 하나로 묶어서 해" -> "커밋은 작업 단위로 하나로 합치기", "왜 또 영어로 말해? 한국어로 해" -> "한국어로 답하기".
If the message is only about the current task (a specific change, bug, file, UI detail, approval, question), output "-".`;

const VERIFY_SYSTEM = `A developer's messages to an AI coding agent were grouped under one rule about how the agent should work. Check each message.
Input: "RULE: <rule>" then lines "id: message". For each message output exactly one line "id|yes" or "id|no", nothing else.
yes = the message asks the agent to follow this rule as a lasting way of working (or complains the agent broke it again).
no = the message is a one-time instruction for the current step, is about something else, or only mentions the topic.`;

const GROUP_SYSTEM = `You group short Korean rules (about how an AI coding agent should work) that mean the same thing. Input lines are "id: rule".
Output one line per group of two or more rules with the same meaning: the ids separated by commas, the clearest rule first, e.g. "4,0,17". Nothing else. Do not output single-rule groups. Group only when following one rule means following the other; related but different rules stay apart.`;

const MATCH_SYSTEM = `You match rules a developer repeated to an AI coding agent against lines in their instruction and memory files.
Input has two parts: "RULES" with lines "cN: rule" and "LINES" with lines "fileNo:lineNo: text".
For each rule output exactly one line "cN|fileNo:lineNo" for the single line that states the same rule (same meaning, not just same topic), or "cN|-" if no line does. Nothing else.`;

// ---------- 본체 ----------

function emptyCache() {
  return { v: CACHE_VERSION, gen: {}, group: {}, match: {} };
}

function loadCache() {
  const c = readJson(CACHE_FILE(), null);
  return c && c.v === CACHE_VERSION ? { ...emptyCache(), ...c } : emptyCache();
}

// 실패하면 한 번 더. 그래도 안 되면 빈 결과(그 항목들만 버린다).
async function ask(complete, opts, parse, ok, calls) {
  for (let i = 0; i < 2; i++) {
    let got;
    calls.n++;
    try {
      got = parse(await complete(opts));
    } catch {
      continue;
    }
    if (ok(got)) return got;
  }
  return null;
}

// 「규칙 아님」 답. 모델이 '-' 대신 긴 줄표(—)나 「없음」으로 답하기도 해서, 그것들이 「—」라는 규칙으로 묶인 적이 있다(2026-10-02).
export const notRule = (r) => /^[\s\-‐‑–—―]*$/.test(r) || /^(none|n\/a|없음|해당 ?없음)$/i.test(r.trim());

async function generalize(texts, cache, complete, calls) {
  const need = texts.filter((t) => !(sha1(t) in cache.gen));
  for (let i = 0; i < need.length; i += GEN_BATCH) {
    let batch = need.slice(i, i + GEN_BATCH);
    for (let attempt = 0; attempt < 2 && batch.length; attempt++) {
      calls.n++;
      let got = new Map();
      try {
        const out = await complete({ model: 'haiku', system: GEN_SYSTEM, prompt: batch.map((t, j) => `${j}: ${t}`).join('\n'), maxTokens: 2500 });
        got = parseIdLines(out);
      } catch {
        // 호출 자체가 실패하면 이 배치 전체를 다시 한 번 시도한다.
      }
      const missed = [];
      batch.forEach((t, j) => {
        const r = got.get(j);
        if (!r) return missed.push(t);
        cache.gen[sha1(t)] = notRule(r) ? '-' : clip(r, 60);
      });
      batch = missed;
    }
  }
}

// 묶음마다 메시지를 그 규칙에 다시 대 본다. 「no」인 메시지는 묶음에서 뺀다. 캐시 열쇠는 규칙+문장.
async function verify(rule, msgs, cache, complete, calls) {
  cache.verify ||= {};
  const key = (m) => sha1(`${rule}\n${m}`);
  const need = msgs.filter((m) => !(key(m) in cache.verify));
  if (need.length) {
    const got = await ask(
      complete,
      { model: 'haiku', system: VERIFY_SYSTEM, prompt: `RULE: ${rule}\n${need.map((m, i) => `${i}: ${m}`).join('\n')}`, maxTokens: 800 },
      parseIdLines,
      (m) => m.size >= need.length,
      calls,
    );
    need.forEach((m, i) => {
      const v = got?.get(i);
      if (v) cache.verify[key(m)] = /^y/i.test(v);
    });
  }
  // 판정을 못 받은 메시지는 남긴다(판정 실패로 묶음 전체가 사라지지 않게).
  return msgs.map((m) => cache.verify[key(m)] !== false);
}

async function group(rules, cache, complete, calls) {
  const key = sha1(rules.slice().sort().join('\n'));
  if (cache.group[key]) return cache.group[key];
  const map = Object.fromEntries(rules.map((r) => [r, r]));
  if (rules.length > 1) {
    const groups = await ask(
      complete,
      { model: 'sonnet', system: GROUP_SYSTEM, prompt: rules.map((r, i) => `${i}: ${r}`).join('\n'), maxTokens: 3000 },
      (out) => parseGroups(out, rules.length),
      () => true,
      calls,
    );
    for (const ids of groups || []) for (const i of ids) map[rules[i]] = rules[ids[0]];
  }
  cache.group = { [key]: map }; // 가장 최근 묶음만 둔다(규칙 목록이 바뀌면 다시 묶는다).
  return map;
}

// 대조에 보낼 줄 목록. 줄이 많으면 짧은 줄부터 예산 안에서 고른다.
function lineTable(files) {
  const all = [];
  files.forEach((file, fi) => {
    let lines;
    try {
      lines = ruleLines(file);
    } catch {
      return;
    }
    for (const l of lines) all.push({ fi, file, line: l.line, text: l.text, sent: mask(clip(l.text, LINE_MAX)) });
  });
  let budget = LINE_BUDGET;
  const keep = new Set();
  for (const l of [...all].sort((a, b) => a.sent.length - b.sent.length)) {
    if (budget - l.sent.length < 0) break;
    budget -= l.sent.length + 8;
    keep.add(l);
  }
  return all.filter((l) => keep.has(l));
}

async function matchRules(reps, files, cache, complete, calls) {
  const table = lineTable(files);
  if (!reps.length || !table.length) return reps.map(() => null);
  const body = table.map((l) => `${l.fi}:${l.line}: ${l.sent}`).join('\n');
  const key = sha1(`${reps.join('\n')}\n--\n${body}`);
  let got = cache.match[key];
  if (!got) {
    const prompt = `RULES\n${reps.map((r, i) => `c${i}: ${r}`).join('\n')}\n\nLINES\n${body}`;
    const res = await ask(
      complete,
      { model: 'sonnet', system: MATCH_SYSTEM, prompt, maxTokens: 1500 },
      (out) => {
        const m = new Map();
        for (const line of String(out).split(/\r?\n/)) {
          const x = line.trim().match(/^c(\d+)\s*\|\s*(-|\d+:\d+)\s*$/);
          if (x) m.set(Number(x[1]), x[2]);
        }
        return m;
      },
      (m) => m.size > 0,
      calls,
    );
    got = reps.map((_, i) => res?.get(i) ?? null);
    if (res) cache.match = { [key]: got };
  }
  return got.map((ref) => {
    if (!ref || ref === '-') return null;
    const [fi, line] = ref.split(':').map(Number);
    const l = table.find((r) => r.fi === fi && r.line === line);
    return l ? { file: l.file, line: l.line, text: l.text } : null;
  });
}

// ---------- 그 줄이 처음 생긴 날 ----------

function gitRoot(file) {
  const home = path.resolve(os.homedir()).toLowerCase();
  let dir = path.dirname(path.resolve(file));
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir.toLowerCase() === home ? null : dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function firstSeen(file, text) {
  const root = gitRoot(file);
  if (root) {
    const needle = text.replace(/^[-*>#\s]+/, '').slice(0, 20);
    try {
      const out = execFileSync('git', ['-C', root, 'log', `-S${needle}`, '--format=%aI', '--reverse', '--', path.relative(root, file)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const first = out.split(/\r?\n/).find(Boolean);
      if (first) return new Date(first).toISOString();
    } catch {
      // git 이 없거나 실패하면 아래 파일 정보로 넘어간다.
    }
  }
  try {
    // frontmatter 의 modified 는 마지막으로 고친 때라 늦을 수 있다. 파일이 생긴 시각과 견줘 이른 쪽을 쓴다.
    const head = fs.readFileSync(file, 'utf8').slice(0, 2000);
    const m = head.match(/^\s*modified:\s*(\S+)/m);
    const st = fs.statSync(file);
    const times = [m && Date.parse(m[1]), st.birthtimeMs || st.ctimeMs].filter((x) => x && !Number.isNaN(x));
    return times.length ? new Date(Math.min(...times)).toISOString() : null;
  } catch {
    return null;
  }
}

// ---------- 공개 함수 ----------

export async function findRepeatedRules(sessions, labels, { complete, files, minSessions = 2, minMessages = 3, onStats } = {}) {
  const calls = { n: 0 };
  const cache = loadCache();
  const cands = pickCandidates(sessions, labels);
  const texts = [...new Set(cands.map((c) => c.text))];
  await generalize(texts, cache, complete, calls);
  writeJson(CACHE_FILE(), cache);

  const withRule = cands
    .map((c) => ({ ...c, rule: cache.gen[sha1(c.text)] }))
    .filter((c) => c.rule && !notRule(c.rule));
  const rules = [...new Set(withRule.map((c) => c.rule))].sort();
  const rep = await group(rules, cache, complete, calls);
  writeJson(CACHE_FILE(), cache);

  const byRep = new Map();
  for (const c of withRule) {
    const r = rep[c.rule] || c.rule;
    if (!byRep.has(r)) byRep.set(r, []);
    byRep.get(r).push(c);
  }
  const clusters = [];
  for (const [rule, all] of byRep) {
    if (new Set(all.map((c) => c.s.id)).size < minSessions || all.length < minMessages) continue;
    const keep = await verify(rule, all.map((c) => c.text), cache, complete, calls);
    const list = all.filter((_, i) => keep[i]);
    const sess = new Set(list.map((c) => c.s.id));
    if (sess.size < minSessions || list.length < minMessages) continue;
    clusters.push({
      rule,
      messages: list
        .sort((a, b) => a.e.t - b.e.t)
        .map((c) => ({ t: c.e.t, x: mask(clip(c.e.x, 120)), project: projectName(c.s.root || c.s.cwd), session: c.s.id })),
      sessions: sess.size,
      source: null,
      afterRule: 0,
    });
  }
  clusters.sort((a, b) => b.sessions - a.sessions || b.messages.length - a.messages.length);

  const ruleFileList = files || ruleFiles([...new Set(sessions.map((s) => s.root).filter(Boolean))]);
  const found = await matchRules(clusters.map((c) => c.rule), ruleFileList, cache, complete, calls);
  writeJson(CACHE_FILE(), cache);
  clusters.forEach((c, i) => {
    const src = found[i];
    if (!src) return;
    c.source = { ...src, firstSeen: firstSeen(src.file, src.text) };
    c.afterRule = countAfter(c.messages, c.source.firstSeen);
  });

  onStats?.({ candidates: cands.length, distinct: texts.length, generalized: withRule.length, rules: rules.length, groups: byRep.size });
  return { clusters, usage: { calls: calls.n } };
}

export function countAfter(messages, iso) {
  const since = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(since) ? 0 : messages.filter((m) => m.t >= since).length;
}
