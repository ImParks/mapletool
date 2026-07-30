-- ============================================================================
-- 주간 퀘스트(quest_presets) 초기화 요일 정정: 월요일 → 목요일.
-- ----------------------------------------------------------------------------
-- 배경: quest_presets.reset_type 은 애초에 'weekly_mon'(월요일 초기화)으로 설계됐다. 넥슨
-- 스케줄러 API 는 콘텐츠별 초기화 요일을 알려주지 않아 API 로 확인할 방법이 없었고, 초기
-- 설계 당시 잘못 월요일로 가정했다. 실제 인게임 사양은 주간 퀘스트도 주간 보스와 동일하게
-- **목요일**에 초기화된다 — 사용자 확인으로 정정한다(2026-07-30).
--
-- 이 정정에 맞춰 ResetType 자체에서 weekly_mon 을 완전히 제거했다(src/lib/period.ts).
-- 남겨두면 "그럼 월요일 초기화가 실제로 있나?" 하는 혼동을 계속 부르기 때문이다.
--
-- 이 마이그레이션이 하는 일:
--   1. quest_presets.reset_type CHECK 를 ('daily','weekly_mon') → ('daily','weekly_thu') 로 교체
--   2. 기존 reset_type='weekly_mon' 행을 'weekly_thu' 로 일괄 변경
--   3. discover_quest_preset RPC 의 인자 검증을 weekly_thu 기준으로 교체(시그니처는 그대로라
--      create or replace 로 충분 — boss 쪽처럼 drop 후 재생성할 필요가 없다)
--
-- quest_presets 의 유니크 키는 (category, nexon_content_name) 이라 reset_type 은 포함되지
-- 않는다 — 그래서 boss_presets 정정(20260729100000) 때와 달리 병합 로직이 필요 없다.
-- 단순 UPDATE 로 충분하고, 유니크 위반이 날 수도 없다.
--
-- ⚠️ 완료 기록에 미치는 영향: completions.period_key 는 저장 당시 reset_type 으로 계산된
-- 키를 그대로 갖고 있고, 이 마이그레이션은 completions 를 건드리지 않는다. page.tsx 가 항목의
-- **현재** reset_type 으로 다시 계산한 키와 일치하는 완료만 인정하므로(2026-07-29 수정),
-- weekly_mon 키로 저장된 이번 주 완료는 배포 이후 "미완료"로 보인다 — 데이터가 사라진 게
-- 아니라 새 기준(목요일 주기)으로 재판정된 것이다. 사용자에게 "이번 주 체크해 둔 주간 퀘스트가
-- 초기화된 것처럼 보일 수 있다"고 배포 공지할 것.
--
-- 코드 프리셋(PRESET_ITEMS: w1 무릉도장/w2 주간 의뢰/w3 플래그 레이스)의 reset_type 은 DB 가
-- 아니라 src/lib/presets.ts 에 있어 이 마이그레이션이 손대지 않는다 — 코드 배포로 함께 바뀐다.
--
-- ⚠️ 배포 순서: 앱 코드를 먼저 배포하고 이 마이그레이션을 적용한다(기존 규칙과 동일 이유 —
-- 코드가 모르는 사이 DB 에 코드가 모르는 값이 남아있는 것보다, DB 가 코드를 따라가는 편이 안전).
--
-- 멱등 작성: CHECK 는 drop 후 재생성, UPDATE 는 이미 맞는 행을 건드리지 않는다(where 절).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) reset_type CHECK 제약을 **먼저 지운다**(재생성은 뒤에서 — 순서 중요).
--    새 CHECK 는 'weekly_mon' 을 허용하지 않는 좁힌 제약이라, 기존 weekly_mon 행이 남은
--    채로 먼저 걸면 ADD CONSTRAINT 시점에 기존 데이터 검증에서 곧바로 실패한다
--    (PostgreSQL 은 ALTER TABLE ADD CONSTRAINT 시 기존 행 전체를 즉시 검증한다).
--    그래서 "지우기 → 데이터 백필 → 새로 걸기" 순서를 반드시 지킨다.
--    무명 제약이 하나라도 남으면 뒤에서 새 CHECK 를 걸 때 이름 충돌 등으로 꼬일 수 있으므로,
--    reset_type 을 언급하는 CHECK 를 전부 찾아 지운다(20260729100000 과 동일 패턴).
-- ----------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.quest_presets'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%reset_type%'
  loop
    execute format('alter table public.quest_presets drop constraint %I', c.conname);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2) 기존 행 정정 (제약이 없는 지금 상태에서 안전하게 UPDATE). where 절 덕분에 이미
--    정정된 행은 건드리지 않는다(멱등).
-- ----------------------------------------------------------------------------
update public.quest_presets
set reset_type = 'weekly_thu'
where reset_type = 'weekly_mon';

-- ----------------------------------------------------------------------------
-- 3) 이제 모든 행이 새 제약을 만족하므로 CHECK 를 다시 건다.
-- ----------------------------------------------------------------------------
alter table public.quest_presets
  add constraint quest_presets_reset_type_check
  check (reset_type in ('daily', 'weekly_thu'));

comment on column public.quest_presets.reset_type is '초기화 주기(daily 또는 weekly_thu 만 해당 — 주간 퀘스트는 목요일 초기화). 완료 판정은 이 값으로 currentPeriodKey 계산. 2026-07-30 이전에는 잘못 weekly_mon(월요일)이었다.';

-- ----------------------------------------------------------------------------
-- 4) discover_quest_preset : 인자 검증을 weekly_thu 기준으로 교체.
--    시그니처(text,text,text,text)가 그대로라 create or replace 로 충분하다.
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
  if p_reset_type not in ('daily', 'weekly_thu') then
    raise exception 'discover_quest_preset(): reset_type 은 daily 또는 weekly_thu 여야 합니다 (받은 값: %)', p_reset_type;
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
  '넥슨 스케줄러 응답에서 발견된 미등록 daily/weekly 콘텐츠를 find-or-create 로 등록. (category, nexon_content_name) 정확 일치 조합이 이미 있으면 그 id 반환, 없으면 신규 삽입 후 id 반환. reset_type 은 daily 또는 weekly_thu(2026-07-30 이전엔 weekly_mon 이었으나 정정됨). SECURITY DEFINER — 일반 사용자의 quest_presets 직접 insert 를 막는 RLS 를 우회해 이 좁은 로직만 실행한다.';

revoke all on function public.discover_quest_preset(text, text, text, text) from public;
revoke all on function public.discover_quest_preset(text, text, text, text) from anon;
grant execute on function public.discover_quest_preset(text, text, text, text) to authenticated;
