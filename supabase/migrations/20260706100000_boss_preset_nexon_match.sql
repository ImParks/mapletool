-- ============================================================================
-- boss_presets 에 넥슨 스케줄러 매칭 필드 추가 + "하드 스우/듄켈" 통합 항목 분리.
-- ----------------------------------------------------------------------------
-- 배경: 넥슨 스케줄러 API(GET /maplestory/v1/scheduler/character-state)가 내려주는
-- 콘텐츠명(content_name)/난이도(difficulty)와 boss_presets 를 매칭해 "실제 완료 여부"를
-- 자동 확인하는 기능(scheduler-state.ts)을 위해, boss_presets 에 넥슨 원문 콘텐츠명/난이도를
-- 별도 컬럼으로 보관한다. 표시용 name 과 분리하는 이유: name 은 관리자가 자유롭게 바꿀 수
-- 있어 매칭 키로 쓰기 불안정하기 때문(예: name 을 "주간 윌(하드)"로 바꿔도 매칭은 안정적이어야 함).
--
-- b5("하드 스우 / 듄켈")는 서로 다른 두 보스를 한 항목으로 묶어놨는데, 스케줄러 API 는 두 보스를
-- 별개 content_name 으로 내려주기 때문에 그대로 두면 "매칭 키 1개 : 실제 콘텐츠 2개"가 되어
-- 아무거나 하나만 잡아도 완료로 오판할 위험이 있다. 그래서 b5 를 "하드 스우" 단독 항목으로
-- 개명하고(id 는 그대로 유지 — 기존 completions/character_boss_selection/quest_durations 보존),
-- "하드 듄켈"을 신규 b7 로 분리한다. b5 를 선택/견적입력해둔 캐릭터는 b7 도 함께 선택/견적된
-- 것으로 이어받는다(character_boss_selection/quest_durations 복제).
--
-- completions(완료 기록)는 절대 복제하지 않는다 — 과거 "b5 완료" 기록만으로는 "스우+듄켈
-- 둘 다 잡음"인지 "둘 중 하나만 잡음"인지 구분할 수 없어서, 그대로 복제하면 실제로는 안 잡은
-- 보스가 "완료"로 잘못 표시될 위험이 있다(사용자가 다음 주기부터 새로 체크하도록 남겨둔다).
--
-- 멱등 작성: add column if not exists / update(자연히 멱등) / insert on conflict do nothing.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) 넥슨 매칭 필드 추가 (nullable — 값이 없으면 자동 매칭 대상에서 제외, 수동 체크로 유지)
-- ----------------------------------------------------------------------------
alter table public.boss_presets
  add column if not exists nexon_content_name text,
  add column if not exists nexon_difficulty  text;

comment on column public.boss_presets.nexon_content_name is '넥슨 스케줄러 API 원문 콘텐츠명(예: 스우, 루시드). 표시용 name 과 분리 — name 은 관리자가 자유롭게 바꿔 매칭 키로 부적합하기 때문. null 이면 자동 동기화 대상에서 제외(수동 체크만 가능).';
comment on column public.boss_presets.nexon_difficulty is '넥슨 스케줄러 API 원문 난이도(예: 하드). nexon_content_name 과 둘 다 있어야 자동 매칭 대상(오매칭 방지). null 이면 수동 체크로 유지.';

-- ----------------------------------------------------------------------------
-- 2) b5 개명: "하드 스우 / 듄켈" → "하드 스우" (id 는 그대로 유지 → 기존 완료기록/
--    보스선택/견적시간 보존). 넥슨 매칭 필드도 채운다.
-- ----------------------------------------------------------------------------
update public.boss_presets
set name = '하드 스우',
    nexon_content_name = '스우',
    nexon_difficulty = '하드'
where id = 'b5';

-- ----------------------------------------------------------------------------
-- 3) 기존 b6("선택 아케인")을 한 칸 뒤로 밀고(list_order 7), "하드 듄켈"을 b5 바로
--    뒤(list_order 6)에 신규 삽입한다. req_level/rec_hexa/symbol_type/req_force 는
--    분리 전 b5 와 동일 값을 그대로 물려받는다(같은 통합 항목에서 나온 값이라 보스별
--    난이도 스펙 차이가 없음).
-- ----------------------------------------------------------------------------
update public.boss_presets set list_order = 7 where id = 'b6';

insert into public.boss_presets
  (id, name,          reset_type,   req_level, rec_hexa, symbol_type, req_force, list_order,
   nexon_content_name, nexon_difficulty)
values
  ('b7', '하드 듄켈', 'weekly_thu', 230,       18,       'arcane',    1800,      6,
   '듄켈', '하드')
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 4) b1~b4 는 넥슨 콘텐츠명만 베스트에포트로 채운다. 난이도는 확신이 없어 NULL 로
--    남긴다 — 매칭 정책상 content_name+difficulty 둘 다 있어야 자동 매칭하므로
--    안전하게 수동 체크로 유지된다(관리자가 나중에 확인해 채울 수 있음).
--    b6("선택 아케인 (진힐라 등)")은 특정 콘텐츠명이 없는 그룹 라벨이라 둘 다 NULL 유지.
-- ----------------------------------------------------------------------------
update public.boss_presets set nexon_content_name = '윌'          where id = 'b1';
update public.boss_presets set nexon_content_name = '루시드'      where id = 'b2';
update public.boss_presets set nexon_content_name = '데미안'      where id = 'b3';
update public.boss_presets set nexon_content_name = '검은 마법사' where id = 'b4';

-- ----------------------------------------------------------------------------
-- 5) b5 를 선택/견적입력해둔 캐릭터는 b7("하드 듄켈")도 함께 이어받는다("b5 를 잡는다/
--    이만큼 걸린다"는 사용자 의도를 분리된 두 보스 모두에 반영). 이미 b7 행이 있으면
--    무시(on conflict do nothing) — 재적용해도 안전. completions 는 위 설명대로
--    의도적으로 복제하지 않는다.
-- ----------------------------------------------------------------------------
insert into public.character_boss_selection (user_id, character_ocid, item_id)
select user_id, character_ocid, 'b7'
from public.character_boss_selection
where item_id = 'b5'
on conflict (user_id, character_ocid, item_id) do nothing;

insert into public.quest_durations (user_id, item_id, minutes)
select user_id, 'b7', minutes
from public.quest_durations
where item_id = 'b5'
on conflict (user_id, item_id) do nothing;
