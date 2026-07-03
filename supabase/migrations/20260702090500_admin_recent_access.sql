-- ============================================================================
-- admin_recent_access(p_limit) : 관리자 페이지 "최근 접속" 목록용 RPC
-- ----------------------------------------------------------------------------
-- 배경: 관리자 페이지는 각 행에 "마스킹된 이메일 + last_access_at"을 요구하지만,
-- 이메일은 auth.users.email 에 있고 profiles 에는 없다. auth.users 는 PostgREST(Data API)로
-- 노출되지 않고, 이 앱은 service_role 을 쓰지 않으므로(anon 키 + RLS 만) 일반 세션으로는
-- 다른 유저의 이메일을 조회할 수 없다. delete_own_account() 와 동일한 패턴으로,
-- SECURITY DEFINER 함수를 통해 "관리자에게만" 마스킹된 이메일을 좁게 노출한다.
--
--  * 반환 컬럼: id(uuid), masked_email(text), last_access_at(timestamptz).
--    디자인 목업의 "캐릭터 수"는 포함하지 않는다 — 이 앱은 캐릭터를 DB에 캐시하지 않고
--    넥슨 OpenAPI 를 매 요청 조회하므로, 전체 유저의 캐릭터 수를 한 번에 낼 방법이 없다
--    (알려진 설계 편차. 필요해지면 화면에서 유저별로 개별 조회하거나 별도 캐시 테이블을
--    새로 설계해야 한다).
--  * 호출자가 is_admin() 이 아니면 예외를 raise하고 아무 행도 반환하지 않는다.
--    (실행 권한 자체는 authenticated 전체에 주지만, 함수 내부에서 role 을 검사한다 —
--    delete_own_account() 가 auth.uid() 를 함수 내부에서 검사하는 것과 동일한 방어 위치.)
--  * p_limit 은 1~100 로 clamp 한다(기본 20). 범위를 벗어나거나 null 이어도 안전한 값으로 보정.
--  * 이메일 마스킹 규칙(로컬파트 = @ 앞부분, 도메인은 그대로 노출):
--      - 로컬파트 길이 <= 2  : 전부 마스킹 ('*' 반복)
--      - 로컬파트 길이 3~4   : 앞 2글자 노출 + '****'
--      - 로컬파트 길이 5+    : 앞 3글자 노출 + '****'
--    예: "me@gmail.com" -> "**@gmail.com", "member@gmail.com" -> "mem****@gmail.com".
--    로컬파트 원문 전체가 그대로 노출되는 경우는 없다(마지막 case 도 항상 뒤가 '****' 로 잘림).
--  * last_access_at 오래된 순(desc, null 은 맨 뒤)으로 정렬해 p_limit 개만 반환.
--  * is_admin() 과 동일한 패턴: security definer + set search_path = '' + 객체 전부 스키마 수식.
--  * authenticated 에만 grant execute, anon/public 은 매번 명시적으로 revoke(멱등).
-- ============================================================================

create or replace function public.admin_recent_access(p_limit integer default 20)
returns table (
  id             uuid,
  masked_email   text,
  last_access_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  if not public.is_admin() then
    raise exception 'admin_recent_access(): 관리자만 호출할 수 있습니다.';
  end if;

  -- null/범위 밖 값을 안전하게 보정(남용 방지). 기본 20, 최소 1, 최대 100.
  v_limit := greatest(1, least(coalesce(p_limit, 20), 100));

  return query
    with base as (
      select
        p.id,
        p.last_access_at,
        split_part(coalesce(u.email, ''), '@', 1) as local_part,
        split_part(coalesce(u.email, ''), '@', 2) as domain_part
      from public.profiles p
      join auth.users u on u.id = p.id
    )
    select
      b.id,
      (
        case
          when length(b.local_part) <= 2 then repeat('*', greatest(length(b.local_part), 1))
          when length(b.local_part) <= 4 then left(b.local_part, 2) || '****'
          else left(b.local_part, 3) || '****'
        end
      ) || '@' || b.domain_part as masked_email,
      b.last_access_at
    from base b
    order by b.last_access_at desc nulls last
    limit v_limit;
end;
$$;

comment on function public.admin_recent_access(integer) is
  '관리자 페이지 "최근 접속" 목록. profiles/auth.users 를 id 로 join 해 마스킹된 이메일만 반환. '
  'is_admin() 아니면 예외. p_limit 은 1~100 로 clamp(기본 20). SECURITY DEFINER, 캐릭터 수는 미포함(캐릭터 미캐시).';

-- create or replace function 은 기존 권한을 유지하지만, 신규 생성 시 PostgreSQL 기본 동작상
-- PUBLIC 에 EXECUTE 가 자동 부여될 수 있으므로 매번 명시적으로 정리한다(멱등).
revoke all on function public.admin_recent_access(integer) from public;
revoke all on function public.admin_recent_access(integer) from anon;
grant execute on function public.admin_recent_access(integer) to authenticated;
