-- ============================================================================
-- delete_own_account() : 회원탈퇴(계정 자체 삭제) RPC
-- ----------------------------------------------------------------------------
-- 이 앱은 service_role 을 쓰지 않는다(anon 키 + RLS 만). auth.users 행 삭제는 보통
-- Supabase Admin API(service_role) 로만 가능하므로, SECURITY DEFINER 함수로
-- "본인 자신"만 삭제할 수 있는 좁은 구멍을 뚫는다.
--
--  * 인자를 받지 않는다 — target user_id 를 파라미터로 받으면 클라이언트가 남의 id 를
--    넘겨 삭제시킬 수 있으므로, 항상 함수 내부에서 (select auth.uid()) 로 "호출자 자신"만
--    대상으로 삼는다.
--  * auth.uid() 가 null 이면(비로그인/신뢰 컨텍스트) 예외를 raise 하고 아무것도 지우지 않는다.
--  * profiles / user_secrets / completions / quest_durations / character_boss_selection 은
--    전부 references auth.users(id) on delete cascade 이므로(20260702090000_init_schema.sql
--    참고, 전수 확인 완료 — 5개 테이블 모두 on delete cascade, boss_presets.created_by 만
--    on delete set null 인데 이건 개인 데이터가 아니라 관리자가 만든 공용 프리셋의 작성자
--    참조라 삭제 대상이 아님), auth.users 행 삭제 한 줄로 연쇄 삭제가 일어난다. 그래서 이
--    함수는 명시적으로 다른 테이블을 지우지 않는다.
--  * is_admin() 과 동일하게 security definer + set search_path = '' + 객체 전부 스키마 수식.
--  * authenticated 에만 실행 권한을 준다(anon/public 은 명시적으로 회수).
--
-- create or replace + grant/revoke 만 사용해 멱등하게 재적용 가능하다.
-- ============================================================================

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid := (select auth.uid());
begin
  if target_id is null then
    raise exception 'delete_own_account(): 로그인한 사용자만 회원탈퇴를 요청할 수 있습니다.';
  end if;

  -- profiles/user_secrets/completions/quest_durations/character_boss_selection 은
  -- 전부 auth.users(id) on delete cascade 라 이 한 줄로 연쇄 삭제된다.
  delete from auth.users where id = target_id;
end;
$$;

comment on function public.delete_own_account() is
  '회원탈퇴: 호출자 본인((select auth.uid()))의 auth.users 행을 삭제. 인자 없음(다른 사용자 삭제 불가). '
  'profiles/user_secrets/completions/quest_durations/character_boss_selection 은 FK cascade 로 함께 삭제된다. '
  'auth.uid() 가 null 이면 예외를 raise 하고 아무것도 지우지 않는다. SECURITY DEFINER.';

-- create or replace function 은 기존 권한을 유지하지만, 신규 생성 시 PostgreSQL 기본 동작상
-- PUBLIC 에 EXECUTE 가 자동 부여될 수 있으므로 매번 명시적으로 정리한다(멱등).
revoke all on function public.delete_own_account() from public;
revoke all on function public.delete_own_account() from anon;
grant execute on function public.delete_own_account() to authenticated;
