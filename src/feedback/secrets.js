// C14: 비밀값으로 보이는 것을 대화창에 붙여 넣은 메시지. 수와 날짜·프로젝트만 남기고 내용은 어디에도 보이지 않는다.
import { hasSecret } from '../collab.js';
import { projectName } from '../sessions.js';

export function findSecrets(sessions) {
  const hits = [];
  for (const s of sessions) {
    for (const e of s.ev) if (e.k === 'p' && hasSecret(e.x)) hits.push({ t: e.t, project: projectName(s.root) });
  }
  hits.sort((a, b) => a.t - b.t);
  return { count: hits.length, hits };
}
