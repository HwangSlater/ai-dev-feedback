// README 그림용 리포트를 지어낸 데이터로 그린다. 기록을 읽지 않고 AI 도 부르지 않는다.
// 쓰는 법: node scripts/demo.mjs  →  docs/images/demo-ko.html (그림은 이 파일을 브라우저로 찍는다)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEEDBACK } from '../src/catalog.js';
import { renderReport } from '../src/report/render.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'images');
const MIN = 60_000;
const at = (hm, day = '2026-02-17') => Date.parse(`${day}T${hm}:00+09:00`);

const guess = {
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
    first: [
      { t: at('14:05'), x: '결제 버튼을 누르면 화면이 하얗게 멈춰' },
      { t: at('14:12'), x: '여전히 멈춰' },
      { t: at('14:20'), x: '모바일에서는 아직도 똑같아' },
    ],
    firstAsk: { t: at('15:10'), x: '왜 결제 모듈부터 의심하는 거야?' },
    again: [{ t: at('15:31'), n: 3, x: '이것도 아닌 것 같은데' }],
    good: {
      t: at('16:02'),
      x: '결제 화면에서 「결제하기」를 누르면 주문 확인 화면으로 넘어가야 정상인데, 데스크톱 크롬에서는 잘 되고 모바일 사파리에서만 화면이 하얗게 멈춰. 콘솔에는 오류가 없고 새로고침하면 장바구니는 그대로야. 장바구니에 상품이 하나일 때는 괜찮고 둘 이상일 때만 멈춰.',
      resolvedAt: at('16:21'),
    },
    modelChange: null,
  },
};

const rules = {
  clusters: [
    {
      rule: '커밋 메시지는 한국어로 쓰기',
      sessions: 3,
      messages: [
        { t: at('10:12', '2026-02-05'), x: '커밋 메시지 한국어로 써 줘', project: 'shop-web' },
        { t: at('17:40', '2026-02-19'), x: '커밋 메시지는 한국어로 쓰라고 했잖아', project: 'admin-api' },
        { t: at('11:03', '2026-02-26'), x: '또 영어로 커밋했네. 앞으로 한국어로', project: 'shop-web' },
      ],
      source: { file: '/work/shop-web/CLAUDE.md', text: '커밋 메시지는 한국어로 쓴다', firstSeen: '2026-02-10T00:00:00+09:00' },
      afterRule: 2,
    },
  ],
};

const testSummary = { tests: 842, missing: 9, pct: 1.1, repos: 'shop-web 외 1곳', examples: [] };
const rep = {
  meta: {
    title: '30일 동안 AI와 개발한 방식을 돌아봤어요',
    periodLabel: '2/1 ~ 3/2 · 최근 30일 · 지어낸 예시',
    projects: 3,
    sessions: 38,
    prompts: 1204,
    git: true,
    preview: false,
    notMeasured: [],
  },
  picks: {
    habits: [{ kind: 'guessLoop' }, { kind: 'repeatRule' }],
    strengths: [{ title: FEEDBACK.testChecks.goodTitle, html: FEEDBACK.testChecks.goodWhy(testSummary), source: FEEDBACK.testChecks.goodSource }],
    promise: FEEDBACK.guessLoop.promise,
    summary: '테스트에 결과 확인을 넣는 습관은 탄탄해요. 시간이 가장 많이 샌 곳은 <b>같은 증상을 「고쳐 줘」로만 반복한 구간</b>이었고, <b>여러 번 말한 부탁이 다시 어겨지는 일</b>이 계속됐어요.',
    testSummary,
  },
  findings: { guess, rules, secrets: { count: 1, hits: [{ t: at('09:30', '2026-02-11'), project: 'admin-api' }] } },
  ownRule: { file: 'shop-web/CLAUDE.md', text: '같은 방법으로 두 번 실패하면 멈추고 원인부터 묻는다' },
  generated: Date.parse('2026-03-02T09:00:00+09:00'),
};

fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, 'demo-ko.html');
fs.writeFileSync(file, renderReport(rep));
console.log(file);
