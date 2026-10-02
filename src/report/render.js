// 월간 돌아보기 HTML 한 장. 모양은 docs/images/report-ko.png·report-en.png(지어낸 데이터, scripts/demo.mjs)와 같다.
// 글은 언어별로 src/i18n.js(틀)와 src/catalog.js(피드백 본문)에서 가져온다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES, feedbackFor } from '../catalog.js';
import { ui } from '../i18n.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const two = (n) => String(n).padStart(2, '0');
const hm = (t) => `${two(new Date(t).getHours())}:${two(new Date(t).getMinutes())}`;
const md = (t) => `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`;
const model = (m) => m.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-(\d+)$/, ' $1').replace(/^\w/, (c) => c.toUpperCase());

// 출처 번호는 리포트에 처음 나온 순서대로 붙인다.
function citer() {
  const order = [];
  const cite = (key) => {
    let i = order.indexOf(key);
    if (i < 0) i = order.push(key) - 1;
    return `<sup><a href="#r${i + 1}">${i + 1}</a></sup>`;
  };
  const list = () =>
    order
      .map((k, i) => {
        const s = SOURCES[k];
        return `<li id="r${i + 1}"><a href="${esc(s.url)}">${esc(s.title)}</a> (${esc(s.date)})${s.note ? ` — ${esc(s.note)}` : ''}</li>`;
      })
      .join('\n');
  return { cite, list };
}

const evidenceList = (items, cite) => `<ul class="check">${items.map(([k, text]) => `<li>${text}${cite(k)}</li>`).join('')}</ul>`;
const checks = (list) => `<ul class="check">${list.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`;

function guessHabit(g, ownRule, cite, n, F, U) {
  const dur = (ms) => U.dur(Math.round(ms / 60_000));
  const t = g.top;
  const rows = [];
  t.first.forEach((f, i) => rows.push([hm(f.t), `${U.q(esc(f.x))}${i === 0 ? U.firstReport : ''}`, '']));
  rows.push([`~${hm(t.end)}`, U.streakRow(t.n, dur(t.ms)), 'hl']);
  if (t.firstAsk) rows.push([hm(t.firstAsk.t), U.firstAsk(U.q(esc(t.firstAsk.x))), '']);
  for (const a of t.again) rows.push([hm(a.t), U.again(a.n, U.q(esc(a.x))), 'hl']);
  if (t.good) rows.push([hm(t.good.t), U.goodRow, 'ok']);
  if (t.episode.resolvedAt) rows.push([hm(t.episode.resolvedAt), U.solvedRow(dur(t.episode.resolvedAt - t.episode.start)), 'ok']);
  const timeline = rows.map(([tm, text, cls]) => `<li><span class="t">${tm}</span><span${cls ? ` class="${cls}"` : ''}>${text}</span></li>`).join('\n');
  const good = t.good
    ? `<blockquote><span class="when">${md(t.good.t)} ${hm(t.good.t)} — ${U.goodWhen}</span>${esc(t.good.x)}</blockquote>
  <p class="small">${U.goodNote(U.q(esc(t.first[1]?.x || t.first[0].x)))}</p>`
    : '';
  const fair = t.modelChange ? `<div class="note">${U.fair(esc(model(t.modelChange.from)), esc(model(t.modelChange.to)))}</div>` : '';
  const projects = Object.entries(g.byProject).sort((a, b) => b[1] - a[1]).map(([p, k]) => `${esc(p)} ${k}`).join(' · ');
  return `<h2>${U.habitHead(n)}<br>${esc(F.title)}</h2>
<div class="habit">
  <p class="step">${U.stepWhat}</p>
  <p>${U.guessIntro(g.count, projects, g.messages, dur(g.ms))}</p>
  <p class="small sub">${md(t.start)} · ${esc(t.project)}</p>
  <ul class="timeline">
${timeline}
  </ul>
  ${good}
  ${fair}
  <p class="step">${U.stepWhy}</p>
  <p>${F.why}</p>
  ${evidenceList(F.evidence, cite)}
  ${ownRule ? `<p class="small sub">${U.ownRule(esc(ownRule.file), esc(ownRule.text))}</p>` : ''}
  <p class="step">${U.stepTry}</p>
  <div class="try">
    ${U.guessTry}
    <span class="say">${esc(F.trySay)}</span>
    <span class="small sub">${esc(F.tryNote)}</span>
  </div>
  <p class="step">${U.stepCheck}</p>
  ${checks(F.check)}
</div>`;
}

// 묶음 안에서 규칙 문장과 가장 많이 겹치는 메시지를 예로 고른다(묶기가 가끔 엉뚱한 메시지를 끼워 넣는다). 시간순으로 보여 준다.
const grams = (s) => {
  const t = String(s).replace(/\s+/g, '');
  const g = new Set();
  for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
  return g;
};
function examples(c, k) {
  const ref = grams(c.rule + (c.source?.text || ''));
  const score = (m) => [...grams(m.x)].filter((x) => ref.has(x)).length;
  return [...c.messages].sort((a, b) => score(b) - score(a)).slice(0, k).sort((a, b) => a.t - b.t);
}

function ruleHabit(rules, n, cite, F, U) {
  const top = rules.clusters.slice(0, 2);
  const anySource = top.some((c) => c.source);
  const blocks = top
    .map((c) => {
      const src = c.source
        ? `<p class="small sub">${U.ruleSource(esc(path.basename(c.source.file)), esc(c.source.text), c.source.firstSeen ? md(Date.parse(c.source.firstSeen)) : '', c.afterRule)}</p>`
        : '';
      return `<h3>${U.ruleHead(esc(c.rule), c.sessions, c.messages.length)}</h3>
  ${examples(c, 2).map((m) => `<blockquote><span class="when">${md(m.t)} ${hm(m.t)} · ${esc(m.project)}</span>${esc(m.x)}</blockquote>`).join('\n  ')}
  ${src}`;
    })
    .join('\n');
  const say = top.map((c) => `<span class="say">${esc(c.source ? F.trySay(c.rule) : F.trySayNoRule(c.rule))}</span>`).join('');
  return `<h2>${U.habitHead(n)}<br>${esc(anySource ? F.title : F.titleNoRule)}</h2>
<div class="habit">
  <p class="step">${U.stepWhat}</p>
  <p>${U.ruleIntro(anySource)}</p>
  ${blocks}
  <p class="step">${U.stepWhy}</p>
  <p>${anySource ? F.why : F.whyNoRule}</p>
  ${evidenceList(F.evidence, cite)}
  <p class="step">${U.stepTry}</p>
  <div class="try">
    ${U.ruleTry(anySource)}
    ${say}
  </div>
  <p class="step">${U.stepCheck}</p>
  ${checks(F.check)}
</div>`;
}

function testHabit(t, n, cite, F, U) {
  const num = (x) => x.toLocaleString(U.locale);
  return `<h2>${U.habitHead(n)}<br>${esc(F.title)}</h2>
<div class="habit">
  <p class="step">${U.stepWhat}</p>
  <p>${U.testIntro(esc(t.repos), num(t.tests), num(t.missing), t.pct)}</p>
  ${t.examples.length ? `<ul class="check">${t.examples.map((e) => `<li><code>${esc(e.file)}:${e.line}</code> ${esc(e.name)}</li>`).join('')}</ul>` : ''}
  <p class="step">${U.stepWhy}</p>
  <p>${F.why}</p>
  ${evidenceList(F.evidence, cite)}
  <p class="step">${U.stepTry}</p>
  <div class="try"><span class="say">${esc(F.trySay)}</span></div>
  <p class="step">${U.stepCheck}</p>
  ${checks(F.check)}
</div>`;
}

export function renderReport(rep) {
  const { meta, picks, findings } = rep;
  const lang = meta.lang || 'ko';
  const U = ui(lang);
  const { F, LATER } = feedbackFor(lang);
  const num = (x) => x.toLocaleString(U.locale);
  const { cite, list } = citer();
  const nth = ['①', '②'];

  const strengths = picks.strengths.map((s) => `<li><b>${esc(s.title)}</b>${s.html}${s.source ? cite(s.source) : ''}</li>`).join('\n');

  const habits = picks.habits
    .map((h, i) => {
      if (h.kind === 'guessLoop') return guessHabit(findings.guess, rep.ownRule, cite, nth[i], F.guessLoop, U);
      if (h.kind === 'repeatRule') return ruleHabit(findings.rules, nth[i], cite, F.repeatRule, U);
      if (h.kind === 'testChecks') return testHabit(picks.testSummary, nth[i], cite, F.testChecks, U);
      return '';
    })
    .join('\n');

  const S = F.secrets;
  const secrets = findings.secrets?.count
    ? `<div class="alert"><b>${U.secretsHead(esc(S.title))}</b><br>${U.secretsCount(findings.secrets.count, [...new Set(findings.secrets.hits.map((h) => h.project))].map(esc).join(', '))} ${esc(S.why)} ${esc(S.action)}<br><span class="small sub">${U.secretsNext(esc(S.trySay))}</span></div>`
    : '';

  const promise = picks.promise
    ? `<h2>${U.promiseHead}</h2>
<div class="promise">
  <p class="sub small">${U.promiseSub}</p>
  <p class="big">${esc(picks.promise)}</p>
  <p class="small">${U.promiseWhy(cite('gollwitzer'))}</p>
</div>`
    : '';

  const body = `<p class="kicker">${esc(meta.periodLabel)}</p>
<h1>${esc(meta.title)}</h1>
<div class="summary">
  <p><b>${U.inShort}</b> — ${picks.summary}</p>
  <ul>
    ${picks.strengths.length ? `<li>${U.tocGood(picks.strengths.length)}</li>` : ''}
    ${picks.habits.length ? `<li>${U.tocHabit(picks.habits.length)}</li>` : ''}
    ${picks.promise ? `<li>${U.tocPromise}</li>` : ''}
  </ul>
  <div class="stats">${U.stats(num(meta.projects), num(meta.sessions), num(meta.prompts)).map((x) => `<span>${x}</span>`).join('')}</div>
</div>
${secrets}
${strengths ? `<h2>${U.goodHead}</h2>\n<p class="sub">${U.goodSub}</p>\n<ul class="good-list">${strengths}</ul>` : ''}
${habits}
${promise}
<h3>${U.laterHead}</h3>
<ul class="later">${[...meta.notMeasured, ...LATER].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
<h3>${U.sourcesHead}</h3>
<ol class="refs">
${list()}
</ol>
<p class="small sub">${U.sourcesNote}</p>
<div class="foot">
  ${U.foot(meta.git)}
  ${meta.preview ? `<br>${U.preview}` : ''}
  <br>${U.made} ${esc(new Date(rep.generated).toLocaleString(U.locale))}
</div>`;

  const css = fs.readFileSync(path.join(DIR, 'style.css'), 'utf8');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>
${css}
</style>
</head>
<body>
<div class="wrap">
${body}
</div>
</body>
</html>
`;
}
