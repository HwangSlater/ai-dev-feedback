// C5(확인 없는 테스트) 훑기의 시험. 임시 git 저장소에 언어별 테스트 파일을 넣고 숫자를 맞춰 본다.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const { scanTestChecks, testFileLang, inTestDir, blankCode, blankPy, hasCheck, findJsTests, findPyTests, findGoTests, findJvmTests } =
  await import('../src/feedback/tests.js');

const JS = `import { equal } from 'node:assert/strict';
function expectValid(x) { if (!x) throw new Error('bad'); }
const runCase = (x) => { assert.ok(x); };

it('expect 로 확인', () => { expect(1).toBe(1); });
it('확인 없음', () => { const x = 1 + 1; console.log("expect(x) 는 글자일 뿐"); });
test('도우미 이름으로 확인', () => { expectValid(1); });
test('같은 파일 도우미', () => { runCase(2); });
test('assert 모듈에서 가져온 이름', () => { equal(1, 1); });
test.each([[1], [2]])('each %s', (n) => { expect(n).toBeTruthy(); });
it.todo('나중에');
test('가짜 함수 안의 throw 는 확인이 아니다', () => { const f = () => { throw new Error('x'); }; f; });
it(\`템플릿 \${1}\`, () => { const s = \`a \${ \`b}\` } c\`; expect(s).toBeTruthy(); });
it('정규식 안의 괄호', () => { const r = /[)}]/; expect(r.test('}')).toBe(true); });
// test('주석 속 테스트', () => {});
`;

const PLAIN_NODE_TEST = `import test from 'node:test';
test('폴더로만 테스트인 파일', () => { run(); });
`;

const PY = `import pytest


def 값을_본다(x):
    assert x


def 돌린다(x):
    값을_본다(x)


def check_response(r):
    return r


def test_assert():
    assert 1 + 1 == 2


def test_raises():
    with pytest.raises(ValueError):
        int("x")


def test_no_check():
    """assert 가 문서에만 있다"""
    x = 1
    # assert x


def test_도우미의_도우미():
    돌린다(1)


def test_prefix():
    check_response(200)


class TestThing:
    def test_self_assert(self):
        self.assertEqual(1, 1)

    def test_mock(self):
        m.assert_called_once_with(1)

    def test_nothing(self):
        obj.check(1)
`;

const GO = `package x

import "testing"

func check(t *testing.T, v int) {
	if v != 1 {
		t.Errorf("bad")
	}
}

func TestGood(t *testing.T) { if 1 != 1 { t.Fatal("x") } }
func TestHelper(t *testing.T) { check(t, 1) }
func TestNone(t *testing.T) { _ = fmt.Errorf("x"); s := "t.Error(x) {"; _ = s }
func TestRequire(t *testing.T) { require.Equal(t, 1, 1) }
func TestMain(m *testing.M) { m.Run() }
func (s *Suite) TestSuite() { s.Equal(1, 1) }
func BenchmarkX(b *testing.B) {}
`;

const JAVA = `class FooTest {
  @Test void good() { assertEquals(1, 1); }

  @Test
  @DisplayName("이름 {")
  public void none() { int x = 1; }

  @Test(expected = IllegalStateException.class) public void throwsIt() { foo(); }

  @Test void mock() { Mockito.verify(m).run(); }
}
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adf-c5-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function git(args, date) {
  const env = { ...process.env };
  if (date) env.GIT_AUTHOR_DATE = env.GIT_COMMITTER_DATE = date;
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd: tmp,
    env,
    stdio: 'ignore',
  });
}
function put(rel, text) {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

git(['init', '-q']);
put('web/a.test.js', JS);
put('test/plain.mjs', PLAIN_NODE_TEST);
put('test/harness.mjs', 'export const t = (a, b) => a === b;\n');
put('node_modules/pkg/x.test.js', "it('남의 것', () => {});\n");
put('go/x_test.go', GO);
put('java/FooTest.java', JAVA);
git(['add', '-A', '-f']);
git(['commit', '-q', '-m', 'old'], '2020-01-01T00:00:00Z');
put('tests/test_a.py', PY);
git(['add', '-A']);
git(['commit', '-q', '-m', 'new']);

test('파일 고르기: 이름·폴더 규칙과 제외 폴더', () => {
  assert.equal(testFileLang('src/a.test.ts'), 'js');
  assert.equal(testFileLang('src/__tests__/a.tsx'), 'js');
  assert.equal(testFileLang('tests/test_x.py'), 'py');
  assert.equal(testFileLang('tests/test_한글.py'), 'py');
  assert.equal(testFileLang('pkg/a_test.go'), 'go');
  assert.equal(testFileLang('src/FooTest.java'), 'java');
  assert.equal(testFileLang('node_modules/a/b.test.js'), null);
  assert.equal(testFileLang('src/conftest.py'), null);
  assert.equal(inTestDir('scripts/test-web/cost.mjs'), 'js');
  assert.equal(inTestDir('test/fixtures/a.js'), null);
  assert.equal(inTestDir('src/a.js'), null);
});

test('주석·문자열을 지워도 글자 위치는 그대로', () => {
  const src = "const a = 'x(}'; // expect(\nconst b = `t ${f('{')} u`; /* assert */ const r = /[{]/;";
  const out = blankCode(src, 'js');
  assert.equal(out.length, src.length);
  assert.equal(out.split('\n').length, 2);
  assert.ok(!/expect|assert|\{'|\[\{/.test(out));
  assert.ok(out.includes('f('), '템플릿 `${}` 안의 코드는 남는다');
  const py = 'x = """\nassert 1\n"""\n# assert\ny = 2';
  const pyOut = blankPy(py);
  assert.equal(pyOut.length, py.length);
  assert.ok(!pyOut.includes('assert'));
  assert.equal(pyOut.split('\n')[2].trim(), '', '여러 줄 문자열의 닫는 줄은 비워 들여쓰기를 흐리지 않는다');
});

test('확인 패턴: 도우미 이름은 치고, 남의 객체의 맨 check 는 치지 않는다', () => {
  assert.ok(hasCheck('expectValid(x)', 'js'));
  assert.ok(hasCheck('check_response(r)', 'py'));
  assert.ok(hasCheck('self.assertEqual(a, b)', 'py'));
  assert.ok(hasCheck('r.check_status(200)', 'py'));
  assert.ok(!hasCheck('await throttle.check(scope, key)', 'py'));
  assert.ok(!hasCheck('page.checkout(cart)', 'js'));
  assert.ok(!hasCheck('_ = err.Error()', 'go'));
  assert.ok(hasCheck('t.Error(err)', 'go'));
  assert.ok(!hasCheck('fmt.Errorf("x")', 'go'));
  assert.ok(hasCheck('x shouldBe 3', 'kt'));
});

test('언어별 판정', () => {
  const js = findJsTests(JS);
  assert.equal(js.length, 9);
  assert.deepEqual(js.filter((t) => !t.checked).map((t) => t.name), ['확인 없음', '가짜 함수 안의 throw 는 확인이 아니다']);
  assert.equal(js[1].line, 6);

  const py = findPyTests(PY);
  assert.equal(py.length, 8);
  assert.deepEqual(py.filter((t) => !t.checked).map((t) => t.name), ['test_no_check', 'test_nothing']);

  const go = findGoTests(GO);
  assert.deepEqual(go.map((t) => t.name), ['TestGood', 'TestHelper', 'TestNone', 'TestRequire', 'TestSuite']);
  assert.deepEqual(go.filter((t) => !t.checked).map((t) => t.name), ['TestNone']);

  const java = findJvmTests(JAVA, 'java');
  assert.deepEqual(java.map((t) => t.name), ['good', 'none', 'throwsIt', 'mock']);
  assert.deepEqual(java.filter((t) => !t.checked).map((t) => t.name), ['none']);
});

test('저장소 하나를 훑어 숫자를 낸다', () => {
  const r = scanTestChecks(tmp, { since: Date.now() - 86_400_000 });
  assert.equal(r.files, 5); // node_modules 와 테스트 없는 test/harness.mjs 는 빠진다
  assert.equal(r.tests, 9 + 1 + 8 + 5 + 4);
  assert.equal(r.missing, 3 + 2 + 1 + 1);
  assert.deepEqual(r.byLang.js, { files: 2, tests: 10, missing: 3 });
  assert.deepEqual(r.byLang.py, { files: 1, tests: 8, missing: 2 });
  assert.deepEqual(r.byLang.go, { files: 1, tests: 5, missing: 1 });
  assert.deepEqual(r.byLang.java, { files: 1, tests: 4, missing: 1 });
  assert.equal(r.examples.length, 5);
  assert.ok(r.examples.every((e) => !path.isAbsolute(e.file) && !e.file.includes('\\') && e.line > 0 && e.name));
  // 예시는 git ls-files 순서(go/ → java/ → test/ → tests/ → web/)로 앞에서 다섯
  assert.deepEqual(r.examples[0], { file: 'go/x_test.go', line: 13, name: 'TestNone' });
  // 최근 하루 커밋에서 바뀐 것은 파이썬 파일 하나뿐
  assert.deepEqual(r.recent, { files: 1, tests: 8, missing: 2 });
  assert.equal(scanTestChecks(tmp).recent, null);
});

test('git 저장소가 아니면 null', () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'adf-c5-plain-'));
  try {
    assert.equal(scanTestChecks(plain), null);
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
  }
});
