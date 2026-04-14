@echo off
chcp 65001 > nul
setlocal
cd /d "%~dp0"

echo [1/6] 작업 폴더 확인...
if not exist ".git" (
  echo [오류] 현재 폴더는 git 저장소가 아닙니다.
  echo 폴더: %cd%
  pause
  exit /b 1
)

echo [2/6] Supabase 점검...
if not exist "supabase-config.js" (
  echo [경고] supabase-config.js 파일이 없습니다.
  echo        다른 PC 동기화 게시글이 동작하지 않을 수 있습니다.
) else (
  powershell -NoProfile -Command ^
    "$c = Get-Content -Raw 'supabase-config.js';" ^
    "$okUrl = ($c -match 'SUPABASE_URL') -and ($c -notmatch 'YOUR_SUPABASE_URL');" ^
    "$okKey = ($c -match 'SUPABASE_ANON_KEY') -and ($c -notmatch 'YOUR_SUPABASE_ANON_KEY');" ^
    "if(-not ($okUrl -and $okKey)) { exit 7 } else { exit 0 }"
  if errorlevel 1 (
    echo [경고] supabase-config.js 값이 비어있거나 예시값일 수 있습니다.
    echo        다른 PC에서 게시글이 안 보이면 이 파일 값을 먼저 확인하세요.
  ) else (
    echo Supabase 설정값 형식 점검 통과.
  )
)
echo [안내] service_posts 테이블이 없으면 공용 게시글 저장이 실패합니다.
echo        필요한 경우 아래 SQL을 Supabase SQL Editor에서 1회 실행하세요.
echo        create table if not exists public.service_posts ^(
echo          id uuid primary key default gen_random_uuid^(^),
echo          service text not null,
echo          title text not null,
echo          body text not null,
echo          images jsonb not null default '[]'::jsonb,
echo          created_at timestamptz not null default now^(^)
echo        ^);
echo.

echo [3/6] 변경 파일 스테이징...
git add .

echo [4/6] 커밋 생성...
git diff --cached --quiet
if %errorlevel%==0 (
  echo 커밋할 변경이 없습니다. (이미 최신 상태)
) else (
  for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format \"yyyy-MM-dd HH:mm:ss\""') do set NOW=%%i
  git commit -m "update: deploy %NOW%"
  if errorlevel 1 (
    echo [오류] 커밋에 실패했습니다.
    pause
    exit /b 1
  )
)

echo [5/6] 원격 푸시...
git push origin main
if errorlevel 1 (
  echo [오류] 푸시에 실패했습니다. 원격 URL/권한을 확인하세요.
  pause
  exit /b 1
)

echo [6/6] 완료
echo 배포 요청 완료! Vercel에서 1~3분 내 자동 반영됩니다.
pause