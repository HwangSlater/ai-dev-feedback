// code-dependent 에서 가져온 공통 코드의 시험.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.AI_DEV_FEEDBACK_HOME = path.join(os.tmpdir(), `ai-dev-feedback-test-${process.pid}`);

const { parseFile } = await import('../src/adapters/claude-code.js');
const { commandSignatures, commandClass } = await import('../src/classify.js');
const { mask } = await import('../src/util.js');

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/projects/demo/s1.jsonl');

test('adapter keeps only human prompts and marks failures', async () => {
  const s = await parseFile(FIXTURE);
  const prompts = s.ev.filter((e) => e.k === 'p');
  assert.deepEqual(prompts.map((e) => e.x), ['로그인 API 만들어줘', '왜 JWT가 더 나아?', 'ㄱㄱ', '3번으로 해줘']);
  assert.equal(prompts[3].s, 'sug');
  assert.equal(s.ev.filter((e) => e.k === 'i').length, 1);
  const tests = s.ev.filter((e) => e.k === 't' && e.n === 'Bash');
  // Piped output "2 failed" counts as a failure even without an error exit.
  assert.deepEqual(tests.map((e) => !!e.e), [true, true, true, false]);
  assert.equal(s.cwd, '/work/demo');
});

test('command signatures ignore cd, env vars and quoted pipes', () => {
  assert.deepEqual(commandSignatures('cd app && CI=1 npm run test -- --watch'), ['npm run test']);
  assert.deepEqual(commandSignatures(`grep -n "a|b" src/x.js | head -5`), ['grep', 'head']);
  assert.deepEqual(commandSignatures('python -m pytest tests/'), ['python -m pytest']);
  assert.deepEqual(commandSignatures('uv run main.py --sheets'), ['uv run main.py']);
  assert.equal(commandClass(null, { g: 'npx vitest run' }), 'test');
  assert.equal(commandClass(null, { g: 'git status' }), 'vcs');
});

test('mask hides secrets before text leaves the machine', () => {
  const out = mask('key sk-ant-abcdefghijklmnopqrstuv mail me@x.com call 010-1234-5678');
  assert.ok(!out.includes('sk-ant') && !out.includes('me@x.com') && !out.includes('1234'));
});



test('codex adapter reads both the code-mode and the older tool formats', async () => {
  const { parseFile: parseCodex } = await import('../src/adapters/codex.js');
  const s = await parseCodex(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/codex/2026/09/10/rollout-demo.jsonl'));
  assert.equal(s.cwd, '/work/api');
  assert.deepEqual(s.ev.filter((e) => e.k === 'p').map((e) => e.x), ['회원가입 API 만들어줘', 'ㄱㄱ']);
  const tools = s.ev.filter((e) => e.k === 't').map((e) => `${e.n}:${e.g}${e.e ? '!' : ''}`);
  assert.deepEqual(tools, ['Bash:npm test!', 'Edit:src/signup.js', 'Bash:npm test']);
  assert.equal(s.ev.filter((e) => e.k === 'i').length, 1);
});



const { guessStreaks, hasSecret, isResend } = await import('../src/collab.js');

const lab = (intent, ...sig) => ({ intent, sig: new Set(sig) });
const MIN = 60_000;

test('secrets are spotted, commit hashes and plain text are not', () => {
  assert.ok(hasSecret('키는 AIzaSyA1234567890abcdefghijklmnopqrstuv 이거야'));
  assert.ok(hasSecret('SENTRY_DSN=https://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/2'));
  assert.ok(hasSecret('password: hunter2hunter2hunter2'));
  assert.ok(!hasSecret('커밋 20c767f3a9b1c2d4e5f60718293a4b5c6d7e8f90 으로 되돌려'));
  assert.ok(!hasSecret('토큰 만료 때문인 것 같아'));
  // Bare keys, the way they get handed over in chat.
  assert.ok(hasSecret('토큰 줄게. 3f9a1c0b7e2d4a6f8b1c3e5d7a9f0b2c4d6e8a1b'));
  assert.ok(hasSecret('키 만들었다. AbCd1234EfGh5678IjKl9012Mn'));
  assert.ok(hasSecret('a1b2c3d4e5f60718293a4b5c6d7e8f90'));
  // IDs and commit hashes are not secrets.
  assert.ok(!hasSecret('제출 ID 1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809 확인해줘'));
  assert.ok(!hasSecret('Private Key ID 3f9a1c0b7e2d4a6f8b1c3e5d7a9f0b2c4d6e8a1b'));
  assert.ok(!hasSecret('20c767f3a9b1c2d4e5f60718293a4b5c6d7e8f90'));
});

test('new secret shapes are masked before leaving the machine', () => {
  const out = mask('AIzaSyA1234567890abcdefghijklmnopqrstuv / https://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io / password=hunter2hunter2hunter2');
  assert.ok(!out.includes('AIza') && !out.includes('0123456789abcdef') && !out.includes('hunter2'), out);
  assert.ok(out.includes('password=[KEY]'));
  assert.equal(mask('토큰 줄게. 3f9a1c0b7e2d4a6f8b1c3e5d7a9f0b2c4d6e8a1b'), '토큰 줄게. [KEY]');
  assert.equal(mask('AbCd1234EfGh5678IjKl9012Mn'), '[KEY]');
});

test('resend: same text or same opening with more, within ten minutes', () => {
  const a = { t: 0, x: '로그인 버튼 누르면 화면이 멈추는 거 고쳐줘' };
  assert.ok(isResend(a, { t: MIN, x: '로그인 버튼 누르면 화면이 멈추는 거 고쳐줘' }));
  assert.ok(isResend(a, { t: MIN, x: '로그인 버튼 누르면 화면이 멈추는 거 고쳐줘. 모바일에서만 그래' }));
  assert.ok(!isResend(a, { t: 11 * MIN, x: a.x }));
  assert.ok(!isResend({ t: 0, x: 'ㄱㄱ' }, { t: MIN, x: 'ㄱㄱ' }));
});

test('streak: three "still broken" in a row; a guess or a question ends it', () => {
  const p = (m) => ({ t: m * MIN, x: '' });
  const four = [lab('fix'), lab('inform'), lab('fix'), lab('fix'), lab('fix')].map((l, i) => ({ p: p(i), lab: l }));
  assert.deepEqual(guessStreaks(four).map((g) => g.n), [4]);
  const broken = [lab('fix'), lab('fix'), lab('fix', 'hypothesis'), lab('fix'), lab('fix')].map((l, i) => ({ p: p(i), lab: l }));
  assert.equal(guessStreaks(broken).length, 0);
  const late = [lab('fix'), lab('fix'), lab('fix')].map((l, i) => ({ p: p(i * 40), lab: l }));
  assert.equal(guessStreaks(late).length, 0);
});


test('words that only contain "키" are not keys', () => {
  assert.ok(!hasSecret('스키마 userprofilesettings2024v2abc 에 넣어줘'));
  assert.ok(!hasSecret('키워드 abcdefghij1234567890xyz 로 검색'));
  assert.ok(!hasSecret('user_profile_settings_2024_v2'));
  assert.ok(hasSecret('api키 줄게 a1b2c3d4e5f60718293a4b5c6d7e8f'));
});

test('different pages that share a header are not a resend', () => {
  const head = 'Search Get app Write Sign up Sign in MUSINSA techblog ';
  assert.ok(!isResend({ t: 0, x: `${head} Part 1 본문` }, { t: MIN, x: `${head} Part 2 본문` }));
});
