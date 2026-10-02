// code-dependent(github.com/HwangSlater/code-dependent)에서 가져옴. 두 곳을 함께 고치게 되면 공통 패키지로 뗀다.
// AI labels for data whose meaning varies by person and stack: human prompts and shell commands.
// Everything is deduplicated and cached in labels.json, so each distinct text is sent at most once.
import path from 'node:path';
import { isShell } from './adapters/claude-code.js';
import { CALL_OVERHEAD, complete, detectBackend } from './ai.js';
import { HOME, clip, estimateTokens, mask, pool, readJson, sha1, writeJson } from './util.js';

export const INTENTS = ['build', 'fix', 'why', 'discuss', 'verify', 'inform', 'go', 'other'];
export const SIGNALS = { ap: 'approve', ch: 'challenge', hy: 'hypothesis', st: 'spec_test', dr: 'direction', dg: 'delegate', cr: 'change_req' };
export const CMD_CLASSES = ['test', 'build', 'lint', 'run', 'install', 'vcs', 'explore', 'deploy', 'other'];

const LABELS_FILE = path.join(HOME, 'labels.json');
const CMD_BATCH = 120;

// code-dependent 를 쓰던 사람은 같은 기준으로 매긴 분류가 이미 있다. 읽기만 하고 덮어쓰지 않는다(열쇠에 기준 판이 들어 있어 섞여도 안전하다).
const SHARED_LABELS = path.join(path.dirname(HOME), '.code-dependent', 'labels.json');

export function loadLabels() {
  const own = readJson(LABELS_FILE, {});
  const shared = process.env.AI_DEV_FEEDBACK_HOME ? {} : readJson(SHARED_LABELS, {});
  return { p: { ...shared.p, ...own.p }, c: { ...shared.c, ...own.c } };
}

export function saveLabels(labels) {
  writeJson(LABELS_FILE, labels);
}

// ---------- prompts ----------

// Rubric chosen by scripts/eval-labels.mjs (docs/EXPERIMENTS.md): 76% intent agreement with a Sonnet reference
// at batch 25 (69% at 50), vs 40% for the first 12-intent rubric. Approval is a signal because it usually
// arrives together with new instructions.
const PROMPT_SYSTEM = `You label messages a developer typed to an AI coding agent (often Korean). For each item output exactly one line "id|intent|signals", nothing else.
intent (the ONE main purpose):
build: asks to create or change something - features, UI, content, docs, config, git/deploy tasks, cleanup ("만들어줘", "바꿔줘", "추가해", "푸시해")
fix: says something is broken or behaves wrongly, with or without asking to fix it ("안 돼", "에러 나", "증상이 나와", "누락돼")
why: asks how/why something works or why the AI did something ("왜 이렇게 했어?", "어떻게 만든거야?")
discuss: asks for opinions, options, a plan or an assessment ("어떻게 생각해?", "다른 방법은?", "뭐가 나아?")
verify: asks to test, review or double-check work ("테스트해줘", "확인해볼래?", "빠진 거 없어?")
inform: gives information only - answers, results, "I did it" ("했어", "키 넣었어", "그거 말하는 거야")
go: ONLY approves or continues, nothing else ("ㄱㄱ", "진행해", "이어서 해", "3번으로")
other: anything else
A change request about something that is not broken is build, even if phrased as a complaint.
signals (comma-separated, often empty):
ap: accepts or approves the AI's proposal or says to continue, even when adding instructions
ch: questions or pushes back on the AI's proposal/claim
hy: guesses the cause of a problem
st: states concrete test cases or acceptance criteria
dr: dictates a specific technical choice (library, pattern, structure, algorithm)
dg: explicitly leaves the decision to the AI ("알아서 해", "네가 판단해")
cr: changes requirements after seeing a result ("이거 말고", "그 대신", "생각해보니")
examples:
ㄱㄱ -> go|ap
좋아, 그걸로 해. 대신 로그는 남겨줘 -> build|ap
3번으로 하고 나머지는 빼줘 -> build|ap,cr
이러면 동시에 요청 오면 꼬이지 않아? -> discuss|ch
로그인 안 돼. 토큰 만료 때문인 것 같은데 -> fix|hy
Redis 말고 DB 락으로 해줘 -> build|dr,cr
빈 값, 음수, 1000자 넘는 입력 다 테스트해 -> verify|st
네가 보기에 괜찮은 걸로 해 -> go|ap,dg`;

// Prompt variants compared by scripts/eval-labels.mjs.

export const PROMPT_RUBRIC = PROMPT_SYSTEM;
export const RUBRIC_VERSION = 4;
// Haiku loses 7 points of accuracy at 50 per batch; Codex does not, and its large per-call overhead makes fewer calls worth it.
const promptBatch = () => (detectBackend()?.kind === 'codex' ? 50 : 25);

export function promptText(e) {
  return mask(clip(e.x, 240, 80));
}

// Labels depend on the rubric and the model, so both are part of the cache key.
export function promptKey(text, model = 'haiku') {
  // Codex labels are kept apart from Claude's: a different model labels differently.
  const via = detectBackend()?.kind === 'codex' ? 'x' : '';
  return `${RUBRIC_VERSION}${via}${model[0]}${sha1(text).slice(0, 16)}`;
}

// Collect the distinct prompt texts that still need a label.
export function pendingPrompts(sessions, labels, model) {
  const need = new Map();
  for (const s of sessions) {
    for (const e of s.ev) {
      if (e.k !== 'p') continue;
      const text = promptText(e);
      const key = promptKey(text, model);
      e.key = key;
      if (!labels.p[key] && !need.has(key)) need.set(key, text);
    }
  }
  return need;
}

function parseLines(out) {
  const res = new Map();
  for (const line of out.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s*\|\s*([a-z_]+)\s*(?:\|\s*([a-z,\s]*))?/i);
    if (m) res.set(Number(m[1]), [m[2].toLowerCase(), (m[3] || '').replace(/\s/g, '')]);
  }
  return res;
}

async function labelBatch(entries, labels, model) {
  const input = entries.map(([, text], i) => `${i}: ${text}`).join('\n');
  const out = await complete({ model, system: PROMPT_SYSTEM, prompt: input, maxTokens: 1500 });
  const got = parseLines(out);
  const missed = [];
  entries.forEach(([key], i) => {
    const r = got.get(i);
    if (!r) return missed.push(entries[i]);
    const intent = INTENTS.includes(r[0]) ? r[0] : 'other';
    const sig = r[1].split(',').filter((c) => SIGNALS[c]).join(',');
    labels.p[key] = sig ? `${intent}|${sig}` : intent;
  });
  return missed;
}

export async function labelPrompts(need, labels, model, onProgress) {
  const entries = [...need];
  const batches = [];
  const size = promptBatch();
  for (let i = 0; i < entries.length; i += size) batches.push(entries.slice(i, i + size));
  let done = 0;
  await pool(batches, 4, async (b) => {
    let missed = await labelBatch(b, labels, model);
    if (missed.length) missed = await labelBatch(missed, labels, model);
    for (const [key] of missed) labels.p[key] = 'other';
    saveLabels(labels);
    onProgress?.((done += b.length), entries.length);
  });
}

export function promptLabel(labels, e) {
  const raw = e.key && labels.p[e.key];
  if (!raw) return null;
  const [intent, sig = ''] = raw.split('|');
  return { intent, sig: new Set(sig.split(',').filter(Boolean).map((c) => SIGNALS[c])) };
}

// ---------- shell commands ----------

const RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx', 'bunx', 'uv', 'poetry', 'pipenv', 'python', 'python3', 'py', 'node', 'go', 'cargo', 'dotnet', 'gradle', './gradlew', 'gradlew', 'mvn', './mvnw', 'make', 'docker', 'docker-compose', 'kubectl', 'git', 'gh', 'deno', 'php', 'composer', 'bundle', 'rails', 'swift', 'flutter', 'dart', 'expo', 'eas']);
const SKIP_WORDS = new Set(['run', 'exec', '-m', 'x', 'compose']);

const NOISE_HEADS = new Set(['cd', 'set-location', 'echo', 'write-host', 'write-output', 'sleep', 'start-sleep', 'true', 'false', 'exit', 'export', 'set', 'for', 'do', 'done', 'if', 'then', 'fi', 'else', 'while', 'break', 'continue', 'function', 'return', 'local']);
const SCRIPT = /\.(py|js|mjs|cjs|ts|sh|ps1|rb)$/i;

// Split on && || ; | outside quotes, parens and braces.
function segments(cmd) {
  const out = [];
  let cur = '';
  let quote = '';
  let depth = 0;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(' || ch === '{') depth++;
    else if ((ch === ')' || ch === '}') && depth) depth--;
    else if (!depth && (ch === ';' || ch === '|' || (ch === '&' && cmd[i + 1] === '&'))) {
      out.push(cur);
      cur = '';
      if (cmd[i + 1] === ch) i++;
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// "cd app && CI=1 npm run test -- --watch" -> ["npm run test"]
export function commandSignatures(cmd) {
  const sigs = new Set();
  for (const seg of segments(cmd)) {
    const toks = seg.trim().split(/\s+/).filter(Boolean);
    while (toks.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0]) || ['sudo', 'time', 'env', '&', '.', 'call'].includes(toks[0]))) toks.shift();
    if (!toks.length) continue;
    const head = toks[0].replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
    // Only word-like heads are commands; anything else is a fragment of a script or a heredoc.
    if (!/^[a-z][\w.-]*$/.test(path.basename(head)) || NOISE_HEADS.has(head)) continue;
    const base = path.basename(head);
    const sig = [SCRIPT.test(base) ? base : head.includes('/') ? base : head];
    if (RUNNERS.has(base)) {
      for (const t of toks.slice(1)) {
        if (sig.length >= 3) break;
        if (t === '-m') {
          sig.push(t);
          continue;
        }
        if (t.startsWith('-')) continue;
        const tb = path.basename(t.replace(/\\/g, '/'));
        if (SCRIPT.test(tb)) {
          sig.push(tb.toLowerCase());
          break;
        }
        if (!/^[a-z][\w:-]*$/i.test(t)) break;
        sig.push(t.toLowerCase());
        if (!SKIP_WORDS.has(t.toLowerCase())) break;
      }
    }
    sigs.add(sig.join(' ').slice(0, 40));
  }
  return [...sigs];
}

const CMD_SYSTEM = `Classify shell command prefixes run by an AI coding agent. For each input line "id: command" output one line "id|class".
class: test=runs tests or test runners; build=compiles/bundles/type-checks; lint=lint/format; run=starts an app/server/script;
install=installs dependencies/packages; vcs=git/gh/version control; explore=reads files, lists dirs, searches, inspects state;
deploy=deploys/publishes/infra changes; other=anything else.`;

export function pendingCommands(sessions, labels) {
  const need = new Set();
  for (const s of sessions) {
    for (const e of s.ev) {
      if (e.k !== 't' || !isShell(e.n)) continue;
      e.sig = commandSignatures(e.g);
      for (const sig of e.sig) if (!labels.c[sig] && !seedClass(sig)) need.add(sig);
    }
  }
  return [...need];
}

export async function labelCommands(sigs, labels) {
  const batches = [];
  for (let i = 0; i < sigs.length; i += CMD_BATCH) batches.push(sigs.slice(i, i + CMD_BATCH));
  await pool(batches, 4, async (b) => {
    const out = await complete({ model: 'haiku', system: CMD_SYSTEM, prompt: b.map((s, i) => `${i}: ${s}`).join('\n'), maxTokens: 2000 });
    const got = parseLines(out);
    b.forEach((sig, i) => {
      const c = got.get(i)?.[0];
      labels.c[sig] = CMD_CLASSES.includes(c) ? c : 'other';
    });
    saveLabels(labels);
  });
}

const CMD_PRIORITY = ['test', 'build', 'lint', 'deploy', 'run', 'install', 'vcs', 'explore', 'other'];

// Universal commands whose meaning never depends on the project. Saves AI calls and powers --no-ai.
const SEED = [
  [/(^|\s)(pytest|jest|vitest|mocha|phpunit|rspec|playwright test)\b|\b(test|tests|spec)\b|-m (pytest|unittest)/, 'test'],
  [/^(tsc|npx tsc|webpack|vite build|esbuild|rollup)\b|\bbuild\b|^(cargo check|go vet)/, 'build'],
  [/^(eslint|prettier|ruff|black|flake8|mypy|biome)\b|\b(lint|format|typecheck)\b/, 'lint'],
  [/\b(install|add|i|ci|sync)$|^pip\b|^brew\b|^apt/, 'install'],
  [/^(git|gh)\b/, 'vcs'],
  [/^(ls|dir|cat|type|head|tail|grep|rg|find|wc|sed|awk|tree|stat|pwd|which|where|get-childitem|get-content|select-string|du|file|diff|less|jq|sort|uniq|cut)$/, 'explore'],
];

function seedClass(sig) {
  for (const [re, c] of SEED) if (re.test(sig)) return c;
  return null;
}

export function commandClass(labels, e) {
  let best = null;
  for (const sig of e.sig || commandSignatures(e.g)) {
    const c = labels?.c[sig] || seedClass(sig);
    if (c && (!best || CMD_PRIORITY.indexOf(c) < CMD_PRIORITY.indexOf(best))) best = c;
  }
  return best;
}

// ---------- estimate ----------

export function estimateLabelCost(need, sigs) {
  let input = 0;
  for (const text of need.values()) input += estimateTokens(text) + 3;
  const pBatches = Math.ceil(need.size / promptBatch());
  const cBatches = Math.ceil(sigs.length / CMD_BATCH);
  const overhead = CALL_OVERHEAD[detectBackend()?.kind] ?? 350;
  input += pBatches * (overhead + estimateTokens(PROMPT_SYSTEM));
  input += cBatches * (overhead + estimateTokens(CMD_SYSTEM)) + sigs.length * 8;
  const output = need.size * 9 + sigs.length * 5;
  return { calls: pBatches + cBatches, input, output };
}
