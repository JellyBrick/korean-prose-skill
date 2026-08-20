import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseArguments, run, type Options } from '../skills/korean-prose/scripts/prose.ts';

test('기본 제공자와 모델을 선택한다', () => {
  assert.deepEqual(parseArguments(['--medium', '버튼 이름', '저장해']), {
    provider: 'openrouter',
    model: '~google/gemini-flash-latest',
    medium: '버튼 이름',
    task: '저장해',
    help: false,
    acceptAntigravityRisk: false,
  });
});

test('명령줄 옵션이 제공자와 모델 환경변수보다 우선한다', () => {
  const options = parseArguments(
    ['--provider', 'google', '--model', 'gemini-3.7-flash', '교정해 줘'],
    {
      KOREAN_PROSE_PROVIDER: 'antigravity',
      KOREAN_PROSE_MODEL: 'gemini-3.6-flash-low',
    },
  );

  assert.equal(options.provider, 'google-ai-studio');
  assert.equal(options.model, 'gemini-3.7-flash');
  assert.equal(options.acceptAntigravityRisk, false);
});

test('Antigravity 위험 동의 옵션을 별도 인자로 처리한다', () => {
  const environmentOnly = parseArguments(['문장을 교정해 줘'], {
    KOREAN_PROSE_PROVIDER: 'antigravity',
    KOREAN_PROSE_ACCEPT_ANTIGRAVITY_RISK: 'true',
  });
  assert.equal(environmentOnly.acceptAntigravityRisk, false);

  const options = parseArguments([
    '--provider',
    'antigravity',
    '--accept-antigravity-risk',
    '문장을 교정해 줘',
  ]);

  assert.equal(options.acceptAntigravityRisk, true);
  assert.equal(options.task, '문장을 교정해 줘');
});

test('기존 OpenRouter 요청 형식을 유지한다', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  let requestedBody: Record<string, unknown> | undefined;

  process.env.OPENROUTER_API_KEY = 'test-key';
  globalThis.fetch = async (_input, init) => {
    requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ choices: [{ message: { content: '교정된 문장' } }] });
  };

  try {
    const options: Options = {
      provider: 'openrouter',
      model: '~google/gemini-flash-latest',
      medium: '내부 개발 문서',
      task: '문장을 교정해 줘',
      help: false,
      acceptAntigravityRisk: false,
    };
    assert.equal(await run(options, ''), '교정된 문장');
    assert.equal(requestedBody?.model, '~google/gemini-flash-latest');
    assert.ok(Array.isArray(requestedBody?.messages));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }
});

test('Google AI Studio 요청과 응답 형식을 처리한다', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  let requestedUrl = '';
  let requestedHeaders: Headers | undefined;
  let requestedBody: Record<string, unknown> | undefined;

  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedHeaders = new Headers(init?.headers);
    requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      candidates: [{ content: { parts: [{ text: '첫 문장' }, { text: '과 둘째 문장' }] } }],
    });
  };

  try {
    const options: Options = {
      provider: 'google-ai-studio',
      model: 'gemini-3.5-flash-lite',
      medium: '내부 개발 문서',
      task: '문장을 교정해 줘',
      help: false,
      acceptAntigravityRisk: false,
    };
    const output = await run(options, '참고 내용');

    assert.equal(output, '첫 문장과 둘째 문장');
    assert.equal(
      requestedUrl,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    );
    assert.equal(requestedHeaders?.get('x-goog-api-key'), 'test-key');
    assert.ok(requestedBody?.systemInstruction);
    assert.match(JSON.stringify(requestedBody?.contents), /참고 내용/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('Antigravity를 임시 작업 공간에서 제한된 헤드리스 모드로 실행한다', async () => {
  const fixtureDirectory = mkdtempSync(join(tmpdir(), 'korean-prose-test-'));
  const executable = join(fixtureDirectory, 'agy');
  const invocationFile = join(fixtureDirectory, 'invocation.json');
  const originalExecutable = process.env.ANTIGRAVITY_CLI_PATH;
  const originalInvocationFile = process.env.TEST_ANTIGRAVITY_INVOCATION;

  writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.TEST_ANTIGRAVITY_INVOCATION, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));
process.stdout.write(JSON.stringify({ status: 'SUCCESS', response: '교정된 문장' }));
`,
  );
  chmodSync(executable, 0o755);
  process.env.ANTIGRAVITY_CLI_PATH = executable;
  process.env.TEST_ANTIGRAVITY_INVOCATION = invocationFile;

  try {
    const options: Options = {
      provider: 'antigravity',
      model: 'gemini-3.6-flash-low',
      medium: '내부 개발 문서',
      task: '문장을 교정해 줘',
      help: false,
      acceptAntigravityRisk: false,
    };
    await assert.rejects(run(options, '참고 내용'), (error) => {
      assert.match(String(error), /--accept-antigravity-risk/);
      assert.match(String(error), /실행할 때마다 다시 필요/);
      assert.equal(existsSync(invocationFile), false);
      return true;
    });

    options.acceptAntigravityRisk = true;
    assert.equal(await run(options, ''), '교정된 문장');

    const invocation = JSON.parse(readFileSync(invocationFile, 'utf8')) as {
      argv: string[];
      cwd: string;
    };
    assert.ok(invocation.argv.includes('--sandbox'));
    assert.ok(invocation.argv.includes('--disable-slash-commands'));
    assert.ok(invocation.argv.includes('gemini-3.6-flash-low'));
    assert.match(invocation.cwd, /korean-prose-antigravity-/);
    assert.equal(invocation.argv.some((argument) => argument === '--dangerously-skip-permissions'), false);

    writeFileSync(
      executable,
      `#!/usr/bin/env node
process.stderr.write('authentication required');
process.exit(1);
`,
    );
    await assert.rejects(run({ ...options, task: '외부에 노출하면 안 되는 입력' }, ''), (error) => {
      assert.match(String(error), /authentication required/);
      assert.doesNotMatch(String(error), /외부에 노출하면 안 되는 입력/);
      return true;
    });
  } finally {
    if (originalExecutable === undefined) delete process.env.ANTIGRAVITY_CLI_PATH;
    else process.env.ANTIGRAVITY_CLI_PATH = originalExecutable;
    if (originalInvocationFile === undefined) delete process.env.TEST_ANTIGRAVITY_INVOCATION;
    else process.env.TEST_ANTIGRAVITY_INVOCATION = originalInvocationFile;
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
});
