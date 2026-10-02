// 정답 붙이기 결과로 피드백별 정확도를 계산해 docs/accuracy.json 과 docs/accuracy.md 에 남긴다.
// 쓰는 법: node scripts/score-labels.mjs [label-answers.json 경로 = ~/Downloads/label-answers.json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOME, readJson } from '../src/util.js';

const file = process.argv[2] || path.join(os.homedir(), 'Downloads', 'label-answers.json');
const fresh = readJson(file, {}).answers;
const { items, days, carried = {} } = readJson(path.join(HOME, 'label-items.json'), {});
// 이전 판정을 다시 쓴 것 + 이번에 새로 판정한 것
const answers = fresh && { ...carried, ...fresh };
if (!answers || !items) throw new Error(`결과(${file})나 항목(label-items.json)이 없어요.`);

const DOCS = new URL('../docs/', import.meta.url);
const accFile = new URL('accuracy.json', DOCS);
const acc = readJson(accFile, {});
const today = new Date().toISOString().slice(0, 10);

// 리포트의 피드백 이름 ← 정답 붙이기 항목 종류
const KINDS = { guessLoop: ['guessLoop'], repeatRule: ['ruleMessage'], repeatRuleSource: ['ruleSource'] };
const rows = [];
const wrong = [];
for (const [name, kinds] of Object.entries(KINDS)) {
  const list = items.filter((it) => kinds.includes(it.kind));
  const yes = list.filter((it) => answers[it.id]?.a === 'yes').length;
  const no = list.filter((it) => answers[it.id]?.a === 'no').length;
  const skip = list.length - yes - no;
  const accuracy = yes + no ? yes / (yes + no) : null;
  acc[name] = { accuracy, judged: yes + no, skipped: skip, date: today, by: 'user', days };
  rows.push(`| ${name} | ${yes + no} | ${yes} | ${no} | ${skip} | ${accuracy == null ? '–' : `${Math.round(accuracy * 100)}%`} |`);
  for (const it of list) if (answers[it.id]?.a === 'no') wrong.push(`- ${name}: ${it.rule ? `「${it.rule}」 ` : ''}${answers[it.id].note ? `— ${answers[it.id].note}` : ''}`);
}
// 규칙 파일 대조가 틀리면 「규칙이 있는데도」 문장이 틀리므로, 같은 부탁 반복의 정확도는 둘 중 낮은 쪽으로 본다.
if (acc.repeatRuleSource?.accuracy != null && acc.repeatRule?.accuracy != null) acc.repeatRule.accuracy = Math.min(acc.repeatRule.accuracy, acc.repeatRuleSource.accuracy);

fs.writeFileSync(accFile, `${JSON.stringify(acc, null, 2)}\n`);
const md = new URL('accuracy.md', DOCS);
const head = fs.existsSync(md) ? fs.readFileSync(md, 'utf8') : '# 정확도\n\n피드백마다 사람이 정답을 붙여 잰 「맞는 비율」. 80% 를 넘어야 리포트에 나온다(`--preview` 제외). 「모르겠다」는 계산에서 뺀다.\n';
const section = `\n## ${today} (최근 ${days}일 기록, 사람 판정)\n\n| 피드백 | 판정 | 맞다 | 아니다 | 모르겠다 | 맞는 비율 |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n${wrong.length ? `\n틀렸다고 한 것:\n${wrong.join('\n')}\n` : ''}`;
fs.writeFileSync(md, head + section);
console.log(section);
