# Script to check Billplz Payment Provider Configuration
Write-Host "=== Billplz Payment Provider Check ===" -ForegroundColor Cyan
Write-Host ""

# Check environment variables
Write-Host "1. Checking Environment Variables:" -ForegroundColor Yellow
$requiredVars = @(
    "BILLPLZ_API_KEY",
    "BILLPLZ_X_SIGNATURE_KEY",
    "BILLPLZ_COLLECTION_ID"
)

$allSet = $true
foreach ($var in $requiredVars) {
    $value = [Environment]::GetEnvironmentVariable($var, "Process")
    if (-not $value) {
        $value = [Environment]::GetEnvironmentVariable($var, "User")
    }
    if (-not $value) {
        $value = [Environment]::GetEnvironmentVariable($var, "Machine")
    }
    
    if ($value) {
        Write-Host "  [OK] $var is set (length: $($value.Length))" -ForegroundColor Green
    } else {
        Write-Host "  [X] $var is NOT set" -ForegroundColor Red
        $allSet = $false
    }
}

Write-Host ""
if (-not $allSet) {
    Write-Host "[WARNING] Some required environment variables are missing!" -ForegroundColor Red
    Write-Host "  The Billplz provider will NOT be registered if these are not set." -ForegroundColor Red
    Write-Host ""
}

# Check if Medusa server is running
Write-Host "2. Checking Medusa Server:" -ForegroundColor Yellow
try {
    $response = Test-NetConnection -ComputerName localhost -Port 9000 -InformationLevel Quiet -WarningAction SilentlyContinue
    if ($response) {
        Write-Host "  [OK] Medusa server is running on port 9000" -ForegroundColor Green
    } else {
        Write-Host "  [X] Medusa server is NOT running on port 9000" -ForegroundColor Red
    }
} catch {
    Write-Host "  [X] Could not check server status" -ForegroundColor Red
}

Write-Host ""

# Check provider file exists
Write-Host "3. Checking Provider File:" -ForegroundColor Yellow
$providerFile = "src\providers\billplz\index.ts"
if (Test-Path $providerFile) {
    Write-Host "  [OK] Provider file exists: $providerFile" -ForegroundColor Green
    
    # Check if getStatus method exists
    $content = Get-Content $providerFile -Raw
    if ($content -match "async getStatus\(") {
        Write-Host "  [OK] getStatus method found" -ForegroundColor Green
    } else {
        Write-Host "  [X] getStatus method NOT found" -ForegroundColor Red
    }
    
    if ($content -match "static identifier = `"billplz`"") {
        Write-Host "  [OK] Provider identifier is 'billplz'" -ForegroundColor Green
    } else {
        Write-Host "  [X] Provider identifier check failed" -ForegroundColor Red
    }
} else {
    Write-Host "  [X] Provider file NOT found: $providerFile" -ForegroundColor Red
}

Write-Host ""

# Check config file
Write-Host "4. Checking Medusa Config:" -ForegroundColor Yellow
$configFile = "medusa-config.ts"
if (Test-Path $configFile) {
    $configContent = Get-Content $configFile -Raw
    if ($configContent -match 'id: "billplz"') {
        Write-Host "  [OK] Billplz provider configured in medusa-config.ts" -ForegroundColor Green
    } else {
        Write-Host "  [X] Billplz provider NOT found in config" -ForegroundColor Red
    }
    
    if ($configContent -match 'resolve: "\.\/src\/providers\/billplz"') {
        Write-Host "  [OK] Provider resolve path is correct" -ForegroundColor Green
    } else {
        Write-Host "  [X] Provider resolve path check failed" -ForegroundColor Red
    }
} else {
    Write-Host "  [X] Config file NOT found: $configFile" -ForegroundColor Red
}

Write-Host ""

# Try to test API if server is running and we have publishable key
Write-Host "5. Testing Payment Providers API:" -ForegroundColor Yellow
$publishableKey = [Environment]::GetEnvironmentVariable("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY", "Process")
if (-not $publishableKey) {
    $publishableKey = [Environment]::GetEnvironmentVariable("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY", "User")
}

if ($publishableKey -and $response) {
    try {
        $headers = @{
            'x-publishable-api-key' = $publishableKey
        }
        $apiResponse = Invoke-RestMethod -Uri "http://localhost:9000/store/payment-providers?region_id=reg_01KAB3KFSXAQCSCZFR8SV8DFC7" -Method GET -Headers $headers -ErrorAction Stop
        
        Write-Host "  [OK] API is accessible" -ForegroundColor Green
        Write-Host "  Payment Providers returned:" -ForegroundColor Cyan
        foreach ($provider in $apiResponse.payment_providers) {
            $color = if ($provider.id -eq "pp_billplz_billplz") { "Green" } else { "White" }
            Write-Host "    - $($provider.id)" -ForegroundColor $color
        }
        
        $billplzFound = $apiResponse.payment_providers | Where-Object { $_.id -eq "pp_billplz_billplz" }
        if ($billplzFound) {
            Write-Host ""
            Write-Host "  [OK] Billplz provider (pp_billplz_billplz) is available in API!" -ForegroundColor Green
        } else {
            Write-Host ""
            Write-Host "  [X] Billplz provider NOT found in API response" -ForegroundColor Red
            Write-Host "    This means the provider is not registered or not enabled in the region" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  [X] API test failed: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    if (-not $publishableKey) {
        Write-Host "  [WARNING] NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY not found - skipping API test" -ForegroundColor Yellow
    }
    if (-not $response) {
        Write-Host "  [WARNING] Server not running - skipping API test" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
if ($allSet) {
    Write-Host "[OK] All environment variables are set" -ForegroundColor Green
} else {
    Write-Host "[X] Some environment variables are missing - provider will NOT load" -ForegroundColor Red
    Write-Host ""
    Write-Host "To fix: Set these in your .env file or environment:" -ForegroundColor Yellow
    Write-Host "  BILLPLZ_API_KEY=your_api_key" -ForegroundColor White
    Write-Host "  BILLPLZ_X_SIGNATURE_KEY=your_signature_key" -ForegroundColor White
    Write-Host "  BILLPLZ_COLLECTION_ID=your_collection_id" -ForegroundColor White
}

