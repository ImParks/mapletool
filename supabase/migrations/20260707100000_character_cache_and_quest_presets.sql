-- ============================================================================
-- character_cache + quest_presets 테이블 추가.
-- ----------------------------------------------------------------------------
-- 배경(전체 계획: "넥슨 데이터 캐싱 + 실제 완료/스탯 동기화 + 신규 콘텐츠 자동 등록"): `/main`
-- 페이지가 매 요청마다 넥슨 API 를 라이브 호출하던 것을 "DB 캐시 우선" 모델로 전환한다. 이
-- 마이그레이션은 그 중 순수 스키마 파트만 담당한다(서버 액션/페이지 리라이트는 별도 작업).
--
--  * character_cache : 사용자별 캐릭터 스냅샷(이미지/스탯 등). 넥슨 라이브 호출을 대체하는
--    캐시 — "동기화" 버튼을 눌렀을 때(또는 최초 키 등록 워밍업)만 갱신되고, 평소 페이지
--    진입 시에는 이 테이블만 읽는다. 캐릭터 자체를 DB 의 "진실 소스"로 승격하는 게 아니라
--    어디까지나 캐시다 — 넥슨 원본이 바뀌어도 사용자가 명시적으로 동기화하기 전까지는
--    갱신되지 않는다(README "캐릭터는 DB에 캐시하지 않는다"는 v1 원칙에서 의도적으로
--    벗어나는 변경 — 이번 캐싱 전환의 핵심).
--  * quest_presets : boss_presets 의 daily/weekly 버전. 넥슨 스케줄러가 알려주지만 코드
--    프리셋(src/lib/presets.ts PRESET_ITEMS)에 없는 콘텐츠를 담는다. req_level/req_force/
--    rec_hexa/symbol_type 같은 보스 전용 요구치 필드는 없다(일일/주간 퀘스트는 그런 스펙
--    요구치가 없는 콘텐츠라서). 일반 사용자의 insert/update/delete 는 RLS 로 막고, 다음
--    마이그레이션의 discover_quest_preset() RPC(SECURITY DEFINER)로만 생성 가능하게 한다
--    (다른 사용자가 만든 프리셋을 덮어쓰거나 동시 생성으로 중복 행이 생기는 것을 방지).
--
-- 멱등 작성: create table if not exists / create index if not exists /
-- drop policy if exists 후 create policy / drop trigger if exists 후 create trigger.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- character_cache : 사용자별 캐릭터 스냅샷. 본인 행만 전체 CRUD(관리자 예외 없음 —
-- character_boss_selection 등 기존 "본인 전용" 테이블과 동일한 RLS 패턴).
-- ----------------------------------------------------------------------------
create table if not exists public.character_cache (
  user_id         uuid        not null references auth.users(id) on delete cascade,
  ocid            text        not null,
  character_name  text        not null,
  world_name      text        not null,
  character_class text        not null,
  character_level int         not null,
  image_url       text,
  combat_power    bigint,
  arcane_force    int,
  authentic_force int,
  synced_at       timestamptz not null default now(),
  primary key (user_id, ocid)
);

comment on table public.character_cache is '사용자별 캐릭터 스냅샷 캐시(넥슨 라이브 호출 대체). "동기화"/"숙제 동기화"/최초 키 등록 워밍업 시 서버 액션이 upsert 로 채운다. 본인 행만 RLS 로 CRUD(관리자 예외 없음). 캐릭터 자체의 "진실 소스"는 여전히 넥슨이며, 이 테이블은 어디까지나 캐시 — synced_at 은 마지막 동기화 시각.';
comment on column public.character_cache.ocid is '넥슨 캐릭터 식별자(getCharacterList 응답). user_id 와 함께 복합 PK.';
comment on column public.character_cache.combat_power is '전투력(스탯 조회 계산 결과). null 이면 아직 스탯 동기화 전.';
comment on column public.character_cache.arcane_force is '아케인포스 합계(심볼 장비 조회 계산 결과). null 이면 아직 스탯 동기화 전.';
comment on column public.character_cache.authentic_force is '어센틱포스 합계(심볼 장비 조회 계산 결과). null 이면 아직 스탯 동기화 전.';
comment on column public.character_cache.synced_at is '마지막으로 넥슨에서 이 스냅샷을 갱신한 시각. 표시용("n분 전 동기화" 등)으로 쓸 수 있음.';

alter table public.character_cache enable row level security;
grant select, insert, update, delete on public.character_cache to authenticated;

drop policy if exists character_cache_all_own on public.character_cache;
create policy character_cache_all_own on public.character_cache
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists idx_character_cache_user on public.character_cache (user_id);

-- ----------------------------------------------------------------------------
-- quest_presets : boss_presets 의 daily/weekly 버전(넥슨에서 발견됐지만 코드 프리셋에
-- 없는 일일/주간 콘텐츠). 인증 사용자 전체 select, insert/update/delete 는 RPC 전용.
-- ----------------------------------------------------------------------------
create table if not exists public.quest_presets (
  id                 text        primary key default gen_random_uuid()::text,
  name               text        not null,
  category           text        not null check (category in ('daily', 'weekly')),
  reset_type         text        not null check (reset_type in ('daily', 'weekly_mon')),
  nexon_content_name text        not null,
  list_order         int         not null default 0,
  created_by         uuid        references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.quest_presets is 'boss_presets 의 daily/weekly 버전. 넥슨 스케줄러에서 발견됐지만 코드 프리셋(src/lib/presets.ts PRESET_ITEMS)에 없는 일일/주간 콘텐츠. req_level/req_force/rec_hexa/symbol_type 같은 보스 전용 요구치 필드는 없음. 인증 사용자 전체 select, 일반 insert/update/delete 는 RLS 로 막고 discover_quest_preset() RPC(SECURITY DEFINER)로만 생성한다.';
comment on column public.quest_presets.category is '표시 그룹(daily/weekly). PresetItem.category 와 동일 개념 — reset_type(초기화 주기)과는 다른 값이니 혼동 금지.';
comment on column public.quest_presets.reset_type is '초기화 주기(period.ts ResetType 중 daily/weekly_mon 만 해당). 완료 판정은 이 값으로 currentPeriodKey 계산.';
comment on column public.quest_presets.nexon_content_name is '넥슨 스케줄러 API 원문 콘텐츠명. discover_quest_preset() 의 find-or-create 매칭 키(category 와 조합해 유니크, 정확 일치만 매칭).';
comment on column public.quest_presets.created_by is '자동 등록한 사용자(discover_quest_preset 호출자). 계정 삭제돼도 프리셋은 유지(on delete set null) — 공용 데이터라 개인 데이터 삭제 대상이 아님.';

alter table public.quest_presets enable row level security;
-- 테이블 권한은 boss_presets 와 동일한 레포 컨벤션으로 authenticated 전체에 폭넓게 부여하되
-- ("GRANT 는 authenticated 에 폭넓게, 실제 통제는 RLS 정책이 최종 게이트" — rls_policies.sql
-- 참고), select 정책만 두고 insert/update/delete 정책은 만들지 않아 RLS 기본 deny 로 직접
-- 쓰기를 막는다(discover_quest_preset() 은 SECURITY DEFINER 라 정의자 권한으로 실행돼 이
-- RLS 를 우회한다 — 일반 authenticated 세션으로는 절대 직접 insert/update/delete 불가).
grant select, insert, update, delete on public.quest_presets to authenticated;

drop policy if exists quest_presets_select_all on public.quest_presets;
create policy quest_presets_select_all on public.quest_presets
  for select to authenticated
  using (true);

create index if not exists idx_quest_presets_order on public.quest_presets (category, list_order);

-- find-or-create 매칭 키(category, nexon_content_name) 유니크 — 다음 마이그레이션
-- discover_quest_preset() 의 on conflict 타겟이자, 동시 요청으로 중복 프리셋이 생기는 것을
-- DB 레벨에서 막는 최종 방어선.
create unique index if not exists idx_quest_presets_nexon_match
  on public.quest_presets (category, nexon_content_name);

drop trigger if exists quest_presets_set_updated_at on public.quest_presets;
create trigger quest_presets_set_updated_at
  before update on public.quest_presets
  for each row execute function public.set_updated_at();
