# EasyParcel Configuration Checker
# This script verifies that EasyParcel environment variables are set correctly

Write-Host "Checking EasyParcel Configuration..." -ForegroundColor Cyan
Write-Host ""

$errors = @()
$warnings = @()

# Check required variables
if (-not $env:EASYPARCEL_API_KEY) {
    $errors += "EASYPARCEL_API_KEY is not set (required)"
} else {
    Write-Host "✓ EASYPARCEL_API_KEY is set" -ForegroundColor Green
}

# Check optional variables
if ($env:EASYPARCEL_DEMO -eq "true") {
    Write-Host "✓ Demo mode enabled" -ForegroundColor Yellow
} else {
    Write-Host "✓ Using live mode (production)" -ForegroundColor Green
}

if ($env:EASYPARCEL_SENDER_POSTCODE) {
    Write-Host "✓ Sender postcode: $env:EASYPARCEL_SENDER_POSTCODE" -ForegroundColor Green
} else {
    $warnings += "EASYPARCEL_SENDER_POSTCODE not set (will use stock location address if available)"
}

if ($env:EASYPARCEL_SENDER_STATE) {
    Write-Host "✓ Sender state: $env:EASYPARCEL_SENDER_STATE" -ForegroundColor Green
} else {
    $warnings += "EASYPARCEL_SENDER_STATE not set (will use stock location address if available)"
}

if ($env:EASYPARCEL_DEFAULT_WEIGHT_KG) {
    Write-Host "✓ Default weight: $env:EASYPARCEL_DEFAULT_WEIGHT_KG kg" -ForegroundColor Green
} else {
    Write-Host "✓ Default weight: 1 kg (default)" -ForegroundColor Green
}

Write-Host ""
Write-Host "Summary:" -ForegroundColor Cyan

if ($errors.Count -gt 0) {
    Write-Host "Errors:" -ForegroundColor Red
    foreach ($error in $errors) {
        Write-Host "  ✗ $error" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Please set the required environment variables in backend.env" -ForegroundColor Yellow
    exit 1
}

if ($warnings.Count -gt 0) {
    Write-Host "Warnings:" -ForegroundColor Yellow
    foreach ($warning in $warnings) {
        Write-Host "  ⚠ $warning" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Configuration looks good! EasyParcel provider should be available after restarting Medusa." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Restart Medusa backend (yarn dev or yarn start)" -ForegroundColor White
Write-Host "2. Go to Medusa Admin → Settings → Locations & Shipping" -ForegroundColor White
Write-Host "3. Add 'easyparcel_easyparcel' fulfillment provider to your stock location" -ForegroundColor White
Write-Host "4. Create shipping options using EasyParcel provider" -ForegroundColor White

