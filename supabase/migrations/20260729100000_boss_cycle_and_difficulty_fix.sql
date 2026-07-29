-- ============================================================================
-- 넥슨 스케줄러 실측(2026-07-29)으로 드러난 보스 데이터 오류 정정.
-- ----------------------------------------------------------------------------
-- 배경: /maplestory/v1/scheduler/character-state 를 실제로 호출해 확인한 결과, 우리가
-- boss_presets 에 저장해 온 두 값이 넥슨 원문과 달랐다.
--
--  (1) 난이도: 넥슨은 **영문 소문자**(easy/normal/hard/chaos/extreme)로 내려준다.
--      그런데 20260706100000 이 b5(스우)/b7(듄켈)에 한글 '하드' 를 넣어 두어,
--      scheduler-state.ts 의 findBossMatch 가 **단 한 건도 매칭하지 못했다**
--      (normalizeName 은 공백제거+소문자화만 하므로 '하드' 와 'hard' 는 영원히 다르다).
--      → 두 보스의 자동 숙제 동기화가 통째로 죽어 있었다.
--
--  (2) 초기화 주기: 넥슨 cycle 은 3종이다 — bossDaily(24행) / bossWeekly(51행) /
--      bossMonthly(2행: 검은 마법사 hard·extreme). 그런데 시드와 discover_boss_preset RPC 가
--      전부 'weekly_thu' 로 단정했다. 그 결과 일일 보스는 매일 초기화되지 않고 일주일 유지되고,
--      검은 마법사는 매주 목요일에 초기화됐다.
--      **주기는 보스 이름이 아니라 (이름, 난이도) 쌍에 종속된다** — 자쿰 easy·normal 은 일일,
--      자쿰 chaos 는 주간이다(매그너스/파풀라투스/피에르/반반/블러디퀸/벨룸도 동일).
--      아래 데이터 정정이 이름만이 아니라 쌍으로 매칭하는 이유다.
--
-- 이 마이그레이션이 하는 일:
--   1. boss_presets.reset_type CHECK 에 'monthly' 추가
--   2. 한글/대소문자 난이도를 영문 소문자로 정정 (+ 그 과정에서 생기는 중복 행 병합)
--   3. (이름, 난이도) 실측 매핑으로 기존 행의 reset_type 교정
--   4. discover_boss_preset 에 p_reset_type 인자 추가 (구 3인자 함수는 제거)
--
-- 멱등 작성: 제약은 drop 후 재생성, update 는 이미 맞는 행을 건드리지 않음,
-- 함수는 create or replace. 재적용해도 안전하다.
--
-- ⚠️ 배포 순서: **앱 코드를 먼저 배포하고 이 마이그레이션을 적용한다.** 반대로 하면 DB 에
-- 'monthly' 가 생겼는데 구 코드는 그 값을 모른 채 목요일 주기 키를 만들어(구 currentPeriodKey 는
-- daily 가 아닌 모든 값을 주간으로 처리했다) 신 코드가 영영 못 읽는 고아 완료 행이 생긴다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) reset_type CHECK 제약 교체 — 'monthly' 허용
--    제약이 init_schema 에서 컬럼 인라인으로 선언돼 이름이 자동 생성됐다. 이름을 가정하지 않고
--    reset_type 을 언급하는 CHECK 를 전부 찾아 지운 뒤 명시적 이름으로 다시 만든다
--    (무명 제약이 하나라도 남으면 monthly 삽입이 조용히 거부된다).
-- ----------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.boss_presets'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%reset_type%'
  loop
    execute format('alter table public.boss_presets drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.boss_presets
  add constraint boss_presets_reset_type_check
  check (reset_type in ('daily', 'weekly_mon', 'weekly_thu', 'monthly'));

comment on column public.boss_presets.nexon_difficulty is
  '넥슨 스케줄러 API 원문 난이도. **영문 소문자**(easy/normal/hard/chaos/extreme) — 한글이 아니다. nexon_content_name 과 둘 다 있어야 자동 매칭 대상(오매칭 방지). null 이면 수동 체크로 유지. 값 열거 CHECK 는 일부러 걸지 않는다(넥슨이 새 난이도를 추가하면 discover_boss_preset 이 통째로 막힌다).';

comment on column public.boss_presets.reset_type is
  '초기화 주기. 넥슨 cycle 에서 파생: bossDaily→daily, bossWeekly→weekly_thu, bossMonthly→monthly. (이름, 난이도) 쌍마다 다르다 — 자쿰 normal 은 daily, 자쿰 chaos 는 weekly_thu.';

-- ----------------------------------------------------------------------------
-- 2) 난이도 정정: 한글/대문자 → 영문 소문자. 중복이 생기면 병합한다.
--
--    중복이 생기는 이유: 유니크 인덱스 idx_boss_presets_nexon_match(nexon_content_name,
--    nexon_difficulty) 가 있는데, b5 가 ('스우','하드') 로 매칭에 실패하는 동안
--    discover_boss_preset 이 ('스우','hard') 자동발견 행을 따로 만들었을 수 있다.
--    그 상태에서 b5 를 'hard' 로 바꾸면 유니크 위반으로 마이그레이션 전체가 롤백된다.
--
--    병합 방향: **시드 행(b5/b7)을 남기고 자동발견 행을 지운다.** 시드 행에는 관리자가
--    큐레이션한 req_level/req_force/rec_hexa 가 있고, 사용자 데이터(보스선택/견적시간/완료)도
--    이미 그 id 를 참조하고 있기 때문이다. 자동발견 행에 붙은 사용자 데이터는 시드 행으로 옮긴다.
--
--    완료 기록(completions)을 복제하는 것이 20260706100000 의 선례("완료 기록은 복제하지
--    않는다")와 모순돼 보이지만 그렇지 않다. 그때는 b5 하나를 스우+듄켈 **둘로 분리**하는
--    상황이라 "과거의 b5 완료"가 어느 보스를 잡은 건지 판별 불가였다. 지금은 같은 보스·같은
--    난이도를 가리키는 두 행을 **1:1 병합**하는 것이라 의미가 모호하지 않다 — 옮기지 않으면
--    사용자가 이번 주기에 실제로 잡아서 기록된 완료가 사라진다.
-- ----------------------------------------------------------------------------
do $$
declare
  r        record;
  v_target text;
  v_dup    text;
begin
  for r in
    select id, nexon_content_name, nexon_difficulty
    from public.boss_presets
    where nexon_difficulty is not null
  loop
    v_target := case lower(btrim(r.nexon_difficulty))
                  when '이지'     then 'easy'
                  when '노말'     then 'normal'
                  when '노멀'     then 'normal'
                  when '하드'     then 'hard'
                  when '카오스'   then 'chaos'
                  when '익스트림' then 'extreme'
                  else lower(btrim(r.nexon_difficulty))
                end;

    -- 이미 올바른 값이면 아무것도 하지 않는다(멱등 — 재적용 시 이 루프는 전부 여기서 빠진다).
    continue when v_target = r.nexon_difficulty;

    -- 비교는 반드시 `=` 로 한다(`is not distinct from` 금지). 충돌 여부를 판정하는 기준은
    -- 유니크 인덱스 idx_boss_presets_nexon_match 인데, 표준 유니크 인덱스는 NULL 을 서로 다른
    -- 값으로 취급하므로(NULLS DISTINCT) content_name 이 NULL 인 두 행은 애초에 충돌하지 않는다.
    -- `is not distinct from` 을 쓰면 NULL = NULL 을 참으로 봐서, 충돌하지도 않는 행을 중복으로
    -- 오인해 지워버린다. `=` 는 NULL 에서 0행을 돌려주므로 병합을 건너뛰고 난이도만 정규화한다.
    select id into v_dup
    from public.boss_presets
    where nexon_content_name = r.nexon_content_name
      and nexon_difficulty = v_target
      and id <> r.id
    limit 1;

    if v_dup is not null then
      raise notice '보스 프리셋 병합: % (%) <- 자동발견 행 %', r.id, r.nexon_content_name, v_dup;

      -- 사용자 데이터를 시드 행으로 이관한 뒤 자동발견 행을 지운다. **순서를 뒤집으면 안 된다.**
      -- 세 테이블의 FK 상황이 서로 다르고, 둘 다 이관 → 삭제 순서를 요구한다:
      --  * completions / quest_durations : item_id 가 boss_presets 로의 FK **없는** text 다
      --    (코드 프리셋 id 인 d1/w1 도 같은 컬럼에 들어가기 때문). 행을 먼저 지우면 고아가 남는다.
      --  * character_boss_selection : item_id 에 `references public.boss_presets(id) on delete
      --    cascade` 가 걸려 있다(init_schema.sql:125). 행을 먼저 지우면 선택이 **소리 없이 함께
      --    사라진다** — 고아보다 더 나쁘다.
      insert into public.completions (user_id, character_ocid, item_id, period_key)
      select user_id, character_ocid, r.id, period_key
      from public.completions
      where item_id = v_dup
      on conflict (user_id, character_ocid, item_id, period_key) do nothing;
      delete from public.completions where item_id = v_dup;

      insert into public.character_boss_selection (user_id, character_ocid, item_id)
      select user_id, character_ocid, r.id
      from public.character_boss_selection
      where item_id = v_dup
      on conflict (user_id, character_ocid, item_id) do nothing;
      delete from public.character_boss_selection where item_id = v_dup;

      insert into public.quest_durations (user_id, item_id, minutes)
      select user_id, r.id, minutes
      from public.quest_durations
      where item_id = v_dup
      on conflict (user_id, item_id) do nothing;
      delete from public.quest_durations where item_id = v_dup;

      delete from public.boss_presets where id = v_dup;
    end if;

    update public.boss_presets set nexon_difficulty = v_target where id = r.id;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3) reset_type 교정 — 넥슨 cycle 실측 매핑
--
--    아래 목록은 2026-07-29 에 실제 응답(boss_contents 77행)에서 그대로 뽑은 것이다.
--    bossWeekly 는 현재 기본값 weekly_thu 와 같으므로 나열하지 않고, 기본값과 다른
--    bossDaily / bossMonthly 만 적는다.
--    여기에 없는 보스는 손대지 않는다(모르는 것을 추측해서 바꾸지 않는다).
-- ----------------------------------------------------------------------------

-- cycle = bossDaily → 매일 00시 초기화
update public.boss_presets b
set reset_type = 'daily'
from (values
  ('자쿰',       'easy'),
  ('자쿰',       'normal'),
  ('매그너스',   'easy'),
  ('매그너스',   'normal'),
  ('힐라',       'normal'),
  ('힐라',       'hard'),
  ('카웅',       'normal'),
  ('파풀라투스', 'easy'),
  ('파풀라투스', 'normal'),
  ('피에르',     'normal'),
  ('반반',       'normal'),
  ('블러디퀸',   'normal'),
  ('벨룸',       'normal'),
  ('반 레온',    'easy'),
  ('반 레온',    'normal'),
  ('반 레온',    'hard'),
  ('혼테일',     'easy'),
  ('혼테일',     'normal'),
  ('혼테일',     'chaos'),
  ('아카이럼',   'easy'),
  ('아카이럼',   'normal'),
  ('핑크빈',     'normal'),
  ('핑크빈',     'chaos'),
  ('시그너스',   'normal')
) as m(content_name, difficulty)
where b.nexon_content_name = m.content_name
  and b.nexon_difficulty = m.difficulty
  and b.reset_type <> 'daily';

-- cycle = bossMonthly → 매월 1일 00시 초기화
update public.boss_presets b
set reset_type = 'monthly'
from (values
  ('검은 마법사', 'hard'),
  ('검은 마법사', 'extreme')
) as m(content_name, difficulty)
where b.nexon_content_name = m.content_name
  and b.nexon_difficulty = m.difficulty
  and b.reset_type <> 'monthly';

-- 시드 b4('주간 검은 마법사')는 nexon_difficulty 가 NULL 이라(20260706100000 이 난이도를
-- 확신하지 못해 비워 뒀다) 위 쌍 매칭에 걸리지 않는다. 검은 마법사는 난이도와 무관하게
-- bossMonthly 이므로 id + 콘텐츠명으로 한 번 더 짚어준다.
update public.boss_presets
set reset_type = 'monthly'
where id = 'b4'
  and nexon_content_name = '검은 마법사'
  and reset_type <> 'monthly';

-- ----------------------------------------------------------------------------
-- 4) discover_boss_preset : p_reset_type 인자 추가
--
--    구 3인자 함수는 본문에 reset_type = 'weekly_thu' 를 리터럴로 박아 넣어, 넥슨에서 발견된
--    일일/월간 보스까지 전부 주간으로 등록했다(위 (2)의 DB 측 원인).
--
--    인자를 추가하면 PostgreSQL 은 **새 오버로드를 만들 뿐 구 함수를 지우지 않는다.**
--    구 함수가 남아 있으면 PostgREST 가 3키 요청을 받았을 때 그걸 계속 호출하므로 반드시
--    명시적으로 drop 한다. drop 은 ACL 도 함께 지우므로 아래에서 grant 를 다시 건다.
-- ----------------------------------------------------------------------------
drop function if exists public.discover_boss_preset(text, text, text);

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
  -- 보스에 weekly_mon(월요일 초기화)은 존재하지 않는다 — 넥슨 cycle 3종에 대응하는 값만 받는다.
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
  -- 여기서 기존 행의 reset_type 을 p_reset_type 으로 덮어쓰지 **않는다**: 일반 사용자의
  -- 동기화 요청이 전 사용자 공용 행을 바꾸는 셈이 되기 때문이다(관리자 큐레이션 보호).
  -- 과거에 잘못 저장된 행은 위 3)이 일괄로 정정한다.
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
  '넥슨 스케줄러 응답에서 발견된 미등록 보스를 find-or-create 로 등록. (nexon_content_name, nexon_difficulty) 정확 일치 조합이 이미 있으면 그 id 반환(기존 행의 reset_type 은 덮어쓰지 않는다), 없으면 호출자가 넘긴 reset_type(넥슨 cycle 에서 파생) + req_level=0/req_force=0/rec_hexa=0/symbol_type=null 로 신규 삽입 후 id 반환. SECURITY DEFINER — 일반 사용자의 boss_presets 직접 insert/update 를 막는 RLS 를 우회해 이 좁은 로직만 실행한다.';

-- create or replace function 은 기존 권한을 유지하지만, 신규 생성 시 PostgreSQL 기본 동작상
-- PUBLIC 에 EXECUTE 가 자동 부여될 수 있으므로 매번 명시적으로 정리한다(멱등).
revoke all on function public.discover_boss_preset(text, text, text, text) from public;
revoke all on function public.discover_boss_preset(text, text, text, text) from anon;
grant execute on function public.discover_boss_preset(text, text, text, text) to authenticated;
