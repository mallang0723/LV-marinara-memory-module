# 「하단 블록 빼고 읽기」 해시·원문 소비처 전수 점검 (1.4.2-lv.2)

기준: `hashText(`, `.h ===`/`.h !==`, `srcNorm`, 내용 길이·공백 비교, `listMessages(`/`prepareMessages(` 호출처를 `src/memory/core/*.cjs`와 `src/adapter`에서 전수 검색(2026-11-19). 옵션 켜짐 때 어댑터의 `content`는 걸러진 글, `rawContent`는 저장된 원문.

## 계획서 3-3이 바뀐 점

계획서의 `ledger.cjs` 앵커(`hashText(row.rawContent ?? row.content)`)는 **혼자서는 작동하지 않는다**: `service.cjs:1299-1300`의 `chatMessages`가 행을 `{id, number, speaker, role, content, swipe, tr}`로 새로 만들어 `prepareMessages`에 넘기므로 `rawContent`가 ledger까지 닿지 않는다. 그래서 ledger는 건드리지 않고 `patchService`에 앵커 2개를 둔다.
1. `out.push({... content: String(row.content) ...})`에 `rawContent`(있을 때만) 전달.
2. `L.prepareMessages(...)` 바로 뒤에서 `m.h = L.hashText(m.rawContent); delete m.rawContent`(ledger와 같은 함수, 같은 입력 = 옵션 꺼짐 때의 h와 동일).
옵션이 꺼져 있으면 `rawContent`가 생기지 않아 두 줄 모두 아무것도 하지 않는다.

## 표

| 위치 | 하는 일 | 읽는 값 | 옵션 켜짐 때 영향 | 조치 |
|---|---|---|---|---|
| ledger.cjs:385 `h: hashText(row.content)` | 메시지 지문 | 걸러진 content | 지문이 바뀜 | 서비스 앵커 2가 `h`를 원문 기준으로 덮어씀. 시험: 켜기 전후 `h` 동일 |
| ledger.cjs:2523 `reconcile` (`now.h !== seen.h`) | 정리된 메시지의 변경 감지 | `h`, id, 위치 | 지문이 같으므로 변경 없음 | 시험: 꺼진 때 만든 장부를 켠 뒤 `reconcile` → rolledBack false |
| scenes.cjs:1097,1205-1210 `covered` | 장면이 덮은 메시지 기록 | `h` | 〃 | 위와 같음 |
| scenes.cjs:2982 `changedAt` | 덮은 메시지 변경 감지 | `h`, id | 〃 | 위와 같음 |
| scenes.cjs:2166 | 대사 확인 지문 | `e.m.h`, e.context | `h` 같음. `context`는 걸러진 글이라 켠 뒤 새 확인부터 다름 | 의도된 동작(새로 정리하는 부분부터) |
| service.cjs:572 `branchMemory` | 분기 비교(`a.h !== b.h`) | `h` | 두 방이 같은 규칙이면 동일. 방마다 옵션이 다르면 `h`는 원문이라 여전히 동일 | 조치 불요 |
| service.cjs:2110-2111 resume | 처리 끝난 메시지 대조 | `h` | 같음 | 조치 불요 |
| selected.cjs:13,16,17 | 직접 고른 기억 지문/낡음 | `m.h`, `m.text` | `h`는 같음. **고른 글 조각(`text`)은 걸러진 content의 문장**이라, 걸러져 사라진 부분을 고른 기억은 검증에서 거절될 수 있음 | 블록 속 글을 고르는 일은 옵션 켠 방에서 불가. 이미 고른 기억의 `stale`은 `h` 기준이라 영향 없음. 7880 QA 항목 |
| vectors.cjs:70,90,105,120,180 | 임베딩 색인 `hash(d.text)` | 장면·노트 텍스트 | 메시지 원문과 무관(장면 텍스트 기준) | 조치 불요 |
| ledger.cjs:2001, service.cjs:4207,4929,5538,5551,5553 | 식사·백업 계획·회상 지문 | 장부·장면 필드, 최근 `m.h` | `m.h` 같음 | 조치 불요 |
| service.cjs:1288 빈 글 건너뛰기(`!String(row.content).trim()`) | 빈 메시지 제외 | content | 블록뿐인 메시지가 사라져 순서가 어긋날 수 있음 | **어댑터가 걸러서 빈 글이 되면 원문 그대로 둠**(`readableContent`). 시험: 블록뿐 메시지도 목록에서 사라지지 않음 |
| service.cjs:1299 `translationSource === row.content` | 번역 붙일지 | content | 걸러진 글과 같아야 함 | 어댑터가 `translationSource = 걸러진 content`로 둠. 시험 포함 |
| adapter/translator.js:77 `pub.h !== hashText(content)` | 번역기 공개 번역 유효성 | **원문이어야 함** | 걸러진 글로 대조하면 번역이 사라짐 | `translatorRow`가 `rawContent ?? content`로 대조. 시험 포함 |
| service.cjs:3092-3190 `srcNorm`/`noteSourceKo` | 문단 번역 대응 | content를 문단·문장으로 나눔 | 번역(문단 키는 원문 문단 해시)은 걸러지지 않으므로, 남은 문단은 그대로 대응. 문단 수 비교(`en.length === kr.length`)는 걸러진 쪽이 더 짧아 문장 단위 대응이 줄 수 있음 | 문단 번역은 문단 키라 안전. 문장 대응 저하는 7880 QA 항목 |
| service.cjs:638-650, 5447 | 분기 대조·화자 태그 복구 | `listMessages` 행 | 분기 대조는 role/characterId만. 5447은 Marinara 말풍선 전용(루미버스는 `updateMessageContent` 거절) | 조치 불요 |
| engine.js `onMessage`/`refreshTail`/스냅샷 | 호스트 원문 보관 | 원문(dto) | 스냅샷은 항상 원문, 걸러기는 `listMessages` 때마다 | 옵션/태그를 바꾸면 다음 목록부터 바로 반영(캐시 없음) |
| 인젝터(common/injector.js) | 프롬프트에 넣는 기억 | 장부 렌더 | 메시지 원문을 읽지 않음 | 계획서 3-5대로 변경 없음 |
