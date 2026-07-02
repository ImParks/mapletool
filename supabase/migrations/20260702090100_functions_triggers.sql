-- ============================================================================
-- 함수 / 트리거
--  * is_admin()             : 관리자 판정. RLS 재귀 방지 위해 SECURITY DEFINER + search_path 고정.
--  * handle_new_user()      : auth.users INSERT 시 profiles 자동 생성(role 'user').
--  * guard_profile_update() : profiles UPDATE 시 role/id/created_at 무단 변경 차단.
--  * sync_nexon_key_flag()  : user_secrets 변경 시 profiles.has_nexon_key 동기화.
--  * set_updated_at()       : updated_at 자동 갱신.
-- 모두 create or replace + drop trigger if exists 로 멱등.
-- SECURITY DEFINER 함수는 search_path 를 비워(=only pg_catalog) 두고 객체를 전부 스키마 수식한다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- is_admin() : 현재 로그인 사용자가 admin 인지.
-- SECURITY DEFINER(소유자=postgres) 로 실행되어 profiles 의 RLS 를 우회 → 정책에서 호출해도 재귀 없음.
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  );
$$;

comment on function public.is_admin() is '현재 사용자가 admin 인지 반환. RLS 재귀 방지용 SECURITY DEFINER + search_path 고정. 정책에서 호출.';

-- 정책 평가(authenticated 컨텍스트)에서 호출되므로 실행 권한 부여.
grant execute on function public.is_admin() to authenticated;

-- ----------------------------------------------------------------------------
-- handle_new_user() : 신규 가입 시 profiles 생성. 닉네임은 가입 메타데이터에서.
-- daily/weekly 는 코드 프리셋, 완료기록은 period_key 모델이라 per-user 시드 INSERT 불필요(프로필만 생성).
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nickname, role)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'nickname',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name',
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is 'auth.users INSERT 시 profiles 자동 생성(role user, 닉네임은 메타데이터/이메일 로컬파트).';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- guard_profile_update() : profiles UPDATE 보호.
--  - id, created_at 은 항상 원래 값 유지.
--  - role 은 "로그인한 일반 사용자(auth.uid() 존재 && !is_admin())"가 바꾸지 못하게 원래 값 유지.
--    관리자이거나 JWT 없는 신뢰 컨텍스트(서버 SQL/대시보드, auth.uid() = null)면 변경 허용
--    → 최초 관리자 부트스트랩(대시보드 SQL) 가능.
-- ----------------------------------------------------------------------------
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;

  if (select auth.uid()) is not null and not public.is_admin() then
    new.role := old.role;
  end if;

  return new;
end;
$$;

comment on function public.guard_profile_update() is 'profiles UPDATE 시 id/created_at 고정, 일반 사용자의 role 자가 변경 차단. auth.uid() 가 null(서버 SQL/대시보드)이면 role 변경 허용(관리자 부트스트랩).';

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ----------------------------------------------------------------------------
-- sync_nexon_key_flag() : user_secrets 변경에 따라 profiles.has_nexon_key 동기화.
-- 관리자는 user_secrets 를 못 읽지만, 이 플래그로 "등록률" 통계는 낼 수 있다(원문 노출 없음).
-- SECURITY DEFINER 라 profiles RLS 우회. profiles 의 guard 트리거가 함께 돌지만
-- has_nexon_key 는 보호 대상이 아니므로 정상 반영된다.
-- ----------------------------------------------------------------------------
create or replace function public.sync_nexon_key_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.profiles set has_nexon_key = false where id = old.user_id;
    return old;
  else
    update public.profiles
      set has_nexon_key = (new.nexon_api_key is not null and length(btrim(new.nexon_api_key)) > 0)
      where id = new.user_id;
    return new;
  end if;
end;
$$;

comment on function public.sync_nexon_key_flag() is 'user_secrets 변경 시 profiles.has_nexon_key 동기화(관리자 등록률 통계용, 키 원문 미노출).';

drop trigger if exists user_secrets_sync_flag on public.user_secrets;
create trigger user_secrets_sync_flag
  after insert or update or delete on public.user_secrets
  for each row execute function public.sync_nexon_key_flag();

-- ----------------------------------------------------------------------------
-- set_updated_at() : updated_at 자동 갱신 (user_secrets, boss_presets).
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is 'UPDATE 시 updated_at 을 now() 로 갱신하는 공용 트리거 함수.';

drop trigger if exists user_secrets_set_updated_at on public.user_secrets;
create trigger user_secrets_set_updated_at
  before update on public.user_secrets
  for each row execute function public.set_updated_at();

drop trigger if exists boss_presets_set_updated_at on public.boss_presets;
create trigger boss_presets_set_updated_at
  before update on public.boss_presets
  for each row execute function public.set_updated_at();
