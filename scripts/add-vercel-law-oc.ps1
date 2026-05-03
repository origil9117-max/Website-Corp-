# Vercel 프로젝트에 LAW_OC 환경 변수를 추가합니다. (Production)
# 사용 전: 저장소 루트에서 npx vercel link 로 프로젝트 연결, npx vercel login 완료
#
# 실행 예 (OC는 채팅에 붙여넣지 말고 로컬에서만):
#   $env:LAW_OC = '공동활용에서_발급한_OC'
#   .\scripts\add-vercel-law-oc.ps1

$ErrorActionPreference = "Stop"
if (-not $env:LAW_OC -or $env:LAW_OC.Trim().Length -lt 2) {
  Write-Error "먼저 PowerShell에서: `$env:LAW_OC = '발급받은_OC값' 설정 후 다시 실행하세요."
}

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

Write-Host "Adding LAW_OC to Vercel (production)..."
$env:LAW_OC | npx vercel env add LAW_OC production
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
Write-Host "완료. Vercel 대시보드에서 Production 재배포(Redeploy)를 실행하세요."
