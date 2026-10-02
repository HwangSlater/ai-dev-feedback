// 정확도 측정(1a)용 정답 붙이기 페이지를 만든다. 사람이 「맞다/아니다」를 누르고 결과 파일을 저장하면 score-labels.mjs 가 정확도를 계산한다.
// 쓰는 법: node scripts/make-labeling.mjs [일수=30] [이미 판정한 label-answers.json]
//   → ~/.ai-dev-feedback/label.html 과 label-items.json. 판정 파일을 주면, 바뀌지 않은 항목(같은 구간·같은 메시지와 같은 규칙)은
//     그 답을 다시 쓰고 페이지에는 새로 판정할 것만 보여 준다.
import fs from 'node:fs';
import path from 'node:path';
import { complete } from '../src/ai.js';
import { loadLabels, pendingPrompts } from '../src/classify.js';
import { findRepeatedRules, ruleFiles } from '../src/feedback/rules.js';
import { findGuessLoops } from '../src/feedback/streaks.js';
import { selectSessions, sinceOf } from '../src/select.js';
import { loadSessions } from '../src/sessions.js';
import { HOME, clip, mask } from '../src/util.js';

const days = Number(process.argv[2] || 30);
const ITEMS_FILE = path.join(HOME, 'label-items.json');
const prevAnswers = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).answers : null;
const prev = prevAnswers && fs.existsSync(ITEMS_FILE) ? JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf8')) : null;
const since = sinceOf(days);
const { sessions } = await loadSessions();
const sel = selectSessions(sessions, { since });
const labels = loadLabels();
const need = pendingPrompts(sel, labels, 'haiku');
if (need.size) console.error(`분류가 안 된 메시지 ${need.size}개는 빠집니다 — 먼저 node bin/ai-dev-feedback.js --yes 를 한 번 돌리세요.`);

const items = [];
const when = (t) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// 「고쳐 줘」 반복: 리포트와 같은 방법(같은 문제인지 확인 포함)으로 찾은 구간 전부.
const guess = await findGuessLoops(sel, labels, { complete });
for (const g of guess.list) {
  const s = sel.find((x) => x.id === g.session);
  const msgs = s.ev.filter((e) => e.k === 'p' && e.t >= g.start && e.t <= g.end).map((p) => ({ when: when(p.t), x: clip(mask(p.x), 200) }));
  items.push({ id: `guess-${g.start}`, kind: 'guessLoop', project: g.project, when: when(g.start), messages: msgs });
}

// 같은 부탁 반복: 리포트 기준(대화 2곳·메시지 3개)보다 넓게(메시지 2개) 잡아 묶음 품질도 본다.
const rules = await findRepeatedRules(sel, labels, { complete, files: ruleFiles([...new Set(sel.map((s) => s.root).filter(Boolean))]), minSessions: 2, minMessages: 2 });
for (const c of rules.clusters) {
  for (const m of c.messages) items.push({ id: `rule-${m.session}-${m.t}`, kind: 'ruleMessage', rule: c.rule, project: m.project, when: when(m.t), x: m.x });
  if (c.source) items.push({ id: `source-${c.rule}`, kind: 'ruleSource', rule: c.rule, file: path.basename(c.source.file), line: c.source.text });
}

// 이전 판정 다시 쓰기: 같은 항목일 때만 — 구간은 시작과 메시지 수가 같을 때, 메시지는 붙은 규칙이 같을 때.
const carried = {};
for (const it of items) {
  const old = prev?.items.find((p) => p.id === it.id);
  if (!old || !prevAnswers[old.id]?.a) continue;
  if (it.kind === 'guessLoop' && old.messages.length !== it.messages.length) continue;
  if ((old.rule ?? null) !== (it.rule ?? null)) continue;
  carried[it.id] = prevAnswers[old.id];
}
fs.mkdirSync(HOME, { recursive: true });
fs.writeFileSync(ITEMS_FILE, JSON.stringify({ made: new Date().toISOString(), days, items, carried }, null, 1));
const ask = items.filter((it) => !carried[it.id]);

const css = fs.readFileSync(new URL('../src/report/style.css', import.meta.url), 'utf8');
const page = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>정답 붙이기</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>${css}
.q { background:var(--paper); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin:12px 0; }
.q.done { opacity:.55; }
.q .ask { margin:10px 0 6px; font-weight:700; }
.btns { display:flex; gap:8px; flex-wrap:wrap; }
.btns button { font:inherit; font-size:15px; min-height:44px; padding:0 18px; border-radius:8px; border:1px solid var(--line); background:var(--paper); color:var(--ink); cursor:pointer; }
.btns button.on { background:var(--accent); border-color:var(--accent); color:#fff; }
.btns button.on.no { background:var(--warm); border-color:var(--warm); }
.note { width:100%; margin-top:8px; font:inherit; font-size:14px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--ink); }
.bar { position:sticky; top:0; background:var(--bg); padding:10px 0; border-bottom:1px solid var(--line); display:flex; gap:12px; align-items:center; justify-content:space-between; z-index:1; }
.save { font:inherit; min-height:44px; padding:0 18px; border:0; border-radius:8px; background:var(--accent); color:#fff; cursor:pointer; }
.msg { font-size:14px; padding:6px 10px; background:var(--bg); border-radius:6px; margin:4px 0; }
.msg span { color:var(--sub); font-size:12px; margin-right:6px; }
</style></head><body><div class="wrap">
<h1>정답 붙이기</h1>
<p>도구가 찾은 것이 맞는지 판단해 주세요. 맞는 비율이 80% 를 넘는 피드백만 리포트에 나와요. 애매하면 「모르겠다」를 누르시면 돼요(계산에서 빠져요).</p>
<p class="sub small">누른 것은 이 브라우저에 저장되니 중간에 닫아도 돼요. 다 하면 맨 위 「결과 저장」을 눌러 주세요 — <code>label-answers.json</code> 파일이 내려받아져요.</p>
<div class="bar"><span id="count"></span><button class="save" id="save">결과 저장</button></div>
<div id="list"></div>
</div>
<script>
const ITEMS = ${JSON.stringify(ask).replace(/</g, '\\u003c')};
const KEY = 'adf-labels-${Date.now()}';
let ans = {};
try { ans = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const QUESTION = {
  guessLoop: '이 메시지들이 같은 문제를 두고, 원인을 짐작하지 않은 채 「고쳐 줘」·「여전히 안 돼」를 이어 간 것이 맞나요?',
  ruleMessage: (it) => '이 메시지가 「' + esc(it.rule) + '」를 말한 것이 맞나요? (지금 작업 하나에 대한 지시가 아니라, 늘 지켜야 할 방식을 말한 것인지)',
  ruleSource: (it) => '규칙 파일의 이 줄이 「' + esc(it.rule) + '」와 같은 뜻인가요?',
};
const TITLE = { guessLoop: '「고쳐 줘」 반복', ruleMessage: '같은 부탁 반복 — 메시지', ruleSource: '같은 부탁 반복 — 규칙 파일' };
function body(it) {
  if (it.kind === 'guessLoop') return '<p class="sub small">' + esc(it.project) + ' · ' + esc(it.when) + ' · 메시지 ' + it.messages.length + '개</p>' + it.messages.map((m) => '<div class="msg"><span>' + esc(m.when) + '</span>' + esc(m.x) + '</div>').join('');
  if (it.kind === 'ruleMessage') return '<p class="sub small">' + esc(it.project) + ' · ' + esc(it.when) + '</p><div class="msg">' + esc(it.x) + '</div>';
  return '<p class="sub small">' + esc(it.file) + '</p><div class="msg">' + esc(it.line) + '</div>';
}
function render() {
  const done = ITEMS.filter((it) => ans[it.id]?.a).length;
  document.getElementById('count').textContent = done + ' / ' + ITEMS.length + ' 완료';
  document.getElementById('list').innerHTML = ITEMS.map((it, i) => {
    const a = ans[it.id]?.a;
    const q = typeof QUESTION[it.kind] === 'function' ? QUESTION[it.kind](it) : QUESTION[it.kind];
    const btn = (v, label, cls = '') => '<button data-i="' + i + '" data-v="' + v + '" class="' + (a === v ? 'on ' + cls : '') + '">' + label + '</button>';
    return '<div class="q' + (a ? ' done' : '') + '"><p class="kicker">' + (i + 1) + '. ' + TITLE[it.kind] + '</p>' + body(it) + '<p class="ask">' + q + '</p><div class="btns">' + btn('yes', '맞다') + btn('no', '아니다', 'no') + btn('skip', '모르겠다') + '</div><input class="note" data-i="' + i + '" placeholder="아니라면 왜인지 한 줄 (선택)" value="' + esc(ans[it.id]?.note || '') + '"></div>';
  }).join('');
}
function store() { try { localStorage.setItem(KEY, JSON.stringify(ans)); } catch {} }
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]');
  if (b) { const it = ITEMS[b.dataset.i]; ans[it.id] = { ...(ans[it.id] || {}), a: b.dataset.v }; store(); render(); }
  if (e.target.id === 'save') {
    const blob = new Blob([JSON.stringify({ saved: new Date().toISOString(), answers: ans }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'label-answers.json'; a.click();
  }
});
document.addEventListener('change', (e) => {
  if (!e.target.classList.contains('note')) return;
  const it = ITEMS[e.target.dataset.i]; ans[it.id] = { ...(ans[it.id] || {}), note: e.target.value }; store();
});
render();
</script></body></html>`;
fs.writeFileSync(path.join(HOME, 'label.html'), page);
const by = items.reduce((m, it) => ((m[it.kind] = (m[it.kind] || 0) + 1), m), {});
console.log(`항목 ${items.length}개 ${JSON.stringify(by)} · 이전 판정 다시 씀 ${Object.keys(carried).length}개 · 새로 판정할 것 ${ask.length}개 → ${path.join(HOME, 'label.html')}`);
