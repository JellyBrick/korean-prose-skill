/**
 * Gemini로 한국어 산문 초고를 생성하는 CLI입니다.
 *
 * 시스템 프롬프트에 문체 규약을 전달하여 번역투 교정과 문체 통일을 함께 수행합니다.
 * 코드나 다국어(i18n) 문구를 다듬을 때는 내장된 읽기 전용 도구로 저장소 내 사용 위치와
 * 주변 맥락을 함께 조회할 수 있습니다.
 * 생성된 결과는 초고이므로 파일 경로, 숫자, 동작 설명이 원본과 일치하는지 확인해야 합니다.
 */
import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
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
  tools?: boolean;
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
const MAX_TOOL_ROUNDS = 5;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_SEARCH_MATCHES = 50;
const MAX_LIST_FILES = 150;
const MAX_READ_LINES = 200;
const DEFAULT_READ_LINES = 120;
const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
  '.cache',
  '.turbo',
  '.venv',
  'venv',
  'target',
  'vendor',
]);
const execFileAsync = promisify(execFile);

const USAGE = `사용법:
  node prose.ts [--provider <제공자>] [--model <모델>] [--medium <매체>]
    [--no-tools] [--accept-antigravity-risk] <작성 요청>

제공자:
  openrouter         OPENROUTER_API_KEY로 OpenRouter를 호출합니다. (기본값)
  google-ai-studio   GEMINI_API_KEY로 Gemini API를 직접 호출합니다.
  antigravity        로그인된 Antigravity CLI(agy)를 호출합니다.

옵션:
  --medium <매체>    출력 매체를 지정합니다. (기본값: 내부 개발 문서)
  --no-tools         저장소 코드 검색 및 파일 읽기 도구 호출을 비활성화합니다.

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

interface ToolParameterProperty {
  type: 'string' | 'number' | 'boolean';
  description: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameterProperty>;
    required?: string[];
  };
}

const WORKSPACE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'search_code',
    description:
      '현재 작업 디렉터리(저장소)에서 문자열이나 정규식 패턴을 검색해 일치하는 파일 경로, 줄 번호, 내용을 반환합니다. i18n 키, UI 문구, 에러 메시지, 컴포넌트나 함수 이름이 코드의 어디에서 어떻게 쓰이는지 찾을 때 사용하세요.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            '검색할 문자열(i18n 키, 문구, 식별자 등) 또는 정규식 패턴입니다.',
        },
        path: {
          type: 'string',
          description:
            '검색 범위를 제한할 작업 디렉터리 기준 상대 경로입니다. 생략하면 전체 저장소를 검색합니다.',
        },
        isRegex: {
          type: 'boolean',
          description:
            'query를 정규식으로 해석할지 여부입니다. 기본값은 false(대소문자 구분 없는 부분 문자열 검색)입니다.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_file',
    description:
      '현재 작업 디렉터리 안의 파일 내용을 줄 번호와 함께 읽습니다. search_code로 찾은 사용 위치 주변의 컴포넌트 구조, 분기 조건, 보간 변수 전달 방식, 인접한 i18n 문구를 확인할 때 사용하세요.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '읽을 파일의 작업 디렉터리 기준 상대 경로입니다.',
        },
        startLine: {
          type: 'number',
          description: '읽기 시작할 줄 번호(1부터 시작, 기본값: 1)입니다.',
        },
        endLine: {
          type: 'number',
          description: '읽기를 끝낼 줄 번호(기본값: 시작 줄부터 120줄)입니다.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description:
      '현재 작업 디렉터리 안의 파일 경로 목록을 조회합니다. 다국어 리소스(i18n, locales) 파일이나 관련 컴포넌트 및 문서 파일의 위치를 찾을 때 사용하세요.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '조회할 작업 디렉터리 기준 상대 경로입니다. 기본값은 .입니다.',
        },
        pattern: {
          type: 'string',
          description:
            '파일 경로에서 찾을 부분 문자열 필터입니다(예: i18n, locale, ko, .json, Modal).',
        },
      },
    },
  },
];

const OPENROUTER_TOOLS = WORKSPACE_TOOL_DEFINITIONS.map((tool) => ({
  type: 'function' as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
}));

const GEMINI_FUNCTION_DECLARATIONS = WORKSPACE_TOOL_DEFINITIONS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters,
}));

const resolveInsideWorkspace = (workspaceRoot: string, requestedPath = '.'): string => {
  const rootReal = realpathSync(workspaceRoot);
  const candidate = resolve(rootReal, requestedPath || '.');
  const relativeCandidate = relative(rootReal, candidate);
  if (relativeCandidate.startsWith('..') || isAbsolute(relativeCandidate)) {
    throw new Error(`작업 디렉터리 바깥의 경로에는 접근할 수 없어요: ${requestedPath}`);
  }
  if (!existsSync(candidate)) {
    throw new Error(`경로를 찾을 수 없어요: ${requestedPath}`);
  }
  const targetReal = realpathSync(candidate);
  const relativeReal = relative(rootReal, targetReal);
  if (relativeReal.startsWith('..') || isAbsolute(relativeReal)) {
    throw new Error(`작업 디렉터리 바깥을 가리키는 심볼릭 링크에는 접근할 수 없어요: ${requestedPath}`);
  }
  return targetReal;
};

const isProbablyBinary = (buffer: Buffer): boolean => {
  const sampleLength = Math.min(buffer.length, 1024);
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) return true;
  }
  return false;
};

const collectWorkspaceFiles = (
  rootReal: string,
  targetReal: string,
  limit = 2000,
): string[] => {
  const collected: string[] = [];

  const visit = (currentPath: string): void => {
    if (collected.length >= limit) return;
    let stats;
    try {
      stats = statSync(currentPath);
    } catch {
      return;
    }

    if (stats.isFile()) {
      const relativeFile = relative(rootReal, currentPath);
      if (!relativeFile.startsWith('..') && !isAbsolute(relativeFile)) {
        collected.push(currentPath);
      }
      return;
    }

    if (!stats.isDirectory()) return;

    let entries;
    try {
      entries = readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((first, second) => first.name.localeCompare(second.name));
    for (const entry of entries) {
      if (collected.length >= limit) break;
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      visit(join(currentPath, entry.name));
    }
  };

  visit(targetReal);
  return collected;
};

const runSearchCodeTool = (
  args: Record<string, unknown>,
  workspaceRoot: string,
): string => {
  const rawQuery = typeof args.query === 'string' ? args.query.trim() : '';
  if (!rawQuery) return '오류: 검색할 query 문자열을 입력해 주세요.';

  const requestedPath = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : '.';
  const isRegex = Boolean(args.isRegex);
  const rootReal = realpathSync(workspaceRoot);
  const targetReal = resolveInsideWorkspace(rootReal, requestedPath);

  let matcher: (line: string) => boolean;
  if (isRegex) {
    try {
      const expression = new RegExp(rawQuery, 'i');
      matcher = (line: string) => expression.test(line);
    } catch {
      const lowered = rawQuery.toLowerCase();
      matcher = (line: string) => line.toLowerCase().includes(lowered);
    }
  } else {
    const lowered = rawQuery.toLowerCase();
    matcher = (line: string) => line.toLowerCase().includes(lowered);
  }

  const files = collectWorkspaceFiles(rootReal, targetReal);
  const matches: string[] = [];

  for (const filePath of files) {
    if (matches.length >= MAX_SEARCH_MATCHES) break;
    let stats;
    try {
      stats = statSync(filePath);
    } catch {
      continue;
    }
    if (stats.size > MAX_FILE_BYTES) continue;

    let buffer: Buffer;
    try {
      buffer = readFileSync(filePath);
    } catch {
      continue;
    }
    if (isProbablyBinary(buffer)) continue;

    const lines = buffer.toString('utf8').split(/\r?\n/);
    const relativePath = relative(rootReal, filePath);
    for (let index = 0; index < lines.length; index += 1) {
      if (matcher(lines[index])) {
        const snippet = lines[index].trim().slice(0, 240);
        matches.push(`${relativePath}:${index + 1}: ${snippet}`);
        if (matches.length >= MAX_SEARCH_MATCHES) break;
      }
    }
  }

  if (matches.length === 0) {
    return `"${rawQuery}"와 일치하는 코드를 찾지 못했어요.`;
  }
  return matches.join('\n');
};

const runReadFileTool = (
  args: Record<string, unknown>,
  workspaceRoot: string,
): string => {
  const requestedPath = typeof args.path === 'string' ? args.path.trim() : '';
  if (!requestedPath) return '오류: 읽을 파일의 path를 입력해 주세요.';

  const rootReal = realpathSync(workspaceRoot);
  const targetReal = resolveInsideWorkspace(rootReal, requestedPath);
  const stats = statSync(targetReal);
  if (!stats.isFile()) {
    return `오류: 파일이 아닌 경로예요: ${requestedPath}`;
  }
  if (stats.size > MAX_FILE_BYTES) {
    return `오류: 파일 크기가 너무 커서 읽을 수 없어요: ${requestedPath}`;
  }

  const buffer = readFileSync(targetReal);
  if (isProbablyBinary(buffer)) {
    return `오류: 바이너리 파일은 읽을 수 없어요: ${requestedPath}`;
  }

  const lines = buffer.toString('utf8').split(/\r?\n/);
  const rawStart = typeof args.startLine === 'number' && Number.isFinite(args.startLine)
    ? Math.floor(args.startLine)
    : 1;
  const startLine = Math.max(1, Math.min(rawStart, Math.max(1, lines.length)));
  const rawEnd = typeof args.endLine === 'number' && Number.isFinite(args.endLine)
    ? Math.floor(args.endLine)
    : startLine + DEFAULT_READ_LINES - 1;
  const endLine = Math.max(
    startLine,
    Math.min(lines.length, startLine + MAX_READ_LINES - 1, rawEnd),
  );

  const relativePath = relative(rootReal, targetReal);
  const numbered = lines
    .slice(startLine - 1, endLine)
    .map((line, offset) => `${startLine + offset}: ${line}`);

  return [`[파일: ${relativePath} (${startLine}~${endLine} / 전체 ${lines.length}줄)]`, ...numbered].join(
    '\n',
  );
};

const runListFilesTool = (
  args: Record<string, unknown>,
  workspaceRoot: string,
): string => {
  const requestedPath = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : '.';
  const pattern = typeof args.pattern === 'string' ? args.pattern.trim().toLowerCase() : '';
  const rootReal = realpathSync(workspaceRoot);
  const targetReal = resolveInsideWorkspace(rootReal, requestedPath);

  const files = collectWorkspaceFiles(rootReal, targetReal)
    .map((filePath) => relative(rootReal, filePath))
    .filter((relativePath) => (!pattern ? true : relativePath.toLowerCase().includes(pattern)))
    .slice(0, MAX_LIST_FILES);

  if (files.length === 0) {
    return '조건에 맞는 파일을 찾지 못했어요.';
  }
  return files.join('\n');
};

export const executeWorkspaceTool = (
  name: string,
  rawArgs: unknown,
  workspaceRoot: string = process.cwd(),
): string => {
  const args =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};
  try {
    if (name === 'search_code') return runSearchCodeTool(args, workspaceRoot);
    if (name === 'read_file') return runReadFileTool(args, workspaceRoot);
    if (name === 'list_files') return runListFilesTool(args, workspaceRoot);
    return `오류: 알 수 없는 도구예요: ${name}`;
  } catch (error) {
    return `오류: ${error instanceof Error ? error.message : String(error)}`;
  }
};

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
  let disableTools = false;
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
    if (argument === '--no-tools') {
      disableTools = true;
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
  const parsed: Options = {
    provider,
    model: modelValue?.trim() || DEFAULT_MODELS[provider],
    medium,
    task: taskParts.join(' ').trim(),
    help,
    acceptAntigravityRisk,
  };
  if (disableTools) parsed.tools = false;
  return parsed;
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

const systemPrompt = (medium: string, enableTools = true): string =>
  [
    '당신은 10년 차 IT 서비스 수석 UX 라이터이자 한국어 원어민 카피라이터입니다.',
    '입력된 텍스트나 로직에서 기계적인 번역투와 어색한 표현을 없애고 자연스러운 한국어로 교정해 주세요.',
    '',
    '다음 원칙을 반드시 지켜 주세요.',
    '1. 출력 매체와 독자에 맞는 어미를 선택하고, 한 문서 안에서 섞지 마세요.',
    '2. 사용자에게 행동을 요청할 때는 직역한 명령투를 피하고 배려하는 표현을 사용하세요.',
    '3. 영어식 무생물 주어와 수동태를 피하고, 상황과 감정을 능동적인 문장으로 자연스럽게 풀어 쓰세요.',
    '4. 불필요한 대명사와 접속사를 생략하되, 조사와 연결 어미를 무리하게 떼어내거나 서술어를 명사구(체언)로 압축해 문장을 딱딱하게 만들지 마세요.',
    '5. 가리키는 대상이 바로 앞 문장에 없는 지시어(그 기준, 이를 통해 등)를 쓰지 말고, 대상을 직접 적거나 생략된 과정을 풀어서 설명하세요.',
    '6. 문맥상 주체가 분명하면 주어를 반복하지 말고, 주체가 빠져 모호하면 명시하되 아직 정해지지 않은 담당자나 조직을 임의로 지어내지 마세요.',
    '7. UI 문구는 명확하고 간결하게 작성하고, 기술 문서는 결정의 이유와 근거를 남겨 주세요.',
    '8. 입력과 참고 자료에 없는 사실, 수치, 출처, 평가를 만들지 마세요. 정보가 부족하면 추측하지 말고 생략하세요.',
    '9. 대상의 의미를 과장하거나 홍보성 수식어를 붙이지 말고, 감각적인 척하는 추상 명사 조합(결을 살리다, 밀도를 더하다, 농도를 높이다 등)을 피하세요.',
    '10. 단순히 A가 아니라 B다, A보다 B에 가깝다 같은 상투적인 대조 구문과, 내용 없는 선언형 도입 및 마무리 문장(핵심은 분명합니다, 중요한 것은 ~입니다 등)을 쓰지 마세요.',
    '11. ~를 함께 봅니다처럼 실제 행동이 모호한 포괄 동사나 지나치게 사전적인 합성어(판단 기준, 작동 구조, 운영 관점, ~ 축 등)의 반복을 피하고 구체적인 행동으로 풀어 쓰세요.',
    '12. 관계 설명 없는 기계적인 세 항목 나열, 요청하지 않은 전망과 결론, 과도한 볼드체와 기호를 피하세요.',
    '',
    '코드(i18n 다국어 키, UI 컴포넌트 문구, 에러 및 검증 메시지, CLI 출력, 주석 등)와 관련된 문장을 다룰 때는 다음 사항을 함께 확인하세요.',
    '- 문구가 실제로 표시되는 UI 요소(버튼, 모달 제목과 본문, 토스트 알림, 입력창 하단 오류 등)와 전후 동작 흐름에 맞게 작성하세요.',
    '- 포맷팅 변수나 플레이스홀더({name}, {count}, %s, ${limit} 등)는 원문 형태를 유지하고, 들어가는 값에 맞춰 조사와 서술어를 자연스럽게 연결하세요.',
    '- 같은 화면이나 인접한 i18n 키에서 쓰는 용어 및 어미와 일관성을 유지하세요.',
    ...(enableTools
      ? [
          '- 입력에 i18n 키, 파일 경로, 컴포넌트나 함수 이름만 주어졌거나 코드 내 사용 맥락이 부족하면 제공된 읽기 전용 도구(search_code, read_file, list_files)로 실제 사용 위치와 주변 문구를 확인한 뒤 작성하세요. 입력에 맥락이 충분하거나 코드와 무관한 일반 산문이면 도구를 호출하지 마세요.',
        ]
      : []),
    '',
    `[출력 매체]: ${medium}`,
    '',
    '아래 문체 규약을 반드시 지켜 주세요. em-dash와 en-dash는 사용하지 말고 공백 하이픈, 쉼표, 콜론으로 바꾸세요.',
    '설명이나 머리말, 도구 사용 내역 없이 요청한 결과물만 출력해 주세요.',
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

interface OpenRouterToolCall {
  id?: unknown;
  type?: unknown;
  function?: {
    name?: unknown;
    arguments?: unknown;
  };
}

interface OpenRouterMessage {
  role?: unknown;
  content?: unknown;
  tool_calls?: OpenRouterToolCall[];
}

const parseToolArguments = (raw: unknown): Record<string, unknown> => {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
};

const completeWithOpenRouter = async (
  key: string,
  model: string,
  system: string,
  user: string,
  enableTools = true,
): Promise<string> => {
  const messages: Record<string, unknown>[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  let toolsActive = enableTools;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const includeTools = toolsActive && round < MAX_TOOL_ROUNDS;
    const requestBody: Record<string, unknown> = {
      model,
      messages,
      temperature: 0.2,
      ...(includeTools ? { tools: OPENROUTER_TOOLS } : {}),
    };

    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = (await response.text()).slice(0, 500);
      if (includeTools && round === 0 && /tool/i.test(errorText)) {
        toolsActive = false;
        round -= 1;
        continue;
      }
      throw new Error(`OpenRouter ${response.status}: ${errorText}`);
    }

    const payload: unknown = await response.json();
    const message = (payload as { choices?: { message?: OpenRouterMessage }[] }).choices?.[0]
      ?.message;
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];

    if (includeTools && toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: typeof message?.content === 'string' ? message.content : null,
        tool_calls: toolCalls,
      });
      for (const call of toolCalls) {
        const toolName = typeof call.function?.name === 'string' ? call.function.name : '';
        const toolArgs = parseToolArguments(call.function?.arguments);
        const toolResult = executeWorkspaceTool(toolName, toolArgs);
        messages.push({
          role: 'tool',
          tool_call_id: typeof call.id === 'string' ? call.id : '',
          content: toolResult,
        });
      }
      continue;
    }

    return responseText(message?.content);
  }

  throw new Error('도구 호출 횟수 한도를 초과했어요. 참고 자료를 직접 전달해 다시 시도해 주세요.');
};

interface GeminiPart {
  text?: unknown;
  thought?: unknown;
  functionCall?: {
    name?: unknown;
    args?: unknown;
  };
  [key: string]: unknown;
}

const completeWithGoogleAiStudio = async (
  key: string,
  model: string,
  system: string,
  user: string,
  enableTools = true,
): Promise<string> => {
  const endpoint = `${GOOGLE_AI_STUDIO_ENDPOINT}/${encodeURIComponent(model)}:generateContent`;
  const contents: Record<string, unknown>[] = [{ role: 'user', parts: [{ text: user }] }];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const includeTools = enableTools && round < MAX_TOOL_ROUNDS;
    const requestBody: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      ...(includeTools ? { tools: [{ functionDeclarations: GEMINI_FUNCTION_DECLARATIONS }] } : {}),
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(
        `Google AI Studio ${response.status}: ${(await response.text()).slice(0, 500)}`,
      );
    }

    const payload: unknown = await response.json();
    const candidateContent = (
      payload as {
        candidates?: { content?: { role?: unknown; parts?: GeminiPart[] } }[];
      }
    ).candidates?.[0]?.content;
    const parts = Array.isArray(candidateContent?.parts) ? candidateContent.parts : [];
    const functionCalls = parts
      .map((part) => part.functionCall)
      .filter(
        (call): call is { name?: unknown; args?: unknown } =>
          Boolean(call && typeof call.name === 'string'),
      );

    if (includeTools && functionCalls.length > 0) {
      contents.push({
        role: typeof candidateContent?.role === 'string' ? candidateContent.role : 'model',
        parts,
      });
      contents.push({
        role: 'user',
        parts: functionCalls.map((call) => {
          const toolName = String(call.name);
          const toolArgs = parseToolArguments(call.args);
          const result = executeWorkspaceTool(toolName, toolArgs);
          return {
            functionResponse: {
              name: toolName,
              response: { result },
            },
          };
        }),
      });
      continue;
    }

    const text = parts
      .filter((part) => part.thought !== true)
      .map((part) => part.text)
      .filter((part): part is string => typeof part === 'string')
      .join('');
    return responseText(text);
  }

  throw new Error('도구 호출 횟수 한도를 초과했어요. 참고 자료를 직접 전달해 다시 시도해 주세요.');
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
      throw new Error(
        `Antigravity ${String(payload.status)}: ${String(payload.error || '응답 실패')}`,
      );
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
  options: Pick<Options, 'provider' | 'model' | 'tools'>,
  system: string,
  user: string,
): Promise<string> => {
  const enableTools = options.tools !== false;
  if (options.provider === 'openrouter') {
    return completeWithOpenRouter(
      apiKeyFor('openrouter'),
      options.model,
      system,
      user,
      enableTools,
    );
  }
  if (options.provider === 'google-ai-studio') {
    return completeWithGoogleAiStudio(
      apiKeyFor('google-ai-studio'),
      options.model,
      system,
      user,
      enableTools,
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

  const enableTools = options.tools !== false && options.provider !== 'antigravity';
  const user = context.trim() ? `${options.task}\n\n참고 자료:\n\n${context.trim()}` : options.task;
  const system = systemPrompt(options.medium, enableTools);
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
