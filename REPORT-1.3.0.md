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
