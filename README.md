# Korean Prose

한국어 작성 및 교정 [Agent Skills](https://agentskills.io/)입니다.

영어를 직역했거나 문체가 고르지 못한 기술 문서, PR 본문, UI 문구를 한국어 원어민이 읽었을 때 자연스럽고 매끄러운 문장으로 다듬습니다.

(e.g. `버튼 눌러요` -> `버튼을 눌러주세요`)

Codex와 Claude Code를 비롯한 Agent Skills 호환 에이전트에서 사용할 수 있습니다.

## 원리

- OpenRouter로 Gemini에게 초고 작성을 시키고, 내장된 문체 규약을 바탕으로 기계적인 번역투와 불필요한 대명사, 어미 혼용을 정리합니다.
- 확인되지 않은 사실이나 출처를 보태지 않고 과장, 홍보 문구, 틀에 박힌 결론 같은 AI 글쓰기 패턴도 억제합니다.

## 요구 사항

- Agent Skills를 지원하고 로컬 명령을 실행할 수 있는 에이전트
- Node.js 24 이상
- OpenRouter API 키

## 설치

### Codex

Codex에 저장소 경로를 전달하여 설치를 요청할 수 있습니다.

```text
다음 스킬을 설치해 주세요:
https://github.com/JellyBrick/korean-prose-skill/tree/main/skills/korean-prose
```

직접 설치하려면 저장소를 복제한 뒤 스킬 폴더를 Codex 개인 설치 경로로 복사합니다.

```bash
git clone https://github.com/JellyBrick/korean-prose-skill.git
mkdir -p ~/.codex/skills
cp -R korean-prose-skill/skills/korean-prose ~/.codex/skills/korean-prose
```

### Claude Code

저장소를 복제한 뒤 스킬 폴더를 Claude Code 개인 설치 경로로 복사합니다.

```bash
git clone https://github.com/JellyBrick/korean-prose-skill.git
mkdir -p ~/.claude/skills
cp -R korean-prose-skill/skills/korean-prose ~/.claude/skills/korean-prose
```

Claude Code의 설치 위치와 호출 방식은
[Claude Code 스킬 문서](https://code.claude.com/docs/en/slash-commands)에서 확인할 수 있습니다.

### 기타 Agent Skills 호환 에이전트

사용 중인 제품의 문서에서 안내하는 스킬 디렉터리에 `skills/korean-prose` 폴더를 복사합니다.
지원하는 디렉터리와 실행 권한은 제품마다 다를 수 있습니다.

## API 키 설정

OpenRouter API 키를 환경변수로 설정합니다.

```bash
export OPENROUTER_API_KEY='your-api-key'
```

작업 중인 프로젝트의 `.env.local` 파일에 설정할 수도 있습니다.

```dotenv
OPENROUTER_API_KEY=your-api-key
```

`.env.local` 파일은 버전 관리에 포함하지 마세요.

## 데이터 처리

CLI는 작성 요청과 표준 입력으로 받은 참고 자료를 OpenRouter API로 전송합니다. 비밀 키,
개인정보, 외부로 보내면 안 되는 코드는 참고 자료에 포함하지 마세요.

## 사용 방법

### Codex

대화창에서 `$korean-prose`를 불러 원하는 작업을 요청합니다.

```text
$korean-prose를 사용해 이 PR 본문을 자연스럽게 다듬어 주세요.
```

### Claude Code

대화창에서 `/korean-prose` 명령으로 호출합니다.

```text
/korean-prose 이 PR 본문을 자연스럽게 다듬어 주세요.
```

### 터미널

저장소를 복제한 디렉터리에서 CLI를 직접 실행할 수도 있습니다.

```bash
node skills/korean-prose/scripts/prose.ts \
  --medium 'GitHub PR 본문' \
  '인증 흐름을 변경한 PR 본문을 작성해 줘'

git diff --stat | node skills/korean-prose/scripts/prose.ts \
  --medium 'GitHub PR 본문' \
  '이 변경의 PR 본문을 작성해 줘'
```

인자에는 작성 요청을, 표준 입력에는 참고 자료나 변경 사항을 전달합니다. `--medium` 옵션에는
글이 게시될 출력 매체를 지정합니다.

## 문체 규약

기본 문체 규약은 `skills/korean-prose/references/style.md`에 있습니다. 작업 중인 저장소 루트에
`docs/korean-style.md`가 있으면 해당 프로젝트의 문체 규약을 우선 적용합니다.

생성된 문장은 검토가 필요한 초안입니다. 모델이 파일 경로나 숫자, 세부 동작을 원문과 다르게
작성할 수 있으므로 최종 반영 전에 원본과 일치하는지 직접 확인하세요.
