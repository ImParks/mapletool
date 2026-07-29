---
name: maple-reset-cycles
description: 메이플스토리 컨텐츠의 초기화 주기(일일/주간 퀘스트/주간 보스)와 체크리스트 완료 상태를 모델링하는 방법을 다루는 스킬. mapletool에서 일일/주간/보스 체크 완료 여부, 초기화 시각, "주기 키(period key)" 계산, 완료 자동 리셋(리셋 배치 불필요), 다음 초기화까지 남은 시간 표시, 멱등 완료 기록(중복 INSERT 방지) 등을 구현하거나 디버깅할 때 사용한다. 초기화, 리셋, 일일/주간/보스, 월요일 초기화, 목요일 초기화, KST, UTC+9, 완료 상태, 체크리스트 주기, currentPeriodKey, period_key, periodStart, dayNum, ResetType, daily/weekly_mon/weekly_thu, category 와 reset_type 구분, 새 초기화 주기(월간) 추가, 남은 시간/다음 초기화 같은 요청에 매칭된다.
---

# 메이플 초기화 주기 & 체크리스트 완료 상태 모델링

mapletool은 일일/주간 퀘스트와 주간 보스의 완료 여부를 체크하는 보조 웹앱이다. 핵심 메커니즘은 `src/lib/period.ts` 에 구현되어 있다. 이 스킬은 **메커니즘**만 다룬다. 어떤 보스/콘텐츠가 일일·주간인지의 **목록**은 패치마다 바뀌므로 절대 여기에 하드코딩하지 말고, daily/weekly 는 `src/lib/presets.ts`(코드 프리셋, id `d1..`/`w1..`), 주간 보스는 DB 테이블 `boss_presets`(관리자 CRUD, 전체 유저 공유)에서만 관리한다.

## 초기화 규칙 (모든 시각 Asia/Seoul, UTC+9 고정)

- **일일(daily)**: 매일 00:00 KST 초기화.
- **주간 퀘스트(weekly_mon)**: 매주 **월요일** 00:00 KST 초기화. resetWeekday = 1.
- **주간 보스(weekly_thu)**: 매주 **목요일** 00:00 KST 초기화. resetWeekday = 4.
- **월간 보스(monthly)**: 매월 **1일** 00:00 KST 초기화. 현재 검은 마법사(넥슨 `cycle="bossMonthly"`)뿐.
  넥슨 API 는 `cycle` 이 월간이라는 사실만 알려주고 초기화 시점은 알려주지 않으며, 스케줄러 API 의 `date` 조회 범위가 최근 13일뿐이라 월 경계를 관측해 확인할 수도 없다. 앵커는 인게임 확인으로 확정했다(2026-07-29).

KST는 서머타임이 없어 항상 UTC+9 고정이다. 서버(예: Vercel)는 UTC로 동작할 수 있으므로 시각 계산은 절대 `new Date()`의 로컬 필드(`getHours()`/`getDay()` 등)를 직접 쓰지 말고 항상 KST로 변환한다. `period.ts`는 `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", ... })`로 변환하므로(`kstParts`), 서버 타임존과 무관하게 동일한 결과가 나온다.

`ResetType = "daily" | "weekly_mon" | "weekly_thu" | "monthly"`. 사람이 읽는 라벨은 `RESET_LABEL` 맵(`Record<ResetType, string>`)을 쓴다. 실제 값:

- `daily` → `"매일 00시 초기화"`
- `weekly_mon` → `"월요일 00시 초기화"`
- `weekly_thu` → `"목요일 00시 초기화"`
- `monthly` → `"매월 1일 00시 초기화"`

전체 목록이 필요하면 손으로 나열하지 말고 `ALL_RESET_TYPES`(period.ts) 를 쓴다.

## 완료 상태는 "주기 키(period key)" 기반

별도의 리셋 배치/크론 없이 완료가 자동으로 초기화되도록 설계되어 있다.

- `currentPeriodKey(resetType, now?)` 는 **같은 주기 안에서는 항상 같은 문자열**, **초기화 시점이 지나면 다른 문자열**을 반환한다.
- 완료 기록을 `(item, period_key)` 형태로 저장한다.
- 완료 판단 = "현재 `currentPeriodKey(item.reset_type)` 와 일치하는 완료 기록이 존재하는가".
- 초기화 시각이 지나면 키가 달라지므로 과거 키 기록은 자동으로 "현재 주기에 대한 완료 없음"이 된다 → **리셋 배치/크론 불필요**.

이 모델 덕분에 "초기화 시간에 모든 행을 미완료로 UPDATE" 하는 작업이 전혀 필요 없다.

- **완료 처리 = INSERT** (현재 `period_key`로 한 행 추가).
- **완료 해제 = DELETE** (해당 `(item, period_key)` 행 삭제).
- **멱등성 필수**: 같은 주기에서 같은 항목을 두 번 완료해도 행이 중복되면 안 된다. 저장 테이블에 `unique(user_id, item_id, period_key)`(또는 등가) 제약을 두고, INSERT는 `upsert`/`on conflict do nothing`으로 멱등하게 처리한다. 자세한 스키마/RLS/제약은 `supabase-architect` 에이전트가 설계한다.

## period.ts 실제 구현 요약 (정확한 코드는 `src/lib/period.ts` 참조)

- `kstParts(now)` (**export 됨** — KST 날짜/요일이 필요한 다른 파일도 Intl 변환을 복제하지 말고 이걸 재사용): `Intl.DateTimeFormat`(locale `"en-CA"`, `timeZone: "Asia/Seoul"`)로 KST 기준 `year`/`month`/`day`/`weekday`를 뽑는다. **`weekday`는 일=0, 월=1, … 토=6** (내부 `weekdayMap`으로 `Sun`→0 … `Sat`→6 변환). 함께 export 되는 `kstMidnight(y,m,d)`는 해당 KST 달력 날짜 00:00의 실제 시각(Date)을 돌려준다(UTC+9 고정 오프셋) — 관리자 통계의 "오늘 00:00 KST 이후" 같은 경계 계산용.
- `kstDayNumber(now)`: KST 자정 기준 일련번호. `Math.floor(Date.UTC(year, month-1, day) / 86400000)` — UTC epoch day가 아니라 **KST 날짜(year/month/day)를 그대로 UTC 정오 없이 자정으로 본 표시용 일수**다. 같은 KST 달력 날짜면 서버 타임존과 무관하게 같은 값이 나온다.
- 키 형식 (아래 예시는 모두 **2026-06-23(KST 화요일, dayNum=20627)** 기준 — 코드로 직접 검증 가능):
  - `daily` → `` `d-${dayNum}` `` → `d-20627`
  - `weekly_mon` → `` `weekly_mon-${periodStart}` `` → 직전 월요일은 2026-06-22(dayNum 20626) → `weekly_mon-20626`
  - `weekly_thu` → `` `weekly_thu-${periodStart}` `` → 직전 목요일은 2026-06-18(dayNum 20622) → `weekly_thu-20622`
  - `monthly` → `` `monthly-${year}-${MM}` `` (월은 2자리 zero-pad) → `monthly-2026-06`
- 네 접두사(`d-` / `weekly_mon-` / `weekly_thu-` / `monthly-`)는 서로 배타적이다 — 접두사만으로 "그 주기의 키인가"를 판별할 수 있다(마이그레이션에서 낡은 행을 고를 때 유용).
- **키 형식은 절대 바꾸지 말 것.** `completions.period_key` 에 그대로 저장돼 있고 그 컬럼엔 CHECK 도 length 제한도 없어서, 형식을 바꾸면 이미 쌓인 완료 기록이 조용히 전부 고아가 된다(DB 가 막아주지 않는다).
- 주간 `periodStart` 계산: 현재 KST 요일에서 직전 초기화 요일까지 거슬러 올라간 일수만큼 `dayNum`을 뺀다.
  - `resetWeekday = resetType === "weekly_mon" ? 1 : 4`
  - `diff = (weekday - resetWeekday + 7) % 7`
  - `periodStart = dayNum - diff`
  - 검증 예(화요일 weekday=2): `weekly_mon` → diff=(2-1+7)%7=1 → 20627-1=20626. `weekly_thu` → diff=(2-4+7)%7=5 → 20627-5=20622.
  - 즉 같은 주기에 속한 모든 날은 같은 `periodStart`(직전 월/목요일의 dayNum)를 가지므로 키가 동일하다.

## category 와 reset_type 은 서로 다른 개념 (혼동 금지)

`src/lib/presets.ts` 의 `PresetItem` 은 두 필드를 모두 갖는다.

- **`category`** (`ChecklistCategory = "daily" | "weekly" | "boss_daily" | "boss"`): **UI 표시 그룹**. 화면에서 묶어 보여줄 섹션. `CATEGORY_LABEL`(일일 컨텐츠/주간 퀘스트/일일 보스/주간·월간 보스), `CATEGORY_ORDER`(`["daily","weekly","boss_daily","boss"]`)로 라벨/정렬을 정한다. 보스 계열인지 판별할 땐 `isBossCategory()` 를 쓴다(캐릭터별 보스 선택 필터가 걸리는 그룹).
- **`reset_type`** (`ResetType`): **초기화 주기(완료 판정에 사용)**. `currentPeriodKey`에 넘기는 값.

이 둘은 보통 연관되지만 항상 1:1은 아니다. 가장 명확한 예가 보스다: `category: "boss"` 한 그룹 안에 `reset_type: "weekly_thu"`(주간 보스)와 `reset_type: "monthly"`(검은 마법사)가 **함께** 들어 있고, 반대로 `category: "boss_daily"` 는 `reset_type: "daily"` 로 일일 컨텐츠와 같은 주기를 공유한다. `category: "weekly"` 항목의 주기도 `weekly_mon`(월요일)이라 이름과 다르다.

보스의 `category` 는 `reset_type` 에서 파생한다(`checklist-data.ts` 의 `buildAllItems`: `reset_type === "daily" ? "boss_daily" : "boss"`). 별도 컬럼을 두지 않는 이유는 주기가 넥슨 `cycle` 에서 이미 결정되므로 두 값이 어긋날 여지만 생기기 때문이다. **완료 여부는 언제나 `reset_type`으로 계산하고, `category`는 화면 그룹핑/정렬에만 쓴다.** 절대 `category`로 주기 키를 만들지 말 것(`currentPeriodKey(item.category)`는 타입상 우연히 통과할 수 있는 `"daily"`/`"weekly"` 같은 값에서도 의미가 틀어진다 — 반드시 `item.reset_type`을 넘긴다).

## 새 초기화 주기 추가 절차

> 아래 순서는 2026-07-29 에 `monthly` 를 실제로 추가하며 검증한 것이다. 특히 6~8번은 그때 빠뜨리면 **데이터가 조용히 손상되는** 지점이라 생략 금지.

1. `src/lib/period.ts` 의 `ResetType` 유니온에 새 값 추가.
2. **`ALL_RESET_TYPES` 배열에도 추가**. 여기 빠지면 `currentPeriodKeys()` 가 그 주기를 안 돌려주고, 그 주기의 완료가 화면에서 통째로 사라진다(유니온과 배열의 일치를 타입이 강제하지 못하므로 눈으로 챙길 것).
3. `currentPeriodKey` 의 `switch` 에 분기 추가. `default` 의 `never` 체크가 안전망이라 분기를 빼면 컴파일 에러가 난다.
   > 예전에는 `if (daily) ... else 주간` 구조여서 값만 추가하고 분기를 빼먹으면 **컴파일이 통과하고** 조용히 목요일 키(`monthly-20657`)가 나왔다. 그래서 `switch`+`never` 로 바꿨다.
4. `RESET_LABEL` 에 라벨 추가. `Record<ResetType, string>` 이라 누락하면 컴파일 에러.
5. 필요하면 `src/lib/presets.ts` 에서 해당 `reset_type`을 쓰는 프리셋 항목 추가. 새 주기가 기존 표시 그룹과 안 맞으면 `ChecklistCategory`/`CATEGORY_LABEL`/`CATEGORY_ORDER` 도 함께 갱신(`category` 와 `reset_type` 은 별개 개념임에 주의 — 아래 섹션).
6. **DB 마이그레이션이 필요하다.** `period_key` 자체는 제약 없는 `text` 라 어떤 형식이든 수용하지만, 값을 열거하는 곳이 네 군데 있다:
   - `boss_presets.reset_type` CHECK (`20260702090000_init_schema.sql`)
   - `quest_presets.reset_type` CHECK (`20260707100000_...`)
   - `discover_boss_preset()` 의 plpgsql 화이트리스트
   - `discover_quest_preset()` 의 plpgsql 화이트리스트
   CHECK 와 RPC 화이트리스트는 **반드시 같은 마이그레이션에서** 고친다 — 하나만 고치면 RPC 가 예외를 던지거나 CHECK 가 거부해 조용히 실패한다.
7. **`.in("period_key", [...])` 로 여러 주기를 조회하는 지점을 전부 `currentPeriodKeys()` 로 바꾼다.** 주기를 손으로 나열하면 새 주기가 추가될 때 누락된다. 누락의 결과가 단순 표시 버그가 아니라는 점이 중요하다 — 화면에 미완료로 보이는 항목을 사용자가 체크하면 `toggleCompletion` 이 "이미 있는 행"을 찾아 **DELETE** 하고 `done:false` 를 반환하는데, 클라이언트는 에러가 아니면 롤백하지 않아 화면엔 체크된 채 남고 DB 에선 완료가 사라진다.
8. **단일 `reset_type` 을 하드코딩해 `completions` 를 DELETE 하는 지점**도 함께 고친다(예: `boss-selection-actions.ts` 의 보스 선택 해제). 안 고치면 다른 주기 항목의 완료가 안 지워져 유령 완료로 남는다.
9. **배포 순서: 앱 코드 먼저, 마이그레이션 나중.** DB→TS 경계가 무검증 캐스팅인 곳이 있어, DB 에 새 값이 먼저 생기면 구 코드가 그 값으로 엉뚱한 키를 만든다. 되돌리기 어려운 쓰기 경로에서는 캐스팅 대신 `asResetType()` 으로 좁힐 것.
10. 테스트가 없는 프로젝트이므로, `period.ts` 를 `npx tsc` 로 단독 컴파일해 실행하고 **기존 키 형식이 그대로인지**(회귀) + 새 주기의 경계 시각을 눈으로 확인한다. 기존 키 형식이 바뀌면 이미 쌓인 완료 기록이 전부 고아가 된다.

## 엣지 케이스 / 주의

- **자정 경계**: 정확히 00:00 KST에 키가 바뀐다. `period.ts`는 시(hour)가 아닌 KST "날짜"로 일수를 계산하므로 23:59:59 → 00:00:00 전환 시 `dayNum`이 1 증가하고 키가 즉시 갱신된다.
- **타임존 무관**: 사용자가 미국 등 다른 타임존에서 접속해도 완료 판정은 항상 KST 기준이다(서버에서 `currentPeriodKey` 계산). 클라이언트 로컬 시간(`new Date().getDay()` 등)으로 판정하지 말 것.
- **읽기 캐시 vs 시간 민감성**: 완료 판정/주기 키는 항상 요청 시점에 계산해야 한다(캐시 금지). 넥슨 API 응답 캐시(`maple.ts`의 `next: { revalidate: 60 }`)와 혼동하지 말 것 — 그건 `nexon-maple-api` 영역이며, 주기 키 계산과는 무관하다.
- **"남은 시간" 표시(다음 초기화 시각 계산)**: 핵심은 "다음 초기화는 항상 미래의 KST 자정"이라는 점이다. 현재 시각이 이미 초기화일 자정을 지났다면 그 자정이 아니라 **다음** 자정을 가리켜야 한다(음수 잔여시간 버그 방지).
  - daily: 다음 KST 자정 = 현재 KST 날짜 `dayNum + 1`의 00:00(KST). UTC로는 그 날짜의 `Date.UTC(y, m-1, d+1) - 9*3600*1000`.
  - weekly: 다음 해당 요일(월=1/목=4) 00:00 KST.
    - `daysAhead = (resetWeekday - weekday + 7) % 7`
    - `daysAhead === 0`(오늘이 바로 초기화 요일)이면 이미 오늘 자정은 지났으므로 `daysAhead = 7`로 보정한다.
    - 대상 자정 = `dayNum + daysAhead` 의 00:00 KST.
  - 표시는 (대상 KST 자정 − 현재 시각)을 시/분/초로 포맷. UTC+9 고정이라 DST 보정은 불필요.
  - 헬퍼가 필요하면 `period.ts`에 `nextResetAt(resetType, now): Date` 형태로 추가하고 위 키 계산과 동일한 `kstParts`/`kstDayNumber` KST 변환을 재사용할 것(시간 계산 로직을 여러 파일에 흩뿌리지 말 것).
- **콘텐츠 목록 하드코딩 금지**: 어떤 보스/퀘스트가 어느 주기인지는 패치마다 바뀐다. 이 스킬과 `period.ts`는 메커니즘만, 실제 항목은 `presets.ts`(및 사용자별 커스텀 항목 DB)에서 관리한다.

## 관련 설정

- `mapletool-conventions`: 전반적 프로젝트 컨벤션(경로 별칭 `@/*` → `./src/*`, 서버 전용 모듈, TS strict 등).
- `nexon-maple-api`: 캐릭터/스탯 조회용 넥슨 OpenAPI 레퍼런스(완료 상태 모델과는 별개 영역).
- `supabase-architect` 에이전트: `(user_id, item_id, period_key)` 완료 기록 테이블 스키마·유니크 제약·RLS 설계와 멱등 INSERT(upsert)/DELETE 쿼리를 담당.
