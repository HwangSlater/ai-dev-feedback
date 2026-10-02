// code-dependent(github.com/HwangSlater/code-dependent)에서 가져옴. 두 곳을 함께 고치게 되면 공통 패키지로 뗀다.
// Loads sessions through a per-file cache: a log file is parsed again only when its size or mtime changes.
import fs from 'node:fs';
import path from 'node:path';
import * as claudeCode from './adapters/claude-code.js';
import * as codex from './adapters/codex.js';
import { HOME, pool, readJson, sha1, writeJson } from './util.js';

// 3: 답 사건에 모델(m)을 더함 — 해결이 메시지 덕인지 모델이 바뀐 덕인지 가르기 위해.
const CACHE_VERSION = 3;
const ADAPTERS = [claudeCode, codex];

export async function loadSessions({ onProgress } = {}) {
  const dir = path.join(HOME, 'cache', 'sessions');
  const jobs = [];
  for (const adapter of ADAPTERS) {
    for (const file of adapter.listFiles()) jobs.push({ adapter, file });
  }
  let parsed = 0;
  let done = 0;
  const sessions = await pool(jobs, 6, async ({ adapter, file }) => {
    const st = fs.statSync(file);
    const key = path.join(dir, `${sha1(file)}.json`);
    const hit = readJson(key, null);
    let s;
    if (hit && hit.v === CACHE_VERSION && hit.size === st.size && hit.mtime === st.mtimeMs) {
      s = hit.s;
    } else {
      s = await adapter.parseFile(file);
      s.tool = adapter.name;
      writeJson(key, { v: CACHE_VERSION, size: st.size, mtime: st.mtimeMs, s });
      parsed++;
    }
    onProgress?.(++done, jobs.length);
    return s;
  });
  // Resumed sessions copy earlier history into the new file; keep each event once.
  const seen = new Set();
  for (const s of sessions.sort((a, b) => a.start - b.start)) {
    s.ev = s.ev.filter((e) => {
      const fp = `${e.t}|${e.k}|${e.n || ''}|${(e.g || e.x || '').slice(0, 60)}`;
      if (seen.has(fp)) return false;
      seen.add(fp);
      return true;
    });
    s.start = s.ev[0]?.t || 0;
  }
  const live = sessions.filter((s) => s.ev.length);
  for (const s of live) s.root = projectRoot(s.cwd);
  return { sessions: live, parsed, total: jobs.length };
}

const roots = new Map();

// Nearest ancestor with .git, so a session started in app/mobile counts toward app.
export function projectRoot(cwd) {
  if (!cwd) return '';
  if (roots.has(cwd)) return roots.get(cwd);
  let dir = cwd;
  let root = cwd;
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      root = dir;
      break;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  const home = process.env.USERPROFILE || process.env.HOME || '';
  // A home directory under git (dotfiles) is not a project.
  if (home && projectKey(root) === projectKey(home) && projectKey(cwd) !== projectKey(home)) root = cwd;
  roots.set(cwd, root);
  return root;
}

export function projectKey(cwd) {
  return (cwd || '?').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function projectName(cwd) {
  if (!cwd) return '?';
  const norm = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  const home = (process.env.USERPROFILE || process.env.HOME || '').replace(/\\/g, '/');
  if (home && norm.toLowerCase() === home.toLowerCase()) return '~';
  return norm.split('/').pop();
}
