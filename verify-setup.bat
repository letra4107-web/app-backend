@echo off
REM Firebase Setup Verification for Windows
REM Run this to verify your Firebase configuration

echo.
echo 🔍 Verifying Firebase Setup...
echo.

REM Check 1: Firebase CLI installed
echo ✓ Check 1: Firebase CLI Installation
firebase --version >nul 2>&1
if %errorlevel% equ 0 (
  echo.  ✅ Firebase CLI is installed
  firebase --version
) else (
  echo.  ❌ Firebase CLI not found
  echo.  Run: npm install -g firebase-tools
  pause
  exit /b 1
)

echo.

REM Check 2: Firestore rules file
echo ✓ Check 2: Firestore Rules File
if exist "firestore.rules" (
  echo.  ✅ firestore.rules file exists
  for %%A in (firestore.rules) do echo.  📄 File size: %%~zA bytes
) else (
  echo.  ❌ firestore.rules file not found
  pause
  exit /b 1
)

echo.

REM Check 3: Rules syntax validation
echo ✓ Check 3: Firestore Rules Syntax
findstr /m "allow read, write" firestore.rules >nul
if %errorlevel% equ 0 (
  echo.  ✅ Rules appear valid
) else (
  echo.  ⚠️  Rules might not be properly formatted
)

echo.

REM Check 4: Collection path check
echo ✓ Check 4: Collection Path (/users/{userId})
findstr /m "match /users" firestore.rules >nul
if %errorlevel% equ 0 (
  echo.  ✅ Rules use correct /users pattern
) else (
  echo.  ⚠️  Rules might use different path
)

echo.

REM Check 5: Firebase JSON
echo ✓ Check 5: Firebase Configuration
if exist "firebase.json" (
  echo.  ✅ firebase.json exists
) else (
  echo.  ℹ️  firebase.json will be created on first deploy
)

echo.

REM Check 6: Current directory
echo ✓ Check 6: Current Directory
cd /d "%cd%"
echo.  📁 Working directory: %cd%
echo.  ✅ Make sure this is your LinawLm project folder

echo.
echo ✅ Verification Complete!
echo.
echo 📋 Next Steps:
echo.
echo 1. Run: firebase deploy --only firestore:rules
echo 2. Wait for: ✔ Deploy complete!
echo 3. Verify: firebase describe firestore:rules
echo 4. Test signup in app
echo.
pause
