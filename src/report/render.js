// 월간 돌아보기 HTML 한 장. 모양은 docs/images/report-ko.png(지어낸 데이터, scripts/demo.mjs)와 같다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEEDBACK, LATER, SOURCES } from '../catalog.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const KST = (t) => new Date(t);
const two = (n) => String(n).padStart(2, '0');
const hm = (t) => `${two(KST(t).getHours())}:${two(KST(t).getMinutes())}`;
const md = (t) => `${KST(t).getMonth() + 1}/${KST(t).getDate()}`;
const dur = (ms) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`;
};
const num = (n) => n.toLocaleString('ko-KR');
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

function guessHabit(g, ownRule, cite) {
  const F = FEEDBACK.guessLoop;
  const t = g.top;
  const rows = [];
  t.first.forEach((f, i) => rows.push([hm(f.t), `「${esc(f.x)}」${i === 0 ? ' — 첫 보고' : ''}`, '']));
  rows.push([`~${hm(t.end)}`, `이렇게 <b>${t.n}번 연속</b>, ${dur(t.ms)}. 원인에 대한 짐작은 한 번도 없었어요.`, 'hl']);
  if (t.firstAsk) rows.push([hm(t.firstAsk.t), `처음으로 원인을 물음 — 「${esc(t.firstAsk.x)}」`, '']);
  for (const a of t.again) rows.push([hm(a.t), `다시 ${a.n}번 연속 — 「${esc(a.x)}」`, 'hl']);
  if (t.good) rows.push([hm(t.good.t), '상황을 한 번에 풀어서 보냄 ↓', 'ok']);
  if (t.episode.resolvedAt) rows.push([hm(t.episode.resolvedAt), `해결. 처음 보고부터 약 ${dur(t.episode.resolvedAt - t.episode.start)}.`, 'ok']);
  const timeline = rows.map(([tm, text, cls]) => `<li><span class="t">${tm}</span><span${cls ? ` class="${cls}"` : ''}>${text}</span></li>`).join('\n');
  const good = t.good
    ? `<blockquote><span class="when">${md(t.good.t)} ${hm(t.good.t)} — 이날 가장 잘 쓴 메시지</span>${esc(t.good.x)}</blockquote>
  <p class="small">이 메시지는 상황을 풀어서 썼어요. 처음의 「${esc(t.first[1]?.x || t.first[0].x)}」와 나란히 놓고 보세요 — <b>어디서</b>, <b>기대한 것</b>, <b>실제로 본 것</b>, <b>어디서는 괜찮은지</b>가 들어 있나요?</p>`
    : '';
  const fair = t.modelChange
    ? `<div class="note">공정하게 말하면, 이 메시지를 보낼 무렵 답하는 모델도 ${esc(model(t.modelChange.from))} 에서 ${esc(model(t.modelChange.to))} 로 바뀌었어요. 그래서 해결이 메시지 덕인지 모델 덕인지는 기록만으로 가를 수 없어요. 다만 아래의 근거들은 모델과 상관없이 같은 말을 해요.</div>`
    : '';
  const projects = Object.entries(g.byProject).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${esc(p)} ${n}`).join(' · ');
  return `<h2>바꾸면 좋을 습관 ①<br>${esc(F.title)}</h2>
<div class="habit">
  <p class="step">무슨 일이 있었나</p>
  <p>이 기간에 원인 짐작 없이 「안 돼」·「여전히」가 3번 넘게 이어진 구간이 <b>${g.count}번</b> 있었어요(${projects}). 메시지 ${g.messages}개, 합치면 <b>약 ${dur(g.ms)}</b>이에요. 가장 길었던 날을 보면 이래요.</p>
  <p class="small sub">${md(t.start)} · ${esc(t.project)}</p>
  <ul class="timeline">
${timeline}
  </ul>
  ${good}
  ${fair}
  <p class="step">왜 문제인가</p>
  <p>${F.why}</p>
  ${evidenceList(F.evidence, cite)}
  ${ownRule ? `<p class="small sub">작업 규칙에도 이미 같은 문장을 적어 두셨어요 — ${esc(ownRule.file)}: 「${esc(ownRule.text)}」</p>` : ''}
  <p class="step">이렇게 해 보세요</p>
  <div class="try">
    <b>두 번째로 같은 증상을 봤을 때</b>, 세 번째 「고쳐 줘」 대신 이렇게 보내 보세요.
    <span class="say">${esc(F.trySay)}</span>
    <span class="small sub">${esc(F.tryNote)}</span>
  </div>
  <p class="step">스스로 확인해 보기</p>
  <ul class="check">${F.check.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
</div>`;
}

// 묶음 안에서 규칙 문장과 가장 많이 겹치는 메시지를 예로 고른다(묶기가 가끔 엉뚱한 메시지를 끼워 넣는다). 시간순으로 보여 준다.
const grams = (s) => {
  const t = String(s).replace(/s+/g, '');
  const g = new Set();
  for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
  return g;
};
function examples(c, n) {
  const ref = grams(c.rule + (c.source?.text || ''));
  const score = (m) => [...grams(m.x)].filter((x) => ref.has(x)).length;
  return [...c.messages].sort((a, b) => score(b) - score(a)).slice(0, n).sort((a, b) => a.t - b.t);
}

function ruleHabit(rules, n, cite) {
  const F = FEEDBACK.repeatRule;
  const top = rules.clusters.slice(0, 2);
  const anySource = top.some((c) => c.source);
  const blocks = top
    .map((c) => {
      const ms = c.messages;
      const shown = examples(c, 2);
      const src = c.source
        ? `<p class="small sub">${esc(path.basename(c.source.file))} 에 「${esc(c.source.text)}」라고 적혀 있는데도${c.source.firstSeen ? `(${md(Date.parse(c.source.firstSeen))}에 생김)` : ''}, ${c.afterRule ? `그 뒤로 ${c.afterRule}번` : '다시'} 말해야 했어요.</p>`
        : '';
      return `<h3>「${esc(c.rule)}」 — ${c.sessions}개 대화에서 ${ms.length}번</h3>
  ${shown.map((m) => `<blockquote><span class="when">${md(m.t)} ${hm(m.t)} · ${esc(m.project)}</span>${esc(m.x)}</blockquote>`).join('\n  ')}
  ${src}`;
    })
    .join('\n');
  const say = top.map((c) => `<span class="say">${esc(c.source ? F.trySay(c.rule) : F.trySayNoRule(c.rule))}</span>`).join('');
  return `<h2>바꾸면 좋을 습관 ${n}<br>${esc(anySource ? F.title : F.titleNoRule)}</h2>
<div class="habit">
  <p class="step">무슨 일이 있었나</p>
  <p>같은 부탁을 여러 대화에서 되풀이했어요.${anySource ? ' 규칙으로 적어 둔 뒤에도요.' : ''}</p>
  ${blocks}
  <p class="step">왜 문제인가</p>
  <p>${anySource ? F.why : F.whyNoRule}</p>
  ${evidenceList(F.evidence, cite)}
  <p class="step">이렇게 해 보세요</p>
  <div class="try">
    <b>${anySource ? '두 번 넘게 말한 규칙은 자동으로 확인되게 바꿔 보세요.' : '늘 지켜야 하는 것은 한 번 적어 두세요.'}</b> 에이전트에게 이렇게 맡기면 돼요.
    ${say}
  </div>
  <p class="step">스스로 확인해 보기</p>
  <ul class="check">${F.check.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
</div>`;
}

function testHabit(t, n, cite) {
  const F = FEEDBACK.testChecks;
  return `<h2>바꾸면 좋을 습관 ${n}<br>${esc(F.title)}</h2>
<div class="habit">
  <p class="step">무슨 일이 있었나</p>
  <p>${esc(t.repos)} 의 테스트 ${num(t.tests)}개 중 ${num(t.missing)}개(${t.pct}%)가 결과를 확인하는 코드 없이 실행만 해요.</p>
  ${t.examples.length ? `<ul class="check">${t.examples.map((e) => `<li><code>${esc(e.file)}:${e.line}</code> ${esc(e.name)}</li>`).join('')}</ul>` : ''}
  <p class="step">왜 문제인가</p>
  <p>${F.why}</p>
  ${evidenceList(F.evidence, cite)}
  <p class="step">이렇게 해 보세요</p>
  <div class="try"><span class="say">${esc(F.trySay)}</span></div>
  <p class="step">스스로 확인해 보기</p>
  <ul class="check">${F.check.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
</div>`;
}

export function renderReport(rep) {
  const { meta, picks, findings } = rep;
  const { cite, list } = citer();
  const nth = ['①', '②'];

  const strengths = picks.strengths
    .map((s) => `<li><b>${esc(s.title)}</b>${s.html}${s.source ? cite(s.source) : ''}</li>`)
    .join('\n');

  const habits = picks.habits
    .map((h, i) => {
      if (h.kind === 'guessLoop') return guessHabit(findings.guess, rep.ownRule, cite).replace('바꾸면 좋을 습관 ①', `바꾸면 좋을 습관 ${nth[i]}`);
      if (h.kind === 'repeatRule') return ruleHabit(findings.rules, nth[i], cite);
      if (h.kind === 'testChecks') return testHabit(picks.testSummary, nth[i], cite);
      return '';
    })
    .join('\n');

  const secrets = findings.secrets?.count
    ? `<div class="alert"><b>먼저 확인할 것 — ${esc(FEEDBACK.secrets.title)}</b><br>${findings.secrets.count}번(${[...new Set(findings.secrets.hits.map((h) => h.project))].map(esc).join(', ')}). ${esc(FEEDBACK.secrets.why)} ${esc(FEEDBACK.secrets.action)}<br><span class="small sub">다음부터는: 「${esc(FEEDBACK.secrets.trySay)}」</span></div>`
    : '';

  const promise = picks.promise
    ? `<h2>다음 달에 해 볼 한 가지</h2>
<div class="promise">
  <p class="sub small">한 번에 하나만 바꾸는 게 오래가요.</p>
  <p class="big">${esc(picks.promise)}</p>
  <p class="small">「다음에 [이런 상황]이면 [이렇게 한다]」로 정해 두면, 막연한 다짐보다 지킬 가능성이 눈에 띄게 높아요${cite('gollwitzer')}. 다음 달 돌아보기에서 이 상황이 몇 번 있었고 몇 번 지켰는지 보여 드릴게요.</p>
</div>`
    : '';

  const body = `<p class="kicker">${esc(meta.periodLabel)}</p>
<h1>${esc(meta.title)}</h1>
<div class="summary">
  <p><b>한 줄로 보면</b> — ${picks.summary}</p>
  <ul>
    ${picks.strengths.length ? `<li>잘하고 있는 것 ${picks.strengths.length}가지 — 계속 이렇게 하시면 돼요</li>` : ''}
    ${picks.habits.length ? `<li>바꾸면 좋을 습관 ${picks.habits.length}가지 — 무슨 일이 있었는지, 왜 문제인지, 어떻게 바꾸면 되는지</li>` : ''}
    ${picks.promise ? '<li>다음 달에 해 볼 한 가지</li>' : ''}
  </ul>
  <div class="stats"><span><b>${num(meta.projects)}</b>개 프로젝트</span><span><b>${num(meta.sessions)}</b>개 대화</span><span><b>${num(meta.prompts)}</b>개 메시지</span></div>
</div>
${secrets}
${strengths ? `<h2>잘하고 있는 것</h2>\n<p class="sub">칭찬이 아니라, 계속 지키면 좋은 이유가 있는 습관이에요.</p>\n<ul class="good-list">${strengths}</ul>` : ''}
${habits}
${promise}
<h3>다음 달부터 함께 볼 것</h3>
<ul class="later">${[...meta.notMeasured, ...LATER].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
<h3>출처</h3>
<ol class="refs">
${list()}
</ol>
<p class="small sub">인용한 문장은 모두 원문과 대조한 것만 써요.</p>
<div class="foot">
  이 돌아보기는 내 컴퓨터에 있는 AI 대화 기록${meta.git ? '과 git 기록' : ''}만으로 만들었고, 다른 사람과 비교하지 않아요. 점수나 등급은 없어요. AI 없이 혼자 한 일(직접 읽기, 직접 고치기)은 기록에 안 남아서 반영되지 않아요.
  ${meta.preview ? '<br>미리보기: 아직 정확도를 재는 중인 피드백도 함께 보여 주고 있어요.' : ''}
  <br>만든 날 ${esc(new Date(rep.generated).toLocaleString('ko-KR'))}
</div>`;

  const css = fs.readFileSync(path.join(DIR, 'style.css'), 'utf8');
  return `<!doctype html>
<html lang="ko">
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
