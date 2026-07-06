---
name: nexon-maple-api
description: 넥슨 메이플스토리 OpenAPI 레퍼런스. 인증 헤더(x-nxopen-api-key), 베이스 URL, 엔드포인트(캐릭터 리스트/식별자(ocid)/기본정보/스탯/유니온/장비 등), date 파라미터 규칙, 캐싱, 에러 코드/레이트리밋을 정리. 넥슨 API 연동 코드를 작성·확장·디버깅할 때 항상 먼저 참조한다.
---

# 넥슨 메이플스토리 OpenAPI 레퍼런스

> 이 프로젝트의 실제 클라이언트는 `src/lib/maple.ts`(서버 전용)에 있다. 새 엔드포인트를 추가할 땐 그 파일의 `request()` 헬퍼와 `MapleApiError` 패턴을 재사용한다.

## 출처
- "검증됨(코드 기준)" 섹션: 현재 코드(`maple.ts`)에서 직접 확인한 사실.
- "공식 문서 확인됨" 섹션: 아래 넥슨 공식 가이드에서 확인 (2026-06-23).
  - API 명세: https://openapi.nexon.com/ko/game/maplestory/?id=14
  - 사전준비: https://openapi.nexon.com/ko/guide/prepare-in-advance/
  - 사용 가이드: https://openapi.nexon.com/ko/guide/request-api/
- ⚠️ 개별 엔드포인트(유니온/장비/심볼 등) 상세 파라미터·응답 필드와 `date` 규칙은 명세 페이지가 SPA라 본문 추출 불가. 추가 시 해당 엔드포인트 페이지 내용을 붙여넣어 보강한다.

---

## 검증됨 (코드 기준)

### 베이스 URL
```
https://open.api.nexon.com
```

### 인증
- 모든 요청에 헤더 `x-nxopen-api-key: <API_KEY>` 필요.
- API 키는 https://openapi.nexon.com 에서 발급.
- **이 앱은 키를 환경변수가 아니라 사용자별 앱 설정에 저장**한다. → 호출은 반드시 서버(서버 컴포넌트/route handler/server action)에서만 수행하고, **키를 클라이언트로 절대 노출하지 않는다.**
- 401/403 → 키가 유효하지 않거나 권한 없음. 사용자에게 "설정에서 키 확인" 안내.

### 캐싱
- `fetch(..., { next: { revalidate: 60 } })` — 넥슨 데이터는 자주 바뀌지 않으므로 60초 캐싱. 엔드포인트 특성에 맞게 조정.

### 에러 응답 형태
- 비정상 응답 본문: `{ "error": { "name": "<코드>", "message": "<메시지>" } }`
- `MapleApiError(message, status, code)` 로 일관 처리.

### 구현된 엔드포인트

| 메서드/경로 | 파라미터 | 반환(요약) |
|---|---|---|
| `GET /maplestory/v1/character/list` | (없음) | `account_list[].character_list[]` → `{ ocid, character_name, world_name, character_class, character_level }` |
| `GET /maplestory/v1/id` | `character_name` | `{ ocid }` |
| `GET /maplestory/v1/character/basic` | `ocid`, `date?` | `CharacterBasic` (레벨/경험치/직업/길드/이미지 등) |
| `GET /maplestory/v1/character/stat` | `ocid`, `date?` | `CharacterStat` → `final_stat: [{ stat_name, stat_value }]`, `remain_ap` |

**조회 흐름:** 캐릭터명 → `getOcid` 로 `ocid` 획득 → `ocid` 로 basic/stat 등 상세 조회.
계정 전체 캐릭터는 `character/list` 한 번으로 가져온다.

### date 파라미터 (주의 — 사용자 문서로 확정 필요)
- 형식은 KST 기준 `YYYY-MM-DD` 로 추정. 넥슨 데이터는 보통 **전일 자정 기준 스냅샷**으로 갱신되어, 당일 데이터는 일정 시각 이후에 조회 가능한 경우가 많다.
- 미지정 시 최신 가용 데이터.
- ⚠️ 정확한 갱신 시각·조회 가능 범위·과거 데이터 보존 기간은 **공식 문서 붙여넣기로 확정**한다.

---

## 공식 문서 확인됨

### 사전준비 / API 키 발급
- 넥슨 ID 로그인 → "내 애플리케이션"에서 앱 등록 → 등록 완료 시 **API Key 자동 발급**.
- 앱당 API Key **최대 2개** 발급 가능.
- 넥슨 ID당 동일 게임 애플리케이션 **최대 3개** 등록 가능.
- 애플리케이션 타입: 개발 단계 / 서비스 단계.
  - 개발 단계: 서비스명만 입력.
  - 서비스 단계: 서비스명, 개발 환경, URL, 소개, 이미지 필요.
- 개발 → 서비스 전환 시 **새 API Key 발급 필요**(기존 키 그대로 승격 불가).
- 키 유출 시 추가 발급으로 교체.

### 레이트리밋 / 호출 제한
| 앱 타입 | 초당 제한 | 일일 제한 |
|---|---|---|
| 개발 단계 | 5건/초 | 1,000건/일 |
| 서비스 단계 | 500건/초 | 20,000,000건/일 |

- 한도 초과 시 **429 / OPENAPI00007** 반환. 이 앱은 사용자별 키를 쓰므로 키 단위로 한도가 적용된다.

### 전체 에러 코드 표
| 코드 | HTTP | 의미 |
|---|---|---|
| OPENAPI00001 | 500 | 서버 내부 오류 (Internal Server Error) |
| OPENAPI00002 | 403 | 권한이 없는 경우 |
| OPENAPI00003 | 400 | 유효하지 않은 식별자 |
| OPENAPI00004 | 400 | 파라미터 누락 또는 유효하지 않음 |
| OPENAPI00005 | 400 | 유효하지 않은 API KEY |
| OPENAPI00007 | 429 | API 호출량 초과 |
| OPENAPI00011 | 503 | API 점검 중 |

### API 카테고리 (명세 페이지 기준)
캐릭터 정보 / 유니온 정보 / 길드 정보 / 연무장 / 확률 정보 / 랭킹 / 공지 / **스케줄러**.

### 스케줄러 — 일일/주간/보스 완료 여부 (넥슨이 직접 제공!)
⚠️ 과거에 "넥슨 API엔 일일/주간 퀘스트 완료 여부가 없다"고 판단했던 것은 **틀렸다** — 아래 엔드포인트로 조회 가능. `character/basic`·`stat`과 달리 **자기 계정 캐릭터만** 조회 가능한 제약이 있다.

| 메서드/경로 | 파라미터 | 비고 |
|---|---|---|
| `GET /maplestory/v1/scheduler/character-state` | `ocid`, `date?`(YYYY-MM-DD, 미입력 시 오늘) | ⚠️ **자신의 계정에 속한 캐릭터만 조회 가능** (basic/stat과 다른 인증 범위). 해당 기준일에 접속 이력이 없으면 응답이 없을 수 있음 |

**응답 (`CharacterStateResponse`):**
- `date`, `character_name`, `world_name`, `character_level`, `character_class`
- `daily_contents[]` — 일일 콘텐츠/퀘스트: `{ content_name, type("contents"|"quest"), registration_flag(인게임 스케줄러 등록 여부), now_count, max_count, quest_state("0":기타/"1":진행중/"2":완료) }`
- `weekly_contents[]` — 주간 콘텐츠/퀘스트: `daily_contents`와 동일 구조
- `boss_contents[]` — 주간보스: `{ content_name, difficulty, cycle(초기화 주기), list_order_no, registration_flag, complete_flag("true"/"false") }`
- `weekly_boss_clear_count`, `weekly_boss_clear_limit_count` — 주간 보스 처치 완료/제한 횟수

**의미:** 이 엔드포인트를 쓰면 사용자가 앱에서 수동 체크하지 않아도, **게임 내 실제 완료 여부를 넥슨 서버에서 그대로 가져와** 일일/주간 퀘스트·주간보스 체크리스트를 자동 동기화할 수 있다. 단, 인게임 "스케줄러" 기능에 등록된 항목(`registration_flag`)만 잡히고, 조회 시점의 데이터가 실시간이 아니라 `date` 기준 스냅샷이라는 점은 유의.

---

## 보강 예정 섹션 (개별 엔드포인트 페이지 붙여넣은 뒤 채움)

### 추가 엔드포인트
<!-- 예: 유니온(union/raider), 장비(item-equipment), 심볼(symbol-equipment),
     캐시장비, 어빌리티, 무릉도장(dojang), 캐릭터 인기도(popularity) 등 -->
- [x] 스케줄러(scheduler/character-state) — 위 섹션에 정리 완료
- [ ] (붙여넣기)

### date 파라미터 상세
- [ ] 갱신 시각·조회 가능 범위·과거 데이터 보존 기간 (개별 엔드포인트 페이지에서 확정)

### 월드/직업/스탯 enum 값
- [ ] 코드값 매핑 (붙여넣기)
