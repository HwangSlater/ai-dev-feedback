import fs from 'node:fs';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.AI_DEV_FEEDBACK_HOME = path.join(os.tmpdir(), `ai-dev-feedback-test-${process.pid}`);

const { promptKey, promptText } = await import('../src/classify.js');
const { findGuessLoops } = await import('../src/feedback/streaks.js');
const { findSecrets } = await import('../src/feedback/secrets.js');
const { renderReport } = await import('../src/report/render.js');

const MIN = 60_000;
const T0 = Date.parse('2026-03-02T10:00:00+09:00');
const LONG = '결제 화면에서 「결제하기」를 누르면 주문 확인 화면으로 넘어가야 정상인데, 데스크톱 크롬에서는 잘 되고 모바일 사파리에서만 화면이 하얗게 멈춰. 콘솔에는 오류가 없고 새로고침하면 장바구니는 그대로야. 세 번 중 두 번꼴로 생기고, 어제 배포 뒤부터 그래. 장바구니에 상품이 하나일 때는 괜찮고 둘 이상일 때만 멈춰.';

// 지어낸 대화: 수정 요청 4번 연속 → 원인을 물음 → 3번 연속 → 풀어 쓴 보고(모델 바뀜) → 해결.
function session() {
  const p = (m, x, lab) => ({ t: T0 + m * MIN, k: 'p', x, n: x.length, lab });
  const prompts = [
    p(0, '결제 버튼을 누르면 화면이 하얗게 멈춰', 'fix'),
    p(6, '여전히 멈춰', 'fix'),
    p(16, '모바일에서는 아직도 똑같아', 'fix'),
    p(25, '아직도 안 돼', 'fix'),
    p(90, '왜 결제 모듈부터 의심하는 거야?', 'why'),
    p(120, '이것도 아닌 것 같은데', 'fix'),
    p(121, '똑같이 멈춰', 'fix'),
    p(122, '여전히 똑같은데', 'fix'),
    p(200, LONG, 'build'),
    p(217, '해결됐어, 고마워', 'build'),
  ];
  const replies = [
    { t: T0 + 190 * MIN, k: 'r', n: 10, x: '...', m: 'claude-opus-5' },
    { t: T0 + 205 * MIN, k: 'r', n: 10, x: '...', m: 'claude-fable-5-1' },
  ];
  const ev = [...prompts, ...replies].sort((a, b) => a.t - b.t);
  const labels = { p: {}, c: {} };
  for (const e of prompts) {
    e.key = promptKey(promptText(e));
    labels.p[e.key] = e.lab;
    delete e.lab;
  }
  return { s: { id: 's1', root: '/work/shop', cwd: '/work/shop', start: ev[0].t, end: ev.at(-1).t, ev }, labels };
}

test('반복 구간과 그 문제를 쫓던 흐름 전체를 찾는다', async () => {
  const { s, labels } = session();
  const g = await findGuessLoops([s], labels);
  assert.equal(g.count, 2);
  assert.equal(g.messages, 7);
  assert.equal(g.top.n, 4);
  assert.equal(g.top.first.length, 3);
  assert.equal(g.top.firstAsk.t, T0 + 90 * MIN);
  assert.deepEqual(g.top.again.map((a) => a.n), [3]);
  // 해결 신호(「해결됐어」)에서 흐름이 끝나고, 그 직전의 풀어 쓴 보고를 찾는다.
  assert.equal(g.top.episode.resolvedAt, T0 + 217 * MIN);
  assert.equal(g.top.good.t, T0 + 200 * MIN);
  assert.deepEqual(g.top.modelChange, { from: 'claude-opus-5', to: 'claude-fable-5-1' });
});

test('비밀값은 수와 프로젝트만 남긴다', () => {
  const { s } = session();
  s.ev.push({ t: T0 + 300 * MIN, k: 'p', x: '토큰 줄게. 3f9a1c0b7e2d4a6f8b1c3e5d7a9f0b2c4d6e8a1b', n: 50 });
  const r = findSecrets([s]);
  assert.equal(r.count, 1);
  assert.deepEqual(Object.keys(r.hits[0]).sort(), ['project', 't']);
});

test('리포트: 고른 것만 그리고, 출처는 나온 순서대로 번호가 붙고, 비밀값 내용은 없다', async () => {
  const { s, labels } = session();
  const guess = await findGuessLoops([s], labels);
  const html = renderReport({
    meta: { title: '30일 동안 AI와 개발한 방식을 돌아봤어요', periodLabel: '9/1 ~ 10/1', projects: 1, sessions: 1, prompts: 10, git: true, preview: false, notMeasured: [] },
    picks: {
      habits: [{ kind: 'guessLoop' }],
      strengths: [{ title: '테스트에 기대값 확인을 꼭 넣어요', html: '테스트 100개 중 1개', source: 'banik' }],
      promise: '같은 증상으로 두 번 실패하면, 세 번째는 고쳐 달라고 하지 않고 원인 가설과 확인 방법부터 받는다.',
      summary: '요약',
    },
    findings: { guess, secrets: { count: 1, hits: [{ t: T0, project: 'shop' }] } },
    ownRule: { file: 'shop/CLAUDE.md', text: '같은 시도를 세 번 넘게 반복하지 않는다' },
    generated: Date.now(),
  });
  assert.ok(html.includes('바꾸면 좋을 습관 ①'));
  assert.ok(html.includes('4번 연속'));
  assert.ok(html.includes('Opus 5 에서 Fable 5.1 로'));
  assert.ok(html.includes('먼저 확인할 것'));
  assert.ok(!html.includes('3f9a1c'));
  assert.ok(!html.includes('undefined'));
  // 잘하는 것(banik)이 먼저 나와 1번, 그다음 습관의 Claude Code 지침이 2번.
  assert.ok(html.indexOf('id="r1"') < html.indexOf('All Smoke'));
  assert.ok(/<li id="r2"><a href="https:\/\/code\.claude\.com/.test(html));
});

test('같은 문제가 아닌 구간은 빼고, 같은 문제인 부분만 남긴다', async () => {
  const { s, labels } = session();
  // 첫 구간(4개)은 「0-1」만 같은 문제 → 3개 미만이라 빠짐, 둘째 구간(3개)은 전부 같은 문제.
  const fake = async ({ prompt }) => (prompt.includes('하얗게 멈춰') ? '0-1' : '0-2');
  const g = await findGuessLoops([s], labels, { complete: fake });
  assert.equal(g.count, 1);
  assert.equal(g.top.n, 3);
  // 판정은 캐시되므로, 다른 답을 보려면 캐시를 지운다.
  fs.rmSync(path.join(process.env.AI_DEV_FEEDBACK_HOME, 'streak-cache.json'), { force: true });
  const none = await findGuessLoops([s], labels, { complete: async () => 'none' });
  assert.equal(none.count, 0);
});
