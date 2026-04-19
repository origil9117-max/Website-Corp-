# Supabase setup

1. Create a Supabase project.
2. In project settings, copy:
   - Project URL
   - anon public key
3. Copy `supabase-config.example.js` to `supabase-config.js` and fill values.
4. Create table `notices`:

```sql
create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
```

5. Create table `resources`:

```sql
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  url text,
  content text not null,
  file_name text,
  file_path text,
  file_size bigint,
  download_allowed boolean not null default true,
  created_at timestamptz not null default now()
);
```

기존 프로젝트에 테이블이 이미 있는 경우, 아래로 컬럼만 추가할 수 있습니다.

```sql
alter table public.resources
  add column if not exists download_allowed boolean not null default true;
```

6. Create storage bucket:
   - Bucket name: `resource-files`
   - Public bucket: ON

7. Enable Email/Password sign-in in Authentication.
8. Create one admin user in Authentication -> Users.
9. RLS policy examples (allow read to everyone, write to authenticated only):

```sql
alter table public.notices enable row level security;
alter table public.resources enable row level security;

create policy "notices read all" on public.notices
for select using (true);
create policy "notices write auth" on public.notices
for all using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

create policy "resources read all" on public.resources
for select using (true);
create policy "resources write auth" on public.resources
for all using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');
```

10. Storage policy examples:

```sql
create policy "resource files read all"
on storage.objects for select
using (bucket_id = 'resource-files');

create policy "resource files write auth"
on storage.objects for all
using (bucket_id = 'resource-files' and auth.role() = 'authenticated')
with check (bucket_id = 'resource-files' and auth.role() = 'authenticated');
```

