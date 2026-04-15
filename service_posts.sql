-- Run once in Supabase SQL Editor so 게시글(service-post.html)이 모든 PC에서 공유됩니다.
-- 로컬 저장만 쓰는 경우 이 테이블이 없으면 브라우저마다 데이터가 따로 저장됩니다.

create table if not exists public.service_posts (
  id uuid primary key default gen_random_uuid(),
  service text not null,
  title text not null,
  body text not null,
  images jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists service_posts_service_created_idx
  on public.service_posts (service, created_at desc);

alter table public.service_posts enable row level security;

-- 공개 읽기 + 익명 작성(현재 페이지는 클라이언트 관리자 비밀번호만 사용)
-- 보안을 강화하려면 Supabase Auth 연동 후 정책을 좁히세요.
drop policy if exists "service_posts_all" on public.service_posts;
create policy "service_posts_all" on public.service_posts
  for all
  using (true)
  with check (true);
