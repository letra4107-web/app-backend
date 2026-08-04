@echo off
echo 🧪 Testing Speech Recognition Endpoint
echo =====================================

REM Check if backend is running
echo 📡 Checking if backend is running on port 5002...
curl -s https://app-backend-production-f32c.up.railway.app/health >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Backend is running
) else (
    echo ❌ Backend is not running. Please start it with: npm start
    exit /b 1
)

echo.
echo 🎤 Testing speech recognition endpoint...

REM Create a simple test audio file (beep sound) for testing
echo 📁 Creating test audio file...
ffmpeg -f lavfi -i "sine=frequency=1000:duration=1" -acodec pcm_s16le -ar 16000 test_audio.wav 2>nul

if exist "test_audio.wav" (
    echo ✅ Test audio file created

    REM Test the endpoint
    echo 🔍 Testing /api/speech/recognize endpoint...
    curl -s -X POST ^
        -F "audio=@test_audio.wav" ^
        -F "language=tl" ^
        https://app-backend-production-f32c.up.railway.app/api/speech/transcribe

    REM Clean up
    del test_audio.wav
    echo 🧹 Cleaned up test file
) else (
    echo ❌ Failed to create test audio file. Please install ffmpeg.
)

echo.
echo ✨ Test completed!
pause
