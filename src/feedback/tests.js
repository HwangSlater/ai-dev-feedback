// C5: 결과가 맞는지 확인하는 코드(assert·expect 같은 것)가 하나도 없는 테스트 함수.
// 근거: Banik 2026 — 에이전트가 쓴 테스트 패치의 80.2% 가 확인이 약하거나 없다(evidence.md C5).
//
// 순서: git ls-files 로 테스트 파일을 고른다 → 파일마다 한 번 읽어 주석·문자열을 지운다(위치는 그대로)
//       → 언어별로 테스트 함수 본문을 잘라 확인 패턴을 찾는다.
// 거짓 경보를 줄이는 쪽으로 판단한다: 확인처럼 보이는 것이 하나라도 있으면 「확인 있음」으로 친다.
//   - 이름이 assert·expect·check·verify·should 로 시작하는 호출(다른 파일의 도우미 포함)
//   - 같은 파일에 정의된 도우미 함수 중 본문에 확인이 있는 것의 호출
//   - assert 모듈에서 가져온 이름(`import { equal } from 'node:assert'`)의 호출
//   - 함수 리터럴 없이 함수 참조만 넘긴 테스트(`it('x', runCase)`)는 본문을 볼 수 없으니 확인 있음으로 친다
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// 이보다 큰 파일은 생성된 것으로 보고 건너뛴다.
const MAX_FILE = 1_000_000;
const MAX_EXAMPLES = 5;
const EXCLUDE_DIR =
  /(^|\/)(node_modules|vendor|vendors|dist|build|out|\.venv|venv|site-packages|third_party|third-party|bower_components|coverage|\.next|\.nuxt|\.expo|target|Pods|__generated__)(\/|$)/;

// ── 파일 고르기 ──────────────────────────────────────────────

/** 테스트 파일이면 언어 키(js·py·go·java·kt), 아니면 null. */
export function testFileLang(p) {
  if (EXCLUDE_DIR.test(p)) return null;
  const base = p.slice(p.lastIndexOf('/') + 1);
  if (/\.(?:test|spec|cy)\.[cm]?[jt]sx?$/.test(base)) return 'js';
  if (/(^|\/)__tests__\//.test(p) && /\.[cm]?[jt]sx?$/.test(base) && !/\.d\.ts$/.test(base)) return 'js';
  if (/^test_[\p{L}\p{N}_]*\.py$/u.test(base) || /_test\.py$/.test(base) || base === 'tests.py') return 'py';
  if (/_test\.go$/.test(base)) return 'go';
  if (/^(?:Test\w+|\w+(?:Test|Tests|IT))\.java$/.test(base)) return 'java';
  if (/^\w+(?:Test|Tests)\.kt$/.test(base)) return 'kt';
  return null;
}

/**
 * 이름에 test·spec 표시는 없지만 테스트 폴더(tests/ · test/ · test-web/ 같은 것) 안에 있는 JS 파일.
 * node:test 로 직접 짠 저장소가 이렇게 둔다. 도우미·자료 파일도 섞여 있으니 테스트가 하나라도 나올 때만 센다.
 */
export function inTestDir(p) {
  if (EXCLUDE_DIR.test(p) || /(^|\/)(fixtures?|__fixtures__|__mocks__|__snapshots__|testdata)\//.test(p)) return null;
  if (!/\.[cm]?[jt]sx?$/.test(p) || /\.d\.[cm]?ts$/.test(p)) return null;
  return /(^|\/)(?:tests?|specs?|e2e|test-[\w-]+|[\w-]+-tests?)\//.test(p) ? 'js' : null;
}

// ── 주석·문자열 지우기 ────────────────────────────────────────
// 줄바꿈과 글자 위치는 그대로 두고 내용만 공백으로 바꾼다. 문자열 안의 「assert」나 괄호에 속지 않기 위해서다.

const spaces = (s) => s.replace(/[^\n]/g, ' ');
const REGEX_PREV = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_KW = /(?:^|[^\w$])(?:return|typeof|case|in|of|delete|void|throw|new|await|yield|else|do)\s*$/;

/** 중괄호 언어(JS·Go·Java·Kotlin)의 주석·문자열을 지운다. JS 는 템플릿 `${}` 안의 코드와 정규식 리터럴도 다룬다. */
export function blankCode(src, lang) {
  const js = lang === 'js';
  const jvm = lang === 'java' || lang === 'kt';
  const n = src.length;
  const parts = [];
  const tpl = []; // 열린 `${` 의 중괄호 깊이
  let i = 0;
  let codeStart = 0;
  let depth = 0;
  let prev = '';
  const flush = (to) => {
    if (to > codeStart) parts.push(src.slice(codeStart, to));
  };
  // 템플릿 본문을 p 부터 읽는다. 끝 백틱이나 `${` 에서 멈추고 다음 코드 위치를 돌려준다.
  const scanTemplate = (p) => {
    let j = p;
    while (j < n) {
      const c = src[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '`') {
        parts.push(spaces(src.slice(p, j)), '`');
        return j + 1;
      }
      if (c === '$' && src[j + 1] === '{') {
        parts.push(spaces(src.slice(p, j)), '${');
        tpl.push(depth);
        return j + 2;
      }
      j++;
    }
    parts.push(spaces(src.slice(p, n)));
    return n;
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      flush(i);
      parts.push(spaces(src.slice(i, j)));
      i = codeStart = j;
      continue;
    }
    if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      flush(i);
      parts.push(spaces(src.slice(i, j)));
      i = codeStart = j;
      continue;
    }
    if (jvm && c === '"' && src.startsWith('"""', i)) {
      let j = src.indexOf('"""', i + 3);
      j = j < 0 ? n : j + 3;
      flush(i);
      parts.push('"', spaces(src.slice(i + 1, j - 1)), '"');
      i = codeStart = j;
      prev = '"';
      continue;
    }
    if (js && c === '`') {
      flush(i);
      parts.push('`');
      i = codeStart = scanTemplate(i + 1);
      prev = '"';
      continue;
    }
    if (c === '"' || c === "'" || (c === '`' && !jvm)) {
      const raw = c === '`'; // Go 의 날 문자열: 이스케이프 없음, 여러 줄 가능
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (!raw && src[j] === '\n') break;
        j += !raw && src[j] === '\\' ? 2 : 1;
      }
      const end = j < n && src[j] === c ? j + 1 : Math.min(j, n);
      flush(i);
      parts.push(c, spaces(src.slice(i + 1, end - 1)), end - 1 > i ? src[end - 1] : '');
      i = codeStart = end;
      prev = '"';
      continue;
    }
    if (js && c === '/') {
      const wordBefore = /[\w$]/.test(prev) && REGEX_KW.test(src.slice(Math.max(0, i - 12), i));
      if (prev === '' || REGEX_PREV.has(prev) || wordBefore) {
        // 정규식 리터럴로 본다. 줄이 끝날 때까지 닫히지 않으면 나눗셈이었던 것.
        let j = i + 1;
        let cls = false;
        let ok = false;
        while (j < n) {
          const ch = src[j];
          if (ch === '\n') break;
          if (ch === '\\') {
            j += 2;
            continue;
          }
          if (ch === '[') cls = true;
          else if (ch === ']') cls = false;
          else if (ch === '/' && !cls) {
            ok = true;
            break;
          }
          j++;
        }
        if (ok) {
          flush(i);
          parts.push('/', spaces(src.slice(i + 1, j)), '/');
          i = codeStart = j + 1;
          prev = '"';
          continue;
        }
      }
    }
    if (c === '{') depth++;
    else if (c === '}') {
      if (js && tpl.length && depth === tpl[tpl.length - 1]) {
        flush(i);
        tpl.pop();
        parts.push('}');
        i = codeStart = scanTemplate(i + 1);
        prev = '"';
        continue;
      }
      depth--;
    }
    if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') prev = c;
    i++;
  }
  flush(n);
  return parts.join('');
}

/** Python 의 주석·문자열(삼중 따옴표 포함)을 지운다. 여러 줄 문자열은 들여쓰기를 흐리지 않게 여는 따옴표 하나만 남긴다. */
export function blankPy(src) {
  const n = src.length;
  const parts = [];
  let i = 0;
  let codeStart = 0;
  while (i < n) {
    const c = src[i];
    if (c === '#') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      parts.push(src.slice(codeStart, i), spaces(src.slice(i, j)));
      i = codeStart = j;
      continue;
    }
    if (c === '"' || c === "'") {
      const triple = src.startsWith(c + c + c, i);
      let j = i + (triple ? 3 : 1);
      let end = n;
      while (j < n) {
        const ch = src[j];
        if (ch === '\\') {
          j += 2;
          continue;
        }
        if (triple ? src.startsWith(c + c + c, j) : ch === c) {
          end = j + (triple ? 3 : 1);
          break;
        }
        if (!triple && ch === '\n') {
          end = j;
          break;
        }
        j++;
      }
      parts.push(src.slice(codeStart, i), c, spaces(src.slice(i + 1, end)));
      i = codeStart = end;
      continue;
    }
    i++;
  }
  parts.push(src.slice(codeStart, n));
  return parts.join('');
}

// ── 본문 자르기 ──────────────────────────────────────────────

/** s[i] 의 여는 괄호와 짝인 닫는 괄호 위치. 문자열은 이미 지워져 있어 같은 종류만 센다. */
export function matchClose(s, i) {
  const o = s[i];
  const c = o === '(' ? ')' : o === '{' ? '}' : ']';
  let d = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === o) d++;
    else if (s[j] === c && --d === 0) return j;
  }
  return s.length - 1;
}

// from 부터 함수 본문 끝까지. 괄호 밖에서 처음 만나는 `{` 의 짝까지, 그 전에 stop 글자를 만나면 거기까지.
function bodyEnd(s, from, stop = ';') {
  let paren = 0;
  for (let j = from; j < s.length; j++) {
    const ch = s[j];
    if (ch === '(' || ch === '[') paren++;
    else if (ch === ')' || ch === ']') paren--;
    else if (paren <= 0 && ch === '{') return matchClose(s, j) + 1;
    else if (paren <= 0 && stop.includes(ch)) return j;
  }
  return s.length;
}

// 위치 → 줄 번호(1부터). 위치가 커지는 순서로 부르면 빠르다.
function lineCounter(s) {
  let pos = 0;
  let line = 1;
  return (idx) => {
    if (idx < pos) {
      pos = 0;
      line = 1;
    }
    for (; pos < idx; pos++) if (s.charCodeAt(pos) === 10) line++;
    return line;
  };
}

const escapeRe = (s) => s.replace(/[$.*+?^{}()|[\]\\]/g, '\\$&');

// ── 확인 패턴 ────────────────────────────────────────────────

// 이름이 확인 말로 시작하는 호출. expectValid(x)·check_response(r)·self.assertEqual·assertThat 같은 것.
// checkout·checkbox·checked 는 동작이라 뺀다.
// 다만 남의 객체에 붙은 맨 이름 check·verify(throttle.check(...))는 시험 대상 함수인 경우가 많아 확인으로 치지 않는다.
// 그런 테스트는 「예외가 안 나면 통과」일 뿐이라 C5 정의(design.md: 「예외 안 남」만 확인)와 같은 쪽으로 센다.
const CALL_PREFIX = [
  /(?:^|[^\w$.])_*(?:[aA]ssert|[cC]heck(?!out|box|ed\b)|[vV]erify|[eE]xpect|[sS]hould)[\w$]*\s*\(/, // 맨 호출
  /\.\s*_*(?:[aA]ssert|[eE]xpect|[sS]hould)[\w$]*\s*\(/, // self.assertEqual · mock.assert_called_once · then(x).should(
  /\.\s*_*(?:[cC]heck(?!out|box|ed\b)|[vV]erify)[\w$]+\s*\(/, // r.check_status(...) · mock.verifyAll()
  /\b(?:self|this|cls|Mockito|BDDMockito|mockk)\s*\.\s*_*(?:check|verify)\s*\(/, // self.check(...) · Mockito.verify(m)
];
const LANG_CHECKS = {
  js: [
    /(?:^|[^\w$.])(?:assert|expect|should)\s*\./, // assert.equal · expect.soft · should.exist
    /\.should\b/, // chai should · cypress .should(
    /\bt\.(?:is|not|deepEqual|notDeepEqual|true|false|truthy|falsy|throws|throwsAsync|notThrows|notThrowsAsync|snapshot|like|regex|notRegex|pass|fail|ok|notOk|equal|equals|notEqual|same|notSame|strictSame|match|notMatch|has|error|resolves|rejects|assert)\s*\(/,
    /\bto\w*Snapshot\b/,
    /(?:^|[^\w$.])fail\s*\(/,
    /\b(?:if\s*\([^\n]*\)|else)\s*\{?\s*throw\b/, // if (!ok) throw new Error(...) — 가짜 함수 안의 throw 는 확인이 아니다
  ],
  py: [/\bassert\b/, /\bpytest\.(?:raises|warns|fail|deprecated_call)\b/, /\bself\.fail\w*\s*\(/, /\braise\s+AssertionError\b/],
  go: [
    /(?<!\b(?:fmt|errors|xerrors|pkgerrors))\.(?:Errorf|Fatalf)\s*\(/,
    /\.(?:Error|Fatal)\s*\(\s*[^)\s]/, // t.Error(x) — err.Error() 는 인자가 없어 빠진다
    /\.(?:Fail|FailNow|Skip|Skipf|SkipNow)\s*\(/,
    /\b(?:require|assert)\.\w+\s*\(/,
    /(?:^|[^\w])\w+\s*\(\s*t\s*[,)]/, // t 를 넘기는 호출은 도우미가 확인한다고 본다(checkResult(t, got))
    /\bpanic\s*\(/,
  ],
  java: [/(?:^|[^\w$.])fail\s*\(/, /\bthrow\s+new\s+\w*(?:Assertion|Error)/, /\bverify\w*\s*[({]/],
  kt: [/(?:^|[^\w$.])fail\s*\(/, /\bshould\w*\b/, /\bverify\w*\s*[({]/, /\bassert\w*\s*\{/],
};

// testify suite 의 받는 쪽 메서드(s.Equal(...) 같은 것)
const GO_SUITE =
  'Equal|EqualValues|NotEqual|NoError|Error|ErrorIs|ErrorAs|ErrorContains|True|False|Nil|NotNil|Len|Contains|NotContains|Empty|NotEmpty|ElementsMatch|Eventually|Greater|GreaterOrEqual|Less|LessOrEqual|Panics|NotPanics|Zero|NotZero|Fail|FailNow|JSONEq|InDelta|Subset|IsType|Same|Regexp|Require|Assert';

/** 본문 하나에 확인이 있는가. extra 는 파일별로 더해지는 정규식(도우미 이름 호출 등). */
export function hasCheck(body, lang, extra = []) {
  for (const re of CALL_PREFIX) if (re.test(body)) return true;
  for (const re of LANG_CHECKS[lang] || []) if (re.test(body)) return true;
  for (const re of extra) if (re && re.test(body)) return true;
  return false;
}

// 같은 파일의 도우미 함수 중 확인이 있는 것의 이름을 모은다. 도우미가 도우미를 부르는 경우를 위해 몇 번 되풀이한다.
function checkedHelpers(defs, lang, seed = []) {
  const names = new Set(seed);
  let re = namesRe(names);
  for (let round = 0; round < 4; round++) {
    let grew = false;
    for (const d of defs) {
      if (names.has(d.name)) continue;
      if (hasCheck(d.body, lang, [re])) {
        names.add(d.name);
        grew = true;
      }
    }
    if (!grew) break;
    re = namesRe(names);
  }
  return re;
}

function namesRe(names) {
  if (!names.size) return null;
  // 한글 이름(값을_넣는다)도 있으니 경계는 유니코드 글자로 본다
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_$])(?:${[...names].map(escapeRe).join('|')})\\s*\\(`, 'u');
}

// ── JS/TS ───────────────────────────────────────────────────

const ASSERT_MODULE = /^(?:node:)?assert(?:\/strict)?$|^uvu\/assert$|^chai$|^power-assert$|^@std\/assert|^(?:node:)?test$/;

// assert 모듈에서 가져온 이름. import { equal, ok as good } from 'node:assert' · const { strictEqual } = require('assert')
function jsAssertImports(src) {
  const names = [];
  const add = (list) => {
    for (const part of list.split(',')) {
      const m = /(?:\bas\s+|:\s*)?([\w$]+)\s*$/.exec(part.trim());
      if (m) names.push(m[1]);
    }
  };
  for (const m of src.matchAll(/\bimport\s+([\w$]+)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!ASSERT_MODULE.test(m[3])) continue;
    if (m[1]) names.push(m[1]);
    if (m[2]) add(m[2]);
  }
  for (const m of src.matchAll(/\b(?:const|let|var)\s+(?:([\w$]+)|\{([^}]*)\})\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!ASSERT_MODULE.test(m[3])) continue;
    if (m[1]) names.push(m[1]);
    if (m[2]) add(m[2].replace(/\w+\s*:/g, ''));
  }
  // node:test 의 test·it·describe 는 확인이 아니다
  return names.filter((x) => !['test', 'it', 'describe', 'before', 'after', 'beforeEach', 'afterEach', 'mock', 'suite'].includes(x));
}

const JS_FN =
  /(?:\bfunction\s*\*?\s*([\p{L}\p{N}_$]+)\s*\(|\b(?:const|let|var)\s+([\p{L}\p{N}_$]+)\s*(?::[^=;\n]+)?=\s*(?:async\s*)?(?:function\b|\(|[\p{L}\p{N}_$]+\s*=>))/gu;
const JS_TEST = /(^|[^\w$.])(it|test)((?:\s*\.\s*\w+)*)\s*([(`])/g;

/** JS/TS 테스트 파일에서 테스트 블록을 찾는다. [{ name, line, checked }] */
export function findJsTests(src) {
  const s = blankCode(src, 'js');
  const defs = [];
  for (const m of s.matchAll(JS_FN)) defs.push({ name: m[1] || m[2], body: s.slice(m.index, bodyEnd(s, m.index + m[0].length - 1)) });
  const helper = checkedHelpers(defs, 'js', jsAssertImports(src));
  const lineOf = lineCounter(s);
  const out = [];
  JS_TEST.lastIndex = 0;
  let m;
  while ((m = JS_TEST.exec(s))) {
    const start = m.index + m[1].length;
    if (/\bfunction\s*$/.test(s.slice(Math.max(0, start - 12), start))) continue;
    const mods = m[3].replace(/\s/g, '').split('.').filter(Boolean);
    let open = m.index + m[0].length - 1;
    if (mods.includes('each') || mods.includes('for')) {
      // test.each(table)(name, fn) · test.each`table`(name, fn)
      const close = s[open] === '`' ? s.indexOf('`', open + 1) : matchClose(s, open);
      const next = /^\s*\(/.exec(s.slice(close + 1, close + 40));
      if (!next) continue;
      open = close + next[0].length;
    } else if (s[open] !== '(') continue;
    const close = matchClose(s, open);
    JS_TEST.lastIndex = close + 1; // 테스트 안의 테스트는 따로 세지 않는다
    if (mods.includes('todo')) continue;
    const args = s.slice(open + 1, close);
    if (!/,/.test(args)) continue; // it('보류') — 본문 없음
    const name = argName(src, open + 1);
    const hasFn = /=>|\bfunction\b/.test(args);
    out.push({ name, line: lineOf(start), checked: !hasFn || hasCheck(args, 'js', [helper]) });
  }
  return out;
}

// 첫 인자(테스트 이름)를 원문에서 읽는다.
function argName(src, at) {
  const q = /^\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/.exec(src.slice(at, at + 300));
  if (q) return q[2].replace(/\s+/g, ' ').slice(0, 120);
  return src.slice(at, at + 80).split(/,|\n/)[0].trim();
}

// ── Python ──────────────────────────────────────────────────

const PY_DEF = /^([ \t]*)(?:async[ \t]+)?def[ \t]+([\p{L}\p{N}_]+)[ \t]*\(/u;

/** Python 테스트 파일에서 def test_* 를 찾는다. 본문은 들여쓰기로 자른다. */
export function findPyTests(src) {
  const lines = blankPy(src).split('\n');
  const defs = [];
  const tests = [];
  for (let k = 0; k < lines.length; k++) {
    const m = PY_DEF.exec(lines[k]);
    if (!m) continue;
    const indent = m[1].length;
    let end = k + 1;
    for (; end < lines.length; end++) {
      const t = lines[end];
      if (!t.trim()) continue;
      if (t.length - t.trimStart().length <= indent) break;
    }
    // def 줄의 나머지(한 줄 본문 `def test_x(): assert f()`)부터 본문 끝까지
    const body = `${lines[k].slice(m[0].length)}\n${lines.slice(k + 1, end).join('\n')}`;
    (m[2].startsWith('test') ? tests : defs).push({ name: m[2], line: k + 1, body });
  }
  const helper = checkedHelpers(defs, 'py');
  return tests.map((t) => ({ name: t.name, line: t.line, checked: hasCheck(t.body, 'py', [helper]) }));
}

// ── Go ──────────────────────────────────────────────────────

const GO_FN = /\bfunc\s+(?:\(\s*(\w*)\s*\*?[\w.[\]]+\s*\)\s*)?(\w+)\s*(?:\[[^\]]*\])?\(/g;

/** Go 테스트 파일에서 func Test* 를 찾는다(testify suite 메서드 포함, TestMain 제외). */
export function findGoTests(src) {
  const s = blankCode(src, 'go');
  const fns = [];
  for (const m of s.matchAll(GO_FN)) {
    const open = m.index + m[0].length - 1;
    fns.push({ recv: m[1], name: m[2], index: m.index, body: s.slice(open, bodyEnd(s, open)) });
  }
  const helper = checkedHelpers(fns.filter((f) => !/^Test/.test(f.name)), 'go');
  const lineOf = lineCounter(s);
  const out = [];
  for (const f of fns) {
    if (!/^Test/.test(f.name) || f.name === 'TestMain') continue;
    const extra = [helper];
    if (f.recv) extra.push(new RegExp(`\\b${escapeRe(f.recv)}\\.(?:${GO_SUITE})\\s*\\(`));
    out.push({ name: f.name, line: lineOf(f.index), checked: hasCheck(f.body, 'go', extra) });
  }
  return out;
}

// ── Java / Kotlin ───────────────────────────────────────────

const JVM_TEST = /@(?:[\w.]+\.)?(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b(\s*\([^)]*\))?/g;
const JVM_NEXT = /(@[\w.]+(?:\s*\([^)]*\))?)|\bfun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(`[^`\n]*`|\w+)\s*\(|\b([A-Za-z_]\w*)\s*\(/g;
const JVM_DEF = /\b(?:fun\s+(?:<[^>]*>\s*)?(\w+)|(?:void|boolean|int|long|String|[A-Z]\w*(?:<[^>]*>)?)\s+(\w+))\s*\(/g;

/** Java·Kotlin 테스트 파일에서 @Test 메서드를 찾는다. */
export function findJvmTests(src, lang = 'java') {
  const s = blankCode(src, lang);
  const ranges = [];
  for (const m of s.matchAll(JVM_TEST)) {
    JVM_NEXT.lastIndex = m.index + m[0].length;
    let n;
    while ((n = JVM_NEXT.exec(s)) && n[1]);
    if (!n) continue;
    const open = n.index + n[0].length - 1;
    ranges.push({
      name: (n[2] || n[3]).replace(/`/g, ''),
      index: m.index,
      expected: /\bexpected\b/.test(m[1] || ''), // @Test(expected = X.class)
      body: s.slice(open, bodyEnd(s, open, ';@')),
    });
  }
  const defs = [];
  for (const m of s.matchAll(JVM_DEF)) {
    const open = m.index + m[0].length - 1;
    defs.push({ name: m[1] || m[2], body: s.slice(open, bodyEnd(s, open, ';@')) });
  }
  const testNames = new Set(ranges.map((r) => r.name));
  const helper = checkedHelpers(defs.filter((d) => !testNames.has(d.name)), lang);
  const lineOf = lineCounter(s);
  return ranges.map((r) => ({ name: r.name, line: lineOf(r.index), checked: r.expected || hasCheck(r.body, lang, [helper]) }));
}

/** 언어 키와 원문으로 테스트 목록을 낸다. */
export function findTests(src, lang) {
  if (lang === 'js') return findJsTests(src);
  if (lang === 'py') return findPyTests(src);
  if (lang === 'go') return findGoTests(src);
  if (lang === 'java' || lang === 'kt') return findJvmTests(src, lang);
  return [];
}

// ── 저장소 훑기 ─────────────────────────────────────────────

function git(cwd, args) {
  return execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
}

/**
 * 저장소 하나의 테스트 함수 중 확인이 없는 것을 센다. git 저장소가 아니거나 git 이 없으면 null.
 * since(ms)를 주면 그 뒤 커밋에서 새로 생기거나 바뀐 테스트 파일만 따로 센 recent 를 더한다.
 */
export function scanTestChecks(repoRoot, { since } = {}) {
  const repo = path.resolve(repoRoot);
  let top;
  let listed;
  try {
    top = git(repo, ['rev-parse', '--show-toplevel']).trim();
    // 하위 폴더를 받았으면 그 아래만 본다. 경로는 저장소 꼭대기 기준.
    listed = git(repo, ['ls-files', '-z', '--full-name']).split('\0').filter(Boolean);
  } catch {
    return null;
  }
  const perFile = new Map(); // 경로 → { lang, tests }
  for (const rel of listed) {
    const strong = testFileLang(rel);
    const lang = strong || inTestDir(rel);
    if (!lang) continue;
    let src;
    try {
      const abs = path.join(top, rel);
      if (fs.statSync(abs).size > MAX_FILE) continue;
      src = fs.readFileSync(abs, 'utf8');
    } catch {
      continue; // 지워졌거나 하위 모듈
    }
    const tests = findTests(src, lang);
    if (!strong && !tests.length) continue; // 테스트 폴더의 도우미·자료 파일
    perFile.set(rel, { lang, tests });
  }

  const tally = (paths) => {
    const r = { files: 0, tests: 0, missing: 0, byLang: {}, examples: [] };
    for (const rel of paths) {
      const f = perFile.get(rel);
      if (!f) continue;
      const b = (r.byLang[f.lang] ||= { files: 0, tests: 0, missing: 0 });
      r.files++;
      b.files++;
      for (const t of f.tests) {
        r.tests++;
        b.tests++;
        if (t.checked) continue;
        r.missing++;
        b.missing++;
        if (r.examples.length < MAX_EXAMPLES) r.examples.push({ file: rel, line: t.line, name: t.name });
      }
    }
    return r;
  };

  const all = tally(perFile.keys());
  let recent = null;
  if (since != null) {
    try {
      const out = git(repo, ['log', `--since=${new Date(since).toISOString()}`, '--name-only', '--format=', '--', '.']);
      const changed = new Set(out.split('\n').map((x) => x.trim()).filter((x) => perFile.has(x)));
      const r = tally(changed);
      recent = { files: r.files, tests: r.tests, missing: r.missing };
    } catch {
      recent = null;
    }
  }
  return { repo, files: all.files, tests: all.tests, missing: all.missing, byLang: all.byLang, examples: all.examples, recent };
}
