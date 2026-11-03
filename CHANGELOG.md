# 변경 내역

## 1.1.1-lv.1

- 기억 창 크기가 루미버스 **요약 → 메시지 제한 → 컨텍스트 내 메시지 제한**을 따릅니다. 메시지 제한이 켜져 있고 유효한 개수이면 그 값을, 아니면 서재의 `window` 설정을, 둘 다 없으면 기본값 **30**을 사용합니다.
- Spindle 백엔드에 일반 사용자 설정 조회 API가 없어, 기존 프런트엔드 통신으로 해당 사용자의 인증된 `summarization` 설정을 읽습니다. 추가 권한 없이 정리 작업·답변 직전마다 새로 조회하며, 동시에 진행되는 조회만 공유합니다. 브라우저 미연결·조회 거부·설정 누락·시간 초과는 로그 한 줄 후 대체값으로 처리합니다.
- 서재 설정과 서랍에 현재 적용값·출처를 표시합니다. 서재 창 크기 입력란은 루미버스 메시지 제한이 꺼져 있을 때 적용됨을 안내하고 즉시 저장합니다.
- 장면 접기, 답변·회상 경계, 회상 테스트·일반 검색이 같은 창 크기 함수를 사용합니다. 경계가 바뀌면 회상 캐시도 다시 계산합니다. 전체 보관함 검색은 기존대로 창 제한을 받지 않습니다.
- 원작 코어와 UI 원본의 고정 해시는 유지했습니다. 우선순위·조회 실패·사용자 격리·작업별 갱신·실제 설정 HTML 표시 테스트를 추가했습니다.

## 1.1.0-lv.1

- 원작 기준을 `09d0699`(0.10.9)에서 `3498fd9e267bdb214efe214335245e3b7305ba96`(0.11.27)으로 갱신했습니다. 코어 6개와 UI 원본 3개는 바이트 단위 복사·SHA-256 고정, 화면은 정확히 한 번 일치하는 앵커 패치로 빌드합니다.
- **영어로 기억을 저장하고 서재에서는 한국어 번역을 함께 보기**를 지원합니다. 프롬프트 언어 auto/한국어/영어, 별도 번역 연결, 인용 번역 표시 설정은 기존 userStorage에 즉시 저장됩니다.
- 번역 실패 복구·분할·완료분 보존, 방 전환 때 오래된 번역/오류 차단, 기억 길이 재선정, 정리 중 수정·삭제 대응을 반영했습니다.
- 음식 중복 표시·수면/낮잠·꾸밈·이중 언어 인용·대사 상대 확인, 챕터 재생성 실패 시 기존 내용 보존을 반영했습니다. 새 모델 호출도 전부 Lumiverse `generate.quiet` 경로를 사용합니다.
- 번역의 답변 전 대기는 기존 인터셉터 예산 안에서 최대 1초입니다. 나머지는 뒤에서 준비하고 미번역 줄은 원문으로 남깁니다.
- 브라우저 QA는 로컬 리스닝 서버 없이 요청을 프로세스 안에서 처리합니다. `dist/`를 재빌드했습니다.

### 버전별 반영 / 옮기지 않은 것

원작 `git log 09d0699..3498fd9`의 코드·문서 커밋과 CHANGELOG를 함께 검토했습니다. PORT는 Lumiverse 연결·저장·채널로 옮긴 항목, SKIP은 호스트에 없는 Marinara 서버 기능입니다. 설치 스크립트(`install.sh`, `install.ps1`)와 원작 배포 ZIP은 가져오지 않습니다.

| 원작 버전 / 커밋 | 판정 | 반영 내용 또는 제외 이유 |
|---|---|---|
| 0.10.10 (`69e9299`, `a62eff0`, `46d3247`) | SKIP | Termux의 Marinara 서버 패치 앵커·설치 문서. Lumiverse는 서버 소스를 패치하지 않음 |
| 0.11.0 (`33a330a`) | PORT | 언어 감지, 프롬프트 언어 auto/ko/en, 별도 번역 연결, 한국어 보기, 인용 보존, 영어 날짜, 번역 캐시 |
| 0.11.1 (`4a4b8e3`) | PORT | 내부 값 대신 읽을 수 있는 텍스트만 검색 |
| 0.11.2 (`c27dd80`) | PORT | 장부 정리 중 과거 메시지 수정·삭제 시 이번 답변용 복사본에서 제외 |
| 0.11.3 (`d5bfde6`) | PORT | 여러 턴의 한 끼를 음식 이름으로 묶기 |
| 0.11.4 (`aa5204b`) | PORT | 언어 변경 시 켜진 방의 기억 준비, 진행 상황, 실패 후 재시도 |
| 0.11.5 (`f2bce21`) | PORT | 번역이 길어지면 기억을 다시 골라 끝 지침 보존 |
| 0.11.6 (`70d1996`) | PORT | 모든 방의 기억을 영어로 저장하는 설정과 한국어 표시 |
| 0.11.7 (`2a24778`) | PORT / SKIP | 빈 답 안내는 반영. Marinara provider의 DeepSeek `customParameters` 강제 변경은 제외: Lumiverse의 연결·프리셋·추론 설정과 생성 API가 요청을 구성하며 이 확장은 직접 provider를 만들지 않음 |
| 0.11.8 (`e8ef4b1`) | PORT / SKIP | 열기/닫기·Esc·공개 핸들 동작 반영. Marinara 서랍용 body 런처는 제외하고 Lumiverse 서랍·Extras·Ctrl+K 사용 |
| 연동 문서 (`f3dcc55`, `9d2b91a`, `7f343f7`) | PORT / SKIP | `ooc-archive`/`side-b` 전체 장면 검색 범위 반영. Marinara REST 설치·연동 안내는 제외(여기는 확장 채널 라우트) |
| 화면 최적화 (`3475b4d`, `ec38224`, `0fa0278`, `636d7e2`, `01555d1`, `9a5327b`, `2bc33c0`, `c5e25a9`, `194b6c1`, `75cd7bf`) | PORT | 변경된 설정만 저장, 중복 조회 제거, 장면 지연 로딩, 방 전환·폴링·번역 경합 방지. 배포 ZIP 안내는 이식판 빌드 문서로 대체 |
| 0.11.9 (`e7bfa88`) | PORT | 중간 활동으로 수면 구간 분리, 저녁 낮잠과 밤잠 구분 |
| 0.11.10 (`4d5bf40`) | PORT | 모든 탭 한국어 보기, 로딩 표시, 장부 탭 장면 연결, 검색 범위 통합 |
| 0.11.11 (`b1a54e5`) | PORT / SKIP | 번역 오류·남은 항목 재시도, 모바일 닫기, 압축 RP 날짜. Marinara 월드트래커 읽기는 제외하고 본문 날짜만 사용 |
| 0.11.11 이후 (`4858f46`, 별도 CHANGELOG 버전 없음) | PORT | 인물별 기억·관계 변화 보존, 챕터 재생성 실패·동시 편집 시 기존 챕터 유지 |
| 0.11.13 (`9f0f4a2`) | PORT | 내용/형식 실패 분할, 성공한 번역 보존, 개별 실패 격리, 연결·인증·사용량 오류는 분할하지 않음 |
| 0.11.14 (`9351266`) | PORT | 영어 인용과 이어지는 한국어 번역을 한 대사로 보존·복구 |
| 0.11.15 (`30faba3`) | PORT | 대사 상대 확인·편집, 날짜별 생활 묶기, 불확실한 수면 표시 |
| 0.11.16 (`0f74c93`) | PORT | 음식 순서·표현이 다른 중복 식사 표시 정리 |
| 0.11.17 (`f7f7fa8`) | PORT | 음식 동의 표현, 수면 이력, 닫기 버튼 대비·위치 |
| 0.11.18 (`d520b0f`) | PORT | 모델로 최대 20끼 의미 비교, 원본 보존·실패 시 기존 표시 유지 |
| 0.11.19 (`04541ae`) | PORT | 수면 경계 보정, 씻기와 꾸밈 구분 |
| 0.11.20 (`5fe214a`) | PORT | 이미 끝난 낮잠 회상을 새 잠듦으로 기록하지 않기 |
| 0.11.21 (`6b4a051`) | PORT | 데스크톱 닫기 복구, 최근 낮잠 횟수·확인된 시간 |
| 0.11.22 (`1939298`) | PORT | 지난 기상 주기별 낮잠 요약과 중복 미확인 수면 안내 정리 |
| 0.11.23 이름 표시 계열 (`2d26a42`, `3e825ec`, `c1d41cc`, `0f9d828`, `128cf0d`, `79c51e4`, `abc65ad`, `dbdd98d`, `1be49f9`, `65757a5`, `b4e53e4`) | SKIP | Marinara RP 생성 파이프라인의 화자 태그·대사 이름 주입. UI 스위치 제거. `speakers.cjs` 자체는 원본 그대로 복사·검증하지만 생성 훅은 연결하지 않음 |
| 0.11.24 (`085a95b`, `2a0e000`, `dec8ab5`, `3927c82`) | SKIP | Marinara 이름 생성 지침의 들여쓰기·패치 호환성 |
| 수신자 재시도 (`271ed1c`) | PORT | 첫 20건에서 끝내지 않고 모든 묶음 진행, 미확정 항목은 다음 실행에서 재확인 |
| 0.11.25 (`13d4bae`) | SKIP | Marinara 생성 결과의 기존 화자 태그에서 이름 표시 |
| 0.11.26 (`3a5ffc9`) | SKIP | Marinara 그룹 RP의 주변 발화 표지에서 이름 표시 |
| 0.11.27 (`3498fd9`) | SKIP | Marinara 개별 그룹 생성 대상 이름 보정. 원작 기준은 이 커밋에 고정 |

### 시험 이식과 제외

- 원본 코어 시험: 기존 ledger/scenes/recall/vectors/details/dialogue-provenance에 bilingual-quote, compact-date, emotional-continuity, meal-dedup, nap-summary, recipient-repair/retry, retrospective-sleep, routine-sleep-groom, semantic-meal-display, speakers를 추가/갱신했습니다.
- `test-language*.cjs`, `test-translation-retry/split.cjs`, `test-edit-during-read.cjs`, `test-library-retry-ui.cjs`는 `tests/upstream-*.test.js`로 옮겨 Lumiverse 서비스·저장소·호스트 어댑터·패치된 화면을 검사합니다. compact-date-flow의 본문 날짜와 emotional-continuity의 실패 보존은 `tests/memory-sync.test.js`에 이식했습니다.
- `test-context-names.cjs`, `test-individual-names.cjs`, `test-tagged-names.cjs`, `test-speaker-names.cjs` 및 `test-speakers.cjs` 중 서버 패치 시험은 SKIP: 제외한 Marinara 생성 훅 전용입니다. 순수 speakers 함수 시험은 유지합니다.
- `test-model-options.cjs`는 SKIP: Marinara의 provider/customParameters 구성 시험이며 Lumiverse가 연결/프리셋의 추론 설정을 관리합니다. 호스트의 빈 답·오류·JSON 모드 거절은 이식판 서비스 시험으로 검사합니다.
- compact-date/compact-date-flow의 월드트래커 시험은 SKIP: Lumiverse에 해당 트래커가 없습니다. `e2e-edit-during-read.mjs`의 Marinara 서버/가짜 HTTP 모델 기동은 SKIP하고 같은 수정·삭제 시나리오를 호스트 대역으로 검사합니다.
- `test-library-input-search.mjs`와 `test-side-b-search.cjs`의 Marinara 서버 기동·REST 연동은 SKIP. 패치된 실제 화면 검색은 브라우저 QA에서, `side-b`/`ooc-archive`/기본 회상 범위는 이식판 라우트 시험에서 검사합니다.

## 1.0.0-lv.1 (첫 공개)
- 비공개 이식판 LV-AnonMemory 0.2.0-lv.1 에서 기억 서재만 떼어 낸 독립 확장. 원작 기준 커밋 09d0699(런타임 0.10.9).
- 익명 커뮤니티 관련 코드·화면·서랍 탭·Extras/Ctrl+K 항목·RP 소재 주입·테스트·QA는 포함하지 않음.
- 포함: 기억 서재 전부(장면·사실·장부·챕터·큰 흐름, 회상, 채팅 분기 이어받기), 화면 닫기 보호(오버레이 가드), PC 스크롤 수정, `{{memory_ledger}}` 매크로.
- 권한: generation, chats, chat_mutation, characters, interceptor (embeddings 없음).
- 검증: 단위·원본·이식 테스트, 브라우저 QA, 스캐너 `[]`. 실호스트 동작은 README의 미확인 목록 참고.
