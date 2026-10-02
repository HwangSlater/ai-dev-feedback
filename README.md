<div align="center">

# ai-dev-feedback

### AI와 개발하는 방식에, 바로 써먹을 수 있는 피드백을

내 Claude Code·Codex 대화 기록으로 한 달을 돌아봐요.<br>
어디서 시간이 샜는지, 무엇을 바꾸면 좋을지, 왜 그런지(출처와 함께), 다음 달엔 무엇을 해 볼지.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-d97757.svg)](#claude-code)
[![Codex](https://img.shields.io/badge/Codex-supported-111.svg)](#codex)
![Report](https://img.shields.io/badge/report-KO%20%C2%B7%20EN-7b61ff.svg)
[![Local first](https://img.shields.io/badge/data-stays%20local-555.svg)](#내-데이터는-내-컴퓨터에)

**한국어** · [English](README.en.md)

<img src="docs/images/report-ko.png" alt="ai-dev-feedback 리포트 (지어낸 예시)" width="640">

<sub>그림은 지어낸 데이터로 만든 예시예요(`npm run demo`).</sub>

</div>

---

## 왜 만들었나

이제 코드는 AI 에이전트가 써요. 그래도 얼마나 빨리 원하는 곳에 닿는지는 내가 에이전트와 어떻게 일하느냐에 달려 있어요. 일을 어떻게 맡기는지, 끝났다는 걸 무엇으로 아는지, 막혔을 때 무엇을 하는지.

이런 걸 보여 주는 도구는 대개 점수나 성향을 붙여 줘요. 그런데 피드백 연구를 보면 그런 피드백은 행동을 잘 바꾸지 못해요. 도움이 되는 건 구체적인 행동, 그게 왜 중요한지, 그리고 다음에 할 일이에요. **ai-dev-feedback** 은 이미 나눈 대화를 읽고 바로 그것을 써 줘요.

리포트를 읽고 나면 네 가지에 스스로 답할 수 있게 하는 게 목표예요.

1. 나는 지금 어떻게 개발하고 있나
2. 무엇을 바꾸면 좋을까
3. 왜 그런가 — 원문과 대조한 출처만 써요
4. 앞으로 어떻게 할까 — 그대로 보낼 문장과, 다음 달 「[상황]이면 [행동]」 한 줄

점수·순위·연속 기록·속도 숫자는 없고, 다른 사람과 비교하지 않아요.

## 지금 보는 것 (v0.1)

| 피드백 | 필요한 것 |
| --- | --- |
| 같은 증상에 원인 짐작 없이 「고쳐 줘」만 반복 | AI 분류 |
| 같은 부탁을 여러 대화에서 되풀이 — 규칙으로 적은 뒤에도 | AI 분류 |
| 실행만 하고 결과를 확인하지 않는 테스트 | git |
| 비밀값을 대화창에 붙여 넣음 | — |

사람이 판정한 정답과 비교해 맞는 비율이 80% 를 넘은 피드백만 리포트에 나와요([docs/accuracy.md](docs/accuracy.md)). 도구나 모델에 따라 뒤집히는 조언은 빼고, 어디서나 통하는 것만 써요([docs/evidence.md](docs/evidence.md)).

「고쳐 줘」가 길게 이어진 구간은 시간순 기록과, 마침내 풀린 메시지, 그때 모델이 바뀌었는지까지 보여 줘요. 모델이 바뀌었다면 기록만으로는 무엇 덕분인지 가를 수 없으니 그렇다고 밝혀요.

## 바로 쓰기

```bash
npx github:HwangSlater/ai-dev-feedback
```

질문 다섯 개(기간, 프로젝트, git 을 읽을지, AI 분류를 쓸지, 특히 보고 싶은 것)에 답하면 리포트가 브라우저로 열려요. 다음 달에는 `--yes` 로 지난번 답 그대로 돌릴 수 있어요.

## AI 도구에서 쓰기

### Claude Code

```
/plugin marketplace add HwangSlater/ai-dev-feedback
/plugin install ai-dev-feedback@ai-dev-feedback
```

그다음 이렇게 부탁하세요: `내 AI 개발 습관 돌아봐줘`

### Codex

```
`npx -y github:HwangSlater/ai-dev-feedback --yes` 실행하고 요약 보여줘
```

### 그냥 터미널에서

```bash
npx github:HwangSlater/ai-dev-feedback              # 무엇을 볼지 물어봐요
npx github:HwangSlater/ai-dev-feedback --yes        # 지난번과 같이
npx github:HwangSlater/ai-dev-feedback --no-ai      # 아무것도 밖으로 보내지 않아요
npx github:HwangSlater/ai-dev-feedback scan --json  # 볼 수 있는 기록과 예상 비용만
```

AI 분류는 로그인된 `claude` 나 `codex` CLI, 또는 `ANTHROPIC_API_KEY` 로 돌아가요. 분류 결과는 저장해 두고 다음부턴 새 메시지만 분류해요. [code-dependent](https://github.com/HwangSlater/code-dependent) 를 써 봤다면 그 분류도 그대로 써요.

## 내 데이터는 내 컴퓨터에

| 읽는 것 | 어디서 |
| --- | --- |
| 에이전트 대화 기록 | `~/.claude/projects`, `~/.codex/sessions` |
| git 기록·테스트 파일 | 그 대화가 있었던 프로젝트 폴더 (예라고 했을 때만) |
| 규칙 파일 | 그 프로젝트의 `CLAUDE.md`·`AGENTS.md`, `~/.claude` 의 메모리 파일 |

모든 분석은 내 컴퓨터에서 하고 `~/.ai-dev-feedback/` 에만 남아요. AI 분류를 켜면 **내가 쓴 메시지의 짧은 조각**만 보내고, 그 전에 키·토큰·이메일·전화번호를 가려요. 대화 원문, 에이전트의 답, 명령 출력, 코드는 보내지 않아요. `--no-ai` 면 아무것도 나가지 않아요.

## 지금 상태

초기 판이에요. 리포트와 질문은 한국어와 영어로 나와요(`--lang ko|en`, 처음엔 시스템 언어를 따라요). 정확도는 만든 사람의 기록으로 재고, 틀린 것을 보고 같은 기록으로 고쳤기 때문에 새 기록으로 확인하기 전까지는 개발용 값으로 봐 주세요([docs/accuracy.md](docs/accuracy.md)). 다음은 대화와 커밋을 이어 보는 피드백(끝났다고 했는데 안 된 것, 통과시키려고 고친 테스트)과 작업 하나 돌아보기예요.

## 라이선스

[MIT](LICENSE) © [HwangSlater](https://github.com/HwangSlater)
