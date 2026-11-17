# Korean Prose

한국어 작성 및 교정 [Agent Skills](https://agentskills.io/)입니다.

영어를 직역했거나 문체가 고르지 못한 기술 문서, PR 본문, UI 문구를 한국어 원어민이 읽었을 때 자연스럽고 매끄러운 문장으로 다듬습니다.

(e.g. `버튼 눌러요` -> `버튼을 눌러주세요`)
<img width="803" height="393" src="https://github.com/user-attachments/assets/2aa58b36-4f95-414e-bcf8-4a4fa4bea8b3" />


Codex와 Claude Code를 비롯한 Agent Skills 호환 에이전트에서 사용할 수 있습니다.

## 원리

- 가능하다면 `Gemini`로 문서의 초고를 작성하고, 스킬에 내장된 문체 가이드를 바탕으로 가독성이 떨어지는 문장을 정리합니다.
  - `Gemini` 호출시 기본적으로 `OpenRouter`를 사용합니다. 다만, `Google AI Studio`나 로그인된 상태의 `Antigravity CLI`도 사용할 수 있습니다.
- 코드나 다국어(i18n) 문구를 다듬을 때는 해당 문구가 실제로 호출되는 코드 위치, 전후 동작 맥락, 인접 문구 등의 정보를 먼저 조사하여 반영합니다.
  - 또한, `초고 작성용 Gemini`가 문장이 사용되는 컨텍스트를 직접적으로 이해할 수 있도록 읽기 전용 도구(`search_code`, `read_file`, `list_files`)를 제공합니다. (`--no-tools`로 해당 동작을 비활성화할 수도 있습니다)
- LLM 특유의 글쓰기 패턴도 억제합니다.
  - `확인되지 않은 사실이나 출처 보태기`
  - `과장`
  - `쓸데없는 홍보 문구`
  - `틀에 박힌 결론`
  - `단순히 A가 아니라 B다`
  - `A보다 B에 가깝다`
  - `감각적인 척하는 추상어 조합`
  - `대상이 흐릿한 지시어`
  - `조사와 어미를 떼어낸 명사 나열체`
  - 등등...

## 설치

### 모든 에이전트 공통

https://www.skills.sh/jellybrick/korean-prose-skill/korean-prose

해당 링크에서 스킬을 간단한 방법으로 설치할 수 있습니다.

<details>
  <summary>
    수동 설치 방법
  </summary>
  
#### Codex

Codex에 저장소 경로를 전달하여 설치를 요청할 수 있습니다.

```text
다음 스킬을 설치해 주세요:
https://github.com/JellyBrick/korean-prose-skill/tree/main/skills/korean-prose
```

직접 설치하려면 저장소를 복제한 뒤 스킬 폴더를 Codex 개인 설치 경로로 복사해 주세요.

```bash
git clone https://github.com/JellyBrick/korean-prose-skill.git
mkdir -p ~/.codex/skills
cp -R korean-prose-skill/skills/korean-prose ~/.codex/skills/korean-prose
```

#### Claude Code

저장소를 복제한 뒤 스킬 폴더를 Claude Code 개인 설치 경로로 복사해주세요.

```bash
git clone https://github.com/JellyBrick/korean-prose-skill.git
mkdir -p ~/.claude/skills
cp -R korean-prose-skill/skills/korean-prose ~/.claude/skills/korean-prose
```

Claude Code의 설치 위치와 호출 방식은 [Claude Code 스킬 문서](https://code.claude.com/docs/en/slash-commands)에서 확인하실 수 있습니다.

#### 기타 Agent Skills 호환 에이전트

사용 중인 Agent의 문서에서 안내하는 스킬 디렉터리에 `skills/korean-prose` 폴더를 복사해 주세요.

</details>

## 주의!!

> [!WARNING]  
> LLM이 생성된 문장은 항상 검토가 필요한 초안입니다.
> 
> LLM이 파일 경로, 숫자, 세부 동작을 원문과 다르게 작성할 수 있으므로 최종 반영 전에 원본과 일치하는지 직접 확인하세요!!

## 요구 사항 및 설정

- Agent Skills를 지원하고 로컬 명령을 실행할 수 있는 에이전트
- Node.js 24+
- 선택한 제공자에 필요한 API 키 또는 CLI 로그인 상태
  - OpenRouter: `OPENROUTER_API_KEY`
  - Google AI Studio: `GEMINI_API_KEY`
  - Antigravity: 설치 및 로그인을 마친 Antigravity CLI

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

### Antigravity

Antigravity CLI를 설치한 뒤 대화형 세션에서 로그인하거나 CLI를 통해 로그인해주세요.

그리고, korean-prose 스킬을 사용하기 전, 해당 에이전트에서 아래의 프롬프트를 입력해주세요.

```text
korean-prose 스킬을 사용할 때 Antigravity 모드로 사용하도록 메모리해.
```

이 뒤부터는 korean-prose 스킬이 `agy`를 헤드리스 모드로 호출해서 사용하게 됩니다.

> [!CAUTION]
> [Google Antigravity 추가 약관](https://antigravity.google/terms)은 제3자 제품이나 도구와 연결해 서비스를 사용하는 행위를 위반으로 해석할 수 있도록 규정하고 있습니다.
> 
> 구글 계정이 제한되거나 정지될 위험이 있으므로, 약관을 직접 확인한 뒤 사용해 주세요.

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

argument에는 작성 요청을, stdin에는 참고 자료나 변경 사항을 적어주세요. 그리고, `--medium` 옵션에는 글이 게시될 매체의 타입을 지정해주세요. 

- `--provider`에는 `openrouter`, `google-ai-studio`, `antigravity` 중 하나를 지정할 수 있습니다.
  - `openrouter`와 `google-ai-studio` 제공자는 필요할 때 저장소 안의 코드와 다국어 문구를 읽기 전용 도구로 조회합니다. 도구 호출을 사용하지 않으려면, `--no-tools` 옵션을 사용해주세요.
- `--model`을 생략하면 제공자별 기본 모델을 사용합니다.

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
명령줄 옵션은 환경변수보다 우선순위가 높습니다. 

```bash
export KOREAN_PROSE_PROVIDER='google-ai-studio'
export KOREAN_PROSE_MODEL='gemini-3.7-flash'
```

Google AI Studio의 기본 모델은 `gemini-3.5-flash-lite`, Antigravity의 기본 모델은
`gemini-3.6-flash-low`입니다. Antigravity에서 선택할 수 있는 모델은 `agy models`로 확인해 주세요.

## 문체 가이드

- 기본 문체 가이드는 `skills/korean-prose/references/style.md`에 있습니다.
- 작업 중인 레포지토리 루트 디렉토리에 `docs/korean-style.md`가 있으면 해당 프로젝트의 문체 가이드를 먼저 적용합니다.

## 그 외 추천하는 스킬

[Kill AI Slop](https://killaislop.com/)
