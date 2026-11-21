-- =========================================================
-- 학원 출결관리 시스템 - Supabase 설정 SQL
-- Supabase 대시보드 > SQL Editor 에 전체 붙여넣고 [Run] 한 번 누르세요.
-- (버스 탑승시스템 테이블과 겹치지 않도록 att_ 접두어를 사용합니다)
-- =========================================================

create extension if not exists pgcrypto;

-- 학생
create table if not exists public.att_students (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  class_name  text default '',
  parent_phone text default '',
  memo        text default '',
  -- 학부모 전용 링크 코드 (추측 불가능한 무작위 값)
  parent_code text not null unique default encode(gen_random_bytes(9), 'hex'),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 출결 기록 (학생 1명당 하루 여러 번 등/하원 가능)
create table if not exists public.att_logs (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.att_students(id) on delete cascade,
  log_date    date not null default (now() at time zone 'Asia/Seoul')::date,
  check_in    timestamptz,
  check_out   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists att_logs_date_idx on public.att_logs(log_date);
create index if not exists att_logs_student_idx on public.att_logs(student_id, log_date);

-- ---------------------------------------------------------
-- 보안(RLS): 관리자만 테이블 읽기/쓰기 가능
--  * 버스 시스템의 sb_profiles 에서 role = 'admin' 인 계정 = 출결 관리자
--    (버스 시스템 학부모/도우미 계정은 출결 데이터에 접근 불가)
-- 학부모는 테이블에 직접 접근 불가 → 아래 함수로 자기 자녀 기록만 조회
-- ---------------------------------------------------------
create or replace function public.att_is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if to_regclass('public.sb_profiles') is not null then
    return exists (select 1 from sb_profiles where id = auth.uid() and role = 'admin');
  end if;
  return auth.uid() is not null;
end $$;
revoke all on function public.att_is_admin() from public;
grant execute on function public.att_is_admin() to authenticated;
alter table public.att_students enable row level security;
alter table public.att_logs     enable row level security;

drop policy if exists att_students_admin on public.att_students;
create policy att_students_admin on public.att_students
  for all to authenticated using (public.att_is_admin()) with check (public.att_is_admin());

drop policy if exists att_logs_admin on public.att_logs;
create policy att_logs_admin on public.att_logs
  for all to authenticated using (public.att_is_admin()) with check (public.att_is_admin());

-- 학부모 조회 함수: 코드가 맞을 때만 해당 학생의 최근 60일 기록 반환
create or replace function public.att_parent_view(p_code text)
returns json
language sql
security definer
set search_path = public
as $$
  select case when s.id is null then null else json_build_object(
    'name', s.name,
    'class_name', s.class_name,
    'logs', coalesce((
      select json_agg(json_build_object(
               'log_date', l.log_date,
               'check_in', l.check_in,
               'check_out', l.check_out)
             order by l.log_date desc, l.check_in desc)
      from att_logs l
      where l.student_id = s.id
        and l.log_date >= ((now() at time zone 'Asia/Seoul')::date - 60)
    ), '[]'::json)
  ) end
  from (select 1) d
  left join att_students s on s.parent_code = p_code and length(p_code) >= 12
  limit 1;
$$;

revoke all on function public.att_parent_view(text) from public;
grant execute on function public.att_parent_view(text) to anon, authenticated;

-- 여러 기기(원장님 폰/PC)에서 화면이 실시간으로 같이 바뀌도록
do $$ begin
  alter publication supabase_realtime add table public.att_logs;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.att_students;
exception when others then null; end $$;
