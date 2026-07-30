-- ============================================================================
-- character_cache : 캐릭터 슬라이드 즐겨찾기(is_favorite) + 비활성화(is_active).
-- ----------------------------------------------------------------------------
-- 둘 다 사용자가 카드/설정 화면에서 직접 토글하는 순수 표시용 값이다. 넥슨 동기화("동기화"/
-- "숙제 동기화"/캐릭터 목록 대조)가 이 두 컬럼을 절대 건드리지 않는다 — syncCharacterSnapshot
-- (warmup.ts)과 reconcileCharacterCache(nexon-key-actions.ts)의 upsert 는 이 컬럼들을
-- 지정하지 않으므로 기존 값이 그대로 유지된다(character_cache 테이블의 기존 패턴과 동일:
-- "지정하지 않은 컬럼은 upsert 시 기존 값 유지"). 즉 캐릭터를 재동기화해도 즐겨찾기/비활성
-- 상태는 풀리지 않는다.
--
-- is_favorite : 즐겨찾기 고정. 정렬 규칙(디자인 스펙, MainScreenClient.tsx worldChars 정렬
-- 참고): 즐겨찾기한 캐릭터를 항상 앞으로 모으고, 그 그룹 안에서도(비즐겨찾기 그룹과 동일하게)
-- 레벨 내림차순으로 정렬한다 — 즐겨찾기 여부는 "우선순위"만 결정하고 boolean 하나로 충분하다
-- (즐겨찾기 누른 시각/순번을 저장할 필요가 없다).
--
-- is_active : 메인 슬라이드 노출 여부. false 면 슬라이드(월드 탭 포함)에서 완전히 빠지고
-- 설정 화면의 "비활성 캐릭터" 목록에서만 보인다(재활성화 가능). 캐릭터를 실제로 지우는 게
-- 아니라 화면에서만 숨기는 것 — completions/quest_durations/character_boss_selection 등
-- 기존 데이터는 그대로 보존된다.
--
-- 별도 RLS 정책이 필요 없다 — character_cache 는 이미 본인 행 전체 CRUD 가 허용돼 있다
-- (character_cache_all_own, 20260707100000_character_cache_and_quest_presets.sql).
--
-- 멱등 작성: add column if not exists.
-- ============================================================================

alter table public.character_cache
  add column if not exists is_favorite boolean not null default false;

alter table public.character_cache
  add column if not exists is_active boolean not null default true;

comment on column public.character_cache.is_favorite is '캐릭터 슬라이드에서 즐겨찾기 고정 여부. 사용자가 카드의 별 아이콘으로 직접 토글 — 넥슨 동기화로 갱신되지 않는다. 정렬: 즐겨찾기 그룹을 앞으로, 그 안에서는 레벨 내림차순(비즐겨찾기 그룹과 동일 규칙).';
comment on column public.character_cache.is_active is '메인 화면 슬라이드 노출 여부. false 면 슬라이드에서 숨겨지고 설정의 "비활성 캐릭터" 목록에서만 보인다(재활성화 가능). 하드 삭제가 아니다 — completions/character_boss_selection/quest_durations 등 기존 데이터는 그대로 유지된다. 사용자가 상세 패널의 숨기기 버튼으로 직접 토글 — 넥슨 동기화로 갱신되지 않는다.';
