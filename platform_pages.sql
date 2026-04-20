-- Run once in Supabase SQL Editor — 지능형 행정 플랫폼 4개 하위 페이지 본문을 클라우드에 저장합니다.
-- 테이블이 없으면 관리자 저장이 로컬(브라우저)에만 남을 수 있습니다.

create table if not exists public.platform_pages (
  slug text primary key,
  lead text not null default '',
  body_html text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.platform_pages enable row level security;

-- 기존 통합 정책 제거
drop policy if exists "platform_pages_all" on public.platform_pages;
drop policy if exists "platform_pages_read_all" on public.platform_pages;
drop policy if exists "platform_pages_write_auth" on public.platform_pages;

-- 읽기: 비로그인(anon) 포함 전체 허용
create policy "platform_pages_read_all" on public.platform_pages
  for select
  to anon, authenticated
  using (true);

-- 쓰기: 로그인 사용자만 허용(관리자 로그인 후 저장/수정/삭제)
create policy "platform_pages_write_auth" on public.platform_pages
  for all
  to authenticated
  using (true)
  with check (true);

-- 권한 부여 (RLS 정책과 별개로 필요)
grant usage on schema public to anon, authenticated;
grant select on table public.platform_pages to anon;
grant select, insert, update, delete on table public.platform_pages to authenticated;
