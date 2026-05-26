@echo off
REM Quick test script for backend endpoints - Windows version

set BASE_URL=%1
if "%BASE_URL%"=="" set BASE_URL=http://localhost:5002

echo Testing backend at: %BASE_URL%
echo.

echo 1. Testing /health endpoint...
curl -s "%BASE_URL%/health" || echo Health check failed
echo.

echo 2. Testing /api/auth/send-email-otp endpoint...
curl -s -X POST "%BASE_URL%/api/auth/send-email-otp" ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"test@example.com\"}" || echo Send OTP failed
echo.

echo Testing complete!
