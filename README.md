# Korean Prose

한국어 작성 및 교정 [Agent Skills](https://agentskills.io/)입니다.

영어를 직역했거나 문체가 고르지 못한 기술 문서, PR 본문, UI 문구를 한국어 원어민이 읽었을 때 자연스럽고 매끄러운 문장으로 다듬습니다.

(e.g. `버튼 눌러요` -> `버튼을 눌러주세요`)

Codex와 Claude Code를 비롯한 Agent Skills 호환 에이전트에서 사용할 수 있습니다.

## 원리

- Gemini로 초고를 작성하고, 내장된 문체 규약을 바탕으로 기계적인 번역투(직역체)와 불필요한 대명사, 어미 혼용을 정리합니다.
- 기본적으로 OpenRouter를 사용하며, Google AI Studio나 로그인된 Antigravity CLI도 선택할 수 있습니다.
- `확인되지 않은 사실이나 출처 보태기`, `과장`, `쓸데없는 홍보 문구`, `틀에 박힌 결론`, `이건 단순한 X가 아니다`, `어떻게 하는가`와 같은 LLM 특유의 글쓰기 패턴도 억제합니다.

## 주의!!

> [!WARNING]  
> LLM이 생성된 문장은 항상 검토가 필요한 초안입니다.
> 
> LLM이 파일 경로, 숫자, 세부 동작을 원문과 다르게 작성할 수 있으므로 최종 반영 전에 원본과 일치하는지 직접 확인하세요!!

## 요구 사항

- Agent Skills를 지원하고 로컬 명령을 실행할 수 있는 에이전트
- Node.js 24+
- 선택한 제공자에 필요한 API 키 또는 CLI 로그인 상태
  - OpenRouter: `OPENROUTER_API_KEY`
  - Google AI Studio: `GEMINI_API_KEY`
  - Antigravity: 설치 및 로그인을 마친 Antigravity CLI

## 설치

### Codex

Codex에 저장소 경로를 전달하여 설치를 요청할 수 있습니다.

```text
다음 스킬을 설치해 주세요:
https://github.com/JellyBrick/korean-prose-skill/tree/main/skills/korean-prose
```

직접 설치하려면 저장소를 복제한 뒤 스킬 폴더를 Codex 개인 설치 경로로 복사해주세요.

```bash
git clone https://github.com/JellyBrick/korean-prose-skill.git
mkdir -p ~/.codex/skills
cp -R korean-prose-skill/skills/korean-prose ~/.codex/skills/korean-prose
```

### Claude Code

저장소를 복제한 뒤 스킬 폴더를 Claude Code 개인 설치 경로로 복사해주세요.

```bash
git clone https://github.com/JellyBrick/korean-prose-skill.git
mkdir -p ~/.claude/skills
cp -R korean-prose-skill/skills/korean-prose ~/.claude/skills/korean-prose
```

Claude Code의 설치 위치와 호출 방식은 [Claude Code 스킬 문서](https://code.claude.com/docs/en/slash-commands)에서 확인하실 수 있습니다.

### 기타 Agent Skills 호환 에이전트

사용 중인 Agent의 문서에서 안내하는 스킬 디렉터리에 `skills/korean-prose` 폴더를 복사해 주세요.
지원하는 디렉터리와 실행 권한은 Agent마다 다를 수 있습니다.

## 제공자 설정

### OpenRouter (기본값)

OpenRouter API 키를 환경 변수로 설정해 주세요.

```bash
export OPENROUTER_API_KEY='your-api-key'
```

작업 중인 프로젝트의 `.env.local` 파일에 설정하는 방법도 있습니다.

```dotenv
OPENROUTER_API_KEY=your-api-key
```

### Google AI Studio

Google AI Studio에서 발급한 Gemini API 키를 설정해 주세요.

```bash
export GEMINI_API_KEY='your-api-key'
```

```dotenv
GEMINI_API_KEY=your-api-key
```

`.env.local` 파일은 버전 관리에 포함하지 않도록 주의해 주세요.

### Antigravity

Antigravity CLI를 설치하고 대화형 세션에서 로그인하거나 CLI 제공자 인증을 설정해 주세요.
스크립트는 Antigravity의 인증 정보를 재사용해 `agy`를 헤드리스 모드로 실행하며, API 키를
직접 전달하지 않습니다.

> [!CAUTION]
> [Google Antigravity 추가 약관](https://antigravity.google/terms)은 제3자 제품이나 도구와
> 연결해 서비스를 사용하는 행위를 위반으로 해석할 수 있도록 규정합니다. 계정이 제한되거나
> 정지될 위험이 있으므로 약관을 직접 확인한 뒤 사용하세요. 작성 요청, 표준 입력으로 전달한
> 참고 자료와 적용되는 문체 규약이 Google에 전송되며, 상호작용이 저장되거나 검토될 수
> 있습니다.

Antigravity는 실행할 때마다 사용자의 명시적인 동의가 필요합니다. 에이전트는 위 위험과 전송
범위를 먼저 알리고 이번 실행을 진행해도 되는지 물어야 합니다. 사용자가 명확히 동의한 경우에만
`--accept-antigravity-risk`를 지정할 수 있습니다. 제공자 선택이나 이전 실행의 동의를 이번
실행의 동의로 간주해서는 안 됩니다.

이 옵션은 동의를 저장하지 않으며 환경변수로 대신할 수도 없습니다. 약관 준수를 보장하는 장치가
아니라, 위험을 알리지 않은 채 실행되는 일을 막기 위한 확인 절차입니다.

## 사용 방법

### Codex

대화창에서 `$korean-prose`를 불러 원하는 작업을 요청하실 수 있어요.

```text
$korean-prose를 사용해 이 PR 본문을 자연스럽게 다듬어 주세요.
```

### Claude Code

대화창에서 `/korean-prose` 명령으로 호출하실 수 있어요.

```text
/korean-prose 이 PR 본문을 자연스럽게 다듬어 주세요.
```

### 터미널

저장소를 복제한 디렉터리에서 CLI로 직접 실행하실 수도 있어요.

```bash
node skills/korean-prose/scripts/prose.ts \
  --medium 'GitHub PR 본문' \
  '인증 흐름을 변경한 PR 본문을 작성해 줘'

git diff --stat | node skills/korean-prose/scripts/prose.ts \
  --medium 'GitHub PR 본문' \
  '이 변경의 PR 본문을 작성해 줘'
```

인자에는 작성 요청을, 표준 입력에는 참고 자료나 변경 사항을 적어주세요. 그리고, `--medium` 옵션에는 글이 게시될 출력 매체를 지정해주세요.

`--provider`에는 `openrouter`, `google-ai-studio`, `antigravity` 중 하나를 지정할 수 있습니다.
`--model`을 생략하면 제공자별 기본 모델을 사용합니다.

```bash
# Google AI Studio와 Gemini 3.5 Flash-Lite
node skills/korean-prose/scripts/prose.ts \
  --provider google-ai-studio \
  --model gemini-3.5-flash-lite \
  --medium '내부 개발 문서' \
  '이 문서를 자연스럽게 다듬어 줘'

# Google AI Studio와 Gemini 3.7 Flash
node skills/korean-prose/scripts/prose.ts \
  --provider google-ai-studio \
  --model gemini-3.7-flash \
  --medium '내부 개발 문서' \
  '이 문서를 자연스럽게 다듬어 줘'

# 로그인된 Antigravity CLI와 Gemini Flash
node skills/korean-prose/scripts/prose.ts \
  --provider antigravity \
  --model gemini-3.6-flash-low \
  --accept-antigravity-risk \
  --medium '내부 개발 문서' \
  '이 문서를 자연스럽게 다듬어 줘'
```

`KOREAN_PROSE_PROVIDER`와 `KOREAN_PROSE_MODEL` 환경변수로 기본값을 바꿀 수도 있습니다.
명령줄 옵션은 환경변수보다 우선합니다.

```bash
export KOREAN_PROSE_PROVIDER='google-ai-studio'
export KOREAN_PROSE_MODEL='gemini-3.7-flash'
```

Google AI Studio의 기본 모델은 `gemini-3.5-flash-lite`, Antigravity의 기본 모델은
`gemini-3.6-flash-low`입니다. Antigravity에서 선택할 수 있는 모델은 `agy models`로 확인해 주세요.

## 문체 규약

기본 문체 규약은 `skills/korean-prose/references/style.md`에 있고, 작업 중인 저장소 루트에 `docs/korean-style.md`가 있으면 해당 프로젝트의 문체 규약을 우선 적용하게 됩니다.

## 그 외 추천하는 스킬

[Kill AI Slop](https://killaislop.com/)
