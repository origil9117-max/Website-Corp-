-- Run once in Supabase SQL Editor so 공지사항(admin/notice/index)이 모든 PC에서 공유됩니다.
-- 공지 테이블이 없으면 각 브라우저(localStorage) 데이터가 따로 보여 동기화되지 않습니다.

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notices_pinned_created_idx
  on public.notices (pinned desc, created_at desc);

alter table public.notices enable row level security;

-- 예전 SUPABASE_SETUP.md 예시 정책(익명 INSERT 불가)이 남아 있으면 저장이 계속 실패합니다.
drop policy if exists "notices read all" on public.notices;
drop policy if exists "notices write auth" on public.notices;
drop policy if exists "notices_all" on public.notices;

create policy "notices_all" on public.notices
  for all
  using (true)
  with check (true);
