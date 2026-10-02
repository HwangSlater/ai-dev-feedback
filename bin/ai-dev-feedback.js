#!/usr/bin/env node
// 시작 질문 → 돌아보기 리포트. 질문과 설명은 docs/design.md 「시작할 때 고르는 것」. 글은 한국어·영어(--lang).
import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';
import { LANGS } from '../src/i18n.js';
import { DEFAULTS, run, scan } from '../src/pipeline.js';
import { fmtNum } from '../src/util.js';

const K = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

const C = {
  ko: {
    help: `ai-dev-feedback — AI 코딩 에이전트와 일한 기록으로 근거 있는 피드백을 주는 돌아보기

  npx github:HwangSlater/ai-dev-feedback               시작 질문에 답하면 리포트를 만들어 브라우저로 엽니다
  npx github:HwangSlater/ai-dev-feedback scan --json   돌아볼 수 있는 기록과 예상 비용만 (AI 없음)
  --yes, -y          묻지 않고 지난번 선택(없으면 기본값)으로
  --days 7|30        기간
  --project a,b      이 프로젝트만 (폴더 이름)
  --no-git           git 기록을 읽지 않음
  --no-ai            짧은 문장 분류에 AI 를 쓰지 않음
  --focus stuck|verify|delegate|harness
  --lang ko|en       리포트와 질문의 언어
  --preview          정확도를 재는 중인 피드백도 보여 줌
  --no-open          브라우저를 열지 않음`,
    unknown: (k) => `모르는 옵션: ${k}\n`,
    same: ['어떻게 돌아볼까요?', (d) => `지난번과 같이 (최근 ${d}일)`, '새로 고르기'],
    period: ['[무엇을 돌아볼까요?]', (n) => `지난 30일 — 메시지 ${n}개 (추천)`, (n) => `지난 7일 — 메시지 ${n}개`],
    projects: ['[어느 프로젝트?]', '전체 (추천)', '직접 고르기', (p) => `  ${p.name} — 메시지 ${p.prompts}개, 마지막 ${new Date(p.last).toISOString().slice(0, 10)}`, '번호를 쉼표로 (예: 1,3) > '],
    git: ['[git 기록도 읽을까요?]', '커밋과 테스트 파일을 읽어 「테스트에 결과 확인이 있나」 같은 것을 봐요. 저장소 밖으로는 아무것도 보내지 않아요', (r) => `예 — 찾은 저장소: ${r || '없음'} (추천)`, '아니오 — 테스트·커밋에 관한 피드백이 빠져요'],
    ai: ['[짧은 문장 분류에 AI 를 쓸까요?]', '내 메시지가 「고쳐 줘」인지 「왜?」인지, 같은 부탁을 되풀이했는지를 AI 가 한 줄씩 판정해요. 비밀값·이메일·전화번호를 가린 짧은 문장만 보내요', (t) => `쓴다 — 약 ${t} 토큰, 처음 한 번만 들고 다음부턴 새 메시지만 (추천)`, '안 쓴다 — 「고쳐 줘 반복」, 「같은 부탁 반복」이 빠지고 비밀값·테스트 피드백만 나와요', '\n(AI 를 부를 수 있는 도구(claude 나 codex CLI)가 없어 분류 없이 진행해요)'],
    focus: ['[이번에 특히 보고 싶은 것이 있나요?]', '고르면 그쪽 피드백을 먼저 보여 줘요', ['알아서 — 시간이 가장 많이 샌 것부터 (추천)', '막혔을 때 어떻게 하는지', '끝났다는 걸 어떻게 확인하는지', '일을 어떻게 맡기는지', '규칙·자동 검사를 키우는지']],
    progress: { load: '기록 읽는 중', classify: '짧은 문장 분류 중', rules: '되풀이한 부탁 찾는 중', git: 'git 기록 읽는 중', nobackend: 'AI 를 부를 도구가 없어 분류 없이 진행해요' },
    scanLine: (b, n, t) => `AI: ${b || '없음'} · 지난 30일 메시지 ${n}개, 분류 예상 약 ${t} 토큰`,
    scanProject: (p) => `- ${p.name}: 메시지 ${p.prompts}개${p.git ? ' · git' : ''}`,
    noSessions: '\n이 기간·프로젝트에 대화 기록이 없어요. 기간을 늘리거나 프로젝트를 바꿔 보세요.',
    done: (f) => `\n돌아보기를 만들었어요: ${f}`,
    good: (t) => `  잘하고 있는 것: ${t}`,
    habit: (k) => `  바꾸면 좋을 것: ${{ repeatRule: '같은 부탁 반복', guessLoop: '같은 증상에 「고쳐 줘」만 반복', testChecks: '결과를 확인하지 않는 테스트' }[k]}`,
    promise: (p) => `  다음 달 한 가지: ${p}`,
    usage: (c, t) => `  분석에 쓴 AI: ${c}번, ${t} 토큰`,
  },
  en: {
    help: `ai-dev-feedback — evidence-based feedback on how you develop with AI coding agents, from your own logs

  npx github:HwangSlater/ai-dev-feedback               answer a few questions; the report opens in your browser
  npx github:HwangSlater/ai-dev-feedback scan --json   what can be analyzed and the estimated cost (no AI)
  --yes, -y          no questions; reuse last choices (or defaults)
  --days 7|30        period
  --project a,b      only these projects (folder names)
  --no-git           don't read git history
  --no-ai            don't use AI to classify short messages
  --focus stuck|verify|delegate|harness
  --lang ko|en       language of the report and questions
  --preview          also show feedback whose accuracy is still being measured
  --no-open          don't open the browser`,
    unknown: (k) => `Unknown option: ${k}\n`,
    same: ['How should I look back?', (d) => `Same as last time (last ${d} days)`, 'Choose again'],
    period: ['[What should I look back on?]', (n) => `Last 30 days — ${n} messages (recommended)`, (n) => `Last 7 days — ${n} messages`],
    projects: ['[Which projects?]', 'All (recommended)', 'Pick', (p) => `  ${p.name} — ${p.prompts} messages, last ${new Date(p.last).toISOString().slice(0, 10)}`, 'Numbers, comma-separated (e.g. 1,3) > '],
    git: ['[Read git history too?]', 'reads commits and test files to see things like whether tests check results; nothing leaves the repository', (r) => `Yes — found: ${r || 'none'} (recommended)`, 'No — test and commit feedback is skipped'],
    ai: ['[Use AI to classify short messages?]', 'an AI labels each of your messages — a fix request, a "why?", the same request again; only short snippets with keys, emails and phone numbers masked are sent', (t) => `Yes — about ${t} tokens the first time, only new messages after that (recommended)`, 'No — the repeated "fix it" and repeated-instruction feedback is skipped; only secrets and tests remain', '\n(No AI tool found (claude or codex CLI), so continuing without classification)'],
    focus: ['[Anything you especially want to look at?]', 'that feedback comes first', ['Let it decide — whatever leaked the most time (recommended)', 'What I do when I get stuck', 'How I check that work is done', 'How I hand work over', 'Whether I grow rules and automatic checks']],
    progress: { load: 'Reading logs', classify: 'Classifying short messages', rules: 'Finding repeated instructions', git: 'Reading git history', nobackend: 'No AI tool found; continuing without classification' },
    scanLine: (b, n, t) => `AI: ${b || 'none'} · last 30 days ${n} messages, classification ~${t} tokens`,
    scanProject: (p) => `- ${p.name}: ${p.prompts} messages${p.git ? ' · git' : ''}`,
    noSessions: '\nNo conversations for this period or project. Try a longer period or another project.',
    done: (f) => `\nYour look back is ready: ${f}`,
    good: (t) => `  Doing well: ${t}`,
    habit: (k) => `  To change: ${{ repeatRule: 'repeating the same instruction', guessLoop: '"fix it" on the same symptom', testChecks: 'tests that never check the result' }[k]}`,
    promise: (p) => `  Next month: ${p}`,
    usage: (c, t) => `  AI used: ${c} calls, ${t} tokens`,
  },
};

function parseArgs(argv) {
  const a = { flags: {}, yes: false, open: true, cmd: 'run' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '-h' || k === '--help') a.help = true;
    else if (k === 'scan') a.cmd = 'scan';
    else if (k === '--json') a.json = true;
    else if (k === '-y' || k === '--yes') a.yes = true;
    else if (k === '--days') a.flags.days = Number(next()) || 30;
    else if (k === '--project' || k === '--projects') a.flags.projects = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--no-git') a.flags.git = false;
    else if (k === '--no-ai') a.flags.ai = false;
    else if (k === '--focus') a.flags.focus = next();
    else if (k === '--lang') a.flags.lang = LANGS.includes(next()) ? argv[i] : 'ko';
    else if (k === '--preview') a.flags.preview = true;
    else if (k === '--no-open') a.open = false;
    else a.unknown = k;
  }
  return a;
}

async function ask(rl, question, note, options, def) {
  console.log(`\n${question}${note ? `\n  (${note})` : ''}`);
  options.forEach((o, i) => console.log(`  ${i + 1}) ${o}`));
  const n = Number((await rl.question(`> [${def + 1}] `)).trim());
  return n >= 1 && n <= options.length ? n - 1 : def;
}

async function interactive(info, lang) {
  const T = C[lang];
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (info.last) {
      const i = await ask(rl, T.same[0], '', [T.same[1](info.last.days), T.same[2]], 0);
      if (i === 0) return { ...DEFAULTS, ...info.last, lang };
    }
    const o = { ...DEFAULTS, lang };
    const w = info.windows;
    o.days = [30, 7][await ask(rl, T.period[0], '', [T.period[1](fmtNum(w[30].prompts)), T.period[2](fmtNum(w[7].prompts))], 0)];

    if ((await ask(rl, T.projects[0], '', [T.projects[1], T.projects[2]], 0)) === 1) {
      info.projects.forEach((p, i) => console.log(`  ${i + 1})${T.projects[3](p).slice(1)}`));
      const ans = await rl.question(T.projects[4]);
      o.projects = ans.split(',').map((s) => info.projects[Number(s.trim()) - 1]?.name).filter(Boolean);
    }

    const repos = info.projects.filter((p) => p.git && (!o.projects.length || o.projects.includes(p.name))).map((p) => p.name).join(', ');
    o.git = (await ask(rl, T.git[0], T.git[1], [T.git[2](repos), T.git[3]], 0)) === 0;

    if (info.backend) o.ai = (await ask(rl, T.ai[0], T.ai[1], [T.ai[2](K(w[o.days].tokens)), T.ai[3]], 0)) === 0;
    else {
      o.ai = false;
      console.log(T.ai[4]);
    }

    o.focus = ['auto', 'stuck', 'verify', 'delegate', 'harness'][await ask(rl, T.focus[0], T.focus[1], T.focus[2], 0)];
    return o;
  } finally {
    rl.close();
  }
}

function progress(lang) {
  const tty = process.stderr.isTTY;
  let last = '';
  return (step, done, total) => {
    const msg = C[lang].progress[step];
    const line = total ? `${msg} ${done}/${total}` : msg;
    if (tty) process.stderr.write(`\r\x1b[K${line}`);
    else if (step !== last) process.stderr.write(`${msg}\n`);
    last = step;
  };
}

function openFile(file) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {}
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const early = args.flags.lang || DEFAULTS.lang;
  if (args.unknown) console.error(C[early].unknown(args.unknown));
  if (args.help || args.unknown) return console.log(C[early].help);
  const info = await scan();
  const lang = args.flags.lang || info.last?.lang || DEFAULTS.lang;
  const T = C[lang];
  if (args.cmd === 'scan') {
    if (args.json) return console.log(JSON.stringify(info));
    console.log(T.scanLine(info.backend, fmtNum(info.windows[30].prompts), K(info.windows[30].tokens)));
    for (const p of info.projects) console.log(T.scanProject(p));
    return;
  }
  let opts = { ...DEFAULTS, ...(args.yes ? info.last || {} : {}), ...args.flags, lang };
  if (!args.yes && process.stdin.isTTY) opts = { ...(await interactive(info, lang)), ...args.flags, lang };
  let out;
  try {
    out = await run(opts, progress(lang));
  } catch (e) {
    if (e.message === 'NO_SESSIONS') return console.error(T.noSessions);
    throw e;
  }
  if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');
  const { picks, usage } = out.rep;
  console.log(T.done(out.file));
  for (const s of picks.strengths) console.log(T.good(s.title));
  for (const h of picks.habits) console.log(T.habit(h.kind));
  if (picks.promise) console.log(T.promise(picks.promise));
  console.log(T.usage(usage.calls.haiku + usage.calls.sonnet, fmtNum(usage.input + usage.output)));
  if (args.open) openFile(out.file);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
