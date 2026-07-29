-- ============================================================================
-- discover_boss_preset() / discover_quest_preset() : 안전한 auto-insert RPC.
-- ----------------------------------------------------------------------------
-- 배경: "숙제 동기화" 서버 액션은 일반 사용자 권한(authenticated, RLS 적용)으로 실행되는데,
-- 넥슨 스케줄러 응답에 우리 프리셋(boss_presets/quest_presets)에 없는 콘텐츠가 있으면 새
-- 프리셋을 자동 등록해야 한다. 하지만 일반 사용자에게 boss_presets/quest_presets 의 자유
-- insert/update 권한을 주면 (a) 다른 사람이 관리자 UI 로 큐레이션한 req_level 등을 덮어쓸
-- 위험, (b) 두 사용자가 동시에 같은 신규 콘텐츠를 발견해 중복 행이 생길 위험이 있다.
--
-- 그래서 admin_recent_access()/delete_own_account() 와 동일한 SECURITY DEFINER 패턴으로
-- "이미 있으면 그 id 반환, 없으면 최소 기본값으로만 생성"하는 좁은 find-or-create RPC 로
-- 제한한다. 두 함수 모두:
--  * SECURITY DEFINER + search_path 고정(정의자 권한으로 실행 → RLS 의 "일반 insert 금지"
--    정책을 우회하되, 함수 본문 안의 제한된 로직만 실행된다).
--  * authenticated 에만 grant execute(anon/public 은 명시적으로 revoke).
--  * (select auth.uid()) 가 null 이면 예외 raise(로그인 사용자만 호출 가능 — delete_own_account()
--    처럼 함수 내부에서도 방어적으로 재확인).
--  * 매칭은 "정확히 일치"만 본다(대소문자/공백 정규화 없음) — 넥슨 원문 콘텐츠명을 그대로
--    쓰는 컬럼이라 임의로 정규화하면 scheduler-state.ts 의 매칭 기준과 어긋날 수 있다.
--  * 동시성: 유니크 인덱스(아래) + `insert ... on conflict do nothing returning id` 로 먼저
--    시도하고, 경합으로 다른 트랜잭션이 먼저 삽입했다면(returning 이 비어있음) 재조회해서
--    반환한다. 별도 advisory lock 없이도 DB 유니크 제약이 최종 방어선이라 두 사용자가 동시에
--    같은 신규 콘텐츠를 발견해도 중복 행이 생기지 않는다(PostgreSQL 표준 upsert-형 find-or-create).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- boss_presets : find-or-create 매칭 키(nexon_content_name, nexon_difficulty) 유니크.
-- 두 컬럼 다 nullable 이라 기존 b1~b4(난이도 NULL)/b6(둘 다 NULL) 행은 표준 유니크 인덱스의
-- "NULL 은 서로 다른 값으로 취급" 규칙 덕분에 서로 충돌하지 않는다. discover_boss_preset()
-- 은 두 인자 모두 NOT NULL 을 요구하므로, 실제로 이 인덱스가 막는 중복은 "완전히 같은
-- (콘텐츠명, 난이도) 조합의 신규 삽입"뿐이다.
-- ----------------------------------------------------------------------------
create unique index if not exists idx_boss_presets_nexon_match
  on public.boss_presets (nexon_content_name, nexon_difficulty);

-- ----------------------------------------------------------------------------
-- discover_boss_preset(p_name, p_reset_type, p_nexon_content_name, p_nexon_difficulty) returns text
--
-- 2026-07-29 정정: 원래 3인자였고 본문에 reset_type='weekly_thu' 를 리터럴로 박아 넣었다.
-- 실측 결과 넥슨 cycle 은 3종(bossDaily/bossWeekly/bossMonthly)이라 일일·월간 보스까지
-- 전부 주간으로 등록되고 있었다. 이 파일을 재적용해도 그 버그가 되살아나지 않도록 여기서도
-- 4인자 버전으로 고친다(운영 DB 의 구 3인자 함수 제거와 데이터 정정은 20260729100000 담당).
-- ----------------------------------------------------------------------------
create or replace function public.discover_boss_preset(
  p_name               text,
  p_reset_type         text,
  p_nexon_content_name text,
  p_nexon_difficulty   text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id         text;
  v_next_order int;
begin
  if (select auth.uid()) is null then
    raise exception 'discover_boss_preset(): 로그인한 사용자만 호출할 수 있습니다.';
  end if;
  if p_name is null or p_name = '' then
    raise exception 'discover_boss_preset(): name 은 비어 있을 수 없습니다.';
  end if;
  -- 보스에 weekly_mon(월요일 초기화)은 존재하지 않는다 — 넥슨 cycle 3종 대응값만 받는다.
  if p_reset_type not in ('daily', 'weekly_thu', 'monthly') then
    raise exception 'discover_boss_preset(): reset_type 은 daily/weekly_thu/monthly 여야 합니다 (받은 값: %)', p_reset_type;
  end if;
  if p_nexon_content_name is null or p_nexon_content_name = '' then
    raise exception 'discover_boss_preset(): nexon_content_name 은 비어 있을 수 없습니다.';
  end if;
  if p_nexon_difficulty is null or p_nexon_difficulty = '' then
    raise exception 'discover_boss_preset(): nexon_difficulty 는 비어 있을 수 없습니다.';
  end if;

  -- 이미 등록된 콘텐츠면 그대로 반환(정확 일치 — 대소문자/공백 정규화 없음).
  select id into v_id
  from public.boss_presets
  where nexon_content_name = p_nexon_content_name
    and nexon_difficulty = p_nexon_difficulty
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  v_next_order := coalesce((select max(list_order) from public.boss_presets), 0) + 1;

  -- 넥슨 스케줄러 응답에는 req_level/req_force/rec_hexa 같은 앱 고유 요구치 필드가 없으므로
  -- 전부 "제한 없음"에 해당하는 최소값으로 채운다. 관리자가 나중에 boss-preset-actions.ts
  -- (updateBossPreset)로 수정하면 된다.
  insert into public.boss_presets (
    name, reset_type, req_level, symbol_type, req_force, rec_hexa,
    nexon_content_name, nexon_difficulty, list_order, created_by
  )
  values (
    p_name, p_reset_type, 0, null, 0, 0,
    p_nexon_content_name, p_nexon_difficulty, v_next_order, (select auth.uid())
  )
  on conflict (nexon_content_name, nexon_difficulty) do nothing
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  -- 동시 요청 경합: 다른 트랜잭션이 먼저 삽입했다면(위 insert 가 do nothing 으로 무산됨)
  -- 그 id 를 재조회해서 반환한다.
  select id into v_id
  from public.boss_presets
  where nexon_content_name = p_nexon_content_name
    and nexon_difficulty = p_nexon_difficulty
  limit 1;

  return v_id;
end;
$$;

comment on function public.discover_boss_preset(text, text, text, text) is
  '넥슨 스케줄러 응답에서 발견된 미등록 보스를 find-or-create 로 등록. (nexon_content_name, nexon_difficulty) 정확 일치 조합이 이미 있으면 그 id 반환, 없으면 호출자가 넘긴 reset_type(넥슨 cycle 에서 파생) + req_level=0/req_force=0/rec_hexa=0/symbol_type=null 로 신규 삽입(관리자가 나중에 수정) 후 id 반환. SECURITY DEFINER — 일반 사용자의 boss_presets 직접 insert/update 를 막는 RLS 를 우회해 이 좁은 로직만 실행한다.';

-- create or replace function 은 기존 권한을 유지하지만, 신규 생성 시 PostgreSQL 기본 동작상
-- PUBLIC 에 EXECUTE 가 자동 부여될 수 있으므로 매번 명시적으로 정리한다(멱등).
revoke all on function public.discover_boss_preset(text, text, text, text) from public;
revoke all on function public.discover_boss_preset(text, text, text, text) from anon;
grant execute on function public.discover_boss_preset(text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- discover_quest_preset(p_name, p_category, p_reset_type, p_nexon_content_name) returns text
-- ----------------------------------------------------------------------------
create or replace function public.discover_quest_preset(
  p_name               text,
  p_category           text,
  p_reset_type         text,
  p_nexon_content_name text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id         text;
  v_next_order int;
begin
  if (select auth.uid()) is null then
    raise exception 'discover_quest_preset(): 로그인한 사용자만 호출할 수 있습니다.';
  end if;
  if p_name is null or p_name = '' then
    raise exception 'discover_quest_preset(): name 은 비어 있을 수 없습니다.';
  end if;
  if p_category not in ('daily', 'weekly') then
    raise exception 'discover_quest_preset(): category 는 daily 또는 weekly 여야 합니다.';
  end if;
  if p_reset_type not in ('daily', 'weekly_mon') then
    raise exception 'discover_quest_preset(): reset_type 은 daily 또는 weekly_mon 이어야 합니다.';
  end if;
  if p_nexon_content_name is null or p_nexon_content_name = '' then
    raise exception 'discover_quest_preset(): nexon_content_name 은 비어 있을 수 없습니다.';
  end if;

  -- 이미 등록된 콘텐츠면 그대로 반환(category + nexon_content_name 정확 일치).
  select id into v_id
  from public.quest_presets
  where category = p_category
    and nexon_content_name = p_nexon_content_name
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  v_next_order := coalesce(
    (select max(list_order) from public.quest_presets where category = p_category), 0
  ) + 1;

  insert into public.quest_presets (
    name, category, reset_type, nexon_content_name, list_order, created_by
  )
  values (
    p_name, p_category, p_reset_type, p_nexon_content_name, v_next_order, (select auth.uid())
  )
  on conflict (category, nexon_content_name) do nothing
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  -- 동시 요청 경합: 다른 트랜잭션이 먼저 삽입했다면 그 id 를 재조회해서 반환한다.
  select id into v_id
  from public.quest_presets
  where category = p_category
    and nexon_content_name = p_nexon_content_name
  limit 1;

  return v_id;
end;
$$;

comment on function public.discover_quest_preset(text, text, text, text) is
  '넥슨 스케줄러 응답에서 발견된 미등록 daily/weekly 콘텐츠를 find-or-create 로 등록. (category, nexon_content_name) 정확 일치 조합이 이미 있으면 그 id 반환, 없으면 신규 삽입 후 id 반환. SECURITY DEFINER — 일반 사용자의 quest_presets 직접 insert 를 막는 RLS 를 우회해 이 좁은 로직만 실행한다.';

revoke all on function public.discover_quest_preset(text, text, text, text) from public;
revoke all on function public.discover_quest_preset(text, text, text, text) from anon;
grant execute on function public.discover_quest_preset(text, text, text, text) to authenticated;
