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

### date 파라미터
- 형식은 KST 기준 `YYYY-MM-DD`. 미지정 시 최신 가용 데이터.
- `character/basic` 등은 2023-12-21 데이터부터 조회 가능.
- ⚠️ **`/scheduler/character-state` 는 규칙이 완전히 다르다** — 오늘 날짜를 명시하면 400 이고 조회 범위가 최근 13일뿐이다. 아래 스케줄러 섹션 참조. 다른 엔드포인트와 같은 방식으로 "KST 오늘 날짜를 계산해 넣는" 코드를 쓰면 그 엔드포인트만 100% 실패한다.

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
| `GET /maplestory/v1/scheduler/character-state` | `ocid`, `date?` | ⚠️ **자신의 계정에 속한 캐릭터만 조회 가능** (basic/stat과 다른 인증 범위). ⚠️ **`date` 규칙이 다른 엔드포인트와 다르다 — 아래 참조** |

> 아래는 2026-07-29 에 **실제로 호출해 확인한 값**이다(캐릭터 12명 표본 + 보스 77행 전수). 추측이 아니다.

**응답 (`CharacterStateResponse`):**
- `date` — ⚠️ `YYYY-MM-DD` 가 **아니라** ISO datetime 이다: `"2026-07-29T00:00+09:00"`
- `character_name`, `world_name`, `character_level`, `character_class`
- `daily_contents[]` / `weekly_contents[]` — 동일 구조: `{ content_name, type, registration_flag, now_count, max_count, quest_state }`
- `boss_contents[]` — `{ content_name, difficulty, cycle, list_order_no, registration_flag, complete_flag }`
- `weekly_boss_clear_count`, `weekly_boss_clear_limit_count` — 주간 보스 처치/제한(관측값 12). 인게임 스케줄러를 쓴 적 없는 캐릭터는 `0/0` 이고 `boss_contents` 가 빈 배열이다(날짜 무관 고정)

**`date` 파라미터 — 이 엔드포인트만 규칙이 다르다 (실측):**

| 값 | 결과 |
|---|---|
| **미지정** | 200, **오늘 데이터**. 오늘을 조회하는 유일한 방법 |
| 오늘 날짜 명시 | **400 `OPENAPI00004`** ← KST 오늘 날짜를 계산해 넣으면 100% 실패 |
| 미래 | 400 |
| 어제 ~ 13일 전 | 200 |
| 14일 전 이상 과거 | 400 |

**캐싱 예외:** 이 응답은 스냅샷이 아니라 **실시간**이다 — 방금 잡은 보스가 즉시 `complete_flag="true"` 로 반영되는 것을 확인했다. 그래서 `maple.ts` 의 `getCharacterState` 만 `revalidate: 0` 으로 호출한다(기본 60초를 쓰면 "보스 잡고 바로 동기화했는데 미완료로 뜬다"가 되고, 그 증상은 완료 판정 버그와 사용자 눈에 구별되지 않는다).

**`difficulty` — 영문 소문자 5종:** `easy` / `normal` / `hard` / `chaos` / `extreme`
> ⚠️ **한글이 아니다.** 과거에 `boss_presets.nexon_difficulty` 에 `'하드'` 를 넣은 마이그레이션이 배포돼 `findBossMatch` 가 단 한 건도 매칭하지 못한 채 자동 동기화가 죽어 있었다(`normalizeName` 은 공백제거+소문자화만 하므로 `'하드'` 와 `'hard'` 는 영원히 다르다). 같은 보스가 난이도별로 **별도 행**이다(스우 normal/hard/extreme = 3행).

**`cycle` — 3종:** `bossDaily`(24행) / `bossWeekly`(51행) / `bossMonthly`(2행: 검은 마법사 hard·extreme)
> ⚠️ **"주간 보스" 전용 엔드포인트가 아니다.** 그리고 **주기는 보스 이름이 아니라 (이름, 난이도) 쌍에 종속된다** — 자쿰 `easy`·`normal` 은 `bossDaily`, 자쿰 `chaos` 는 `bossWeekly` 다. 매그너스·파풀라투스·피에르·반반·블러디퀸·벨룸도 같은 식으로 갈린다. **이름만으로 주기를 역추정하면 틀린다.**
> 앱에서의 대응 매핑은 `scheduler-state.ts` 의 `bossCycleToResetType()` — `bossDaily`→`daily`, `bossWeekly`→`weekly_thu`, `bossMonthly`→`monthly`.

**`type` / `quest_state` / `now_count` / `max_count`:**
- `type` 은 `"contents"` | `"quest"` 둘뿐. `type==="contents"` 면 `quest_state` 가 **`null`** 이다(빈 문자열 아님)
- `quest_state` 는 `"0"`(기타) / `"1"`(진행중) / `"2"`(완료) 셋 다 실재
- `type==="quest"` 도 `now/max` 를 가질 수 있다(예: `[일일 퀘스트] 세르니움 조사` = `now=0/max=100/state="1"`). 그래도 완료 판정은 `quest_state` 만 따른다
- ⚠️ **`max_count === 0` 인 콘텐츠가 다수다**(에픽 던전 3종, 무릉도장, `[길드] 지하 수로`, `[길드] 플래그 레이스`). 그때 `now_count` 는 완료 횟수가 **아니다** — `[길드] 지하 수로` 가 `now=10144`(점수), `에픽 던전 : 악몽선경` 이 `now=5 > max=0` 이다. **`now>0` 을 완료로 해석하면 안 된다.** `scheduler-state.ts` 는 이 경우를 `"unknown"`(판정 불가)으로 처리한다
- `registration_flag: "false"` 인 항목도 **전부 응답에 포함**된다(안 하는 주간퀘 12개, 일일퀘 18개 전체). "등록된 것만 온다"가 아니다

**미접속 캐릭터 판별 (실측):** 그날 접속하지 않은 캐릭터는 `daily_contents` 에 몬스터파크 1개만 오고 `cycle="bossDaily"` 항목이 통째로 빠진다(접속한 날은 daily 18개 + bossDaily 24개). **응답이 완전히 비지는 않으므로 "빈 응답"으로는 판별할 수 없다** — `scheduler-state.ts` 의 `hasDailyData`(`boss.some(cycle==="bossDaily")`) / `hasBossData` 를 쓸 것.

**의미:** 이 엔드포인트를 쓰면 사용자가 앱에서 수동 체크하지 않아도, **게임 내 실제 완료 여부를 넥슨 서버에서 그대로 가져와** 체크리스트를 자동 동기화할 수 있다. 단 위의 "판정 불가" 경우들을 미완료로 뭉개지 말 것 — 넥슨이 하지 않은 말을 사용자에게 통보하게 된다.

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
