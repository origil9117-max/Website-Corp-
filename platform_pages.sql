-- Run once in Supabase SQL Editor — 지능형 행정 플랫폼 4개 하위 페이지 본문을 클라우드에 저장합니다.
-- 테이블이 없으면 관리자 저장이 로컬(브라우저)에만 남을 수 있습니다.

create table if not exists public.platform_pages (
  slug text primary key,
  lead text not null default '',
  body_html text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.platform_pages enable row level security;

drop policy if exists "platform_pages_all" on public.platform_pages;

create policy "platform_pages_all" on public.platform_pages
  for all
  using (true)
  with check (true);
