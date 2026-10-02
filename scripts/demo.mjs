// README 그림용 리포트를 지어낸 데이터로 그린다. 기록을 읽지 않고 AI 도 부르지 않는다.
// 쓰는 법: node scripts/demo.mjs  →  docs/images/demo-ko.html, demo-en.html (그림은 이 파일을 브라우저로 찍는다)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedbackFor } from '../src/catalog.js';
import { ui } from '../src/i18n.js';
import { renderReport } from '../src/report/render.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'images');
const MIN = 60_000;
const at = (hm, day = '2026-02-17') => Date.parse(`${day}T${hm}:00+09:00`);

// 지어낸 대화. 언어마다 같은 이야기.
const TEXT = {
  ko: {
    first: ['결제 버튼을 누르면 화면이 하얗게 멈춰', '여전히 멈춰', '모바일에서는 아직도 똑같아'],
    ask: '왜 결제 모듈부터 의심하는 거야?',
    again: '이것도 아닌 것 같은데',
    good: '결제 화면에서 「결제하기」를 누르면 주문 확인 화면으로 넘어가야 정상인데, 데스크톱 크롬에서는 잘 되고 모바일 사파리에서만 화면이 하얗게 멈춰. 콘솔에는 오류가 없고 새로고침하면 장바구니는 그대로야. 장바구니에 상품이 하나일 때는 괜찮고 둘 이상일 때만 멈춰.',
    rule: '커밋 메시지는 한국어로 쓰기',
    ruleMsgs: ['커밋 메시지 한국어로 써 줘', '커밋 메시지는 한국어로 쓰라고 했잖아', '또 영어로 커밋했네. 앞으로 한국어로'],
    ruleLine: '커밋 메시지는 한국어로 쓴다',
    ownRule: '같은 방법으로 두 번 실패하면 멈추고 원인부터 묻는다',
    repos: (U) => U.repos('shop-web', 1),
    period: '2/1 ~ 3/2 · 최근 30일 · 지어낸 예시',
  },
  en: {
    first: ['Checkout freezes on a white screen when I tap pay', 'Still frozen', 'Same on mobile'],
    ask: 'Why are you suspecting the payment module first?',
    again: "That's not it either",
    good: 'On the checkout page, tapping "Pay" should take you to the order confirmation. It works in desktop Chrome, but in mobile Safari the screen freezes white. No console errors, and after a reload the cart is still there. With one item in the cart it works; with two or more it freezes.',
    rule: 'Write commit messages in English',
    ruleMsgs: ['Write the commit message in English', 'I told you to write commit messages in English', 'Committed in another language again. English from now on'],
    ruleLine: 'Commit messages are written in English',
    ownRule: 'If the same approach fails twice, stop and ask for the cause first',
    repos: (U) => U.repos('shop-web', 1),
    period: 'Feb 1 – Mar 2 · last 30 days · made-up example',
  },
};

function report(lang) {
  const T = TEXT[lang];
  const U = ui(lang);
  const { F } = feedbackFor(lang);
  const testSummary = { tests: 842, missing: 9, pct: 1.1, repos: T.repos(U), examples: [] };
  return {
    meta: { lang, title: U.title(30), periodLabel: T.period, projects: 3, sessions: 38, prompts: 1204, git: true, preview: false, notMeasured: [] },
    picks: {
      habits: [{ kind: 'guessLoop' }, { kind: 'repeatRule' }],
      strengths: [{ title: F.testChecks.goodTitle, html: F.testChecks.goodWhy(testSummary), source: F.testChecks.goodSource }],
      promise: F.guessLoop.promise,
      summary: U.summary([U.testGoodPhrase], U.phrase.guessLoop, U.phrase.repeatRule),
      testSummary,
    },
    findings: {
      guess: {
        count: 4,
        messages: 17,
        ms: 95 * MIN,
        fixPrompts: 62,
        hypothesis: 9,
        byProject: { 'shop-web': 3, 'admin-api': 1 },
        top: {
          project: 'shop-web',
          n: 6,
          ms: 48 * MIN,
          start: at('14:05'),
          end: at('14:53'),
          episode: { start: at('14:05'), end: at('16:21'), resolvedAt: at('16:21'), messages: 21 },
          first: T.first.map((x, i) => ({ t: at(['14:05', '14:12', '14:20'][i]), x })),
          firstAsk: { t: at('15:10'), x: T.ask },
          again: [{ t: at('15:31'), n: 3, x: T.again }],
          good: { t: at('16:02'), x: T.good, resolvedAt: at('16:21') },
          modelChange: null,
        },
      },
      rules: {
        clusters: [
          {
            rule: T.rule,
            sessions: 3,
            messages: T.ruleMsgs.map((x, i) => ({ t: at(['10:12', '17:40', '11:03'][i], ['2026-02-05', '2026-02-19', '2026-02-26'][i]), x, project: i === 1 ? 'admin-api' : 'shop-web' })),
            source: { file: '/work/shop-web/CLAUDE.md', text: T.ruleLine, firstSeen: '2026-02-10T00:00:00+09:00' },
            afterRule: 2,
          },
        ],
      },
      secrets: { count: 1, hits: [{ t: at('09:30', '2026-02-11'), project: 'admin-api' }] },
    },
    ownRule: { file: 'shop-web/CLAUDE.md', text: T.ownRule },
    generated: Date.parse('2026-03-02T09:00:00+09:00'),
  };
}

fs.mkdirSync(OUT, { recursive: true });
for (const lang of ['ko', 'en']) {
  const file = path.join(OUT, `demo-${lang}.html`);
  fs.writeFileSync(file, renderReport(report(lang)));
  console.log(file);
}
