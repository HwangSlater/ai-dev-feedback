// 기록 읽기 → 피드백 찾기 → 고르기 → 리포트. 고르는 기준은 docs/design.md 「고르는 법」.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { complete, detectBackend, usage } from './ai.js';
import { FEEDBACK } from './catalog.js';
import { estimateLabelCost, labelCommands, labelPrompts, loadLabels, pendingCommands, pendingPrompts } from './classify.js';
import { findGuessLoops } from './feedback/streaks.js';
import { findSecrets } from './feedback/secrets.js';
import { findRepeatedRules, ruleFiles } from './feedback/rules.js';
import { scanTestChecks } from './feedback/tests.js';
import { renderReport } from './report/render.js';
import { isGit, projectList, selectSessions, sinceOf } from './select.js';
import { loadSessions, projectName } from './sessions.js';
import { HOME, readJson, writeJson } from './util.js';

export const CONFIG_FILE = path.join(HOME, 'config.json');
export const DEFAULTS = { days: 30, projects: [], git: true, ai: true, focus: 'auto' };
const ACCURACY_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'accuracy.json');
// 정확도가 이 아래인 피드백은 리포트에 내지 않는다(미리보기 제외).
const MIN_ACCURACY = 0.8;
// 규칙 반복 찾기에 드는 대략의 토큰(후보 일반화 몇 번 + 묶기 + 대조).
const RULES_EST = 15_000;

// 시작 질문에 보여 줄 것: 기간별 메시지 수, 프로젝트, AI 분류 예상 토큰.
export async function scan() {
  const { sessions } = await loadSessions();
  const labels = loadLabels();
  const windows = {};
  for (const d of [7, 30]) {
    const since = sinceOf(d);
    const sel = selectSessions(sessions, { since });
    const need = pendingPrompts(sel, labels, 'haiku');
    const est = estimateLabelCost(need, pendingCommands(sel, labels));
    windows[d] = { sessions: sel.length, prompts: sel.reduce((a, s) => a + s.ev.filter((e) => e.k === 'p').length, 0), tokens: est.input + est.output + RULES_EST, unlabeled: need.size };
  }
  return { backend: detectBackend()?.kind || null, windows, projects: projectList(sessions, sinceOf(30)), last: readJson(CONFIG_FILE, null) };
}

function accuracyOf(kind) {
  const acc = readJson(ACCURACY_FILE, {});
  return acc[kind]?.accuracy ?? null;
}

// 규칙 파일에서 「같은 시도를 반복하지 않는다」 같은 내 규칙을 찾아 인용한다.
function findOwnRule(files, re) {
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const line = text.split(/\r?\n/).find((l) => re.test(l));
    if (line) return { file: path.basename(path.dirname(file)) + '/' + path.basename(file), text: line.replace(/^[\s>*-]+/, '').replace(/\*\*/g, '').trim().slice(0, 140) };
  }
  return null;
}

function pick(f, opts) {
  const habits = [];
  const strengths = [];
  const notMeasured = [];
  const shown = (kind) => opts.preview || (accuracyOf(kind) ?? 0) >= MIN_ACCURACY;

  // 「안 돼」 반복 — 샌 시간(분)으로 크기를 잰다.
  if (f.guess) {
    if (f.guess.count >= 2 && shown('guessLoop')) habits.push({ kind: 'guessLoop', size: f.guess.ms / 60_000, focus: 'stuck' });
    else if (!f.guess.count && f.guess.fixPrompts >= 20) {
      strengths.push({ title: '막혀도 「고쳐 줘」만 반복하지 않아요', phrase: '막히면 원인부터 짚는', html: `수정 요청 ${f.guess.fixPrompts}개 중, 원인 짐작 없이 같은 요청이 세 번 넘게 이어진 적이 없어요. 같은 실패를 계속 고치게 하면 시간이 새고, 도구 회사 지침도 두 번 넘게 바로잡았으면 새로 시작하라고 해요.`, source: 'cc' });
    }
  } else notMeasured.push('막혔을 때 「고쳐 줘」만 반복했는지 (AI 분류를 켜면 보여요)');

  // 같은 부탁 반복 — 두 번째부터의 되풀이 하나를 5분쯤으로 본다(다시 말하고, 다시 확인하는 시간).
  if (f.rules) {
    const big = f.rules.clusters.filter((c) => c.sessions >= 2);
    if (big.length && shown('repeatRule')) habits.push({ kind: 'repeatRule', size: big.slice(0, 2).reduce((a, c) => a + c.messages.length - 1, 0) * 5, focus: 'harness' });
  } else notMeasured.push('같은 부탁을 여러 대화에서 되풀이했는지 (AI 분류를 켜면 보여요)');

  // 테스트 확인 — 잘하는 것이면 「잘하고 있는 것」, 아니면 바꿀 것 후보.
  let testSummary = null;
  if (f.tests?.length) {
    const tests = f.tests.reduce((a, r) => a + r.tests, 0);
    const missing = f.tests.reduce((a, r) => a + r.missing, 0);
    const pct = tests ? Math.round((missing / tests) * 1000) / 10 : 0;
    const names = [...f.tests].sort((a, b) => b.tests - a.tests).map((r) => projectName(r.repo));
    const repos = names.length > 2 ? `${names[0]} 외 ${names.length - 1}곳` : names.join('·');
    testSummary = { tests, missing, pct, repos, examples: f.tests.flatMap((r) => r.examples.map((e) => ({ ...e, file: `${projectName(r.repo)}/${e.file}` }))).slice(0, 5) };
    if (tests >= 50 && pct <= 5 && shown('testChecks')) strengths.push({ title: FEEDBACK.testChecks.goodTitle, phrase: '테스트에 결과 확인을 넣는', html: FEEDBACK.testChecks.goodWhy(testSummary), source: FEEDBACK.testChecks.goodSource });
    else if (tests >= 20 && pct >= 20 && shown('testChecks')) habits.push({ kind: 'testChecks', size: missing * 2, focus: 'verify' });
  } else if (!opts.git) notMeasured.push('테스트에 결과 확인이 들어 있는지 (git 기록을 읽으면 보여요)');

  // 고르기: 고른 관심사가 있으면 그것부터, 나머지는 샌 크기 순으로. 많아야 둘.
  habits.sort((a, b) => (b.focus === opts.focus) - (a.focus === opts.focus) || b.size - a.size);
  const chosen = habits.slice(0, 2);
  const promise = chosen[0] ? FEEDBACK[chosen[0].kind].promise : null;

  const phrase = { guessLoop: '<b>같은 증상을 「고쳐 줘」로만 반복한 구간</b>', repeatRule: '<b>여러 번 말한 부탁이 다시 어겨지는 일</b>', testChecks: '<b>결과를 확인하지 않는 테스트</b>' };
  const good = strengths.length ? `${strengths.map((s) => s.phrase).join(' 습관과 ')} 습관은 탄탄해요. ` : '';
  const bad = chosen.length ? `시간이 가장 많이 샌 곳은 ${phrase[chosen[0].kind]}이었고${chosen[1] ? `, ${phrase[chosen[1].kind]}이 계속됐어요.` : '요.'}` : '이번에 짚을 만큼 크게 샌 곳은 보이지 않았어요.';
  return { habits: chosen, strengths: strengths.slice(0, 3), promise, summary: `${good}${bad}`, testSummary, notMeasured };
}

export async function run(opts, log = () => {}) {
  log('load');
  const { sessions } = await loadSessions({ onProgress: (d, n) => log('load', d, n) });
  const since = sinceOf(opts.days);
  const sel = selectSessions(sessions, { since, projects: opts.projects });
  if (!sel.length) throw new Error('NO_SESSIONS');

  let labels = null;
  if (opts.ai) {
    if (!detectBackend()) {
      log('nobackend');
      opts = { ...opts, ai: false };
    } else {
      labels = loadLabels();
      const need = pendingPrompts(sel, labels, 'haiku');
      const sigs = pendingCommands(sel, labels);
      log('classify', 0, need.size);
      if (sigs.length) await labelCommands(sigs, labels);
      if (need.size) await labelPrompts(need, labels, 'haiku', (d) => log('classify', d, need.size));
    }
  }

  const roots = [...new Set(sel.map((s) => s.root).filter(Boolean))];
  const findings = { secrets: findSecrets(sel), guess: null, rules: null, tests: null };
  if (labels) {
    findings.guess = await findGuessLoops(sel, labels, { complete });
    log('rules');
    findings.rules = await findRepeatedRules(sel, labels, { complete, files: ruleFiles(roots) });
  }
  if (opts.git) {
    log('git');
    findings.tests = roots.filter(isGit).map((r) => scanTestChecks(r, { since })).filter((r) => r && r.tests);
  }

  const picks = pick(findings, opts);
  const ownRule = picks.habits.some((h) => h.kind === 'guessLoop') ? findOwnRule(ruleFiles(roots), FEEDBACK.guessLoop.ownRule) : null;
  const sinceD = new Date(since);
  const meta = {
    title: `${opts.days}일 동안 AI와 개발한 방식을 돌아봤어요`,
    periodLabel: `${sinceD.getMonth() + 1}/${sinceD.getDate()} ~ ${new Date().getMonth() + 1}/${new Date().getDate()} · 최근 ${opts.days}일`,
    projects: new Set(sel.map((s) => projectName(s.root))).size,
    sessions: sel.length,
    prompts: sel.reduce((a, s) => a + s.ev.filter((e) => e.k === 'p').length, 0),
    git: opts.git,
    preview: !!opts.preview,
    notMeasured: picks.notMeasured,
  };
  const rep = { meta, picks, findings, ownRule, generated: Date.now(), usage: { ...usage, calls: { ...usage.calls } } };
  const file = path.join(HOME, 'report.html');
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(file, renderReport(rep));
  writeJson(CONFIG_FILE, { days: opts.days, projects: opts.projects, git: opts.git, ai: opts.ai, focus: opts.focus });
  return { file, rep };
}
