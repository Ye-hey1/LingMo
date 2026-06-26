# Security Check Script
# 检查敏感文件是否曾被提交到Git历史

Write-Host "=== LingMo Security Check ===" -ForegroundColor Cyan
Write-Host ""

# 检查.env.local是否在Git历史中
Write-Host "1. Checking if .env.local was ever committed..." -ForegroundColor Yellow
$envLocalHistory = git log --all --full-history -- .env.local 2>&1
if ($envLocalHistory) {
    Write-Host "   ⚠️  WARNING: .env.local found in Git history!" -ForegroundColor Red
    Write-Host "   Action required: Rotate all API keys immediately" -ForegroundColor Red
    Write-Host ""
    Write-Host "   To remove from history (use with caution):" -ForegroundColor Yellow
    Write-Host "   git filter-branch --force --index-filter 'git rm --cached --ignore-unmatch .env.local' --prune-empty --tag-name-filter cat -- --all" -ForegroundColor Gray
} else {
    Write-Host "   ✅ .env.local not found in Git history" -ForegroundColor Green
}
Write-Host ""

# 检查硬编码的密钥
Write-Host "2. Scanning for hardcoded secrets..." -ForegroundColor Yellow
$secretPatterns = @(
    "sk-or-v1-",
    "eg4upYo7ruJgaDVOtlHJGj4lyzG4Oh9IpLGwOc6Oehw",
    "wHi8Tkuc5i6v1UCAuVk48A"
)

foreach ($pattern in $secretPatterns) {
    $found = git log -p --all -S $pattern -- "*.ts" "*.tsx" "*.js" "*.jsx" 2>&1
    if ($found) {
        Write-Host "   ⚠️  Found pattern '$pattern' in Git history" -ForegroundColor Red
    }
}
Write-Host ""

# 检查当前工作目录中的敏感文件
Write-Host "3. Checking for sensitive files in working directory..." -ForegroundColor Yellow
$sensitiveFiles = @(
    ".env.local",
    "*.pem",
    "*.key",
    "*.p12"
)

foreach ($pattern in $sensitiveFiles) {
    $files = Get-ChildItem -Path . -Filter $pattern -Recurse -ErrorAction SilentlyContinue
    if ($files) {
        Write-Host "   ⚠️  Found sensitive file: $($files.FullName)" -ForegroundColor Yellow
    }
}
Write-Host ""

# 总结
Write-Host "=== Recommendations ===" -ForegroundColor Cyan
Write-Host "1. Rotate all API keys found in this repository" -ForegroundColor White
Write-Host "2. Use environment variables for all secrets" -ForegroundColor White
Write-Host "3. Never commit .env.local or similar files" -ForegroundColor White
Write-Host "4. Consider using a secrets manager for production" -ForegroundColor White
Write-Host ""
Write-Host "Security check completed." -ForegroundColor Green
