# 기억 서재 1.3.0-lv.1 작업 보고서

2026-11-09 (Asia/Seoul). `feature/1.3.0`에서 구현. 커밋·스테이징하지 않았습니다.

## 기준 및 upstream 확인 제한

첫 Git 작업으로 `git fetch upstream`을 실행했지만 `.git/FETCH_HEAD`가 읽기 전용이라 실패했습니다. 이어서 `git ls-remote upstream HEAD refs/heads/main`으로 읽기 전용 확인을 시도했으나 `Could not resolve host: github.com`으로 실패했습니다. 따라서 **upstream이 8d5f090 이후 전진했는지는 확인하지 못했으며 변경 내역을 추정하지 않습니다.** 기준은 `8d5f0901602cbd652997dcf4dbde9b641d29b387` / runtime 0.12.6 그대로입니다. 이후 커밋을 적용하지 않았습니다.

REPORT-1.2.0의 20 SKIP 계약을 모두 구현하고 해당 화면을 열었습니다. 새 순수 코어 backup/conflicts/reasons/selected/trackers 5개를 로컬 Git의 고정 커밋에서 추출했습니다. 코어·지원 모듈 19개 + UI 3개는 SHA-256 고정 원본이며 conflicts/backup의 scenes import는 기존 방식대로 실행용 생성물에서만 패치합니다. 원작 service.cjs는 동작 참고로만 읽었고 서비스·저장·라우트·DOM 연결은 Lumiverse 구현입니다. MIT LICENSE 및 원작자·원 공유글 고지를 유지합니다.

## 동작과 저장 계약

- 새 상태/장소/물건/트래커/충돌/회상 표시/선택 기억 파일은 모두 기존 `memory/chats/<id>.<종류>.json`과 원작 데이터 모양을 사용합니다. 모든 읽기·쓰기는 요청 사용자의 userStorage에 한정합니다. 기존 1.1.x/1.2.0 자료를 삭제하거나 다시 만드는 마이그레이션은 없습니다.
- characterState·places·keepsakes는 기존 장면 정리 요청에 함께 읽으며 새 호출은 없습니다. 직접 고친 값은 코어의 user 잠금으로 보존합니다. 장면 저장, 편집, 이름 변경/되돌리기 때 파생 기록을 갱신하고 답변 시에는 메시지 편집/삭제를 반영한 장면 복사본으로 상태를 계산합니다. 끄기는 저장 파일을 지우지 않습니다.
- 분기 시 상속 가능한 장면으로 상태/장소/물건/충돌을 다시 접고, 회상 표시는 남은 ID만 유지합니다. 선택 기억은 공통 메시지 범위만 넘기고 새 메시지 ID·번호에 연결합니다. 기존 대상 파일(신규 파일 포함) 또는 설정이 있으면 덮어쓰지 않습니다. 트래커의 사용자 기록과 자동 적용 이력은 원작 forBranch 정책대로 보존하고 사라진 장면의 제안은 제외합니다.
- 충돌 판단은 기록으로 남고 keepA/keepB가 지목한 사실을 주입에서 제외합니다. 사실이 합쳐지면 제외 판단도 후속 사실을 따릅니다. 원본 사실은 지우지 않으며 다시 열기로 판단을 취소합니다.
- 중요/빼기는 회상 후보, 뜻 검색, 개요, 장면 회상, 근처 사건, 원문 회상에 연결합니다. 제외된 장면을 담은 챕터/큰 흐름도 숨겨 요약을 통한 재주입을 막습니다. 사실의 표시는 replacedBy를 따릅니다. 회상 보고서는 요청 시만 trace를 생성하며 주입문에 이유를 섞지 않습니다. 인터셉터에 새 모델 호출을 추가하지 않았습니다.
- Lumiverse의 읽기 허용 소스 `~/Lumiverse/frontend/src/components/chat/MessageContent.tsx`, BubbleMessageDefault.tsx 및 MessageList.tsx에서 `data-component="MessageContent"`와 중첩 `data-message-id`를 확인했습니다. 본문만 선택하고 중복 ID를 제거합니다. 서버는 원문 부분 문자열·ID·내용 해시를 정리 전후 검증하고, 수정/삭제된 원문의 선택 기억은 주입하지 않습니다. 선택 정리는 버튼을 눌렀을 때만 모델을 호출합니다. 시험은 모두 가짜 모델입니다.
- 백업은 원작 JSON header/files/settings/fileHashes 계약입니다. 복원은 방 요청·장부·장면·선택 작업 큐를 확보하고, `memory/restore-undo/<id>/snapshot.json`에 현재 파일의 **원문 바이트**와 설정을 저장·재조회 검증한 뒤 교체합니다. 빠진 파일도 제거하며 기억 on/off는 현재 설정을 유지합니다. 교체 실패 시 모든 이전 파일과 설정 복구를 시도합니다. 복구도 실패하면 안전 사본을 남기고 오류를 표시하여 저장소 복구/재시작 후 undo로 되돌릴 수 있습니다. 읽기는 교체 중간 상태를 보지 않습니다. 손상 파일도 안전 사본으로 보존하므로 정상 백업으로 복원할 수 있습니다.
- 고아 자료는 요청 사용자의 저장소 파일/설정만 후보로 삼고 사용자별 전체 채팅 목록과 get 조회를 재확인합니다. 권한/통신 실패를 삭제로 간주하지 않습니다. 현재 방 삭제는 거절하고 단일/전체 삭제 모두 `confirm:true`가 필요합니다. 사용자 확인 후 UI가 이 값을 전달합니다.
- 메시지 조회 전에 사용자별 방 접근을 확인합니다. 렌더 캐시 역시 사용자+방으로 분리했습니다. userId가 없는 구형 호스트 매크로 문맥은 데이터 없는 표지만 돌려주며 실제 사용자별 인터셉터가 내용을 채우거나 끄기 상태이면 제거합니다.
- 기존 대비 보정, 한국어/별칭 검색, `/api/v1/settings` 메시지 제한, 6초 기본 주입 예산, HTTP/Tailscale UUID fallback, 본문 15px/보조 13px/터치 44px 규칙을 유지합니다. 선택 버튼도 15px/44px입니다. 추가 사용량 제한은 없습니다.

## PORT 표

1.2 보고서의 신규 계약 42개는 이제 **42 PORT / 0 SKIP**입니다. 기존 등록 55개에 이번 20개가 더해 총 75개입니다. 이 표는 해당 42개 계약을 비교합니다. Marinara 전용 설치/삭제/생성 훅, SIDE B 서비스 자체, 창 이동/크기조절은 계속 이식 대상이 아닙니다.

| Method | 경로 | 판정 | 구현 |
|---|---|---|---|
| GET | `/chats/:id/address` | PORT | 호칭 수집·원어/번역 묶기·편집 학습·자동 적용·정확한 되돌리기. |
| POST | `/chats/:id/address` | PORT | 호칭 수집·원어/번역 묶기·편집 학습·자동 적용·정확한 되돌리기. |
| POST | `/chats/:id/address/applied/:aid/undo` | PORT | 호칭 수집·원어/번역 묶기·편집 학습·자동 적용·정확한 되돌리기. |
| POST | `/chats/:id/address/suggestion/:sid` | PORT | 호칭 수집·원어/번역 묶기·편집 학습·자동 적용·정확한 되돌리기. |
| POST | `/chats/:id/attribution-check` | PORT | 전역 기본값/방별 override. off/rules/default/thorough, follow 지원. |
| GET | `/chats/:id/attribution-log` | PORT | 최근 5회 기록을 별도 조회. room 응답은 개수·stamp만 포함. |
| GET | `/chats/:id/backup` | PORT | 원작 백업 JSON·해시·설정 계약. 벡터 포함 선택, 손상 파일은 실패로 보고. |
| GET | `/chats/:id/conflicts` | PORT | 충돌 자동 검출, 판단 기록·다시 열기, 선택한 사실 제외, 병합 후 후속 사실에도 판단 반영. |
| POST | `/chats/:id/conflicts/:cid` | PORT | 충돌 자동 검출, 판단 기록·다시 열기, 선택한 사실 제외, 병합 후 후속 사실에도 판단 반영. |
| POST | `/chats/:id/feature-mode` | PORT | recentLife·characterState·places·keepsakes·trackers·autoApply 전체 기본값/방별 선택 지원. |
| POST | `/chats/:id/keepsakes` | PORT | 방별 추가 기능. 수동 잠금·해제, 장면 기반 갱신/분기, 트래커 날짜/시작일/제안/자동 적용 되돌리기. |
| GET | `/chats/:id/names` | PORT | 기준 이름·별칭, 미리 보기 토큰·병합·글 표기·되돌리기. 두 작업 큐 잠금과 파일 손상 검사. |
| POST | `/chats/:id/names/alias-text-apply` | PORT | 기준 이름·별칭, 미리 보기 토큰·병합·글 표기·되돌리기. 두 작업 큐 잠금과 파일 손상 검사. |
| POST | `/chats/:id/names/alias-text-preview` | PORT | 기준 이름·별칭, 미리 보기 토큰·병합·글 표기·되돌리기. 두 작업 큐 잠금과 파일 손상 검사. |
| POST | `/chats/:id/names/apply` | PORT | 기준 이름·별칭, 미리 보기 토큰·병합·글 표기·되돌리기. 두 작업 큐 잠금과 파일 손상 검사. |
| POST | `/chats/:id/names/dismiss` | PORT | 기준 이름·별칭, 미리 보기 토큰·병합·글 표기·되돌리기. 두 작업 큐 잠금과 파일 손상 검사. |
| POST | `/chats/:id/names/merge` | PORT | 기준 이름·별칭, 미리 보기 토큰·병합·글 표기·되돌리기. 두 작업 큐 잠금과 파일 손상 검사. |
| POST | `/chats/:id/names/merge-preview` | PORT | 기준 이름·별칭, 미리 보기 토큰·병합·글 표기·되돌리기. 두 작업 큐 잠금과 파일 손상 검사. |
| POST | `/chats/:id/names/preview` | PORT | 기준 이름·별칭, 미리 보기 토큰·병합·글 표기·되돌리기. 두 작업 큐 잠금과 파일 손상 검사. |
| POST | `/chats/:id/names/undo` | PORT | 기준 이름·별칭, 미리 보기 토큰·병합·글 표기·되돌리기. 두 작업 큐 잠금과 파일 손상 검사. |
| POST | `/chats/:id/organize-preferences` | PORT | NPC 범위·인용 종류·자세함을 실제 scene prompt/apply/render에 연결. |
| POST | `/chats/:id/places` | PORT | 방별 추가 기능. 수동 잠금·해제, 장면 기반 갱신/분기, 트래커 날짜/시작일/제안/자동 적용 되돌리기. |
| POST | `/chats/:id/recall-prefs` | PORT | 실제 렌더 trace와 중요/빼기. 검색·주입·분기·사실 병합에 반영하며 새 모델 호출 없음. |
| GET | `/chats/:id/recall-report` | PORT | 실제 렌더 trace와 중요/빼기. 검색·주입·분기·사실 병합에 반영하며 새 모델 호출 없음. |
| POST | `/chats/:id/restore/apply` | PORT | 사용자 저장소 전체 파일 교체. 검증된 안전 사본, 실패 rollback, 재시작 후 undo, 요청/작업 큐 동기화. |
| POST | `/chats/:id/restore/preview` | PORT | 사용자 저장소 전체 파일 교체. 검증된 안전 사본, 실패 rollback, 재시작 후 undo, 요청/작업 큐 동기화. |
| POST | `/chats/:id/restore/undo` | PORT | 사용자 저장소 전체 파일 교체. 검증된 안전 사본, 실패 rollback, 재시작 후 undo, 요청/작업 큐 동기화. |
| POST | `/chats/:id/routine-mode` | PORT | 기존 자료 보존, 새 기록/주입만 끄기, 꺼진 구간 기록. |
| GET | `/chats/:id/selected-memories` | PORT | Lumiverse MessageContent 선택과 메시지 ID/원문 검증. 정리 전후 재검사, 중복 방지·stale 제외·삭제. |
| POST | `/chats/:id/selected-memory` | PORT | Lumiverse MessageContent 선택과 메시지 ID/원문 검증. 정리 전후 재검사, 중복 방지·stale 제외·삭제. |
| DELETE | `/chats/:id/selected-memory/:memoryId` | PORT | Lumiverse MessageContent 선택과 메시지 ID/원문 검증. 정리 전후 재검사, 중복 방지·stale 제외·삭제. |
| POST | `/chats/:id/state` | PORT | 방별 추가 기능. 수동 잠금·해제, 장면 기반 갱신/분기, 트래커 날짜/시작일/제안/자동 적용 되돌리기. |
| GET | `/chats/:id/threads` | PORT | 큰 원문 근거 배열을 필요할 때 조회. room에는 개수·stamp만 포함. |
| GET | `/chats/:id/trackers` | PORT | 방별 추가 기능. 수동 잠금·해제, 장면 기반 갱신/분기, 트래커 날짜/시작일/제안/자동 적용 되돌리기. |
| POST | `/chats/:id/trackers` | PORT | 방별 추가 기능. 수동 잠금·해제, 장면 기반 갱신/분기, 트래커 날짜/시작일/제안/자동 적용 되돌리기. |
| GET | `/chats/:id/world` | PORT | 방별 추가 기능. 수동 잠금·해제, 장면 기반 갱신/분기, 트래커 날짜/시작일/제안/자동 적용 되돌리기. |
| GET | `/orphans` | PORT | 요청 사용자 userStorage와 사용자별 방 목록/get 확인. 접근 실패는 삭제로 간주하지 않음. 삭제는 confirm:true 필수. |
| DELETE | `/orphans/:id` | PORT | 요청 사용자 userStorage와 사용자별 방 목록/get 확인. 접근 실패는 삭제로 간주하지 않음. 삭제는 confirm:true 필수. |
| POST | `/orphans/delete-all` | PORT | 요청 사용자 userStorage와 사용자별 방 목록/get 확인. 접근 실패는 삭제로 간주하지 않음. 삭제는 confirm:true 필수. |
| POST | `/settings/attribution-check` | PORT | 전역 기본값/방별 override. off/rules/default/thorough, follow 지원. |
| POST | `/settings/features` | PORT | recentLife·characterState·places·keepsakes·trackers·autoApply 전체 기본값/방별 선택 지원. |
| POST | `/settings/routine` | PORT | 기존 자료 보존, 새 기록/주입만 끄기, 꺼진 구간 기록. |

## 검증

- `npm test`: **73개 테스트 파일 통과, 실패·취소·skip 0** (Node 러너 집계). 기존 회귀와 새 Lumiverse 서비스·선택 DOM 테스트, 원작 conflicts/trackers/auto-apply/recall-reasons/selected 순수 사례, 선택/백업 UI 사례를 포함합니다.
- `tests/release-1.3.test.js`: 20개 새 계약 인증/방 접근 거절, 사용자 격리, 수동 잠금/해제, 충돌 판단/병합, 제외/trace, 트래커 자동 적용 undo, 선택 전후 원문 검증, 백업/복원/재시작 undo, 쓰기·삭제 실패 rollback, 안전 사본 저장 실패, 복구 실패 후 재시작 undo, 분기, 기존 대상 파일 보호, 동시 선택·복원·읽기, 분기 저장 실패 후 정리/재시도, 잘못된 백업 거절, 고아 삭제 범위/확인 등을 검증합니다.
- `npm run verify:original` 및 `UPSTREAM_MEMORY=<8d5f090에서 추출한 임시 디렉터리> npm run verify:original`: `{ "ok": true, "problems": 0 }`. **22개 원본 바이트 일치**, LICENSE도 고정 커밋과 동일합니다.
- backend 번들 정적 안전성 검사와 사용자 없는 매크로 표지의 사용자별 교체/제거 시험도 통과했습니다.
- `BUN_BIN=/home/syhekate/.bun/bin/bun npm run build`: backend 33 modules / frontend 10 modules, 두 dist 번들 생성.
- `npm run qa:ui-fix`: 기본 호출은 Playwright 경로 미설정으로 실패. 지정된 PLAYWRIGHT_MODULE/CHROMIUM_BIN으로 다시 실행했으나 Chromium이 앱 실행 전에 `setsockopt: Operation not permitted` / SIGTRAP으로 종료했습니다.
- 요청된 `QA_ONLY=chromium PLAYWRIGHT_MODULE=$HOME/dev/marinara-sojaefactory/node_modules/playwright/index.mjs CHROMIUM_BIN=/usr/bin/chromium npm run qa:browser`: 같은 sandbox Chromium 실행 제한으로 **0 variants / 0 views**, 통과로 보고하지 않습니다. 두 harness의 탭 순회에 world를 추가했고 browser QA에는 names도 포함했습니다. fake backend에 상태/장소/물건/트래커/선택 기억/회상 표시/고아 자료를 준비했으며 해당 경로 응답과 실제 자료 개수를 별도 확인했습니다.
- `git diff --check`: 통과. 새 core 파일도 고정 Git 객체와 바이트 일치.

## 위험 및 남은 실호스트 QA

1. upstream 최신 여부와 Chromium 기반 실제 화면 측정은 환경 제한으로 미확인입니다. 찹쌀의 실호스트 QA에서 새 world/trackers, 충돌·회상 표시, 본문 선택, 백업 파일 다운로드/업로드/되돌리기, 고아 삭제를 확인해야 합니다. 허용되지 않은 포트에 접속하거나 실행 중인 서버를 건드리지 않았습니다.
2. userStorage에는 다중 파일 원자적 교체가 없습니다. 실행 중 실패는 rollback으로 처리하지만 **복원 도중 프로세스/기기가 종료되면 자동 시작 복구를 수행하지 않습니다**. 저장된 안전 사본으로 복원 되돌리기를 사용할 수 있습니다. 저장소 자체가 계속 실패하면 완전한 복구를 보장할 수 없으며 오류와 안전 사본 경로를 표시합니다.
3. DOM에 렌더된 글이 매크로/HTML/마크다운/치환 등으로 실제 저장 원문과 다르면 추측하여 저장하지 않고 검증 실패로 안내합니다. 여러 메시지를 선택할 때 본문 밖 UI가 포함되면 거절합니다. 메시지 표시 플러그인이 기본 MessageContent 계약을 제공하지 않는 경우 선택 버튼이 나오지 않을 수 있습니다.
4. 실제 모델 품질·큰 방의 저장 지연·기기별 터치/선택 동작은 가짜 호스트 시험만으로 확인할 수 없습니다. 새 상태/장소/물건 기록은 스위치를 켠 뒤 새로 정리한 장면부터 채워집니다.

금지된 Lumiverse-ko 경로, context 텍스트, /srv/devwork에 접근하지 않았습니다. 다른 이식 저장소 및 ~/Lumiverse를 수정하지 않았고 금지 포트/호스트, 실모델, 비밀정보, 전역 설치, 커밋을 사용하지 않았습니다.

## fix1 — 2026-11-09

지시서 `BRIEF-lv-1.3.0-fix1.md`와 허니 검수 판정을 읽고 `feature/1.3.0` / `f66a7e0` 위에서 수정했습니다. 변경은 **스테이징·커밋하지 않았습니다**. SHA 고정 원본 22개는 수정하지 않았으며, 코어 동작 변경은 기존 scenes-import 방식의 생성 패치로만 적용했습니다. `backup.settings` whitelist/type validation은 구현하지 않았습니다. 새로운 사용량 제한도 추가하지 않았습니다.

| 항목 | 변경 및 위치 | 회귀 검증 |
|---|---|---|
| F1 | `src/common/store.js:36`에서 사용자+키별 쓰기를 직렬화하고 `flushKey`로 debounce 대기와 실행 중인 쓰기를 모두 기다립니다. `replaceRaw`도 이를 거칩니다. `src/memory/service.js:331`의 `saveRoomSettings`는 최신 전역 설정에 대상 방 항목만 동기적으로 합친 뒤 저장·flush하여 다른 방의 저장과 cache를 덮어쓰지 않습니다. 복원/undo/고아 삭제(`src/memory/room-backup.js:42`, `:150`)와 분기 실패 정리(`src/memory/service.js:1623`)를 연결했습니다. rollback 쓰기가 오류를 보고해도 실제 저장된 파일 바이트와 방 설정이 이전 상태와 같으면 복구 실패라고 하지 않습니다(`src/memory/room-backup.js:47`, pending cache가 아닌 저장소 원문 재확인). | `tests/fix1.test.js:29`: apply/undo/orphan 각각 debounce 500ms, 다른 방 pending 저장, 실제 쓰기 중 20ms 지연과 추가 저장까지 겹쳐 디스크/cache와 고아 설정 제거 확인. `:58` raw 교체의 대기, `:195` 쓰기는 완료됐지만 acknowledgement가 실패한 경우. 기존 `tests/release-1.3.test.js:277`의 rollback 실패 시험은 실제 바이트가 바뀐 뒤 복구도 실패하도록 보강했습니다. |
| F2 | `src/memory/room-features.js:20`, `:28`: scenes가 null이거나 파일 키가 blocked이면 파생 자료 refresh/save를 하지 않습니다. 읽지 못한 장면을 emptyStore로 간주해 기존 인물/장소/물건/충돌/트래커/회상 표시를 재기록하지 않습니다. | `tests/fix1.test.js:67`: missing/broken/지원하지 않는 버전/일시적 read 오류 각각에서 world/trackers/conflicts GET 전후 저장소 동일. `:85` scenes 없는 conflicts 백업 복원 후 GET, `:205` 기존 cache는 있지만 키가 blocked인 경우. |
| F3 | `src/memory/core-patch.mjs:58`에서 생성 conflicts 코어만 패치합니다. MAX_RECORDS의 제거 후보는 both/dismissed뿐이며 keepA/keepB는 150건을 넘어도 보존합니다. 사실이 일시적으로 없어진 경우에도 판단을 유지합니다. 분기에는 공통 사실의 판단만 전달합니다(`src/memory/room-features.js:96`). 원본 MAX_RECORDS/MAX_OPEN 숫자는 그대로입니다. | `tests/fix1.test.js:105`: 170건 판단 → fold/save/restart → 기각 사실 및 병합 후속 사실 제외. `:117`: both/dismissed만 제거. `tests/upstream/test-conflicts-core.cjs:88`, `:141`의 생성 코어 기대값을 새 보존 계약/omittedAuto 응답에 맞췄습니다. |
| F4 | `src/memory/service.js:1334`, `:1413`: 정상 렌더에는 검증한 선택 기억을 포함하지만 cachedRendered에는 선택 기억을 제외한 별도 렌더를 저장합니다. 시간 초과 fallback은 원문을 다시 확인할 수 없으므로 선택 기억을 내보내지 않습니다. 언어 변환 뒤 길이를 다시 맞추는 경로에도 같은 옵션을 전달합니다. | `tests/fix1.test.js:159`: 선택 기억이 정상 렌더에 들어간 것을 확인한 다음 원문 편집/삭제, sync가 완료되지 않아 실제 budget timeout 발생, fallback에서 선택 전용 내용이 빠지는지 확인. |
| F5 | `src/memory/core-patch.mjs:37`: 인물/장소/물건의 user 잠금·custom·사용자 별칭이 있는 카드는 cap 밖에서도 보존합니다. 직접 추가한 카드와 트래커에는 개수 거절을 적용하지 않고, reasons의 2000개 slice도 생성물에서만 제거했습니다(`:52`, `:55`). 자동 카드의 기존 60/80/60 및 열린 충돌 30 한도 때문에 빠진 개수는 omittedAuto로 전달합니다(`src/memory/room-features.js:75`, `src/memory/core-patch.mjs:62`). UI에 “자동 항목 …개는 표시 한도로 생략했습니다. 직접 고친 기록과 판단은 보존합니다.”를 표시합니다(`src/memory/ui/patch.mjs:138`). | `tests/fix1.test.js:125`: 각 cap보다 5개 많은 수동 카드 보존, 오래된 잠금 카드 보존과 자동 생략 4건. `:143`: 트래커 35개 수정/분기, 중요 2100개와 빼기 2100개 정규화/병합. `:153`: 충돌 36건 중 열린 30건+생략 6건. `:223`: 실제 생성 UI 함수의 한국어 개수 안내. |
| F6 | `src/memory/room-backup.js:87`: 두 번째 복원 전에 기존 snapshot.json 원문을 snapshot.prev.json에 쓰고 재조회 검증합니다. undo는 이전 사본을 승격하여 연속 두 단계까지 되돌릴 수 있습니다(`:110`). 고아 삭제 시 두 사본을 정리합니다. preview.removes는 파싱 성공 여부와 무관하게 실제 기존 파일 목록에서 산출하여 lang/vectors/손상 파일도 포함합니다(`:77`). 화면에서도 목록을 표시합니다(`src/memory/ui/patch.mjs:146`). | `tests/fix1.test.js:172`: 연속 복원 두 번과 undo 두 번 후 원문 바이트 동일. `:185`: lang/vectors/selected 손상 파일을 preview와 실제 제거 양쪽에서 확인. `:214`: prev 사본 검증 실패 시 방 파일 변경 없음. `:223`: UI의 lang 포함 삭제 목록. |
| F7 | QA의 `chat-none`은 실제 fake host에 없었습니다. 1.3의 방 접근 검사가 이를 거절 → drawer assertion 실패 → `chat-a` 복귀가 실행되지 않음 → 빈 화면/없는 setRecall → chat-a 명령을 다른 방 문맥에서 무시하는 연쇄였습니다. `qa/backend-env.mjs:22`에 실제 빈 방을 만들고 `scripts/browser-qa.mjs:156`에서 finally로 원래 방을 복구합니다. seed 실패를 즉시 오류로 처리하고 충돌 쌍도 만듭니다(`qa/backend-env.mjs:40`, `:55`). `qa/feature-checks.mjs:9`는 빈 화면을 통과시키지 않고, `:15`에서 선택 기억 원문 펼치기/트래커/충돌/회상 중요·빼기/고아/백업 파일 업로드·미리보기·확인·적용·undo를 양 테마에서 열어 측정합니다. 양 QA에 연결했습니다(`scripts/browser-qa.mjs:181`, `scripts/ui-fix-qa.mjs:123`). | `tests/fix1.test.js:236`: fake backend에서 빈 방 접근·disabled, 상태/장소/물건/트래커/충돌/선택 기억/회상 표시/고아/백업의 실제 데이터 및 chat-a command event 확인. 브라우저 실행은 아래 명령으로 찹쌀이 수행합니다. |

F7의 CSS는 `src/overrides.memory.css:73`에만 추가했습니다. 데스크톱 `.file-shelf`의 비수축 가로 배열을 wrap으로 바꾸고 `.file-index`와 `.file-foot`/`.file-range`의 긴 시간·메시지 범위를 줄바꿈합니다. 인접 폼의 min-width도 줄어들 수 있게 했습니다. 파일 input과 `::file-selector-button`은 44px 이상, theme toggle은 양 테마에서 명시적인 `#151515` 글자/아이콘과 `#ece8df` 배경 쌍을 사용합니다.

`git diff 72683d8 f66a7e0 -- src/overrides.memory.css src/memory/ui/ui.orig.css src/memory/ui/theme.orig.css`는 차이가 없었습니다. 즉 가로 shelf/nowrap 규칙은 1.2에도 있었습니다. **72683d8에서도 동일한 x2 overflow가 실제 측정됐는지는 아직 확인하지 못했습니다.** 이전 기록 `/tmp/memory-library-lv-qa/qa-report.json`의 8 variants / 336 views / 24 failures는 빈 방으로 이어진 세 오류를 확인해 주지만, 문제의 두 overflowing element 이름을 제공하지 않습니다. 이 환경에서는 Chromium을 다시 실행하지 않았으며, 특정 요소의 실측 원인이나 수정 후 UI 통과를 주장하지 않습니다. 새 ui-fix harness는 실패 시 요소/상위 selector와 left/right/width를 함께 출력하고 theme icon 대비와 파일 input 높이도 검사합니다(`scripts/ui-fix-qa.mjs:49`). 아래 baseline 비교까지 실행하면 1.2의 실측 여부를 확정할 수 있습니다.

검증 결과:

- `npm test`: **74개 파일 / 통과 74 / 실패·취소·skip 0**. Node 26의 기본 격리 집계는 파일 단위입니다. 동일 74파일을 개별 Node 프로세스로도 실행하여 **node:test 사례 511개 + standalone assertion script 8개 = 519개 검증 단위**, 모두 exit 0임을 확인했습니다. 기존 494개 대비 **25개 추가**이며 신규 사례는 `tests/fix1.test.js`에 있습니다. 집계 자료: `/tmp/lv-fix1-counts.json`, 기본 실행 로그: `/tmp/lv-fix1-all.log`.
- `npm run verify:original`: **`{"ok":true,"problems":0}`**. 원본 코어·UI 및 고정 숫자는 바이트 그대로입니다.
- `BUN_BIN=/home/syhekate/.bun/bin/bun npm run build`: **성공**, backend 33 modules / frontend 10 modules. 두 dist 번들도 재생성했습니다.
- `git diff --check`: **통과**.
- 새 browser/ui-fix harness는 문법 검사와 fake backend seed/응답 검사를 수행했습니다. **브라우저 실측은 미실행**입니다.

찹쌀 실행 명령(현재 수정본, 서버를 띄우거나 실행 중 서버에 연결하지 않고 in-process fake backend 사용):

```bash
cd /home/syhekate/dev/lv-memory-library
BUN_BIN=/home/syhekate/.bun/bin/bun npm run build
mkdir -p /tmp/lv-fix1-ui /tmp/lv-fix1-browser
PLAYWRIGHT_MODULE=/home/syhekate/dev/marinara-sojaefactory/node_modules/playwright/index.mjs CHROMIUM_BIN=/usr/bin/chromium QA_SHOT_DIR=/tmp/lv-fix1-ui npm run qa:ui-fix
QA_ONLY=chromium PLAYWRIGHT_MODULE=/home/syhekate/dev/marinara-sojaefactory/node_modules/playwright/index.mjs CHROMIUM_BIN=/usr/bin/chromium QA_SHOT_DIR=/tmp/lv-fix1-browser npm run qa:browser
```

browser QA는 Chromium 4개 화면 크기 × secure/insecure = 8 variants, 호스트 dark/light × 서재 dark/light를 검사합니다. 새 기능이 없는 빈 화면은 실패합니다. 결과 JSON은 `/tmp/lv-fix1-browser/qa-report.json`, 화면은 각 QA_SHOT_DIR에 저장합니다. ui-fix는 1280×800 / 390×844 양 테마의 populated screen과 새 기능을 측정합니다. 백업 적용·undo와 중요/빼기는 fake storage에서만 실행합니다.

72683d8의 기존 ui-fix 실측 비교(현재 checkout을 바꾸지 않는 임시 archive):

```bash
cd /home/syhekate/dev/lv-memory-library
lv_baseline_dir=$(mktemp -d /tmp/lv-72683d8.XXXXXX)
git archive 72683d8 | tar -x -C "$lv_baseline_dir"
cd "$lv_baseline_dir"
BUN_BIN=/home/syhekate/.bun/bin/bun npm run build
mkdir -p /tmp/lv-72683d8-ui
PLAYWRIGHT_MODULE=/home/syhekate/dev/marinara-sojaefactory/node_modules/playwright/index.mjs CHROMIUM_BIN=/usr/bin/chromium QA_SHOT_DIR=/tmp/lv-72683d8-ui npm run qa:ui-fix
```

잔여 범위는 브라우저 실측과 실호스트 QA입니다. 안전 사본은 현재/직전 두 단계이며, 다중 파일 교체 도중 프로세스가 종료됐을 때 자동 복구하지 않는 기존 제한은 같습니다. 금지 경로·context 출력·포트·호스트·실모델·비밀정보·전역 설치·서버 조작·pkill·커밋·push를 사용하지 않았습니다.

## fix2 — 2026-11-09

`BRIEF-lv-1.3.0-fix2.md`와 그 문서가 지정한 fix1 hard rules, 기존 보고서 및 찹쌀의 `/tmp/lv-fix1-ui1.log`, `/tmp/lv-fix1-ui-p.log`, `/tmp/lv-fix1-browser.log`를 확인했습니다. `feature/1.3.0` / `8e62cc0`의 깨끗한 작업 트리에서 시작했으며 변경은 **스테이징·커밋하지 않았습니다**. SHA 고정 원본은 그대로이며 런타임 변경은 `patch.mjs`, 스타일 변경은 overlay CSS에만 적용했습니다. 새 사용량 제한이나 `backup.settings` whitelist/type validation은 추가하지 않았습니다.

기존 로그 판독: browser QA는 **8 variants / 442 views / 158 failures**이며, detachment 26건 + `#status` 글자 크기 110건 + 대비 22건입니다. 따라서 158건 모두 탭 전환 오류인 것은 아닙니다. ui-fix 최초 실행은 conflicts 스크롤에서 중단됐고, 후속 실행은 양 폭의 dark facts/conflicts/restore-confirm 및 390 light ledger 대비 실패를 기록했습니다. `/tmp/lv-fix1-ui/390-light-ledger.png`도 확인했으며 `T2` 행이 hover 배경 위에 있습니다. brief에 전달된 **72683d8 baseline ui-fix 통과 / 1280 scenes overflow 재현 안 됨**을 이번 판정의 기준으로 삼았습니다. 이는 찹쌀의 실행 결과이며 이번 에이전트가 재측정한 결과가 아닙니다.

| 항목 | 원인과 수정 | 확인 |
|---|---|---|
| 1. conflicts detachment | 원본 `runtime.orig.js:292`의 `ensureConflicts()`는 Facts 재진입 때마다 조회 뒤 무조건 `render()`를 호출합니다. 클릭 직후 캐시로 그린 행을 **동일 응답으로도 다시 `content.innerHTML` 교체**(`:1593`)하므로 스크롤 안정성 검사 중 행이 떨어질 수 있습니다. idle polling(`:421`)은 방 status만 조회하며 이 충돌 조회/재렌더 루프의 원인이 아닙니다. `src/memory/ui/patch.mjs:150`에서 응답 적용 직전 방·데이터를 비교하고 달라진 경우에만 Facts를 다시 그립니다. 동일 응답이 겹쳐 도착해도 한 번만 그리며 다른 방·탭·dispose 뒤 응답은 해당 화면을 다시 그리지 않습니다. 실제 데이터 변경에 따른 정상 교체에는 `qa/feature-checks.mjs:5`가 locator를 다시 조회합니다. detachment만 재시도하고 timeout 등 다른 오류는 그대로 실패합니다. | `tests/fix2.test.js:40`, `:59`, `:69`, `:84`: 실제 패치된 요청·poll 함수를 VM에서 실행하여 동일/변경/실패/중복/지연 응답과 idle polling의 render 호출 수 검증. `:122`: QA의 재조회 및 오류 전파. 브라우저 DOM 실측은 미실행. |
| 2. dark 대비 | `.record-link`는 원본 테마에서 투명 배경인데 이전 overlay가 dark 모드의 `.chip-id`를 밝은 색으로 고정해 cream 카드에서 1.11이 됐습니다. `src/overrides.memory.css:86`에서 카드 안의 링크 ID를 `#37354a`로 지정합니다. 원본에는 dark primary 버튼의 normal/hover/active 색상이 서로 다른 specificity로 겹칩니다. `:88`에서 카드 primary 버튼의 글자·배경을 모든 상태에 명시합니다. | 지정 색상 자체의 계산상 대비: ID/cream 9.70:1, ID/soft 8.92:1, 버튼 normal 14.93:1, hover/active 12.18:1. **CSS 색상쌍 계산이며 브라우저 실측 결과가 아닙니다.** 기존 facts/conflicts/backup-confirm 측정을 유지했습니다. |
| 3. 390 light ledger | `src/overrides.memory.css:91`에서 summary의 muted 색을 `#5f5a51`, hover fill을 `#e4dfd3`, 제목을 `#151515`로 지정했습니다. dark hover에서도 밝은 카드 위 글자가 어두운 fill에 놓이지 않도록 같은 summary 범위에서 fill을 지정합니다. | 색상쌍 계산상 번호/soft 5.15:1, 제목/soft 13.73:1. `qa/feature-checks.mjs:32`에 실제 ledger 행 hover 측정을 추가하여 양 QA·양 테마에서 검사합니다. |
| 4. status 13px | 기존 overlay의 보조 글자 목록에 `#status`가 들어 있었습니다. `src/overrides.memory.css:94`가 status와 그 자식의 글자를 15px로 지정합니다. | 기존 browser QA의 primary text ≥15px 기준을 유지합니다. recall pin/exclude, orphans, backup preview/confirm/undo에서 계속 측정합니다. |
| 5. 파일 선택 / header | `src/memory/ui/patch.mjs:172`에서 native file input을 숨기고 **백업 파일 고르기**라는 실제 button으로 동기 클릭합니다. 키보드 활성화, 작업 중 disabled, 기존 upload/change/preview 동작을 유지합니다. `src/overrides.memory.css:95`에서 숨김과 44px/15px를 지정합니다. **MEMORY MODULE · v…**는 pinned original `runtime.orig.js:549`에 있고, `git diff 72683d8 -- src/memory/ui/runtime.orig.js`도 차이가 없습니다. 1.2.0에도 동일한 header 템플릿이 있었습니다. LV가 추가한 영어가 아니므로 brief의 조건대로 유지했습니다. | `tests/fix2.test.js:111`: 한국어 버튼·숨김 input·disabled·클릭 전달. `qa/feature-checks.mjs:70`은 버튼에서 실제 filechooser 이벤트를 받아 업로드하고 버튼 크기·글자 크기·native input 숨김을 확인합니다. `scripts/ui-fix-qa.mjs:53`도 보이는 버튼을 측정합니다. |
| 6. 선택 기억 중복 | 원본 `runtime.orig.js:532`는 요약 paragraph와 원문 blockquote를 항상 둘 다 출력합니다. QA seed의 원문(`qa/backend-env.mjs:25`, `:64`)과 fake model 요약(`:32`)이 같은 문장이므로 원본에서도 재현되는 중복 표시이며 중복 저장은 아닙니다. `src/memory/ui/patch.mjs:176`에서 공백 정규화 후 요약이 한 원문 또는 전체 원문과 같은 경우 중복 paragraph만 생략합니다. 다른 요약과 모든 원문 인용은 보존합니다. | `tests/fix2.test.js:94`: 동일/공백 차이/여러 원문 결합/서로 다른 요약 및 HTML escaping 확인. `qa/feature-checks.mjs:39`에 펼친 카드의 중복 paragraph 검사 추가. |

검증 결과:

- `npm test`: **75개 테스트 파일 / 통과 75 / 실패·취소·skip 0**. 기본 Node 러너의 파일 단위 집계입니다. 로그: `/tmp/lv-fix2-test.log`. 새 `tests/fix2.test.js`를 `node --test --experimental-test-isolation=none tests/fix2.test.js`로 실행한 **7개 개별 사례도 모두 통과**했습니다.
- `npm run verify:original`: **`{"ok":true,"problems":0}`**. 원본 22개 pin 유지.
- `BUN_BIN=/home/syhekate/.bun/bin/bun npm run build`: **성공**, backend 33 modules / frontend 10 modules. `dist/frontend.js` 갱신, backend 번들 바이트 변화 없음.
- `git diff --check`: 통과. 수정 QA 파일의 `node --check`도 통과.
- **이번 턴에서 Chromium/browser QA는 실행하지 않았습니다.** 수정 후의 실제 대비·레이아웃·filechooser·스크롤 안정성 통과는 아래 실행으로 확인해야 합니다. 위 VM 시험과 색상 계산을 브라우저 통과로 간주하지 않습니다.

찹쌀 실행 명령(현재 checkout 그대로, in-process fake backend; 실행 중 서버/금지 포트에 연결하지 않음):

```bash
cd /home/syhekate/dev/lv-memory-library
BUN_BIN=/home/syhekate/.bun/bin/bun npm run build
mkdir -p /tmp/lv-fix2-ui /tmp/lv-fix2-browser
PLAYWRIGHT_MODULE=/home/syhekate/dev/marinara-sojaefactory/node_modules/playwright/index.mjs CHROMIUM_BIN=/usr/bin/chromium QA_SHOT_DIR=/tmp/lv-fix2-ui npm run qa:ui-fix > /tmp/lv-fix2-ui.log 2>&1
QA_ONLY=chromium PLAYWRIGHT_MODULE=/home/syhekate/dev/marinara-sojaefactory/node_modules/playwright/index.mjs CHROMIUM_BIN=/usr/bin/chromium QA_SHOT_DIR=/tmp/lv-fix2-browser npm run qa:browser > /tmp/lv-fix2-browser.log 2>&1
```

ui-fix는 1280×800 / 390×844, browser QA는 Chromium 4개 크기 × secure/insecure 8 variants 및 호스트/서재 양 테마를 검사합니다. 결과 JSON은 `/tmp/lv-fix2-browser/qa-report.json`, 스크린샷은 각 `QA_SHOT_DIR`에 남습니다. 전체 로그는 각각 `/tmp/lv-fix2-ui.log`, `/tmp/lv-fix2-browser.log`입니다. 실패 기준을 완화하거나 문제 화면을 제외하지 않았습니다.
