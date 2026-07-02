-- ============================================================================
-- mapletool v1 스키마 (테이블 / 인덱스 / 코멘트)
-- ----------------------------------------------------------------------------
-- 설계 원칙 (자세한 근거는 supabase/README.md 참고):
--  * anon 키 + RLS 만 사용한다. service_role 은 앱에서 쓰지 않는다.
--  * 사용자별 데이터 격리는 RLS 가 최종 방어선이다.
--  * 완료 상태는 period_key 모델(리셋 배치 없음). period_key 는 "앱"이 계산해 넣는다.
--    (마이그레이션에서 period_key 를 계산하지 않는다 — src/lib/period.ts 가 단일 진실.)
--  * 넥슨 API 키는 profiles 가 아니라 별도 user_secrets 테이블에 보관한다.
--    (RLS 는 행 단위라 profiles 에 두면 "관리자 전체 select" 와 충돌 → 키가 노출될 위험.)
--  * item_id 는 전부 text: daily/weekly 는 코드 프리셋 id(presets.ts: d1..d5, w1..w3),
--    boss 는 boss_presets.id.
--
-- 멱등 작성: create table if not exists / create index if not exists.
-- 재적용해도 안전하도록 구성했다.
-- ============================================================================

-- gen_random_uuid() 등 (pg13+ core 지만 명시적으로 활성화).
create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- profiles : auth.users 와 1:1. 넥슨 키 원문은 여기 두지 않는다(user_secrets 로 분리).
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  nickname       text,
  role           text        not null default 'user' check (role in ('user', 'admin')),
  -- 넥슨 키 "등록 여부" 파생 플래그. 관리자 통계(등록률)용. 원문은 user_secrets 에 있음.
  -- user_secrets 변경 시 트리거(sync_nexon_key_flag)가 이 값을 동기화한다.
  has_nexon_key  boolean     not null default false,
  created_at     timestamptz not null default now(),
  last_access_at timestamptz
);

comment on table public.profiles is 'auth.users 1:1 프로필. role(user/admin), 접속통계용 last_access_at, 넥슨키 등록여부 플래그(has_nexon_key). 넥슨 키 원문은 user_secrets 에 보관.';
comment on column public.profiles.role is '권한. user/admin. 일반 사용자는 스스로 변경 불가(guard_profile_update 트리거).';
comment on column public.profiles.has_nexon_key is 'user_secrets 에 유효한 넥슨 키가 있는지의 파생 플래그(관리자 등록률 통계용). 원문 노출 없이 집계 가능.';
comment on column public.profiles.last_access_at is '마지막 접속 시각. 앱이 접속 시 갱신. 관리자 통계(오늘 접속/최근 접속 목록)용.';

-- ----------------------------------------------------------------------------
-- user_secrets : 넥슨 API 키 원문. "본인만" 접근(관리자도 접근 불가).
-- profiles 와 분리해 "관리자 전체 select" 시에도 절대 섞여 나가지 않게 한다.
-- ----------------------------------------------------------------------------
create table if not exists public.user_secrets (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  nexon_api_key  text,
  -- 마지막 검증 결과 캐시(선택). 저장 시 getCharacterList 로 가볍게 검증해 갱신 권장.
  nexon_key_valid boolean     not null default false,
  updated_at     timestamptz not null default now()
);

comment on table public.user_secrets is '넥슨 API 키 원문 저장. RLS 로 본인(user_id=auth.uid())만 접근. 관리자 정책 없음 → 관리자도 못 읽음. 서버(@/lib/supabase/server)에서만 조회하고 클라이언트 응답/로그에 원문을 담지 않는다.';
comment on column public.user_secrets.nexon_api_key is '넥슨 OpenAPI 키 원문(민감). 클라이언트로 절대 반환 금지. select 시 명시적으로 컬럼을 고르고 원문은 서버 경계를 넘기지 않는다.';

-- ----------------------------------------------------------------------------
-- boss_presets : 전체 유저 공통 주간 보스 목록. 관리자만 CRUD, 인증 사용자는 조회.
-- id 는 text (completions.item_id 를 daily/weekly 코드 id 와 동일하게 text 로 통일).
-- ----------------------------------------------------------------------------
create table if not exists public.boss_presets (
  id          text primary key default gen_random_uuid()::text,
  name        text        not null,
  reset_type  text        not null default 'weekly_thu'
                check (reset_type in ('daily', 'weekly_mon', 'weekly_thu')),
  req_level   int,
  symbol_type text        check (symbol_type in ('arcane', 'authentic')),
  req_force   int,
  rec_hexa    int,
  list_order  int         not null default 0,
  created_by  uuid        references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.boss_presets is '주간 보스 프리셋(전체 유저 공통). 관리자만 insert/update/delete, 인증 사용자는 select. id 는 text(completions.item_id 통일). 시드 b1..b6 는 관례상 코드형 id, 관리자가 추가하면 uuid text.';
comment on column public.boss_presets.reset_type is '초기화 주기(period.ts ResetType). 보스는 보통 weekly_thu(목요일). 완료 판정은 이 값으로 period_key 계산.';
comment on column public.boss_presets.list_order is '표시 순서(오름차순).';

-- ----------------------------------------------------------------------------
-- completions : 숙제 완료 기록 (period_key 모델).
-- 완료   = INSERT (on conflict do nothing 로 멱등)
-- 해제   = DELETE
-- 완료판단 = 현재 period_key 와 일치하는 행 존재 여부. 새 주기가 되면 키가 달라져 자동 초기화.
-- item_id 는 daily/weekly 코드 id 또는 boss_presets.id → 소스가 섞여서 FK 를 걸지 않는다.
-- ----------------------------------------------------------------------------
create table if not exists public.completions (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  character_ocid text        not null,
  item_id        text        not null,
  period_key     text        not null,
  created_at     timestamptz not null default now(),
  -- 한 캐릭터의 한 항목은 한 주기에 한 번만 완료.
  unique (user_id, character_ocid, item_id, period_key)
);

comment on table public.completions is '숙제 완료 기록(period_key 모델). 완료=INSERT(on conflict do nothing), 해제=DELETE. period_key 는 앱이 currentPeriodKey(reset_type)로 계산해 넣는다(마이그레이션에서 계산 금지).';
comment on column public.completions.item_id is 'daily/weekly 는 presets.ts 코드 id(d1..d5,w1..w3), boss 는 boss_presets.id. 소스가 섞여 FK 없음.';
comment on column public.completions.period_key is 'src/lib/period.ts currentPeriodKey 결과(text). 예: d-20636 / weekly_mon-20633 / weekly_thu-20636. 클라이언트가 보낸 값을 그대로 믿지 말고 서버에서 항목 reset_type 으로 재계산 권장.';

-- ----------------------------------------------------------------------------
-- quest_durations : 항목별 예상 소요시간(분). 항목 단위 "전역"(캐릭터 무관), 사용자별.
-- ----------------------------------------------------------------------------
create table if not exists public.quest_durations (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  minutes int  not null check (minutes between 0 and 999),
  unique (user_id, item_id)
);

comment on table public.quest_durations is '항목별 예상 소요시간(분). 항목 단위 전역(캐릭터 무관), 사용자별. unique(user_id,item_id). item_id 는 completions 와 동일 규칙.';

-- ----------------------------------------------------------------------------
-- character_boss_selection : 캐릭터별로 "실제로 잡는" 주간 보스 선택.
-- 행 존재 = 그 캐릭터가 해당 보스를 잡음.
-- ★ 기본 정책: 특정 캐릭터에 대해 행이 하나도 없으면 = "전체 보스 선택"으로 간주(프로토타입 기본값).
--   즉 사용자가 한 번도 선택을 저장하지 않은 캐릭터는 모든 boss_presets 를 대상으로 본다.
--   행이 1개라도 생기면 그때부터는 "선택된 보스만" 대상이 된다.
--   이 기본값 해석은 앱(조회 로직)에서 구현한다(DB 는 존재/부재만 저장).
-- ----------------------------------------------------------------------------
create table if not exists public.character_boss_selection (
  id             uuid not null default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  character_ocid text not null,
  item_id        text not null references public.boss_presets(id) on delete cascade,
  primary key (id),
  unique (user_id, character_ocid, item_id)
);

comment on table public.character_boss_selection is '캐릭터별로 실제 잡는 주간 보스 선택(행 존재=선택). 기본정책: 어떤 캐릭터에 행이 하나도 없으면 "전체 보스 선택"으로 간주(프로토타입 기본값) — 해석은 앱에서. item_id 는 boss_presets.id FK(보스 삭제 시 선택도 정리).';

-- ----------------------------------------------------------------------------
-- 인덱스
-- ----------------------------------------------------------------------------
-- 현재 주기 완료 조회: (user_id, character_ocid, period_key) 로 자주 조회.
-- unique 인덱스는 (user_id, character_ocid, item_id, period_key) 라 period_key 가 선두가 아니어서 별도 추가.
create index if not exists idx_completions_user_char_period
  on public.completions (user_id, character_ocid, period_key);
create index if not exists idx_completions_user_period
  on public.completions (user_id, period_key);

-- 관리자 최근 접속 목록/오늘 접속 통계용.
create index if not exists idx_profiles_last_access
  on public.profiles (last_access_at desc);

-- 보스 목록 표시 순서.
create index if not exists idx_boss_presets_order
  on public.boss_presets (list_order);
