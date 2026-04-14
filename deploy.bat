@echo off
chcp 65001 > nul
setlocal
cd /d "%~dp0"

echo [1/5] 작업 폴더 확인...
if not exist ".git" (
  echo [오류] 현재 폴더는 git 저장소가 아닙니다.
  echo 폴더: %cd%
  pause
  exit /b 1
)

echo [2/5] 변경 파일 스테이징...
git add .

echo [3/5] 커밋 생성...
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

echo [4/5] 원격 푸시...
git push origin main
if errorlevel 1 (
  echo [오류] 푸시에 실패했습니다. 원격 URL/권한을 확인하세요.
  pause
  exit /b 1
)

echo [5/5] 완료
echo 배포 요청 완료! Vercel에서 1~3분 내 자동 반영됩니다.
pause