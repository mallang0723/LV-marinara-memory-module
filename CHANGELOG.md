# 변경 내역

## 1.0.0-lv.1 (첫 공개)
- 비공개 이식판 LV-AnonMemory 0.2.0-lv.1 에서 기억 서재만 떼어 낸 독립 확장. 원작 기준 커밋 09d0699(런타임 0.10.9).
- 익명 커뮤니티 관련 코드·화면·서랍 탭·Extras/Ctrl+K 항목·RP 소재 주입·테스트·QA는 포함하지 않음.
- 포함: 기억 서재 전부(장면·사실·장부·챕터·큰 흐름, 회상, 채팅 분기 이어받기), 화면 닫기 보호(오버레이 가드), PC 스크롤 수정, `{{memory_ledger}}` 매크로.
- 권한: generation, chats, chat_mutation, characters, interceptor (embeddings 없음).
- 검증: 단위·원본·이식 테스트, 브라우저 QA, 스캐너 `[]`. 실호스트 동작은 README의 미확인 목록 참고.
