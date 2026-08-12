/**
 * Gemini로 한국어 산문 초고를 생성하는 CLI입니다.
 *
 * 시스템 프롬프트에 문체 규약을 전달하여 번역투 교정과 문체 통일을 함께 수행합니다.
 * 생성된 결과는 초고이므로 파일 경로, 숫자, 동작 설명이 원본과 일치하는지 확인해야 합니다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = '~google/gemini-flash-latest';
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const HERE = dirname(fileURLToPath(import.meta.url));
const BANNED = /[—–]/;

const readStdin = async (): Promise<string> => {
  if (process.stdin.isTTY) return '';
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  return input;
};

const styleGuide = (): string => {
  const repositoryStyle = join(process.cwd(), 'docs/korean-style.md');
  const bundledStyle = join(HERE, '../references/style.md');
  return readFileSync(existsSync(repositoryStyle) ? repositoryStyle : bundledStyle, 'utf8');
};

const apiKey = (): string => {
  try {
    process.loadEnvFile(join(process.cwd(), '.env.local'));
  } catch {
    // 환경변수를 직접 설정한 경우에는 .env.local 파일이 필요 없습니다.
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error(
      'OPENROUTER_API_KEY를 찾을 수 없어요. 환경변수나 현재 디렉터리의 .env.local 파일에 키를 설정해 주세요.',
    );
    process.exit(1);
  }
  return key;
};

const systemPrompt = (medium: string): string =>
  [
    '당신은 10년 차 IT 서비스 수석 UX 라이터이자 한국어 원어민 카피라이터입니다.',
    '입력된 텍스트나 로직에서 기계적인 번역투와 어색한 표현을 없애고 자연스러운 한국어로 교정해 주세요.',
    '',
    '다음 원칙을 반드시 지켜 주세요.',
    '1. 출력 매체와 독자에 맞는 어미를 선택하고, 한 문서 안에서 섞지 마세요.',
    '2. 사용자에게 행동을 요청할 때는 직역한 명령투를 피하고 배려하는 표현을 사용하세요.',
    '3. 영어식 무생물 주어와 수동태를 피하고, 상황과 감정을 능동적인 문장으로 자연스럽게 풀어 쓰세요.',
    '4. 불필요한 대명사와 접속사를 생략하고 군더더기 없는 문장을 작성하세요.',
    '5. UI 문구는 명확하고 간결하게 작성하고, 기술 문서는 결정의 이유와 근거를 남겨 주세요.',
    '6. 입력과 참고 자료에 없는 사실, 수치, 출처, 평가를 만들지 마세요. 정보가 부족하면 추측하지 말고 생략하세요.',
    '7. 대상의 의미를 과장하거나 홍보성 수식어를 붙이지 말고, 구체적인 사실만 전달하세요.',
    '8. 출처가 불분명한 주체를 내세우거나 문장 끝에 내용 없는 요약구를 덧붙이지 마세요.',
    '9. 요청하지 않은 전망, 도전 과제, 결론을 추가하지 마세요.',
    '10. 상투적인 병렬 구조, 기계적인 세 항목 나열, 과도한 볼드체와 기호를 피하세요.',
    '',
    `[출력 매체]: ${medium}`,
    '',
    '아래 문체 규약을 반드시 지켜 주세요. em-dash와 en-dash는 사용하지 말고 공백 하이픈, 쉼표, 콜론으로 바꾸세요.',
    '설명이나 머리말 없이 요청한 결과물만 출력해 주세요.',
    '',
    '---',
    '',
    styleGuide(),
  ].join('\n');

const complete = async (key: string, system: string, user: string): Promise<string> => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }

  const payload: unknown = await response.json();
  const text = (payload as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message
    ?.content;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('응답 본문이 비어 있어요. 다시 시도해 주세요.');
  }
  return text.trim();
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const mediumAt = argv.indexOf('--medium');
  const medium = mediumAt === -1 ? '내부 개발 문서' : (argv[mediumAt + 1] ?? '내부 개발 문서');
  const task = (mediumAt === -1 ? argv : [...argv.slice(0, mediumAt), ...argv.slice(mediumAt + 2)])
    .join(' ')
    .trim();

  if (!task) {
    console.error('작성할 내용을 인자로 입력해 주세요.');
    process.exit(1);
  }

  const context = await readStdin();
  const user = context.trim() ? `${task}\n\n참고 자료:\n\n${context.trim()}` : task;
  const key = apiKey();
  const system = systemPrompt(medium);
  let draft = await complete(key, system, user);

  if (BANNED.test(draft)) {
    draft = await complete(
      key,
      system,
      `${user}\n\n작성한 초고에 금지된 줄표가 포함되어 있습니다. 줄표를 공백 하이픈이나 쉼표로 바꿔 다시 작성해 주세요.`,
    );
  }
  if (BANNED.test(draft)) {
    console.error(
      '생성된 초고에 금지된 줄표가 남아 있어요. 문체 규약 위반으로 결과를 출력하지 않을게요.',
    );
    process.exit(1);
  }

  process.stdout.write(`${draft}\n`);
};

await main();
