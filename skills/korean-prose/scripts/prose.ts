/**
 * Gemini로 한국어 산문 초고를 생성하는 CLI입니다.
 *
 * 시스템 프롬프트에 문체 규약을 전달하여 번역투 교정과 문체 통일을 함께 수행합니다.
 * 생성된 결과는 초고이므로 파일 경로, 숫자, 동작 설명이 원본과 일치하는지 확인해야 합니다.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export type Provider = 'openrouter' | 'google-ai-studio' | 'antigravity';

export interface Options {
  provider: Provider;
  model: string;
  medium: string;
  task: string;
  help: boolean;
  acceptAntigravityRisk: boolean;
}

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const GOOGLE_AI_STUDIO_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODELS: Record<Provider, string> = {
  openrouter: '~google/gemini-flash-latest',
  'google-ai-studio': 'gemini-3.5-flash-lite',
  antigravity: 'gemini-3.6-flash-low',
};
const HERE = dirname(fileURLToPath(import.meta.url));
const BANNED = /[—–]/;
const execFileAsync = promisify(execFile);

const USAGE = `사용법:
  node prose.ts [--provider <제공자>] [--model <모델>] [--medium <매체>]
    [--accept-antigravity-risk] <작성 요청>

제공자:
  openrouter         OPENROUTER_API_KEY로 OpenRouter를 호출합니다. (기본값)
  google-ai-studio   GEMINI_API_KEY로 Gemini API를 직접 호출합니다.
  antigravity        로그인된 Antigravity CLI(agy)를 호출합니다.

환경변수:
  KOREAN_PROSE_PROVIDER   기본 제공자를 지정합니다.
  KOREAN_PROSE_MODEL      기본 모델을 지정합니다.
  ANTIGRAVITY_CLI_PATH    agy 실행 파일 경로를 지정합니다.

Antigravity 주의:
  Antigravity 추가 약관상 제3자 도구 연동으로 해석될 위험이 있습니다. 작성 요청, 참고 자료,
  문체 규약이 Google에 전송되며 상호작용이 저장되거나 검토될 수 있습니다. 위험을 확인하고
  이번 실행에 동의한 경우에만 --accept-antigravity-risk를 지정하세요. 이 동의는 저장되지
  않으며 Antigravity를 실행할 때마다 다시 지정해야 합니다.
  약관: https://antigravity.google/terms`;

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

const loadLocalEnvironment = (): void => {
  try {
    process.loadEnvFile(join(process.cwd(), '.env.local'));
  } catch {
    // 환경변수를 직접 설정한 경우에는 .env.local 파일이 필요 없습니다.
  }
};

const providerFrom = (value: string | undefined): Provider => {
  const normalized = value?.trim().toLowerCase() || 'openrouter';
  if (normalized === 'openrouter') return 'openrouter';
  if (['google', 'google-ai-studio', 'ai-studio', 'gemini-api'].includes(normalized)) {
    return 'google-ai-studio';
  }
  if (normalized === 'antigravity') return 'antigravity';
  throw new Error(
    `지원하지 않는 제공자예요: ${value}. openrouter, google-ai-studio, antigravity 중 하나를 사용해 주세요.`,
  );
};

export const parseArguments = (
  argv: string[],
  environment: NodeJS.ProcessEnv = process.env,
): Options => {
  let providerValue = environment.KOREAN_PROSE_PROVIDER;
  let modelValue = environment.KOREAN_PROSE_MODEL;
  let medium = '내부 개발 문서';
  let help = false;
  let acceptAntigravityRisk = false;
  const taskParts: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--accept-antigravity-risk') {
      acceptAntigravityRisk = true;
      continue;
    }
    if (argument === '--provider' || argument === '--model' || argument === '--medium') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} 다음에 값을 입력해 주세요.`);
      }
      if (argument === '--provider') providerValue = value;
      if (argument === '--model') modelValue = value;
      if (argument === '--medium') medium = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--')) throw new Error(`지원하지 않는 옵션이에요: ${argument}`);
    taskParts.push(argument);
  }

  const provider = providerFrom(providerValue);
  return {
    provider,
    model: modelValue?.trim() || DEFAULT_MODELS[provider],
    medium,
    task: taskParts.join(' ').trim(),
    help,
    acceptAntigravityRisk,
  };
};

const apiKeyFor = (provider: Exclude<Provider, 'antigravity'>): string => {
  const variable = provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'GEMINI_API_KEY';
  const key = process.env[variable];
  if (!key) {
    throw new Error(
      `${variable}를 찾을 수 없어요. 환경변수나 현재 디렉터리의 .env.local 파일에 키를 설정해 주세요.`,
    );
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

const responseText = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('응답 본문이 비어 있어요. 다시 시도해 주세요.');
  }
  return value.trim();
};

const completeWithOpenRouter = async (
  key: string,
  model: string,
  system: string,
  user: string,
): Promise<string> => {
  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
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
  return responseText(
    (payload as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message
      ?.content,
  );
};

const completeWithGoogleAiStudio = async (
  key: string,
  model: string,
  system: string,
  user: string,
): Promise<string> => {
  const endpoint = `${GOOGLE_AI_STUDIO_ENDPOINT}/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Google AI Studio ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }

  const payload: unknown = await response.json();
  const parts = (payload as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] })
    .candidates?.[0]?.content?.parts;
  const text = parts
    ?.map((part) => part.text)
    .filter((part): part is string => typeof part === 'string')
    .join('');
  return responseText(text);
};

const completeWithAntigravity = async (
  model: string,
  system: string,
  user: string,
): Promise<string> => {
  const executable = process.env.ANTIGRAVITY_CLI_PATH?.trim() || 'agy';
  const temporaryWorkspace = mkdtempSync(join(tmpdir(), 'korean-prose-antigravity-'));
  const prompt = [
    system,
    '',
    '---',
    '',
    '[작성 요청]',
    user,
    '',
    '도구를 사용하거나 파일을 읽고 쓰지 말고, 요청한 결과물만 답변으로 반환하세요.',
  ].join('\n');

  try {
    const { stdout } = await execFileAsync(
      executable,
      [
        '--print',
        prompt,
        '--output-format',
        'json',
        '--disable-slash-commands',
        '--sandbox',
        '--model',
        model,
        '--effort',
        'low',
        '--print-timeout',
        '2m',
      ],
      { cwd: temporaryWorkspace, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    );
    const payload = JSON.parse(stdout) as { status?: unknown; response?: unknown; error?: unknown };
    if (payload.status !== 'SUCCESS') {
      throw new Error(`Antigravity ${String(payload.status)}: ${String(payload.error || '응답 실패')}`);
    }
    return responseText(payload.response);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    if (failure.code === 'ENOENT') {
      throw new Error(
        `${executable} 실행 파일을 찾을 수 없어요. Antigravity CLI를 설치하거나 ANTIGRAVITY_CLI_PATH를 설정해 주세요.`,
      );
    }
    if (error instanceof Error && error.message.startsWith('Antigravity ')) throw error;

    let detail = failure.stderr?.trim();
    try {
      const payload = JSON.parse(failure.stdout || '') as { error?: unknown };
      if (payload.error) detail = String(payload.error);
    } catch {
      // JSON 오류 응답이 아니면 표준 오류의 진단만 사용합니다.
    }
    const exitCode = typeof failure.code === 'number' ? ` (${failure.code})` : '';
    throw new Error(
      `Antigravity CLI 실행에 실패했어요${exitCode}${detail ? `: ${detail.slice(0, 500)}` : '.'}`,
    );
  } finally {
    rmSync(temporaryWorkspace, { recursive: true, force: true });
  }
};

const complete = async (
  options: Pick<Options, 'provider' | 'model'>,
  system: string,
  user: string,
): Promise<string> => {
  if (options.provider === 'openrouter') {
    return completeWithOpenRouter(apiKeyFor('openrouter'), options.model, system, user);
  }
  if (options.provider === 'google-ai-studio') {
    return completeWithGoogleAiStudio(
      apiKeyFor('google-ai-studio'),
      options.model,
      system,
      user,
    );
  }
  return completeWithAntigravity(options.model, system, user);
};

export const run = async (options: Options, context: string): Promise<string> => {
  if (options.provider === 'antigravity' && !options.acceptAntigravityRisk) {
    throw new Error(
      [
        'Antigravity 연동을 실행하지 않았어요.',
        'Google Antigravity 추가 약관상 제3자 도구 연동으로 해석될 위험과 계정 제한 가능성이 있습니다.',
        '작성 요청, 참고 자료, 문체 규약이 Google에 전송되며 상호작용이 저장되거나 검토될 수 있습니다.',
        '위 내용을 확인하고 이번 실행에 동의한 경우에만 --accept-antigravity-risk를 추가해 다시 실행해 주세요.',
        '동의는 저장되지 않으며 Antigravity를 실행할 때마다 다시 필요합니다.',
        '약관: https://antigravity.google/terms',
      ].join('\n'),
    );
  }

  const user = context.trim() ? `${options.task}\n\n참고 자료:\n\n${context.trim()}` : options.task;
  const system = systemPrompt(options.medium);
  let draft = await complete(options, system, user);

  if (BANNED.test(draft)) {
    draft = await complete(
      options,
      system,
      `${user}\n\n작성한 초고에 금지된 줄표가 포함되어 있습니다. 줄표를 공백 하이픈이나 쉼표로 바꿔 다시 작성해 주세요.`,
    );
  }
  if (BANNED.test(draft)) {
    throw new Error(
      '생성된 초고에 금지된 줄표가 남아 있어요. 문체 규약 위반으로 결과를 출력하지 않을게요.',
    );
  }

  return draft;
};

const main = async (): Promise<void> => {
  try {
    loadLocalEnvironment();
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${USAGE}\n`);
      return;
    }
    if (!options.task) throw new Error('작성할 내용을 인자로 입력해 주세요.');
    const draft = await run(options, await readStdin());
    process.stdout.write(`${draft}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};

if (import.meta.main) await main();
