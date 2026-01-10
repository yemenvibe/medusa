# Resend Notification Configuration Checker
# This script verifies that Resend environment variables are set correctly

Write-Host "Checking Resend Notification Configuration..." -ForegroundColor Cyan
Write-Host ""

$errors = @()
$warnings = @()

# Check API Key
if (-not $env:RESEND_API_KEY) {
    $errors += "RESEND_API_KEY is not set (required)"
} else {
    Write-Host "✓ RESEND_API_KEY is set" -ForegroundColor Green
    if ($env:RESEND_API_KEY.StartsWith("re_")) {
        Write-Host "  Format looks correct (starts with 're_')" -ForegroundColor Gray
    } else {
        $warnings += "RESEND_API_KEY doesn't start with 're_' - verify it's correct"
    }
}

# Check From Email
if (-not $env:RESEND_FROM_EMAIL) {
    $errors += "RESEND_FROM_EMAIL is not set (required)"
} else {
    Write-Host "✓ RESEND_FROM_EMAIL: $env:RESEND_FROM_EMAIL" -ForegroundColor Green
    if ($env:RESEND_FROM_EMAIL -match "^[^@]+@[^@]+\.[^@]+$") {
        Write-Host "  Email format looks valid" -ForegroundColor Gray
    } else {
        $warnings += "RESEND_FROM_EMAIL format doesn't look like a valid email"
    }
}

# Check Optional Settings
if ($env:RESEND_BCC_EMAILS) {
    Write-Host "✓ BCC emails configured: $env:RESEND_BCC_EMAILS" -ForegroundColor Green
} else {
    Write-Host "ℹ BCC emails not configured (optional)" -ForegroundColor Yellow
}

Write-Host ""

# Display warnings
if ($warnings.Count -gt 0) {
    Write-Host "⚠ Warnings:" -ForegroundColor Yellow
    foreach ($warning in $warnings) {
        Write-Host "  - $warning" -ForegroundColor Yellow
    }
    Write-Host ""
}

# Display errors or success
if ($errors.Count -gt 0) {
    Write-Host "❌ Configuration Errors:" -ForegroundColor Red
    foreach ($error in $errors) {
        Write-Host "  - $error" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "To fix these errors:" -ForegroundColor White
    Write-Host "1. Get your Resend API key from: https://resend.com/api-keys" -ForegroundColor White
    Write-Host "2. Add to backend.env:" -ForegroundColor White
    Write-Host "   RESEND_API_KEY=re_xxxxxxxxxxxx" -ForegroundColor White
    Write-Host "   RESEND_FROM_EMAIL=orders@yourdomain.com" -ForegroundColor White
    Write-Host "3. Verify your domain in Resend dashboard" -ForegroundColor White
    Write-Host "4. Restart Medusa backend" -ForegroundColor White
    exit 1
} else {
    Write-Host "✅ Configuration looks good! Resend notification provider should be available after restarting Medusa." -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor White
    Write-Host "1. Run 'yarn install' to install Resend SDK" -ForegroundColor White
    Write-Host "2. Verify your domain at: https://resend.com/domains" -ForegroundColor White
    Write-Host "3. Restart Medusa backend: yarn dev" -ForegroundColor White
    Write-Host "4. Test by creating an order or customer" -ForegroundColor White
    Write-Host "5. Check Resend dashboard for sent emails" -ForegroundColor White
}

