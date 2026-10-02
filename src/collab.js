// code-dependent(github.com/HwangSlater/code-dependent)에서 가져옴. 두 곳을 함께 고치게 되면 공통 패키지로 뗀다.
// Habits read straight from the prompt text and the AI labels, with no extra AI call:
// fix requests that repeat without a guess at the cause, messages sent again, and secrets pasted into the chat.
// (code-dependent 의 「정할 때 이유를 붙였나」는 근거가 없어 뺐다 — docs/evidence.md 5절)

// Things that are secrets on their own. Commit hashes and plain long hex are left out: too many false alarms.
export const SECRETS = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/,
  /\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /https?:\/\/[0-9a-f]{32}@[\w.-]+/i,
  /\b(api[_-]?key|secret|token|passwd|password|client[_-]?secret|access[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+]{12,}/i,
];

// Keys pasted bare, the way people actually hand them over: "토큰 줄게. abc123…", "api key: …", or the key alone.
// IDs ("Submission ID …", "request id …") don't match: a letter between the word and the value breaks the link.
// "키" counts only as a word of its own ("키는", "키: …"), so 스키마 or 키워드 don't. Values with "_" are names, not keys.
export const NEAR_KEY = /(api\s?key|access\s?key|secret|token|api\s?키|(?<![가-힣])키(?=[는가를값:=\s])|토큰|시크릿|비밀번호|password)[^A-Za-z0-9\n]{0,15}(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{20,80}/i;
const ALONE = /^(?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9-]{24,80}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;

export function hasSecret(text) {
  const t = text.trim();
  return SECRETS.some((re) => re.test(text)) || NEAR_KEY.test(text) || (ALONE.test(t) && !GIT_SHA.test(t));
}

const RESEND_MS = 10 * 60_000;
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// The same message again, or the whole previous message sent again with more added, shortly after.
// A shared opening alone is not enough: pasted pages often start with the same header.
export function isResend(prev, cur) {
  if (!prev || cur.t - prev.t > RESEND_MS) return false;
  const a = norm(prev.x);
  const b = norm(cur.x);
  if (b.length < 15 || a.length < 15) return false;
  return b.startsWith(a);
}

// Fix requests in a row with no guess at the cause and no "why" in between.
export const GUESS_MIN = 3;
const GUESS_GAP_MS = 30 * 60_000;

export function guessStreaks(items) {
  const out = [];
  let cur = null;
  const close = () => {
    if (cur && cur.n >= GUESS_MIN) out.push(cur);
    cur = null;
  };
  for (const { p, lab } of items) {
    if (cur && p.t - cur.end > GUESS_GAP_MS) close();
    if (lab.intent === 'fix' && !lab.sig.has('hypothesis')) {
      if (!cur) cur = { start: p.t, end: p.t, n: 0, first: p };
      cur.n++;
      cur.end = p.t;
    } else if (lab.intent === 'fix' || lab.intent === 'why' || lab.intent === 'build' || lab.intent === 'discuss' || lab.intent === 'verify') {
      // A guess, a question or a new direction ends the streak. "Still broken" (inform/go) does not.
      close();
    }
  }
  close();
  return out;
}
