// code-dependent(github.com/HwangSlater/code-dependent)에서 가져옴. 두 곳을 함께 고치게 되면 공통 패키지로 뗀다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = process.env.AI_DEV_FEEDBACK_HOME || path.join(os.homedir(), '.ai-dev-feedback');
export const DAY = 86_400_000;

export function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

// Run async fn over items with at most `limit` in flight.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// Collapse whitespace and keep the head and tail of long text.
export function clip(text, head, tail = 0) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= head + tail + 3) return t;
  return tail ? `${t.slice(0, head)} … ${t.slice(-tail)}` : `${t.slice(0, head)}…`;
}

// Strip things that look like secrets or personal data before text leaves the machine.
const MASKS = [
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, '[KEY]'],
  [/\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{16,}/g, '[KEY]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[KEY]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[KEY]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[KEY]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[KEY]'],
  [/(https?:\/\/)[0-9a-f]{32}@/gi, '$1[KEY]@'],
  [/\b(api[_-]?key|secret|token|passwd|password|client[_-]?secret|access[_-]?key)(\s*[:=]\s*['"]?)[A-Za-z0-9_\-./+]{12,}/gi, '$1$2[KEY]'],
  // Keys handed over bare ("토큰 줄게. abc123…") or sent alone; same rules as hasSecret in collab.js.
  [/((?:api\s?key|access\s?key|secret|token|api\s?키|(?<![가-힣])키(?=[는가를값:=\s])|토큰|시크릿|비밀번호|password)[^A-Za-z0-9\n]{0,15})(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{20,80}/gi, '$1[KEY]'],
  [/^\s*(?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])(?![0-9a-f]{40}\s*$)[A-Za-z0-9-]{24,80}\s*$/g, '[KEY]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[TOKEN]'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL]'],
  [/\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/g, '[PHONE]'],
  [/\b[A-Fa-f0-9]{32,}\b/g, '[HEX]'],
  [/\b[A-Za-z0-9+/]{40,}={0,2}/g, '[BLOB]'],
];

export function mask(text) {
  let t = text;
  for (const [re, rep] of MASKS) t = t.replace(re, rep);
  return t;
}

// Token count estimate, measured against Claude's tokenizer (docs/COSTS.md): about 1.5 tokens per Hangul/CJK
// character and 3.7 other characters per token.
export function estimateTokens(text) {
  let cjk = 0;
  for (const ch of text) if (/[ᄀ-ᇿ぀-ヿ㄰-㆏一-鿿가-힯]/.test(ch)) cjk++;
  return Math.ceil(cjk * 1.5 + (text.length - cjk) / 3.7);
}

export function fmtHours(ms, lang) {
  const h = ms / 3_600_000;
  if (h < 1) {
    const m = Math.max(1, Math.round(ms / 60_000));
    return { ko: `약 ${m}분`, ja: `約 ${m} 分`, zh: `约 ${m} 分钟` }[lang] || `~${m}m`;
  }
  const v = h < 10 ? Math.round(h * 2) / 2 : Math.round(h);
  return { ko: `약 ${v}시간`, ja: `約 ${v} 時間`, zh: `约 ${v} 小时` }[lang] || `~${v}h`;
}

export function fmtNum(n) {
  return n.toLocaleString('en-US');
}
