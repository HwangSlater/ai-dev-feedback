// 리포트에 나가는 고정 문장과 출처. 「왜」와 「이렇게 해 보세요」는 여기서만 나온다(그때그때 지어내지 않는다).
// 출처는 docs/evidence.md 에서 원문 대조(✔)한 것만. 문장을 고치면 원문 뜻을 넘지 않았는지 다시 본다.

export const SOURCES = {
  cc: { title: 'Anthropic, Claude Code Best practices', url: 'https://code.claude.com/docs/en/best-practices', date: '2026-10 열람' },
  cursor: { title: 'Cursor, Best practices for coding with agents', url: 'https://cursor.com/blog/agent-best-practices', date: '2026-01-09' },
  stripe: { title: 'Stripe, Minions', url: 'https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents', date: '2026-02-09' },
  kakao: { title: '카카오, AI 협업을 위한 개발 환경과 평가 시스템', url: 'https://tech.kakao.com/posts/753', date: '2025-09-19' },
  shen: { title: 'Shen & Tamkin, How AI Impacts Skill Formation', url: 'https://arxiv.org/abs/2601.20245', date: '2026-01', note: '52명 무작위 실험, GPT-4o 기반 채팅 보조' },
  kurly: { title: '컬리, Claude Code를 활용한 예측 가능한 바이브 코딩 전략', url: 'https://helloworld.kurly.com/blog/vibe-coding-with-claude-code/', date: '2025-12-17' },
  woowa: { title: '우아한형제들, 문서로만 지키던 아키텍처 규칙, 테스트 코드로 강제하기', url: 'https://techblog.woowahan.com/26835/', date: '2026-09-07' },
  bockeler: { title: 'Böckeler (Thoughtworks), Harness engineering', url: 'https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html', date: '2026-04-02' },
  banik: { title: 'Banik 외, All Smoke, No Alarm', url: 'https://arxiv.org/abs/2606.18168', date: '2026-06', note: '에이전트 PR 33,596개' },
  gollwitzer: { title: 'Gollwitzer & Sheeran, Implementation intentions and goal achievement', url: 'https://kops.uni-konstanz.de/entities/publication/2e749bfb-8533-437c-8203-7e788c910c5f', date: '2006', note: '연구 94개(8,461명) 메타분석, d=0.65' },
};

// 각 근거는 [출처 열쇠, 문장]. 문장은 원문 뜻을 넘지 않게.
export const FEEDBACK = {
  // C2
  guessLoop: {
    title: '같은 증상에 「고쳐 줘」만 반복해요',
    why: '같은 실패를 계속 고치게 하면, 실패한 시도가 대화에 쌓여 에이전트도 같은 틀에서 맴돌아요. 그래서 도구를 만든 회사와 큰 개발 조직들이 같은 선을 긋고 있어요.',
    evidence: [
      ['cc', 'Claude Code 공식 지침: 같은 문제로 <b>두 번 넘게</b> 바로잡았다면 대화가 실패한 시도로 가득 찬 상태다. 대화를 비우고, 배운 것을 담아 더 구체적인 요청으로 새로 시작하라. 「깨끗한 대화와 더 나은 요청이 바로잡기를 쌓아 온 긴 대화보다 거의 항상 낫다」'],
      ['cursor', 'Cursor 공식 지침: 결과가 틀리면 변경을 되돌리고, 계획을 더 구체적으로 고쳐 다시 돌려라. 진행 중인 에이전트를 고치는 것보다 대개 빠르고 결과도 깨끗하다'],
      ['stripe', 'Stripe: 에이전트에게 CI 는 <b>최대 두 번까지만</b> 돌리게 한다. 그 이상 돌려도 얻는 것이 점점 줄어든다'],
      ['kakao', '카카오: 배포 환경 로그인 장애에서 「AI는 단일 문제에 매몰되어 해결책을 찾지 못했으며, 결국 개발자가 로그 분석과 코드 리뷰를 통해 근본 원인을 파악하고 해결했습니다」'],
      ['shen', 'Anthropic 실험: AI 를 쓴 집단과 안 쓴 집단의 차이가 <b>디버깅 문제에서 가장 컸다</b>. AI 없이 한 쪽은 오류를 더 많이 겪으며 디버깅 실력이 늘었다(52명, 채팅형 AI)'],
    ],
    trySay: '아직 고치지 마. 지금 증상의 원인 가설 3개와, 각각이 맞는지 확인할 방법(로그·화면에 띄울 값·재현 순서)을 먼저 줘.',
    tryNote: '그리고 증상을 보고할 때는 네 가지를 넣어 주세요: 어디서 · 기대한 것 · 실제로 본 것 · 어디서는 괜찮은지.',
    check: ['다음에 「여전히 안 돼」를 쓰려는 순간, 지금이 몇 번째인지 세어 보셨나요?', '마지막 보고에 「어디서는 괜찮은지」가 들어 있었나요?'],
    promise: '같은 증상으로 두 번 실패하면, 세 번째는 고쳐 달라고 하지 않고 원인 가설과 확인 방법부터 받는다.',
    // 규칙 파일에 이런 말이 있으면 「내 규칙과도 같아요」로 인용한다.
    ownRule: /(같은|동일한) ?(시도|실패|수정).{0,20}(세|3|두|2) ?번|반복하지 않는다|계측을 붙여/,
  },
  // C12 · C13
  repeatRule: {
    title: '여러 번 말한 규칙이 또 어겨져요',
    titleNoRule: '같은 부탁을 여러 대화에서 되풀이해요',
    why: '글로 적은 규칙은 「부탁」이라서, 대화가 길어지거나 규칙 파일이 길어지면 묻혀요. 반복되는 지적이 있다면 그건 기억이 아니라 <b>자동으로 확인되는 장치</b>로 옮길 때라는 신호예요.',
    whyNoRule: '같은 부탁을 대화마다 다시 하면, 에이전트는 새 대화를 열 때마다 그것을 모르는 상태로 시작해요. 늘 지켜야 하는 것은 규칙 파일에 한 번 적고, 예외 없이 지켜야 하면 자동 검사로 옮기는 게 좋아요.',
    evidence: [
      ['cc', 'Claude Code 공식 지침: 「규칙이 있는데도 Claude 가 계속 원치 않는 일을 한다면, 파일이 너무 길어 규칙이 묻히고 있을 가능성이 크다」. 규칙 파일(CLAUDE.md)은 권고이고 훅은 반드시 실행되니, 예외 없이 지켜야 할 것은 훅으로 옮겨라'],
      ['kurly', '컬리: 「Redux 금지」라고 한 뒤 15턴째에 Redux 로 돌아갔다. 대화가 길어질수록 처음 지시가 흐려진다'],
      ['woowa', '우아한형제들: 문서로만 지키던 규칙을 테스트로 옮겨 머지 전에 자동으로 막았다. 기존 위반은 묶어 두고 새 위반만 막았고, 그 뒤 새 위반은 0건. 규칙을 테스트로 옮기는 일도 AI 에이전트에게 맡겼다'],
      ['bockeler', 'Thoughtworks: 에이전트는 미리 방향을 주는 규칙과, 결과를 자동으로 확인하는 검사(테스트·린트 등)로 함께 둘러싸야 한다'],
    ],
    trySay: (rule) => `「${rule}」를 내가 계속 말하고 있어. 이걸 지키지 않으면 멈추거나 다시 하게 하는 자동 검사를 만들어 줘.`,
    trySayNoRule: (rule) => `「${rule}」를 늘 지켜야 할 규칙으로 규칙 파일에 한 줄로 적어 줘.`,
    check: ['이번 주에 두 번 이상 한 지적이 있었나요? 그건 어디에 적혀 있고, 무엇이 확인해 주고 있나요?'],
    promise: '같은 부탁을 두 번째로 하게 되면, 세 번째 전에 규칙 파일이나 자동 검사로 옮긴다.',
  },
  // C5 — 잘하는 것으로도, 바꿀 것으로도 쓴다
  testChecks: {
    goodTitle: '테스트에 기대값 확인을 꼭 넣어요',
    goodWhy: (r) => `${r.repos} 의 테스트 ${r.tests.toLocaleString()}개 중 결과를 확인하지 않고 「오류가 안 나는지」만 보는 테스트는 ${r.missing}개(${r.pct}%)뿐이에요. 에이전트가 쓴 테스트는 80% 가 이 확인이 약하거나 없다는 조사가 있어요. 돌아가기만 하고 아무것도 검사하지 않는 테스트가 거의 없다는 뜻이에요.`,
    title: '결과를 확인하지 않는 테스트가 많아요',
    why: '테스트가 코드를 실행만 하고 결과를 확인하지 않으면, 틀린 코드도 통과해요. 에이전트가 쓴 테스트에서 특히 흔해요.',
    evidence: [['banik', '에이전트 PR 33,596개를 본 연구: 에이전트가 쓴 테스트 패치의 80.2% 가 결과 확인이 약하거나 없었다. 확인이 강한 테스트는 병합될 가능성이 더 높았다']],
    trySay: '이 기능의 테스트를 쓰기 전에, 실패해야 하는 경우를 먼저 적어 줘. 테스트를 쓴 뒤에는 일부러 코드를 틀리게 바꿔서 테스트가 실패하는지 보여 줘.',
    check: ['마지막으로 받은 테스트에서, 코드를 틀리게 바꾸면 실패하는 테스트가 몇 개였나요?'],
    promise: '에이전트가 테스트를 쓰면, 받아들이기 전에 일부러 깨 봐서 실패하는지 한 번 본다.',
    goodSource: 'banik',
  },
  // C14
  secrets: {
    title: '비밀값을 대화창에 붙여 넣었어요',
    why: '대화창에 붙인 값은 내 컴퓨터의 대화 기록 파일에 그대로 남고, AI 서비스로도 전송돼요. 키를 바꾸지 않는 한 되돌릴 수 없어요.',
    trySay: '키는 .env 같은 파일이나 환경 변수에 넣었어. 이름은 ○○_API_KEY 야. 값은 묻지 말고 이 이름으로 읽어 줘.',
    action: '이미 붙여 넣은 키는 새로 발급받아 바꾸는 것이 안전해요.',
  },
};

// 아직 재지 못하는 것 — 「다음 달부터 함께 볼 것」
export const LATER = [
  '에이전트가 「끝났다」고 한 뒤 실제로는 안 된 일이 얼마나 있었는지',
  '처음 쓰는 기술을 다룰 때 설명을 구했는지, 결과만 받았는지',
  '에이전트가 쓴 코드 중 얼마가 버려지거나 곧 다시 고쳐졌는지',
];
