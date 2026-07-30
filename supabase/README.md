# mapletool Supabase 백엔드 (v1)

넥슨 메이플 숙제 트래커의 데이터 모델 / RLS / 트리거 / 시드. Next.js 15 App Router +
`@supabase/ssr`(anon 키 + RLS, service_role 미사용) 기준.

## 마이그레이션 파일 (적용 순서 = 파일명 오름차순)

| 파일 | 내용 |
| --- | --- |
| `migrations/20260702090000_init_schema.sql` | 확장(pgcrypto), 테이블 6개, 인덱스, 코멘트 |
| `migrations/20260702090100_functions_triggers.sql` | `is_admin` / `handle_new_user` / `guard_profile_update` / `sync_nexon_key_flag` / `set_updated_at` + 트리거 |
| `migrations/20260702090200_rls_policies.sql` | RLS 활성화 + 정책 + GRANT |
| `migrations/20260702090300_seed_boss_presets.sql` | 주간 보스 프리셋 b1..b6 시드 |
| `migrations/20260702090400_delete_own_account.sql` | 회원탈퇴 RPC `delete_own_account()` |
| `migrations/20260702090500_admin_recent_access.sql` | 관리자 전용 RPC `admin_recent_access(p_limit)` — 최근 접속 목록(마스킹 이메일) |
| `migrations/20260706100000_boss_preset_nexon_match.sql` | `boss_presets`에 `nexon_content_name`/`nexon_difficulty` 추가, b5(하드 스우/듄켈)→b5(하드 스우)+b7(하드 듄켈) 분리, 선택/견적 복제 |
| `migrations/20260707100000_character_cache_and_quest_presets.sql` | 신규 테이블 `character_cache`(사용자별 캐릭터 스냅샷 캐시), `quest_presets`(boss_presets 의 daily/weekly 버전) + RLS |
| `migrations/20260707100100_discover_preset_rpcs.sql` | `boss_presets`에 `(nexon_content_name, nexon_difficulty)` 유니크 인덱스 추가 + find-or-create RPC `discover_boss_preset()`/`discover_quest_preset()` |

모두 **멱등**(`create table if not exists`, `create or replace`, `drop policy/trigger if exists`,
`create index if not exists`, `on conflict do nothing`)이라 재적용해도 안전하다.

## 적용 방법

```bash
# 로컬 개발 스택(도커) 초기화 + 전체 마이그레이션 재적용
supabase db reset

# 원격(연결된 프로젝트)에 신규 마이그레이션 적용
supabase db push
```

> Supabase CLI가 없으면 대시보드 SQL Editor에 파일 순서대로 붙여넣어 실행해도 된다.

### 최초 관리자 지정(부트스트랩)

`role` 자가 변경은 트리거로 막혀 있지만, **JWT 없는 신뢰 컨텍스트(대시보드 SQL/서버 SQL,
`auth.uid()`가 null)** 에서는 변경이 허용된다. 대시보드 SQL Editor에서:

```sql
update public.profiles set role = 'admin' where id = '<관리자 auth.users id>';
```

이후에는 관리자(`is_admin()`)가 다른 사용자의 role을 바꿀 수 있다(정책 + 트리거 허용).

## 테이블 요약

| 테이블 | 소유/공유 | 용도 |
| --- | --- | --- |
| `profiles` | 본인/관리자(select) | auth.users 1:1. `role`, `nickname`, `last_access_at`, `has_nexon_key`(파생 플래그) |
| `user_secrets` | 본인 전용 | 넥슨 API 키 원문(`nexon_api_key`), `nexon_key_valid`. **관리자도 접근 불가** |
| `boss_presets` | 공용(관리자 CRUD) | 주간 보스 프리셋. `id text`, 시드 b1..b7(b5/b7은 "하드 스우"/"하드 듄켈"로 분리). `nexon_content_name`/`nexon_difficulty`(둘 다 nullable)로 넥슨 스케줄러 API 콘텐츠 매칭 |
| `completions` | 본인 전용 | 완료 기록(period_key 모델). `unique(user_id, character_ocid, item_id, period_key)` |
| `quest_durations` | 본인 전용 | 항목별 예상 소요시간(분). `unique(user_id, item_id)` |
| `character_boss_selection` | 본인 전용 | 캐릭터별 실제 잡는 보스(행 존재=선택). `unique(user_id, character_ocid, item_id)` |
| `character_cache` | 본인 전용 | 사용자별 캐릭터 스냅샷 캐시(이미지/전투력/포스 등). `primary key (user_id, ocid)`. 넥슨 라이브 호출 대체용 — "동기화"/"숙제 동기화"/최초 키 등록 워밍업 시에만 갱신 |
| `quest_presets` | 공용(RPC 전용 쓰기) | `boss_presets`의 daily/weekly 버전. `id text`, 인증 사용자 전체 select, insert/update/delete는 `discover_quest_preset()` RPC로만 |

`item_id`는 전부 **text**로 통일: daily/weekly는 `src/lib/presets.ts`의 코드 id(`d1..d5`,
`w1..w3`) 또는 `quest_presets.id`(자동 등록분), boss는 `boss_presets.id`. `completions.item_id`는
소스가 섞이므로 FK를 걸지 않고, `character_boss_selection.item_id`만 `boss_presets(id)`에
FK(보스 삭제 시 선택 정리).

## 주요 설계 결정

### 1) RLS 설계 (기본 deny + 본인 행 / 관리자 예외)

- 6개 테이블 모두 RLS 활성화. **모든 정책은 `TO authenticated`** → anon은 전부 차단.
- 본인 데이터 3종(`completions`, `quest_durations`, `character_boss_selection`)은
  `for all using(auth.uid()=user_id) with check(auth.uid()=user_id)`. INSERT에도 `with check`로
  `user_id`를 강제하므로 클라이언트가 남의 `user_id`를 넣을 수 없다.
- `profiles`: 본인 select/update + **관리자 전체 select**(유저현황 페이지용). insert는 트리거만,
  delete는 auth.users cascade로 처리(정책 없음).
- `boss_presets`: 인증 사용자 누구나 select, insert/update/delete는 관리자만.
- **관리자 판정은 `public.is_admin()` (SECURITY DEFINER, `search_path` 고정)** 로 구현.
  정의자(postgres)로 실행돼 `profiles`의 RLS를 우회하므로 "정책 안에서 profiles를 읽어 정책을
  평가"하는 **무한 재귀를 피한다**. `auth.uid()`는 initplan 캐싱을 위해 `(select auth.uid())`로 감쌌다.
- `role` 자가 변경 차단은 정책이 아니라 **`guard_profile_update` BEFORE UPDATE 트리거**가 담당한다
  (RLS의 `with check`는 새 행만 보고 old/new 비교가 어렵기 때문). 트리거는 `id`/`created_at`을
  항상 고정하고, 로그인한 일반 사용자의 `role` 변경만 무효화한다.

### 2) 넥슨 API 키 보관 — Vault/pgsodium 대신 "테이블 분리 + RLS" 채택

- **키는 `profiles`가 아니라 별도 `user_secrets` 테이블에 둔다.** 이유: RLS는 **행 단위**라
  "관리자는 profiles 전체 select 가능" 요구와 "키는 본인만" 요구가 같은 테이블에선 양립 불가하다
  (컬럼 단위 차단 불가). 분리하면 관리자가 `select * from profiles`를 해도 **키가 물리적으로 없다.**
- `user_secrets`에는 **관리자 정책을 만들지 않았다** → 관리자도 키 원문 접근 불가. 본인만 CRUD.
- **Vault/pgsodium 컬럼 암호화는 v1에서 채택하지 않음.** 트레이드오프:
  - 이 앱은 **service_role 미사용**이라 서버가 "사용자 JWT(authenticated)" 컨텍스트로 DB를 읽는다.
    Vault의 `vault.decrypted_secrets` 복호화는 상위 권한(service_role/postgres)을 요구하므로,
    authenticated 컨텍스트에서 쓰려면 SECURITY DEFINER RPC + Vault 권한 부여가 필요해 복잡도가 크다.
  - 게다가 복호화 RPC를 "본인 것만" 열어줘도, **세션이 탈취되면 어차피 자기 키를 복호화해 가져갈 수 있어**
    공격자 관점 이득이 제한적이다. (pgsodium TCE는 최신 Supabase에서 사실상 비권장/폐기 방향.)
  - 저장매체 암호화(at-rest)는 Supabase 인프라가 이미 제공한다.
  - **대체 방어선**: (a) 본인만 접근하는 RLS, (b) profiles와의 물리적 분리(관리자·일반 select에
    섞이지 않음), (c) 애플리케이션 규율 — 키는 `@/lib/supabase/server`(서버)에서만 읽고
    **클라이언트 응답/로그/에러에 원문을 절대 담지 않는다**. select 시 필요한 컬럼만 명시적으로 고른다.
  - 후속으로 더 강한 보호가 필요하면, service_role 전용 백엔드 경로를 별도로 만들고 그때 Vault 도입을
    재검토한다(현재 컨벤션 범위를 벗어남).
- **등록률 통계**는 키 원문 없이 내기 위해, `user_secrets` 변경 시 트리거(`sync_nexon_key_flag`)가
  `profiles.has_nexon_key`(불리언 파생 플래그)를 동기화한다. 관리자는 이 플래그만 보고 집계한다.
  (플래그는 본인이 UPDATE로 조작 가능하나 통계 정확도에만 영향 있는 비민감 값이며, 키 변경 시 트리거가
  다시 올바른 값으로 덮는다.)

### 3) character_boss_selection 기본 정책 — "행 없음 = 전체 선택"

캐릭터별로 실제 잡는 보스를 행으로 저장한다(행 존재 = 선택). **특정 캐릭터에 대해 행이 하나도
없으면 = "모든 boss_presets 선택"으로 간주**(프로토타입 기본값). 행이 1개라도 생기면 그때부터
"선택된 보스만" 대상이다. DB는 존재/부재만 저장하고, 이 기본값 해석은 **앱 조회 로직**에서 구현한다.
(주의: 사용자가 "보스를 하나도 안 잡음"을 명시하려면 별도 표현이 필요하다 — v1은 프로토타입 기본값 우선.)

### 4) 접속 통계 — access_log 테이블 없이 profiles 컬럼으로 집계

관리자 페이지가 요구하는 통계는 **별도 로그 테이블 없이** `profiles`의 세 값으로 전부 낼 수 있어
v1에서는 `access_log`를 **추가하지 않았다.**

| 통계 | 산출 |
| --- | --- |
| 전체 유저 | `count(*) from profiles` |
| 오늘 접속 | `last_access_at >= (오늘 00:00 KST)` 카운트 |
| 이번 주 신규 가입 | `created_at >= (이번 주 시작 KST)` 카운트 |
| API 키 등록률 | `has_nexon_key = true` 비율 |
| 최근 접속 목록 | `select * from admin_recent_access(N)` (마스킹된 이메일 포함, 아래 절 참고) |

`last_access_at`는 앱이 접속 시 본인 profiles를 UPDATE해 갱신한다(RLS 본인 update 허용). 로그인
후 서버에서 갱신하면 된다.

**트레이드오프**: `last_access_at`는 "마지막 1회"만 담아 DAU 추세/방문 이력 같은 **시계열 분석은
불가**하다. 나중에 일별 접속 추이·리텐션이 필요해지면 그때 최소 형태의 `access_log(user_id, at)`
(+ 본인 insert만 허용, 관리자 집계용 select)를 추가하는 편이 낫다. 지금 요구된 5개 지표에는
불필요한 쓰기·저장 비용이라 도입을 보류했다.

### 5) 넥슨 스케줄러 매칭 필드 — `boss_presets.nexon_content_name`/`nexon_difficulty`, b5/b7 분리

넥슨 스케줄러 API(`GET /maplestory/v1/scheduler/character-state`)로 실제 완료 여부를 자동
확인하는 기능을 위해 `boss_presets`에 `nexon_content_name text`/`nexon_difficulty text`(둘 다
nullable)를 추가했다(`20260706100000_boss_preset_nexon_match.sql`).

- **표시용 `name`과 분리한 이유**: `name`은 관리자가 자유롭게 바꿀 수 있어(관리자 CRUD, RLS
  `boss_presets` 관리자만 update) 매칭 키로 쓰기 불안정하다. 넥슨 원문 콘텐츠명/난이도는 별도
  컬럼으로 고정해 `name`이 바뀌어도 매칭이 깨지지 않게 한다.
- **매칭 정책(앱 쪽 구현, `src/lib/scheduler-state.ts`)**: `nexon_content_name`과
  `nexon_difficulty`가 **모두** 채워져 있어야 자동 매칭 대상이다. 둘 중 하나라도 null이면 안전하게
  수동 체크로 남긴다(오매칭 방지 최우선). 그래서 b1~b4는 콘텐츠명만 베스트에포트로 채우고
  난이도는 확신이 없어 NULL로 남겼고(관리자가 나중에 채울 수 있음), 그룹 라벨인 b6("선택 아케인")은
  둘 다 NULL로 둔다.
- **b5("하드 스우 / 듄켈") → b5("하드 스우") + b7("하드 듄켈") 분리**: 스케줄러 API는 스우/듄켈을
  서로 다른 content_name으로 내려주는데, 기존 b5는 이 둘을 한 항목으로 묶어놔서 매칭 키 1개에
  콘텐츠 2개가 걸리는 문제가 있었다(하나만 잡아도 완료로 오판할 위험). b5는 id를 유지한 채
  "하드 스우"로 개명해 기존 `completions`/`character_boss_selection`/`quest_durations` 기록을
  그대로 보존하고, "하드 듄켈"은 신규 id `b7`로 분리했다.
  - `character_boss_selection`/`quest_durations`는 `item_id='b5'`인 행을 `'b7'`로도 복제
    삽입했다(이미 있으면 무시) — "b5를 잡는다/이만큼 걸린다"는 사용자 의도를 분리된 두 보스
    모두에 이어받게 하기 위해서다.
  - **`completions`(완료 기록)는 절대 복제하지 않는다.** 과거 "b5 완료" 기록만으로는 "스우+듄켈
    둘 다 잡음"인지 "하나만 잡음"인지 구분할 수 없어서, 그대로 복제하면 실제로는 안 잡은 보스가
    "완료"로 잘못 표시될 위험이 있다. 사용자가 다음 주기부터 두 보스를 각각 새로 체크하도록
    안전하게 남겨둔다.

### 6) 캐릭터 캐시(`character_cache`) + 자동등록 프리셋(`quest_presets`) + 안전한 auto-insert RPC

배경: `/main` 페이지가 매 요청마다 넥슨 API를 라이브 호출하던 것을 "DB 캐시 우선" 모델로
전환하는 작업(전체 계획 문서 "넥슨 데이터 캐싱 + 실제 완료/스탯 동기화 + 신규 콘텐츠 자동
등록")의 DB 파트. `20260707100000_character_cache_and_quest_presets.sql` +
`20260707100100_discover_preset_rpcs.sql`.

- **`character_cache`**: 사용자별 캐릭터 스냅샷(이미지/전투력/아케인·어센틱 포스 등)을 담는
  캐시 테이블. `primary key (user_id, ocid)`. "동기화"/"숙제 동기화" 버튼이나 최초 키 등록
  워밍업이 upsert 로 채우고, 평소 `/main` 진입 시에는 이 테이블만 읽어 넥슨 호출을 피한다.
  기존 "캐릭터는 DB에 캐시하지 않는다"는 v1 원칙에서 **의도적으로 벗어나는 변경**이다 —
  캐릭터 자체가 진실 소스(넥슨)가 아니게 되는 게 아니라, 갱신 시점을 "매 요청"에서 "사용자가
  명시적으로 누른 버튼"으로 옮기는 캐싱 전략이다. RLS 는 다른 본인 전용 테이블과 동일하게
  `auth.uid() = user_id`인 행만 전체 CRUD, 관리자 예외 없음.
- **`quest_presets`**: `boss_presets`의 daily/weekly 버전. 넥슨 스케줄러가 알려주지만 코드
  프리셋(`src/lib/presets.ts` `PRESET_ITEMS`)에 없는 일일/주간 콘텐츠를 담는다. `req_level`/
  `req_force`/`rec_hexa`/`symbol_type` 같은 보스 전용 요구치 필드는 없다(일일/주간 퀘스트는
  그런 스펙 요구치가 없는 콘텐츠라서). 인증 사용자 전체 select 는 허용하되, insert/update/
  delete 는 **정책을 아예 만들지 않아 RLS 기본 deny 로 막는다**(boss_presets 처럼 "관리자만
  허용"하는 예외 정책도 없음 — 오직 SECURITY DEFINER RPC 로만 생성 가능).
- **왜 일반 INSERT 정책이 아니라 RPC 인가**: "숙제 동기화" 서버 액션은 일반 사용자 권한
  (authenticated, RLS 적용)으로 실행되는데, 넥슨 응답에 없는 콘텐츠를 자동 등록해야 한다.
  일반 사용자에게 `boss_presets`/`quest_presets` 자유 insert/update 를 허용하면 (a) 다른
  사용자가 관리자 UI 로 큐레이션한 `req_level` 등을 덮어쓸 위험, (b) 두 사용자가 동시에 같은
  신규 콘텐츠를 발견해 중복 행이 생길 위험이 있다. `admin_recent_access()`/
  `delete_own_account()`와 동일한 SECURITY DEFINER 패턴으로, "이미 있으면 그 id 반환, 없으면
  최소 기본값으로만 생성"하는 좁은 find-or-create RPC 로 제한한다.
  - **`discover_boss_preset(p_name text, p_nexon_content_name text, p_nexon_difficulty text) returns text`**
    — `(nexon_content_name, nexon_difficulty)` 정확 일치(대소문자/공백 정규화 없음) 조합이
    이미 있으면 그 `id` 반환. 없으면 `req_level=0, req_force=0, rec_hexa=0, symbol_type=null,
    reset_type='weekly_thu', list_order=현재 최댓값+1`로 신규 삽입 후 `id` 반환(요구치는 전부
    "제한 없음"에 해당하는 최소값 — 관리자가 나중에 `updateBossPreset`으로 수정).
  - **`discover_quest_preset(p_name text, p_category text, p_reset_type text, p_nexon_content_name text) returns text`**
    — `(category, nexon_content_name)` 정확 일치 조합 기준으로 동일한 find-or-create.
  - **동시성**: `boss_presets(nexon_content_name, nexon_difficulty)` / `quest_presets(category,
    nexon_content_name)`에 유니크 인덱스를 추가하고, `insert ... on conflict do nothing
    returning id`로 먼저 시도한 뒤 `returning`이 비면(경합으로 다른 트랜잭션이 먼저 삽입)
    재조회해서 반환한다. 별도 advisory lock 없이 DB 유니크 제약이 최종 방어선이라, 두
    사용자가 동시에 같은 신규 보스를 발견해도 중복 행이 생기지 않는다(로컬 검증: 두 세션이
    동시에 같은 `(경합콘텐츠, 하드)` 조합으로 `discover_boss_preset`을 호출했을 때 둘 다 같은
    `id`를 반환했고 최종 행은 1개였음).
  - 두 함수 모두 SECURITY DEFINER + `search_path` 고정, `(select auth.uid())`가 null이면
    예외(로그인 사용자만 호출), `authenticated`에만 `grant execute`(anon/public 은 revoke).
    boss_presets 기존 컬럼(`nexon_content_name`/`nexon_difficulty`가 둘 다 NULL 인 b6, 난이도만
    NULL 인 b1~b4)은 표준 유니크 인덱스의 "NULL은 서로 다른 값" 규칙 덕분에 새 유니크 인덱스와
    충돌하지 않는다(로컬 검증 완료).

## 신규 가입 트리거

`auth.users` INSERT → `handle_new_user`(SECURITY DEFINER)가 `profiles`를 자동 생성(`role='user'`,
닉네임은 `raw_user_meta_data`의 nickname/name/full_name → 없으면 이메일 로컬파트). daily/weekly는
코드 프리셋이고 완료기록은 period_key 모델이라 **per-user 시드 INSERT는 불필요**(프로필만 생성).

## 완료 토글 흐름 (앱 구현 가이드 — 서버에서)

1. 항목의 `reset_type`을 얻는다: daily/weekly 코드 프리셋은 `presets.ts`(코드), boss는
   `boss_presets.reset_type`(DB), 자동 등록된 daily/weekly는 `quest_presets.reset_type`(DB).
2. **서버에서** `currentPeriodKey(reset_type)` (`src/lib/period.ts`)로 `period_key`를 계산한다.
   클라이언트가 보낸 `period_key`/`user_id`는 신뢰하지 않는다.
3. 완료 = `completions` INSERT `... on conflict (user_id, character_ocid, item_id, period_key) do nothing`(멱등).
   해제 = 해당 4-튜플 DELETE.
4. 완료 판단 = "현재 `period_key`와 일치하는 행 존재 여부". 새 주기가 되면 키가 달라져 자동 미완료
   → **리셋 배치/크론 불필요**.

## 회원탈퇴(계정 삭제) 흐름

이 앱은 **service_role 을 쓰지 않는다**(anon 키 + RLS 만). Supabase 에서 `auth.users` 행 삭제는
보통 Admin API(`supabase.auth.admin.deleteUser()`, service_role 필요)로만 가능하므로, 대신
`public.delete_own_account()` (SECURITY DEFINER RPC, `20260702090400_delete_own_account.sql`)로
"호출자 본인만" 지울 수 있는 좁은 구멍을 뚫었다.

- **인자 없음.** target user_id 를 파라미터로 받지 않고 항상 함수 내부에서
  `(select auth.uid())`로 호출자 자신만 대상으로 삼는다 — 클라이언트가 남의 id 를 넘겨 삭제시키는
  경로를 원천 차단.
- `auth.uid()`가 null(비로그인/신뢰 컨텍스트)이면 예외를 raise 하고 아무것도 지우지 않는다.
- `delete from auth.users where id = (select auth.uid())` 한 줄만 실행한다.
  `profiles`/`user_secrets`/`completions`/`quest_durations`/`character_boss_selection` 이 전부
  `references auth.users(id) on delete cascade`(`boss_presets.created_by` 만
  `on delete set null` — 개인 데이터가 아니므로 대상 아님)라 이 한 줄로 연쇄 삭제된다.
- `authenticated` 에만 `grant execute`, `anon`/`public` 은 명시적으로 `revoke`.

**앱에서 호출하는 순서**(서버 액션):
1. 서버 액션에서 `await supabase.rpc('delete_own_account')` 호출(`@/lib/supabase/server`의
   서버 클라이언트 — 사용자 세션 쿠키 기반이라 RPC 내부의 `auth.uid()`가 현재 로그인 사용자로 채워짐).
2. 성공하면(에러 없음) `await supabase.auth.signOut()`으로 로컬 세션/쿠키를 정리한다(서버에서
   `auth.users` 행 자체가 사라졌으므로 남은 세션 토큰은 더 이상 유효한 사용자를 가리키지 못함 —
   signOut 으로 클라이언트 상태까지 명시적으로 비운다).
3. `/`(랜딩)으로 리다이렉트한다.

로컬 PostgreSQL(auth 스키마 흉내 + `auth.uid()` 세션변수 + `anon`/`authenticated` 롤)에 기존 4개
마이그레이션 + 이 마이그레이션을 순서대로 적용해 라이브 검증 완료: 유저 A 삭제 시 A 의
`profiles`/`user_secrets`/`completions`/`quest_durations`/`character_boss_selection`이 전부
cascade 로 사라지고 유저 B 데이터는 전혀 건드려지지 않음, `auth.uid()` null 상태 호출은 예외,
anon 롤은 실행 권한 자체가 없어 차단, 기존 마이그레이션 전체 재적용도 에러 없이 통과.

## 관리자 "최근 접속" 목록 — `admin_recent_access(p_limit)`

관리자 페이지는 각 행에 **마스킹된 이메일 + 상대시간 + 상태 배지**를 요구한다. 그런데 이메일은
`auth.users.email`에 있고 `profiles`에는 없다. `auth.users`는 PostgREST(Data API)로 노출되지
않고, 이 앱은 **service_role을 쓰지 않으므로**(anon 키 + RLS만) 일반 세션으로는 다른 유저의
이메일을 조회할 방법이 없다. `delete_own_account()`와 동일한 패턴으로, **SECURITY DEFINER RPC로
"관리자에게만" 마스킹된 이메일을 좁게 노출**한다(`20260702090500_admin_recent_access.sql`).

- **반환 컬럼**: `id uuid`, `masked_email text`, `last_access_at timestamptz`. 디자인 목업의
  "캐릭터 수"는 **포함하지 않는다** — 작성 당시엔 캐릭터를 DB에 캐시하지 않고 넥슨 OpenAPI를 매
  요청 조회했으므로, 전체 유저의 캐릭터 수를 한 번에 집계할 방법이 없었다(알려진 설계 편차).
  이후 `character_cache`(위 "6) 캐릭터 캐시..." 참고)가 추가돼 이론적으로는 `count(*) group by
  user_id`로 집계 가능해졌지만, 이 함수 자체는 아직 그 방식으로 갱신되지 않았다 — 필요해지면
  `admin_recent_access()`를 확장하거나 화면에서 유저별로 개별 조회한다.
- **왜 SECURITY DEFINER인가**: `is_admin()`/`delete_own_account()`와 동일한 이유 — 정의자
  권한으로 실행돼 `auth.users`(PostgREST 미노출) 조인을 함수 내부에서만 허용하고, 클라이언트에는
  마스킹된 결과만 반환한다. 이메일 원문은 함수 밖으로 절대 나가지 않는다.
- **호출자 검사는 함수 내부에서**: 실행 권한(`grant execute`) 자체는 `authenticated` 전체에
  주지만, 함수 본문 첫 줄에서 `is_admin()`이 아니면 예외를 raise하고 아무 행도 반환하지 않는다
  (`anon`은 애초에 `grant execute`가 없어 실행 자체가 막힌다 — 이중 방어).
- **`p_limit`은 1~100으로 clamp**(기본 20, null/범위 밖도 안전한 값으로 보정)해 과도한 조회를 막는다.
- **이메일 마스킹 규칙**(로컬파트 = `@` 앞부분, 도메인은 그대로 노출):
  - 로컬파트 길이 2 이하 → 전부 마스킹(`**`)
  - 로컬파트 길이 3~4 → 앞 2글자 노출 + `****`
  - 로컬파트 길이 5 이상 → 앞 3글자 노출 + `****`
  - 예: `me@gmail.com` → `**@gmail.com`, `member@gmail.com` → `mem****@gmail.com`. 로컬파트
    원문 전체가 그대로 노출되는 경우는 없다(마지막 케이스도 항상 뒤가 `****`로 잘림).
- 정렬은 `last_access_at desc nulls last`(오래 접속 없는/미접속 유저는 맨 뒤).

로컬 PostgreSQL(auth 스키마 흉내 + `auth.uid()` + `anon`/`authenticated` 롤)에 기존 5개
마이그레이션 + 이 마이그레이션을 순서대로 적용해 라이브 검증 완료: 일반 유저 A로 호출 시 예외
raise(행 없음), 관리자 B로 호출 시 A/B 모두 마스킹된 이메일로 반환되고 `last_access_at desc`
정렬 확인, `p_limit=1`은 1행만, `p_limit=100000`은 100으로 clamp되어 안전, `p_limit<=0`도
최소 1로 clamp, 2글자 이하 로컬파트(`ab@short.com`)는 전부 마스킹, `anon` 롤은 실행 권한
자체가 없어 차단, 데이터가 남은 DB에 기존 5개 + 신규 마이그레이션 전체 재적용도 에러 없이 통과.

## period_key 포맷 (검증됨, `src/lib/period.ts` 단일 진실)

- daily → `d-<KST epochDay>` (예: `d-20636`)
- weekly_thu → `weekly_thu-<직전 목요일 epochDay>` (예: `weekly_thu-20636`)
- monthly → `monthly-<YYYY>-<MM>` (예: `monthly-2026-07`)

과거엔 `weekly_mon`(월요일 초기화, 주간 퀘스트 전용)도 있었으나 완전히 제거됐다 — 넥슨은
콘텐츠별 초기화 요일을 알려주지 않아 확인할 방법이 없었고, 초기 설계 당시 근거 없이 월요일로
가정했다. 실제로는 주간 퀘스트도 주간 보스와 동일하게 목요일 초기화라는 것을 사용자 확인으로
정정했다(2026-07-30). `weekly_mon-*` 접두사로 남은 과거 완료 기록은 지우지 않고 낡은 행으로
둔다(현재 어떤 항목의 reset_type 과도 일치하지 않아 화면에는 영향 없음).

숫자는 KST 기준으로 매일 증가하므로 마이그레이션/검증에 하드코딩하지 말고 항상 `currentPeriodKey()`로
계산한다. DB는 `period_key`를 text로 저장할 뿐 계산하지 않는다.

## 앱 코드에서 주의할 점

- 넥슨 키(`user_secrets.nexon_api_key`)는 **서버에서만** 읽고, 응답/로그/에러에 원문을 담지 않는다.
  profiles select 시 키 컬럼이 없음을 전제로 하되(분리됨), 습관적으로 필요한 컬럼만 명시한다.
- `period_key`/`user_id`는 항상 서버에서 확정한다(클라이언트 입력 불신).
- `category`(표시 그룹: daily/weekly/boss_daily/boss)와 `reset_type`(초기화 주기: daily/weekly_thu/monthly)은
  다른 개념이다. 완료·초기화 판정은 반드시 `reset_type`으로.
- 보스 목록은 `boss_presets`(DB)에서 조회해 daily/weekly 코드 프리셋과 합쳐 `CATEGORY_ORDER` 순으로 표시.
- 인증/세션은 기존 `src/lib/supabase/{server,client,middleware}.ts` + `src/middleware.ts`를 재사용한다.
- **로그인 성공 시 서버 액션에서 본인 `profiles.last_access_at`을 갱신해야 한다**(아직 미구현,
  다음 UI 단계에서 처리 예정). 현재는 앱 코드 어디서도 이 컬럼을 UPDATE하지 않아 관리자 페이지의
  "최근 접속"(`admin_recent_access`)이 실제 데이터를 반영하지 못한다.
