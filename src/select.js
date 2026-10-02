// 기간·프로젝트로 대화를 고르고, 시작 질문에 보여 줄 프로젝트 목록을 만든다.
import fs from 'node:fs';
import path from 'node:path';
import { projectKey, projectName } from './sessions.js';
import { DAY } from './util.js';

export function sinceOf(days) {
  return Date.now() - Number(days) * DAY;
}

// 사람 메시지가 하나도 없는 대화는 자동 실행(에이전트끼리 한 일)이라 뺀다.
export function selectSessions(sessions, { since, projects }) {
  const want = projects?.length ? new Set(projects.map((p) => p.toLowerCase())) : null;
  const out = [];
  for (const s of sessions) {
    if (s.end < since) continue;
    if (want && !want.has(projectName(s.root).toLowerCase()) && !want.has(projectKey(s.root))) continue;
    const ev = s.ev.filter((e) => e.t >= since);
    if (!ev.some((e) => e.k === 'p')) continue;
    out.push({ ...s, ev });
  }
  return out;
}

export function projectList(sessions, since) {
  const m = new Map();
  for (const s of sessions) {
    if (s.end < since) continue;
    const k = projectKey(s.root);
    const p = m.get(k) || { name: projectName(s.root), root: s.root, sessions: 0, prompts: 0, last: 0, git: isGit(s.root) };
    const n = s.ev.filter((e) => e.k === 'p' && e.t >= since).length;
    if (!n) continue;
    p.sessions++;
    p.prompts += n;
    p.last = Math.max(p.last, s.end);
    m.set(k, p);
  }
  return [...m.values()].sort((a, b) => b.prompts - a.prompts);
}

export function isGit(root) {
  return !!root && fs.existsSync(path.join(root, '.git'));
}
