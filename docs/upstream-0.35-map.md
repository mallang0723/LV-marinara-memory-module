# 기억 서재 업스트림 0.35.2 → 루미버스 이식 지도

작성 2026-11-15 (설계·조사만, 제품 코드·git 변경 없음). ✅직접 확인 / ⚠️추정·미확인.

- 업스트림 `upstream/main` = `ab1f058`(0.35.2), 우리 기준 `8d5f090`(0.12.6). 사이 **82커밋**(전부 직선 이력, 병합 0). 코드 증가: `memory-module/lib/*.cjs` +4,481/-330, `extension/runtime.js`(UI) +1,245, `theme.css` +36, 테스트 +3,829(71개 파일).
- 우리 `lumiverse` 브랜치 `863b713`(1.3.0-lv.1). 코어 19개는 `src/memory/core/*.cjs`에 **바이트 동일 사본**으로 고정, 서비스는 업스트림 `service.cjs`(0.12.6 기준 4,388줄)를 **새로 쓴** `src/memory/service.js`(1,681줄) + `routes.js`(520) + `room-*.js`.

## 0. 먼저 알아야 할 사실

1. ✅ **`npm run verify:original`이 하는 일** (`scripts/verify-original.mjs`): ① `PINS` 표의 파일 22개(코어 `.cjs` 19개 + `src/memory/ui/runtime.orig.js`·`ui.orig.css`·`theme.orig.css`)의 SHA-256이 고정값과 같은지 검사 ② 환경변수 `UPSTREAM_MEMORY=<업스트림 체크아웃>`이 있으면 같은 파일을 `memory-module/lib/<이름>.cjs`와 `extension/runtime.js`·`ui.css`·`theme.css`에서 찾아 바이트 비교(핀과 별개). `npm test`의 `pretest`가 `scripts/generate-core.mjs`를 돌리는데 그 첫 줄이 이 검증이라 **핀이 어긋나면 테스트도 빌드도 시작하지 않습니다**. 즉 업스트림 갱신 = 핀 22개(+새 코어 `notebook.cjs`) 재계산이 첫 작업. `.generated.cjs`는 이 핀에서 만든 생성물(`core-patch.mjs`)이라 핀 대상 아님.
2. ✅ **코어 모듈은 순수 CommonJS이고 호스트 호출이 없습니다.** `memory-module/lib/*.cjs` 21개 중 `fs`/`process.env`/`globalThis`를 쓰는 파일은 **`service.cjs` 하나뿐**(grep 확인). → 코어 20개(기존 19 + 신규 `notebook.cjs`)는 업스트림 파일을 그대로 복사하면 되고, 호스트 결합은 전부 `service.cjs`·`marinara-memory-runtime.cjs`·`extension/runtime.js`에 있습니다.
3. ✅ **변경된 코어:** address(+133) aliases(4) backup(4) features(8) ledger(+850) **notebook(신규 644)** reasons(4) recall(+187) scenes(+671) state(+130) trackers(+139) translate(+437) vectors(+39). **변경 없음:** conflicts, keepsakes, knowledge, names, places, selected, speakers.
4. ✅ **LV 생성 패치(`core-patch.mjs`)를 업스트림 새 코어에 대어 본 결과(임시 폴더, 저장소 무변경):** 11개 중 10개 통과, **`scenes` 1건 실패** — 앵커 `place: cleanText(item.place, 60)`가 0회(업스트림이 `place: placeText(item.place)`로 바꿔 한국어 60자/그 외 100자로 단어 경계에서 자름, `scenes.cjs:562-570, 1094`). 나머지 앵커(시간 60→120 등)는 여전히 1회씩 일치. → 장소 상한은 업스트림 방식(0.31.6)으로 해결됐으니 **LV 장소 패치 2개 중 하나(`scene place`)는 폐기, `place note fallback`은 유지 여부 결정**(⚠️ 영어 장소 120자 vs 업스트림 100자 차이를 받아들일지).
5. ✅ **UI 패치(`src/memory/ui/patch.mjs`, 44개 앵커)를 업스트림 `runtime.js`(3,869줄)에 대어 본 결과:** **1건만 실패** — `search needs the name table`(해당 문구 0회). 나머지 43개는 일치. (SHA 핀 검사는 우회하고 앵커만 시험.) 앵커가 일치해도 **의미가 맞는지**는 별도 확인 필요: 새 UI는 7개 탭 개편(0.31.0)이라 LV가 숨겼던 미지원 조작 목록·드로어 탭·Ctrl+K 열기가 새 구조에 붙는지 눈으로 확인해야 함.
6. ✅ **새 서버 경로 15개**(`service.cjs` 라우트 비교): `GET/POST /chats/:id/ooc`, `POST /chats/:id/facts`, `/glossary`, `/lines/edit`, `/lines/fill`, `/notebook`, `/notebook/language`, `/notebook/rebuild`, `/plan-answers`, `/routine-people`, `/setup`, `/speech-marks`, `/translations/back`, `/write-language`. 삭제된 경로 없음. LV 라우터 선언은 `src/memory/routes.js:16-29`와 `room-routes.js`.
7. ✅ **호스트 API 사실(채팅 전체 조회 규칙에 직접 영향):** 설치된 `lumiverse-spindle-types@0.6.59`에는 `getMessages(chatId)` 한 가지뿐이라 `host-adapter.js:85-90 allMessages`가 전체를 읽습니다(주석 `chat.getMessages(chatId) … returns ALL messages`, `host-adapter.js:10`). 그러나 호스트 소스(`~/Lumiverse` HEAD `8e0f3945`, 타입 0.6.79)는 `getMessages(chatId,{limit,offset,tail,light,includeExtra,ownMetadataOnly})`와 `updateMessage(...,{metadata_patch,ownMetadata})`를 제공합니다(커밋 `1cf2133f` 2026-10-27, 능력 `chat-lean-messages-v1`·`chat-metadata-patch-v1`을 `spindle.host.capabilities`로 광고; `src/spindle/worker-host.ts:1391, 4054-4100, 4249-4282`; 문서 `developer-docs/docs/backend-api/chat-mutation.md:180`). 구형 호스트는 옵션을 무시하고 전체를 돌려줌.
8. ⚠️ **현재 LV 서비스는 호출마다 전체 채팅을 읽습니다**(`service.js:517 chatMessages` → `host.allMessages`; 호출처 :598, 808, 903, 996, 1018, 1432, 1592-1593 …). 사용자 규칙("불필요한 전체 조회 금지")에 **이미 걸리는 상태**이므로 이식과 함께 어댑터 한 곳에서 해결(아래 §5).

## 1. 82커밋 → 기능 영역 묶음

분류: **코어동기**(업스트림 코어 파일 그대로 복사) / **서비스포트**(`service.cjs` 변경분을 LV 서비스에 적용) / **UI포트**(`runtime.js`·`theme.css`·`ui.css` 앵커 패치 유지) / **Marinara전용**(건너뜀). 위험: 낮/중/높.

| 영역 | 커밋(버전) | 업스트림 파일 | LV 대상 | 분류 | 위험 |
|---|---|---|---|---|---|
| **A. 번역·단어장 연동** | `e6f6eaf` 0.13.0, `219d991` 0.14.0, `5652b9b` 0.15.0, `27522cb` 0.19.0, `8fe171e` 0.31.8, `cc3ec99`(6,15), `6507a35` 0.33.1(인용문), `60decc0` 0.34.4, `78de624` 0.35.0(번역문으로 고치기 확대), `ce89884`(분기에 번역·단어장), `71d89af`(단어장 오전송), `746e4c8`, a4…~e4b8208 0.31.1–0.31.7 영어 기억 표시 다듬기 | `translate.cjs`(+437), `service.cjs`(`/glossary` 4201, `/translations/back`, `noteSourceKo` 3098, `translationLookup` 3082, `branchMemory` 680), UI `syncGlossary` 365-392 | 코어: `core/translate.cjs`. 서비스: `service.js`·`routes.js`(translations 235-250), `inheritBranch` 1576~ | 코어동기 + 서비스포트 + **UI 수정(§4 계약)** | **높**(번역 도구와의 연결이 Marinara 전용 경로) |
| **B. 이중 언어·기억 언어** | `0cdc7cf` 0.16.0 중국어, `da5e329` 0.17.0 방별 언어, `b30223d` 0.18.0 한국어 고정, `219d991`(두 언어 회상), `1a6bda4`, `746e4c8`(…줄임 라벨) | `translate.cjs`, `ledger.cjs`, `recall.cjs`, `backup.cjs`, `service.cjs`(`/write-language`, `/settings/language`) | `core/*`, `service.js` `withLanguage`(24-33), `routes.js:18` `settings/language` | 코어동기 + 서비스포트 | 중 |
| **C. 인물의 수첩** | `420356e` 0.21.0 → `0594ec6`, `7a495a3`(탭), `f673bd2`, `136cad5`, `a9ad3c5`, `dfbcbbb`, `371112b`, `48b4fa2`, `58cbdda`, `c3426ba`, `943e130`, `8ac58b5`, `1ba92b4`, `982b84a`, `bccc2fa`, `5869a5a`(메모 id 고정), `1167e1a`(다시 받기가 방 작업) | **`notebook.cjs` 신규 644줄**, `scenes.cjs`, `features.cjs`, `vectors.cjs`, `service.cjs`(`/notebook*`, `rebuildNotebook`, `notebookJobs`), UI 수첩 탭 | `core/notebook.cjs`(신규 핀), `service.js`·`room-features.js`(기능 목록)·`routes.js`, 저장 파일 `memory/chats/<id>.notebook.json`(`room-data.js:29-39` definitions에 추가) | 코어동기 + 서비스포트(새 라우트 3) + UI | 중(모델 호출이 늘어남 — 사용 한도는 새로 넣지 않는다는 규칙 유지) |
| **D. OOC·작가 계획·미해결/약속 품질** | `d3c8149` 0.25.0 OOC, `7900286` 0.26.0, `c6c738c` 0.26.1, `77b5296` 0.27.0, `d89cd45`…`b62b1e3` 0.28.0–0.28.4, `76b9765`(3,4), `1d7b968`(7,8,13), `5161fb2` 0.20.0 약속 탭, `a4ed90a` 0.31.10 | `ledger.cjs`(+850 중 대부분), `scenes.cjs`, `state.cjs`, `trackers.cjs`, `service.cjs`(`/ooc`, `/plan-answers`, 점검 단계 `tidySteps`) | `core/ledger.cjs`·`scenes.cjs` 등 + `service.js`의 장부 점검부(996 `tidyLedger`) | 코어동기 + 서비스포트 | **높**(서비스 점검 흐름 변경이 크고 호출 수 증가) |
| **E. 답변에 들어가는 기억 글** | `9737004` 0.29.0, `09f5455` 0.30.0(그 뒤·이야기 줄기·바뀔 수 있는 사실·캐시 순서·사용량 기록), `f942f34` 0.31.9(회상 노이즈), `2c396da`, `f3ac169` 0.12.7·`453e9d5`·`128e28c`(호칭·최근 생활) | `recall.cjs`(+187), `ledger.cjs` `renderLedger`, `scenes.cjs`, `translate.cjs`, `service.cjs` | `core/recall.generated.cjs`(패치 적용), `service.js` `renderLedger`·주입, `common/injector.js` | 코어동기 + 서비스포트 | 중 — **6초 인터셉터 예산**(`DEFAULTS.RECALL_BUDGET_MS`, service.js:57-60)과 충돌 가능: 업스트림 회상 호출이 늘면 예산 초과 → 폴백(fast pick) 비율 모니터 필요 |
| **F. 이야기 줄기** | `09f5455`(도입), `ab30310` 0.34.0, `6aaa2c8`, `8f12f15`, `f04aea4` | `scenes.cjs`, `ledger.cjs`, `service.cjs`(줄기 채우기 호출), UI 줄기 탭 | 코어 + `service.js` + UI | 코어동기 + 서비스포트 + UI | 중 |
| **G. UI 전면 개편** | `6a41e3b` 0.31.0(7개 탭·시간순·줄기·인물별), `71d89af`, `fa9acb8` 0.33.2, `60decc0` 0.34.4(캘린더), `78de624` 0.35.0, `44b5b57` 0.31.2 | `extension/runtime.js`(+1,245), `theme.css`(+36), `ui.css`(+8) | `src/memory/ui/runtime.orig.js`·`*.orig.css`(새 핀), `patch.mjs`(앵커 1건 재작성), `overrides.memory.css`, `style.js` | UI포트 | **높**(LV 대비 보정 CSS·15px/44px 규칙·다크 대비·드로어 탭 연결 재검증) |
| **H. 페르소나 말 표시** | `cbfba5e` 0.31.11, `681c508` 0.31.12, `686b067`(14,16,17) | `ledger.cjs`·`scenes.cjs`(`prepareMessages({speechMarks})`), `service.cjs`(`/speech-marks`, `chatMessages` 1305 부근) | `service.js:517 chatMessages`에 `speechMarks` 전달, 라우트 추가 | 코어동기 + 서비스포트 + UI | 중 |
| **I. 배경 설정·진행 규칙** | `24500d6` 0.32.0, `d0b7b3c` 0.32.1, `116fda3` 0.32.2 | `service.cjs`(`/setup`, `withSetup`, `nameInstructions`), **`marinara-memory-runtime.cjs`**(+20: 프롬프트 미리보기·dry-run에 `namesPreview`/`namesDryRun` 패치), UI | 서비스 + `common/injector.js`(출력 형식 자리에 해당하는 위치 결정) | 서비스포트 + UI + **Marinara전용 부분은 LV 인터셉터로 대체** | 중–높(Marinara의 "출력 형식 자리·화자 태그 지침 앞"에 대응하는 Lumiverse 프롬프트 위치를 정해야 함 — ⚠️ 미확인) |
| **J. 호칭·이름·사람** | `f3ac169`, `69c5ed9` 0.35.1(그리스어·키릴·한·중·일), `2cb786e` 0.35.2, `47a1e12`, `a44620b`, `1a6bda4` | `address.cjs`(+133), `scenes.cjs`, `state.cjs`, `translate.cjs` | 코어 | 코어동기(+UI 표시) | 낮 |
| **K. 시간순·할 일·트래커** | `189c87a` 0.33.0, `6507a35`(지금 상태 먼저), `fa9acb8`, `453e9d5`, `e6f6eaf`(트래커 추천) | `trackers.cjs`(+139), `state.cjs`, `ledger.cjs`, UI | 코어 + UI | 코어동기 + UI | 낮–중 |
| **L. 서버 기능 추가·수정** | `4522c01` 0.32.3 `/facts`(사실 손으로 더하기), `c6f155a` 0.31.13 코드 검토 수정, `ab1f058` Vertex 임베딩·인덱싱 오류 표시(#2) | `service.cjs`(+55), UI 4줄 | `service.js` `embedTexts`(임베딩은 호스트 `embeddings` API: `host-adapter.js:115-125`)·`routes.js` | 서비스포트(Vertex 호환은 Marinara 임베딩 연결 전용 → **N/A**, 인덱싱 오류 표시는 UI포트) | 낮 |
| **M. 설치·Marinara 런타임** | `7f65b34` 0.27.1 설치기, `d89cd45` 등의 `MRT` 버전 갱신 전부, `746e4c8`의 설치 스크립트 테스트 부분, 모든 커밋의 `marinara-memory-runtime.cjs` `VERSION` 상수 갱신 | `install.sh`/`install.ps1`/`marinara-memory-runtime.cjs`/`memory-cli.cjs` | — | **Marinara전용(건너뜀)** | — |

(영역 A–M은 82개 커밋을 모두 포함. 커밋별 변경 파일 표는 `git log --reverse --name-only 8d5f090..upstream/main`로 재현됩니다.)

## 2. 통이식 방식 (소유자 지시: 처음부터 다시 만들지 말고 업스트림 코드를 그대로, 호스트 층만 얇게)

### 2.1 그대로 복사 가능한 것
| 업스트림 파일 | 줄수(0.35.2) | 복사 방식 | 고정(verify:original) |
|---|---|---|---|
| `memory-module/lib/{address,aliases,backup,conflicts,features,keepsakes,knowledge,ledger,names,notebook,places,reasons,recall,scenes,selected,speakers,state,trackers,translate,vectors}.cjs` (20개) | — | `src/memory/core/`에 바이트 복사. 호스트 호출 없음(✅). `.generated.cjs`는 `core-patch.mjs`가 기존대로 생성 | 핀 20개(기존 19 + `notebook.cjs`) 재계산 |
| `memory-module/lib/service.cjs` | 5,713 | **복사 + 어댑터 주입**(아래 2.2) — 소유자 방침. 핀 대상으로 넣을지 결정(넣으면 호스트 층은 오직 어댑터에서만 수정 가능) | 선택 |
| `extension/runtime.js`·`ui.css`·`theme.css` | 3,869 / — | `src/memory/ui/*.orig.*`로 복사 + `patch.mjs` 앵커 패치(기존 방식) | 핀 3개 재계산 |
| `memory-module/marinara-memory-runtime.cjs`, `install.*`, `memory-cli.cjs`, `mm` | — | **복사하지 않음**(Marinara 서버 `dist` 패치·설치기) | — |

### 2.2 `service.cjs`가 쓰는 Marinara 호스트 호출 (file:line = `upstream/main:memory-module/lib/service.cjs`)
| 호출 | 줄 | 용도 | 어댑터가 제공할 표면 |
|---|---|---|---|
| `engine()` — Marinara 서버 `dist`에서 `db/connection`, `chats.storage`, `characters.storage`, `connections.storage`, `provider-registry`, `connection-base-url`, `game-state.storage`를 동적 import | 70-99 | 모든 호스트 접근의 단일 관문 | `engine(): Promise<Engine>` 를 **LV 어댑터 객체로 대체** (아래) |
| `e.chats.listMessages(chatId)` | 639-640(분기), 1278(`chatMessages`), 3177(`sourceKoFor`), 5447 | 전체 메시지 | `listMessages(chatId): Promise<Row[]>` — **스냅샷·이벤트 재사용, 전체 조회 최대 1회/세션**(§5). Row = `{id, role:'user'|'assistant'|'narrator', content, characterId, rowid, extra: string|object, activeSwipeIndex}` (`chatMessages` 1285-1305가 읽는 필드) |
| `e.chats.getById(id)` / `e.chats.list()` / `listByGroup(gid)` | 851, 1484, 4760, 5440 / 912, 918 / 833 | 채팅 메타(이름·mode·metadata JSON 문자열·요약 `summaryEntries`) | `getById(id): {id,name,mode,metadata: string, characterIds}`; `list(): Chat[]`(페이지 합침, `host-adapter.js:61-69 pages`); `listByGroup`: Lumiverse에 그룹 개념 없음 → `[]` |
| `e.chats.updateMessageContent(id, text)` | 5452 | 화자 태그 복원 | **미제공(스텁, 호출 경로를 `speakerTagsOn()==false`로 차단)** — Marinara 전용 |
| `e.characters.getById(id)` | 1268 | 캐릭터 이름 | `getById(id): {data: JSON string}` ← `characters.get` |
| `e.connections.list()` / `getWithKey(id)` / `unavailableReason(id)` | 978, 1001, 1526, 4312 / 984, 1007, 1499 / 1503 | 모델·임베딩 연결 | `list()` ← `connections.list(userId)`(`host-adapter.js:44-49`); `getWithKey`는 키 반환 불가 → 어댑터가 연결 id만 들고 `generate.quiet({connection_id})`로 호출(키를 확장이 다루지 않음) |
| `e.createLLMProvider(...)`, `provider.chatComplete(messages, opts)` | 1519, 1685, 1688 | 모델 호출 | `provider = { chatComplete(messages,{maxTokens,temperature,signal,responseFormat}), embed(texts,model,signal) }` ← `generate.quiet`(`host-adapter.js:104` `generate`) / `embeddings.embed`(115-125). `responseFormat:json_object`는 호스트 파라미터로 전달 가능 여부 ⚠️ 확인 필요(없으면 프롬프트 지시만) |
| `e.gameStates.getLatestForMessages` 외 | 1410, 1417, 1430 | Marinara 게임 상태로 이야기 시계 | **스텁 null** → 기존 LV 방식(메시지의 날짜 줄에서 시계, `service.js:501-510 addOwnClock`) 폴백 |
| `fs.readFileSync/writeFileSync/renameSync/existsSync/mkdirSync/rmSync/readdirSync/lstatSync/statSync` (49곳: 113, 147, 164, 185-192, 522, 626-635, 668-681, 698, 747, 755, 767, 806, 889, 921, 2011, 3792, 3938, 4378, 4419, 4745, 4766-4770, 4792-4819, 4896) | 위 | 데이터 폴더 `DATA_DIR/memory-module/…`(`process.env.DATA_DIR`, 29-43) | **동기 `fs` 대체 모듈(§2.3)** |
| `process.env.MEMORY_MODULE_*` | 47, 52, 55, 2895, 2972 | 튜너블 | 어댑터 `env` 객체로 대체(기존 `DEFAULTS`/`tunables`, `service.js:46-70`) |
| `globalThis.__marinaraMemory` | 3795, 3943, 4355, 4840 | 버전·설정 노출 | 어댑터가 `{version}` 제공 |
| `attach(app)` Fastify 훅: `onSend`(분기 `/api/chats/:id/branch`), `preHandler`(삭제 준비 `deletePrepare`, `POST /api/generate` 전 `prepareSpeakers`+`syncBeforeReply`), `onResponse`(`POST /api/generate` 후 1.5초 뒤 `processChat`) | 5664-5700 | 생성 전후·분기·삭제 | → Spindle: 생성 전 = 인터셉터(`common/injector.js`, `registerInterceptor` `backend.js:55`), 생성 후 = `GENERATION_ENDED`(`backend.js:78`), 분기 = `CHAT_FORKED`(`backend.js:95`), 삭제 = `MESSAGE_DELETED`/`CHAT_CHANGED` 이벤트 ⚠️(업스트림은 삭제 요청 URL로 대상 방을 미리 계산, LV `service.js:1576~` 고아 방 관리와 연결) |
| `app.get/post/…('/chats/:id/…')` 89개 | `routes` 함수 | 관리 API | `src/common/router.js`(`router.add(method, pattern, handler)`, 60줄)가 이미 같은 모양을 받음. **업스트림 `routes(app)`를 가짜 `app`(`get/post/put/patch/delete/addHook`)에 붙여 LV 라우터에 등록** — 핸들러는 `(req, reply)`의 `req.params/body/query`와 반환값(`{ok:true,…}`)만 사용 |

### 2.3 어댑터 표면 (함수·시그니처)
```
// src/adapter/marinara-host.js — service.cjs가 require('./host')로 받는 한 곳
createEngine({ api, userId, snapshot }): Engine
Engine = {
  chats: { listMessages(chatId): Promise<Row[]>, getById(id): Promise<Chat|null>,
           list(): Promise<Chat[]>, listByGroup(gid): Promise<Chat[]> /* [] */ },
  characters: { getById(id): Promise<{data:string}|null> },
  connections: { list(): Promise<Conn[]>, getWithKey(id): Promise<Conn&{apiKey:undefined}>, unavailableReason?(id) },
  createLLMProvider(conn,…): { chatComplete(msgs, opts): Promise<string>, embed(texts, model, signal): Promise<number[][]> },
  resolveBaseUrl(conn): string, gameStates: null
}
// 동기 fs 대체 (node:fs 호출을 build alias로 바꿈): 사용자별(ALS) 인메모리 파일 캐시 + 쓰기 뒤 비동기 userStorage 반영
fs: { readFileSync(path,enc), writeFileSync(path,data), renameSync(a,b), existsSync, mkdirSync, rmSync, readdirSync(dir), lstatSync/statSync(path,{bigint}) }
preloadRoom(userId, chatId): Promise<void>    // memory/chats/<id>.* 와 settings.json 을 읽어 캐시에 채움(진입점마다 await)
flush(userId): Promise<{failed:string[]}>     // 쓰기 실패를 숨기지 않음(1.3 요구)
withUser(userId, fn)                          // AsyncLocalStorage — 업스트림 service.cjs의 모듈 전역 Map들은 chatId 키라 사용자 간 충돌 없음, 파일 경로만 사용자별로 분리
mountRoutes(router, routes)                   // app.get/post 호출을 router.add로 변환
hooks: { beforeReply(chatId, body), afterReply(chatId), branched(src,dst,ids), deleted(chatIds) }
```
- ⚠️ **위험 1 — 동기 fs 대 비동기 userStorage.** 업스트림은 어디서든 동기로 파일을 읽습니다. 캐시에 없는 파일을 읽으면 `ENOENT`가 나와 "없는 방"으로 오인하는 사고가 납니다. 현재 LV `service.js`는 `ensureChat()`/`ready()`로 막고 있으므로(`service.js` 머리 주석) 같은 보호를 어댑터 진입점(라우트·이벤트·인터셉터·타이머)마다 `preloadRoom`으로 둬야 함. 업스트림의 `setTimeout` 후속 작업(예: 1.5초 뒤 `processChat`)은 ALS가 전파되는지 ⚠️ **Bun 워커에서 시험 필요**(미확인).
- ⚠️ **위험 2 — 깨진 파일 보호.** LV `store.js`는 `exists+read+JSON.parse`로 깨진 파일을 덮어쓰지 않습니다(`store.js` 머리 주석, `.broken-` 접미사). 업스트림 `readJson/markBroken`(113-192)과 개념이 같아 업스트림 코드가 이 보호를 이미 가지고 있음 — fs 대체가 `renameSync`로 `.broken-*` 보관을 지원해야 함.
- ⚠️ **위험 3 — userStorage는 비원자적 `writeFileSync`**(`store.js` 머리 주석: temp+rename 아님). 업스트림 `writeFileSync` 뒤 `renameSync` 패턴(`atomic write`)은 어댑터에서 임시 파일 이름으로 쓰고 `userStorage.move`(`spindle-api.d.ts:378-440 storage.move`)로 대체 가능한지 ⚠️ 확인 필요.

### 2.4 이식 뒤에 다시 얹어야 하는 LV 전용 기능 (최소화·충돌 표시)
| LV 기능 | 현재 위치 | 업스트림과의 관계 | 판단 |
|---|---|---|---|
| 사용자(operator-scoped) 격리, 모든 호출에 `userId` | `host-adapter.js:28`, `service.forUser` | 업스트림은 단일 사용자 전역 | **필수**. 어댑터 `withUser`. 충돌: 업스트림 모듈 전역 상태 일부(`settings()` 캐시 등)가 파일 경로 단위가 아니면 사용자 간 섞임 → 감사 필요 |
| 인터셉터 6초 예산·빠른 회상 폴백 | `DEFAULTS` `RECALL_BUDGET_MS` 등, `service.js:57-62` | 업스트림 `MEMORY_MODULE_RECALL_TIMEOUT_MS`(55) 단일 타임아웃 | 얹기. 업스트림 회상 내부 타임아웃과 이중이 되지 않도록 한쪽만 |
| 루미버스 메시지 제한 → 기억 창 크기 | `host-settings.js`, `chatWindowInfo` `service.js:538` | 업스트림 `DEFAULT_WINDOW` env | 얹기(작음) |
| 선택한 글 정리(Lumiverse 본문 DOM, 중첩 `data-message-id`) | `common/message-selection.js`, UI 패치 | 업스트림 `selected.cjs`는 동일(변경 없음) | UI 패치로 유지 |
| 방 백업·복원 미리 보기·적용·되돌리기(안전 사본 `memory/restore-undo/<id>/`) | `room-backup.js` | 업스트림에도 백업 라우트와 `backup.cjs`(변경 4줄) 존재, 복원 안전사본은 ⚠️ 없음 | **충돌 가능** — 업스트림 복원 동작을 먼저 확인하고, LV의 안전 사본이 상위 호환이면 래퍼로 유지 |
| 고아 방 조회·삭제(삭제 확인 필수) | `room-routes.js` | 업스트림 `listOrphans/deleteOrphans`(`_test` 목록에 존재) | 업스트림 것 사용 + `confirm:true`·현재 방 거부 규칙만 얹기 |
| 장면 필드 상한 확대(시간 60→120 등 8개 패치) | `core-patch.mjs:7-18` | 업스트림 `placeText`가 장소 문제를 해결 | **장소 1개 폐기**, 나머지 7개 앵커는 유지(통과 확인 ✅) |
| 저장 실패 보고(숨기지 않음) | `store.js` | 업스트림은 `try{}` 삼킴이 많음 | 어댑터 `flush`로 보고, 업스트림 코드는 수정하지 않음 |
| HTTP/Tailscale UUID 대체, 휴대폰 15px/44px, 다크 대비, 드로어 탭·Ctrl+K, 런처 제거, 말풍선 태그 스위치 제거 | `patch.mjs`, `overrides.memory.css`, `style.js`, `shim/marinara.js` | UI 앵커 패치로 유지(43/44 통과 ✅) | UI포트 |
| 분기 상속 | `service.js:1576` `inheritBranch` | 업스트림 `branchMemory`(`ce89884`: OOC id 변환·번역·단어장 포함) | **업스트림 것으로 교체**(더 완전). 호출만 `CHAT_FORKED`에 연결 |
| 화자 태그·말풍선 | 제외됨 | 업스트림 `speakerTags/prepareSpeakers` | 계속 제외(스텁) |

## 3. 우리가 건드리는 지점 요약
- 코어 복사 → `src/memory/core/*.cjs` + `scripts/verify-original.mjs` `PINS` 갱신 + `notebook.cjs` 추가(`notebook.cjs`는 `aliases.cjs`·`node:crypto`만 require(✅ `notebook.cjs:20-21`)하므로 `generate-core.mjs` 패치 불필요.
- 테스트: 업스트림 신규 테스트 71개 파일(+3,829줄)을 `tests/upstream/`로 가져와 `upstream-harness.js`에 맞춤(기존 방식). `npm test` = `node --test tests/*.test.js tests/upstream/*.cjs tests/upstream/*.test.js`(`package.json` scripts).

## 4. 연동 계약 (번역 도구 ↔ 기억 서재)

### 4.1 Marinara 판이 데이터를 주고받는 방식 (코드 확인)
번역 도구 쪽 상세는 `~/dev/lv-translator/docs/translation-tools-1.8.0-map.md` §4.1과 같은 내용. 기억 서재 쪽 요약:

| 흐름 | 쓰는 쪽 → 저장 | 읽는 쪽 | 트리거·특징 |
|---|---|---|---|
| 단어장 → 기억 번역 | 번역 도구가 확장 저장소 `config.chats[chatId].glossary`(없으면 `config.defaults.glossary`)에 `영어 = 한국어` 줄 저장 | **기억 서재 UI**가 `/api/personal-extensions/runtime/client`로 확장을 이름("번역 프리셋·단어장"으로 시작)으로 찾고 `/api/personal-extensions/<id>/storage`를 읽어 `POST /chats/:id/glossary`(`runtime.js:365-392`, `service.cjs:4201-4216`) → `<chat>.translations.json`의 `glossary:{pairs,hash,source,at}` | 방을 열 때 1회·텍스트 바뀔 때. 이름이 사람 이름이면 이름 표의 별칭으로 추가(`glossaryAliases` 3069), 영어 기억 번역에 모델 지시로도 전달(0.31.8) |
| 응답 번역 → 한국어 낱말 회상 | 메시지 `extra.translation`+`translationSource` | **서버**가 `chatMessages`에서 `tr`로 첨부(`service.cjs:1300`), 원문과 같을 때만 | 회상·빠른 회상에서 한국어 낱말로 영어 장면 찾기(`recall.cjs:247,272`). 기억 내용에는 넣지 않음 |
| 인용문 = 채팅의 문단 번역(0.33.1) | 메시지 `extra.paraTranslate.map` | **서버** `noteSourceKo`(3098-3152): 정규화+FNV-1a base36 키로 문단·줄·문장 한국어 찾음 | 찾으면 번역 모델 호출 없음(`translationLookup` 3082) |
| 손수정 번역 → 영어 원문 재작성 | 번역 도구가 메시지 `content`를 PATCH | 기억 서재는 일반 메시지 수정으로 처리(장부 재조정) | 별도 연동 없음 |
| 분기(`ce89884`) | 기억 서재가 `translations.json`(`items`+`glossary`)과 OOC 표시를 분기방 파일로 복사, OOC는 메시지 id 변환 | 분기방 | 메시지의 번역 도구 데이터는 Marinara가 메시지를 복사하며 따라감 |

### 4.2 루미버스 판: 계약 "LV-TX v1" (기억 서재 쪽 구현)
설계 근거와 전체 규격은 번역 도구 문서 §4.2. 기억 서재 쪽 의무만 적습니다.

- **읽는 곳(전부 백엔드, 새 권한 없음):** `chat_mutation`(이미 보유 — `spindle.json`)으로 `getMessages`의 `metadata.st_translator.pub`; `chats`(이미 보유)로 `chats.get(...).metadata.st_translator.glossary`. 확장 간 직접 호출은 `rpcPool.read('st_translator.contract')` 한 가지(존재·버전 확인)만.
- **키·모양:** 메시지 `metadata.st_translator.pub = {v:1, h, lang:'ko', text, paras:{<fnv32b36(normKey)>:ko}, edited, at}`; 채팅 `metadata.st_translator.glossary = {v:1, text, hash, at}`. `h`는 `message.content` 원문 그대로의 FNV-1a32 base36(업스트림 `srcKey`와 같은 함수, `service.cjs:3103-3112`) — 기억 서재가 자기 `content`로 같은 값을 계산해 **일치할 때만** 사용.
- **업스트림 코드 재사용:** `noteSourceKo`(3098)는 행의 `extra.paraTranslate.map`을 읽는다 → 어댑터의 `listMessages`가 Row를 만들 때 `extra`에 **`paraTranslate: {map: pub.paras}`와 `translation: pub.text, translationSource: content`를 합성**해 넣으면 `chatMessages`(1300)와 `noteSourceKo`가 **수정 없이** 동작(통이식 원칙에 부합). 단어장은 어댑터가 `POST /chats/:id/glossary` 내부 함수에 같은 `{glossary: text, source:'번역 프리셋·단어장'}`로 넘김.
- **변경 감지(재조회 없음):** `MESSAGE_EDITED`/`SWIPE_EDITED`/`MESSAGE_SWIPED` 페이로드의 `message.extra.spindle_metadata.st_translator.pub`로 스냅샷의 해당 행만 갱신(`api.d.ts:3030-3120`), `CHAT_CHANGED`의 `changedFields`에 `metadata.st_translator.glossary`가 있으면 단어장만 다시 읽음. 번역 도구가 쓸 때마다 호스트가 이벤트를 내므로 폴링 없음.
- **분기:** 기억 서재 `branchMemory`가 `translations.json`(`glossary` 포함)을 복사하므로(`ce89884`) 분기방의 단어장은 chat 메타데이터 유무와 무관하게 유지. ⚠️ 호스트가 포크 시 메시지 `spindle_metadata`를 복사하는지 미확인.
- **한쪽만 설치:** 번역 도구 없음 → `rpcPool.read` 실패 = "없음", `pub`·`glossary`가 없으면 코드 경로가 건너뜀(업스트림도 확장 미설치 시 아무 일 없음, `runtime.js:379`). 기억 서재 자체 번역·자체 단어장 입력은 그대로. 번역 도구만 있음 → 기억 서재는 아무것도 안 읽음. 버전: `pub.v/glossary.v > 1`이면 해당 입력 무시하고 설정 화면에 "번역 도구가 더 새롭습니다" 한 줄.
- **UI 쪽 수정 1건:** `runtime.js:365-392 syncGlossary`는 Marinara 개인확장 HTTP를 직접 부름 → `patch.mjs`에서 이 함수 본문을 `LV.syncGlossary(id)`(백엔드 라우트 호출)로 대체하는 앵커 1개 추가(기존 `replaceRange` 방식).

## 5. 채팅 전체 조회 금지 규칙을 어댑터에서 지키는 방법
- 어댑터 `listMessages(chatId)`는 **세션당 채팅별 스냅샷** 하나: (a) 있으면 재사용, (b) 없으면 첫 로딩 1회 — 호스트가 `chat-lean-messages-v1`이면 `getMessages(chatId,{limit:200,offset:n,light:true})`로 **페이지 단위**(기억 장부는 본문 전체가 필요하므로 전체 집합이 필요하되 한 번에 큰 응답을 받지 않음), 아니면 현재처럼 전체 1회. (c) 이후는 `MESSAGE_SENT/EDITED/SWIPED/SWIPE_EDITED/DELETED` 이벤트 페이로드로만 갱신(번역 도구 0.3.6 `backend.ts:129-160, 486`의 방식), DTO 없는 이벤트·역할 불명 행만 1회 재조회.
- 불필요한 전체 읽기를 부르는 업스트림 경로: `sourceKoFor`(3175-3178), `/translations`(4144, 4182), `refreshTranslations` — 어댑터 스냅샷이 막아 줌. 기억 서재 UI가 방을 열 때마다 `/chats/:id/translations`를 부르므로 이 경로는 반드시 스냅샷을 사용해야 함(위반 시 방 열 때마다 전체 조회).
- 시험: 가짜 호스트에 `getMessages` 호출 카운터를 두고 "방 열기 → 회상 → 정리 → 번역 조회" 시나리오에서 전체 읽기 ≤ 1(또는 페이지 수)임을 단언(번역 도구 `tests/backend-auto.test.ts:330` 방식).

## 6. 배치 계획 (4배치, 각각 시험 가능)

| 배치 | 내용 | 시험 |
|---|---|---|
| **1. 어댑터 + 복사** | `src/memory/core/` 20개 복사, `ui/*.orig.*` 3개 복사, `service.cjs` 복사, `PINS` 재계산(+`notebook.cjs`), `core-patch.mjs`의 `scene place` 앵커 제거, `patch.mjs`의 1건 재작성, 어댑터(`engine`·`fs` 대체·라우트 장착·훅 매핑)와 전체 조회 1회 규칙 | `npm run verify:original`(핀 22→23 + `UPSTREAM_MEMORY=<upstream/main 체크아웃>`로 바이트 비교), `npm test`(생성 포함), 업스트림 새 테스트 71개를 `tests/upstream/`으로 가져와 통과, 전체 조회 카운터 시험 |
| **2. LV 전용 얹기** | §2.4: 사용자 격리·6초 예산·메시지 제한 창·백업 복원 안전사본·고아 방·저장 실패 보고·모바일/다크 CSS | 기존 `tests/*.test.js`(release-1.3, fix1/2, memory-*, router, routes …) 재실행, 충돌 항목(복원)은 별도 케이스 |
| **3. 연동** | 어댑터의 `pub`/`glossary` 합성, `LV.syncGlossary`, 핸드셰이크, 번역 도구 쪽 쓰기(번역 도구 문서 §5.4 배치 3과 같은 날 맞춤) | 가짜 호스트에서 이벤트만으로 갱신·한쪽 설치 3종·해시 불일치 무시 |
| **4. QA** | 실제 Lumiverse(`npm run qa:browser`, `qa:ui-fix`, `qa:insecure`), 모바일 360px, 7개 탭·수첩·줄기·시간순 캘린더 화면 확인, 번역 도구 연결, 전체 조회·모델 호출 횟수·6초 예산 실측 | 수동 + QA 스크립트 |

## 7. 위험 요약
1. **동기 fs ↔ 비동기 userStorage**(§2.3): 가장 큰 구조 위험. 대안(전체 재작성 포트)은 서비스 변경 1,561줄을 수작업 이식하는 것인데 우리 `service.js`가 원래 업스트림과 줄 단위로 대응하지 않아(4,388→1,681줄) 이쪽도 오류 위험이 큼 — 통이식 쪽이 더 낫다고 보되 **배치 1 안에서 읽기·쓰기 스파이크(1일)로 먼저 증명**할 것.
2. 업스트림 회상·점검의 모델 호출 증가 vs **6초 인터셉터 예산**·사용량(새 상한을 임의로 넣지 말 것 — 규칙).
3. UI 개편 후 LV 대비·터치·드로어 연결 회귀(앵커는 43/44 통과해도 시각 검증 필수).
4. Marinara 전용 프롬프트 위치("출력 형식 자리") ↔ Lumiverse 대응 위치 미정(영역 I).
5. `responseFormat: json_object` 전달 가능 여부, `ALS` 전파, `userStorage.move` 원자성 — ⚠️ 모두 시험으로 확인.
6. 번역 도구 권한 증가(`chats`)와 호스트 능력 의존 — 번역 도구 문서 §6.

## 이식 체크리스트: 「하단 블록 빼고 읽기」(1.4.2-lv.2)

원작 재이식 때 아래가 살아 있는지 확인한다(근거 표: `docs/hide-blocks-hash-audit.md`).

- 어댑터: `src/adapter/hide-blocks.cjs`(`stripHiddenBlocks`, 스위치 등록 `install`), `engine.js`의 `shapeRow`(옵션 켜짐 때 `content`=걸러진 글, `rawContent`=원문, 번역기 `readPub`은 원문), `upstream.js`(스위치 등록 + 방별 getter), `manager.js`/`backend.js`(`ext/hide-blocks` 태그 저장), `patch.mjs`(추가 기능 행의 태그 두 칸 + 저장 핸들러 앵커 2개).
- `core-patch.mjs` `patchService` 앵커 2개: ① `out.push({... content: String(row.content) ...})` 줄에 `rawContent` 전달, ② `L.prepareMessages(out, …)` 직후 `m.h = L.hashText(m.rawContent)`. (원작 `ledger.cjs`는 건드리지 않는다: 서비스가 행을 새로 만들어 넘기므로 계획서의 ledger 앵커로는 원문이 닿지 않는다.)
- 원작 `features.cjs` 레지스트리에 `hideBlocks`를 런타임에 덧붙이므로, 원작 `tests/upstream/*`(레지스트리 키 목록 검사)는 `upstream-service.cjs`만 거치고 `upstream.js`를 거치지 않아 영향이 없다. 원작이 FEATURES 구조를 바꾸면 `install`을 확인한다.
