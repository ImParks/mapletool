-- ============================================================================
-- RLS 정책 (기본 deny + 본인 행만 / 관리자 예외)
--  * 모든 테이블 RLS 활성화. 정책은 전부 TO authenticated → anon 은 차단.
--  * 정책 이름 규칙: <table>_<action>_<scope>.
--  * create policy 는 IF NOT EXISTS 가 없어 drop policy if exists 후 재생성(멱등).
--  * GRANT 는 명시적으로 authenticated 에만(anon 제외). RLS 가 최종 게이트이므로
--    grant 가 있어도 정책 없는 anon 은 접근 불가.
-- ============================================================================

-- RLS 활성화 (반복 안전)
alter table public.profiles                 enable row level security;
alter table public.user_secrets             enable row level security;
alter table public.boss_presets             enable row level security;
alter table public.completions              enable row level security;
alter table public.quest_durations          enable row level security;
alter table public.character_boss_selection enable row level security;

-- 테이블 권한(authenticated). anon 에는 부여하지 않는다.
grant select, insert, update, delete on public.user_secrets             to authenticated;
grant select, insert, update, delete on public.completions              to authenticated;
grant select, insert, update, delete on public.quest_durations          to authenticated;
grant select, insert, update, delete on public.character_boss_selection to authenticated;
grant select, update                 on public.profiles                 to authenticated;
grant select, insert, update, delete on public.boss_presets             to authenticated;

-- ----------------------------------------------------------------------------
-- profiles : 본인 select/update. 관리자는 전체 select. insert 는 트리거(정의자)만.
--   role 자가변경 차단은 guard_profile_update 트리거가 담당(정책은 행 접근만 통제).
-- ----------------------------------------------------------------------------
drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id or public.is_admin());

drop policy if exists profiles_update_own_or_admin on public.profiles;
create policy profiles_update_own_or_admin on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id or public.is_admin())
  with check ((select auth.uid()) = id or public.is_admin());

-- ----------------------------------------------------------------------------
-- user_secrets : 본인만 전체 CRUD. 관리자 정책 없음(관리자도 키 원문 접근 불가).
-- ----------------------------------------------------------------------------
drop policy if exists user_secrets_all_own on public.user_secrets;
create policy user_secrets_all_own on public.user_secrets
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- boss_presets : 인증 사용자 누구나 select. insert/update/delete 는 관리자만.
-- ----------------------------------------------------------------------------
drop policy if exists boss_presets_select_all on public.boss_presets;
create policy boss_presets_select_all on public.boss_presets
  for select to authenticated
  using (true);

drop policy if exists boss_presets_insert_admin on public.boss_presets;
create policy boss_presets_insert_admin on public.boss_presets
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists boss_presets_update_admin on public.boss_presets;
create policy boss_presets_update_admin on public.boss_presets
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists boss_presets_delete_admin on public.boss_presets;
create policy boss_presets_delete_admin on public.boss_presets
  for delete to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- completions / quest_durations / character_boss_selection :
--   본인(user_id = auth.uid()) 행만 전체 CRUD. INSERT 도 with check 로 user_id 강제.
-- ----------------------------------------------------------------------------
drop policy if exists completions_all_own on public.completions;
create policy completions_all_own on public.completions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists quest_durations_all_own on public.quest_durations;
create policy quest_durations_all_own on public.quest_durations
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists character_boss_selection_all_own on public.character_boss_selection;
create policy character_boss_selection_all_own on public.character_boss_selection
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
