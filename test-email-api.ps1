# Test Email API Script
# Tests the /store/test-email endpoint with publishable API key

param(
    [string]$Email = "ammar.alqadasi@gmail.com",
    [string]$PublishableKey = "",
    [string]$BaseUrl = "http://localhost:9000"
)

# Try to get publishable key from environment if not provided
if ([string]::IsNullOrEmpty($PublishableKey)) {
    $PublishableKey = [Environment]::GetEnvironmentVariable("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY", "Process")
    if ([string]::IsNullOrEmpty($PublishableKey)) {
        $PublishableKey = [Environment]::GetEnvironmentVariable("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY", "User")
    }
}

if ([string]::IsNullOrEmpty($PublishableKey)) {
    Write-Host "❌ ERROR: Publishable API key not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please provide the publishable API key in one of these ways:" -ForegroundColor Yellow
    Write-Host "  1. Set environment variable: NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY" -ForegroundColor Yellow
    Write-Host "  2. Pass as parameter: -PublishableKey 'your-key-here'" -ForegroundColor Yellow
    Write-Host "  3. Get it from Medusa Admin Dashboard > Settings > API Keys" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host "📧 Testing email endpoint..." -ForegroundColor Cyan
Write-Host "  Email: $Email" -ForegroundColor Gray
Write-Host "  Endpoint: $BaseUrl/store/test-email" -ForegroundColor Gray
Write-Host ""

try {
    $body = @{
        email = $Email
    } | ConvertTo-Json

    $headers = @{
        "Content-Type" = "application/json"
        "x-publishable-api-key" = $PublishableKey
    }

    $response = Invoke-WebRequest -Uri "$BaseUrl/store/test-email" `
        -Method POST `
        -Headers $headers `
        -Body $body `
        -ErrorAction Stop

    $result = $response.Content | ConvertFrom-Json

    Write-Host "✅ Success!" -ForegroundColor Green
    Write-Host "  Message: $($result.message)" -ForegroundColor Gray
    if ($result.emailId) {
        Write-Host "  Email ID: $($result.emailId)" -ForegroundColor Gray
    }
    Write-Host ""
    Write-Host "✉️  Check your inbox at: $Email" -ForegroundColor Cyan

} catch {
    Write-Host "❌ Error sending test email!" -ForegroundColor Red
    Write-Host ""
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response: $responseBody" -ForegroundColor Yellow
    } else {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    
    exit 1
}




