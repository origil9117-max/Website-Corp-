$ErrorActionPreference = "Stop"

Write-Host "=== One Click Deploy (GitHub -> Vercel) ===" -ForegroundColor Cyan

# Ensure script runs in its own folder
$repoPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoPath

# Basic git availability check
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "git is not installed or not found in PATH." -ForegroundColor Red
  exit 1
}

# Check whether there are any changes
$status = git status --porcelain
if ([string]::IsNullOrWhiteSpace($status)) {
  Write-Host "No changes to deploy. Working tree is clean." -ForegroundColor Yellow
  exit 0
}

# Auto commit message with timestamp
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$message = "deploy: update site ($timestamp)"

Write-Host "Staging files..." -ForegroundColor Gray
git add -A

Write-Host "Committing..." -ForegroundColor Gray
git commit -m $message

Write-Host "Pushing to remote..." -ForegroundColor Gray
git push

Write-Host ""
Write-Host "Push complete. Vercel will auto-deploy shortly." -ForegroundColor Green
Write-Host "Check deployment: https://vercel.com/dashboard" -ForegroundColor Green
