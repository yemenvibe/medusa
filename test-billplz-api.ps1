# Billplz API Test Script
# This script tests your Billplz API credentials

# Read API key from environment or prompt
$apiKey = $env:BILLPLZ_API_KEY
if (-not $apiKey) {
    Write-Host "BILLPLZ_API_KEY not found in environment. Please enter your API key:"
    $apiKey = Read-Host
}

if (-not $apiKey) {
    Write-Host "Error: API key is required" -ForegroundColor Red
    exit 1
}

# Read collection ID from environment or use default
$collectionId = $env:BILLPLZ_COLLECTION_ID
if (-not $collectionId) {
    $collectionId = "riq0mt8s"
    Write-Host "Using default collection ID: $collectionId" -ForegroundColor Yellow
}

# Check if using sandbox
$useSandbox = $env:BILLPLZ_SANDBOX -eq "true" -or $env:BILLPLZ_SANDBOX -eq "1"
$baseUrl = if ($useSandbox) { "https://www.billplz-sandbox.com/api/v3" } else { "https://www.billplz.com/api/v3" }

# Read backend URL from environment or use default
$backendUrl = $env:BACKEND_URL
if (-not $backendUrl) {
    $backendUrl = $env:MEDUSA_BACKEND_URL
}
if (-not $backendUrl) {
    $backendUrl = "http://localhost:9000"
    Write-Host "Using default backend URL: $backendUrl" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Billplz API Test ===" -ForegroundColor Cyan
Write-Host "API Key: $($apiKey.Substring(0, [Math]::Min(8, $apiKey.Length)))..." -ForegroundColor Gray
Write-Host "Collection ID: $collectionId" -ForegroundColor Gray
Write-Host "Environment: $(if ($useSandbox) { 'Sandbox' } else { 'Production' })" -ForegroundColor Gray
Write-Host "URL: $baseUrl/bills" -ForegroundColor Gray
Write-Host "Backend URL: $backendUrl" -ForegroundColor Gray
Write-Host ""

# Create Basic Auth header
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${apiKey}:"))

# Prepare headers
$headers = @{
    "Authorization" = "Basic $auth"
    "Content-Type" = "application/json"
}

# Prepare request body with all required fields
# Required fields: collection_id, email OR mobile, name, amount, callback_url, description
$body = @{
    collection_id = $collectionId
    email = "test@example.com"
    name = "Test Customer"
    amount = 100  # Amount in sen (100 sen = 1 MYR) - positive integer
    callback_url = "$backendUrl/hooks/billplz"  # Required webhook URL
    description = "Test payment from PowerShell script"  # Required, max 200 chars
} | ConvertTo-Json

Write-Host "Request Body:" -ForegroundColor Gray
Write-Host $body -ForegroundColor Gray
Write-Host ""

Write-Host "Sending request..." -ForegroundColor Yellow

try {
    $response = Invoke-WebRequest -Uri "$baseUrl/bills" -Method POST -Headers $headers -Body $body -ErrorAction Stop
    
    Write-Host ""
    Write-Host "SUCCESS!" -ForegroundColor Green
    Write-Host "Status Code: $($response.StatusCode)" -ForegroundColor Green
    Write-Host ""
    Write-Host "Response:" -ForegroundColor Cyan
    $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 10
    
} catch {
    Write-Host ""
    Write-Host "ERROR!" -ForegroundColor Red
    Write-Host "Status Code: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        $reader.Close()
        
        Write-Host ""
        Write-Host "Error Response Body:" -ForegroundColor Red
        Write-Host $responseBody -ForegroundColor Red
        
        try {
            $errorJson = $responseBody | ConvertFrom-Json
            Write-Host ""
            Write-Host "Parsed Error:" -ForegroundColor Red
            $errorJson | ConvertTo-Json -Depth 10
        } catch {
            # Already displayed raw response
        }
        
        # Provide specific guidance based on status code
        if ($statusCode -eq 422) {
            Write-Host ""
            Write-Host "422 Unprocessable Entity - The request data is invalid:" -ForegroundColor Yellow
            Write-Host "- Check that collection ID exists in your account" -ForegroundColor Yellow
            Write-Host "- Verify the amount format is correct (in sen/cents)" -ForegroundColor Yellow
            Write-Host "- Ensure all required fields are provided" -ForegroundColor Yellow
        } elseif ($statusCode -eq 401) {
            Write-Host ""
            Write-Host "401 Unauthorized - Authentication failed:" -ForegroundColor Yellow
            Write-Host "- Verify your API key is correct" -ForegroundColor Yellow
            Write-Host "- Check API key permissions" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "1. Verify your API key is correct in Billplz dashboard" -ForegroundColor Yellow
    Write-Host "2. Ensure you are using sandbox API key for sandbox environment" -ForegroundColor Yellow
    Write-Host "3. Check that collection ID $collectionId exists in your account" -ForegroundColor Yellow
    Write-Host "4. Verify API key has permission to create bills" -ForegroundColor Yellow
}

Write-Host ""
