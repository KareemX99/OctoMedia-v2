param(
  [string]$RepoUrl = "",
  [string]$Branch = ""
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Branch)) {
  $Branch = (git branch --show-current).Trim()
}

if ([string]::IsNullOrWhiteSpace($Branch)) {
  Write-Host "❌ Could not detect branch name. Pass it as second argument." -ForegroundColor Red
  exit 1
}

if (-not [string]::IsNullOrWhiteSpace($RepoUrl)) {
  git remote get-url origin *> $null
  if ($LASTEXITCODE -eq 0) {
    git remote set-url origin $RepoUrl
    Write-Host "✅ Updated origin to: $RepoUrl"
  } else {
    git remote add origin $RepoUrl
    Write-Host "✅ Added origin: $RepoUrl"
  }
}

git remote get-url origin *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "❌ origin is not configured." -ForegroundColor Red
  Write-Host "Usage: powershell -ExecutionPolicy Bypass -File scripts/push-to-github.ps1 <repo_url> [branch]"
  exit 1
}

Write-Host "➡️ Pushing branch '$Branch' to origin..."
git push -u origin $Branch

Write-Host "🎉 Done. Changes are now on GitHub."
