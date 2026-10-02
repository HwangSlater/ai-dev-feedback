// C12·C13 되풀이 규칙 찾기의 시험. 실제 기록은 읽지 않고 시험 안에서 만든 사건 배열과 가짜 complete 를 쓴다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, beforeEach } from 'node:test';

const TMP = path.join(os.tmpdir(), `ai-dev-feedback-rules-${process.pid}`);
process.env.AI_DEV_FEEDBACK_HOME = TMP;

const { findRepeatedRules, pickCandidates, parseIdLines, parseGroups, ruleLines, ruleFiles, countAfter, notRule } = await import('../src/feedback/rules.js');

const DAY = 86_400_000;
const T0 = Date.parse('2026-09-10T00:00:00Z');

const sess = (id, texts, day = 0) => ({
  id,
  root: '/work/app',
  cwd: '/work/app',
  ev: texts.map((x, i) => ({ t: T0 + day * DAY + i * 60_000, k: 'p', x, n: x.length })),
});

// 일반화: 문장 → 규칙. 모르는 것은 '-'. 묶기: 비슷한 두 문장을 하나로. 대조: 한국어 규칙 → 파일 0 의 2번째 줄.
const GEN = {
  '한국어로 답해': '한국어로 답하기',
  '답은 항상 한국어로 해라': '한국어로 답변하기',
  '커밋 하나로 합쳐라': '커밋을 하나로 합치기',
  '앞으로 커밋은 하나로': '커밋을 하나로 합치기',
  '버튼 색 항상 파란색으로 바꿔': '-',
};

// reject: 다시 대 보기에서 「no」로 답할 문장들.
function fakeComplete(log, { breakFirstGen = false, reject = [] } = {}) {
  let genCalls = 0;
  return async ({ system, prompt }) => {
    log.push(system.slice(0, 20));
    const lines = prompt.split('\n');
    if (system.startsWith('You read short')) {
      genCalls++;
      if (breakFirstGen && genCalls === 1) return '형식이 깨진 출력';
      return lines.map((l) => {
        const [, id, text] = l.match(/^(\d+): (.*)$/);
        return `${id}|${GEN[text] ?? '-'}`;
      }).join('\n');
    }
    if (system.startsWith("A developer's messages")) {
      return lines.slice(1).map((l) => {
        const [, id, text] = l.match(/^(\d+): (.*)$/);
        return `${id}|${reject.includes(text) ? 'no' : 'yes'}`;
      }).join('\n');
    }
    if (system.startsWith('You group')) {
      const ids = Object.fromEntries(lines.map((l) => l.match(/^(\d+): (.*)$/).slice(1).reverse()));
      return `${ids['한국어로 답하기']},${ids['한국어로 답변하기']}`;
    }
    if (system.startsWith('You match')) {
      const out = [];
      for (const l of lines) {
        const m = l.match(/^c(\d+): (.*)$/);
        if (m) out.push(`c${m[1]}|${m[2].includes('한국어') ? '0:2' : '-'}`);
      }
      return out.join('\n');
    }
    return '';
  };
}

let ruleFile;
beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  ruleFile = path.join(TMP, 'MEMORY.md');
  fs.writeFileSync(ruleFile, '# 규칙\n- 답은 무조건 한국어로\n```\n코드는 빼기\n```\n');
  // 파일 생성 시각 대신 쓰도록 frontmatter 없이 두고, 날짜는 시험에서 직접 확인한다.
});

test('후보: 길이·단서·라벨로 고르고 제안 수락(sug)은 뺀다', () => {
  const s = sess('a', ['한국어로 답해', '이 함수 고쳐줘', '앞으로 커밋은 하나로', 'x'.repeat(300) + ' 항상']);
  s.ev.push({ t: T0, k: 'p', x: '항상 이걸로', n: 6, s: 'sug' });
  s.ev.push({ t: T0, k: 'p', x: 'Redis 말고 DB 락으로', n: 15, key: 'k1' });
  s.ev.push({ t: T0, k: 'r', x: '항상 그렇게 할게요', n: 10 });
  const labels = { p: { k1: 'build|dr,cr' }, c: {} };
  const got = pickCandidates([s], labels).map((c) => c.text);
  assert.deepEqual(got, ['한국어로 답해', '앞으로 커밋은 하나로', 'Redis 말고 DB 락으로']);
  // 단서 없는 문장도 만들기 요청(build) 라벨이면 잡힌다. 질문(why)은 아니다.
  s.ev[1].key = 'k2';
  labels.p.k2 = 'why';
  assert.equal(pickCandidates([s], labels).length, 3);
  labels.p.k2 = 'build';
  assert.equal(pickCandidates([s], labels).length, 4);
  // 라벨이 없어도 단서로는 돈다.
  assert.equal(pickCandidates([s], null).length, 2);
});

test('파싱: 깨진 줄은 버리고, 묶음에서 한 id 는 한 번만', () => {
  const m = parseIdLines('0|한국어로 답하기\n잡소리\n2: -\n3|');
  assert.deepEqual([...m], [[0, '한국어로 답하기'], [2, '-']]);
  assert.deepEqual(parseGroups('설명\n3,1,2\n1,4\n9,0', 5), [[3, 1, 2], [4], [0]]);
});

test('규칙 파일 줄: 코드 블록·빈 줄 빼고, frontmatter 는 description 만', () => {
  const lines = ruleLines('x.md', '---\nname: a\ndescription: 한국어로 답한다\nmodified: 2026-09-28T00:00:00Z\n---\n\n- 커밋은 합친다\n```\nrm -rf\n```\n|---|---|\n');
  assert.deepEqual(lines, [{ line: 3, text: '한국어로 답한다' }, { line: 7, text: '- 커밋은 합친다' }]);
});

test('ruleFiles: 루트의 CLAUDE.md·AGENTS.md 와 메모리 파일', () => {
  const root = path.join(TMP, 'proj');
  const claude = path.join(TMP, 'claude');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(claude, 'projects', 'p1', 'memory'), { recursive: true });
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'a');
  fs.writeFileSync(path.join(claude, 'projects', 'p1', 'memory', 'MEMORY.md'), 'b');
  fs.writeFileSync(path.join(claude, 'projects', 'p1', 'memory', 'x.txt'), 'c');
  const got = ruleFiles([root, root], { claudeDir: claude }).map((f) => path.relative(TMP, f).replace(/\\/g, '/'));
  assert.deepEqual(got, ['proj/CLAUDE.md', 'claude/projects/p1/memory/MEMORY.md']);
});

test('묶고, 대화 수로 거르고, 규칙 파일과 대조한다', async () => {
  const sessions = [
    sess('s1', ['한국어로 답해', '버튼 색 항상 파란색으로 바꿔'], 0),
    sess('s2', ['답은 항상 한국어로 해라', '커밋 하나로 합쳐라'], 1),
    sess('s3', ['한국어로 답해'], 2),
    sess('s4', ['커밋 하나로 합쳐라', '앞으로 커밋은 하나로'], 3),
  ];
  const log = [];
  const res = await findRepeatedRules(sessions, null, { complete: fakeComplete(log), files: [ruleFile] });
  // 한국어 3번·3대화(두 문장이 하나로 묶임), 커밋 3번이지만 2대화.
  assert.equal(res.clusters.length, 2);
  const [ko, commit] = res.clusters;
  assert.equal(ko.rule, '한국어로 답하기');
  assert.equal(ko.sessions, 3);
  assert.equal(ko.messages.length, 3);
  assert.deepEqual(ko.messages.map((m) => m.session), ['s1', 's2', 's3']);
  assert.equal(ko.messages[0].project, 'app');
  assert.equal(ko.source.line, 2);
  assert.equal(ko.source.text, '- 답은 무조건 한국어로');
  assert.ok(ko.source.firstSeen);
  assert.equal(commit.rule, '커밋을 하나로 합치기');
  assert.equal(commit.sessions, 2);
  assert.equal(commit.source, null);
  assert.equal(commit.afterRule, 0);
  // 일반화 1 + 묶기 1 + 묶음마다 다시 대 보기 2 + 대조 1
  assert.equal(res.usage.calls, 5);

  // 두 번째는 캐시로: AI 호출 없음.
  const again = await findRepeatedRules(sessions, null, { complete: fakeComplete(log), files: [ruleFile] });
  assert.equal(again.usage.calls, 0);
  assert.equal(again.clusters.length, 2);

  // 대화 수 기준을 올리면 커밋 묶음이 빠진다.
  const strict = await findRepeatedRules(sessions, null, { complete: fakeComplete(log), files: [ruleFile], minSessions: 3 });
  assert.deepEqual(strict.clusters.map((c) => c.rule), ['한국어로 답하기']);
});

test('일반화 출력이 깨지면 한 번 다시 묻는다', async () => {
  const sessions = [sess('s1', ['한국어로 답해'], 0), sess('s2', ['한국어로 답해'], 1), sess('s3', ['답은 항상 한국어로 해라'], 2)];
  const log = [];
  const res = await findRepeatedRules(sessions, null, { complete: fakeComplete(log, { breakFirstGen: true }), files: [] });
  assert.equal(res.clusters.length, 1);
  assert.equal(log.filter((s) => s.startsWith('You read short')).length, 2);
});

test('다시 대 보기에서 아니라고 한 메시지는 묶음에서 빠진다', async () => {
  const sessions = [sess('s1', ['한국어로 답해'], 0), sess('s2', ['한국어로 답해'], 1), sess('s3', ['답은 항상 한국어로 해라'], 2)];
  const res = await findRepeatedRules(sessions, null, { complete: fakeComplete([], { reject: ['답은 항상 한국어로 해라'] }), files: [] });
  assert.equal(res.clusters.length, 0); // 남은 것이 메시지 2개뿐이라 기준(3개) 아래
  const loose = await findRepeatedRules(sessions, null, { complete: fakeComplete([], { reject: ['답은 항상 한국어로 해라'] }), files: [], minMessages: 2 });
  assert.equal(loose.clusters[0].messages.length, 2);
});

test('줄표·「없음」 답은 규칙이 아니다', () => {
  for (const r of ['-', '—', '–', ' — ', '없음', 'none']) assert.ok(notRule(r), r);
  assert.ok(!notRule('한국어로 답하기'));
});

test('afterRule: 규칙이 생긴 뒤의 메시지만 센다', () => {
  const msgs = [{ t: T0 }, { t: T0 + DAY }, { t: T0 + 2 * DAY }];
  assert.equal(countAfter(msgs, new Date(T0 + DAY).toISOString()), 2);
  assert.equal(countAfter(msgs, null), 0);
});
