# 中→韓 공부 번역기 — 데스크톱 앱

Firefox 확장판과 같은 기능을 **독립 실행 프로그램**으로 만든 버전입니다 (Electron).
브라우저뿐 아니라 PDF 뷰어, 메모장, 카카오톡, 워드 등 **어떤 프로그램에서든** 사용할 수 있습니다.

## 사용법
- **빠른 분석:** 아무 프로그램에서 중국어를 드래그 → **`Ctrl+Alt+Z`** → 마우스 커서 옆에 분석 창이 뜹니다.
  - 분석 창 바깥 아무 곳이나 클릭하거나 `Esc`를 누르면 닫힙니다.
  - 분석 창 위쪽 🔉 막대로 발음 음량을 조절할 수 있습니다 (설정에서도 가능).
  - 자동 복사가 안 되는 프로그램에서는 `Ctrl+C`로 복사한 뒤 `Ctrl+Alt+Z`를 누르세요.
  - 설정에서 **클립보드 감시**를 켜면 중국어를 복사(`Ctrl+C`)하기만 해도 바로 분석 창이 뜹니다.
- **화면 글자 인식 (OCR):** 복사가 안 되는 글(이미지, 영상 자막 등)은 **`Ctrl+Alt+X`** → 화면에서 글자가 있는 영역을 드래그 → 인식된 글을 확인·수정 → Enter로 분석.
  - 인식 엔진(tesseract.js)이 프로그램에 들어 있어 인터넷 없이 동작합니다. 설정에서 간체/번체를 고를 수 있습니다.
- **메인 창:** 분석(직접 붙여넣기) · 보관함 · 테스트 · 설정. 확장판과 같은 화면입니다.
- 창을 닫으면 **트레이**(작업 표시줄 오른쪽 아래)로 숨습니다. 완전히 끄려면 트레이 아이콘 우클릭 → 종료.
- 설정에서 단축키 변경, 자동 복사 켜기/끄기, 컴퓨터 시작 시 자동 실행을 바꿀 수 있습니다.

## 설치 (Windows)
1. `ZhKoStudy-1.2.1-win-x64.zip`을 **압축 해제**합니다 (예: `C:\ZhKoStudy`). zip 안에서 바로 실행하면 안 됩니다.
2. 폴더 안의 `ZhKoStudy.exe`를 실행합니다. ("Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행**)
3. 처음 실행하면 **바탕화면·시작 메뉴 바로가기를 만들지** 묻습니다 → **만들기**.
   이후에는 바탕화면 아이콘이나 시작 메뉴에서 실행하면 됩니다.
- 설정 → **설치**에서 바로가기를 다시 만들거나 삭제할 수 있습니다.
- 바로가기를 만든 뒤에는 프로그램 폴더를 옮기거나 지우지 마세요.
- 삭제: 설정 → 설치 → 바로가기 삭제 → 트레이에서 종료 → 프로그램 폴더 삭제.

## AI 번역 (Claude, 선택)
- 설정 → AI 번역에 [Anthropic API 키](https://console.anthropic.com/settings/keys)를 넣으면 문장 번역과 단어별 문맥 뜻, 문법 포인트를 Claude 가 만듭니다 (`ai.js`).
- 기본 모델은 Claude Haiku 5.5 (문장 1,000개에 약 $0.25), 설정에서 Claude Sonnet 5.5 로 바꿀 수 있습니다.
- 키는 `config.json`에 Electron `safeStorage`(Windows DPAPI)로 암호화해 저장합니다. 키가 없거나 실패하면 Google 번역을 씁니다.

## 사전
- `data/ko-chars-*.txt`: 자주 쓰는 한자·기능어의 한국어 뜻 (읽기별, 직접 작성). 수정 후 `npm run build-dict`
- `dict/cedict.tsv`: [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cedict) 기반 영어 뜻 (CC BY-SA 4.0)
- 단어 뜻은 ① 한국어 사전 → ② 없으면 Google 번역 순서로 보여주고, CC-CEDICT 영어 뜻을 참고로 함께 표시합니다.

## 데이터
- 보관함·설정은 `%APPDATA%\ZhKoStudy\data.json`, `config.json`에 저장됩니다.
- 확장판 보관함에서 "내보내기"한 JSON을 앱의 보관함 → "가져오기"로 옮길 수 있습니다 (반대도 가능).
- 번역·사전 뜻은 Google 번역에서 가져오므로 분석한 글이 Google로 전송됩니다. 병음·단어 나누기·한자음은 오프라인 계산.

## 소스에서 실행 / 빌드
```bash
npm install
npm start            # 개발 실행
npm run dist:win     # Windows 설치 파일 (dist/)
npm run dist:mac     # macOS (Mac에서 실행)
npm run dist:linux   # Linux AppImage
```
macOS에서는 자동 복사에 **손쉬운 사용(접근성)** 권한이 필요하고, Linux는 `xdotool`이 필요합니다.

## 구조
| 파일 | 역할 |
|---|---|
| `main.js` | 전역 단축키, 선택 글 자동 복사(Windows: PowerShell SendKeys), 클립보드 감시, 트레이, 데이터 저장 |
| `preload.js` | 화면에 최소한의 통신 기능만 노출 |
| `src/shim.js` | 확장 API(`browser.*`) 대체 구현 → 확장판 코드를 그대로 재사용 |
| `src/quick.*` | 빠른 분석 창 (화면 전체를 덮는 투명 창), 화면 글자 인식 영역 선택 |
| `src/ocr.js`, `src/ocr/` | 글자 인식 (tesseract.js, 중국어 간체·번체 데이터). `npm run sync-ocr`로 갱신 |
| `src/app.*`, `src/app-desktop.js` | 메인 창 (분석 · 보관함 · 테스트 · 설정) |
| `src/content.js`, `src/background.js`, `src/lib/` | 분석 엔진·UI |
| `dict.js`, `dict/`, `data/` | 사전 조회 (한국어 뜻 + CC-CEDICT) |

## 자동 업데이트
- 앱은 시작할 때와 6시간마다 이 저장소의 **최신 릴리스**(GitHub Releases)를 확인합니다.
- 새 버전이 있으면 설치 여부를 묻고, `ZhKoStudy-<버전>-win-x64.zip`을 내려받아 프로그램 폴더를 교체한 뒤 다시 실행합니다.
- 설정 → 업데이트에서 직접 확인하거나 자동 확인을 끌 수 있습니다.

### 새 버전 배포 (개발자용)
1. `package.json`의 `version`을 올리고(예: 1.3.1), `release-notes.md`에 변경 내용을 적습니다.
2. `main` 브랜치에 push 합니다.
3. GitHub Actions(`.github/workflows/release.yml`)가 Windows에서 빌드해 `v1.3.1` 릴리스를 만들고 zip을 첨부합니다.
   사용자 앱은 다음 확인 때 자동으로 업데이트를 안내합니다.
