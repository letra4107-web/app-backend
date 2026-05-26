@echo off
REM LinawLetra Production Deployment Script for Windows

setlocal enabledelayedexpansion

echo.
echo ╔════════════════════════════════════════════════════════════════╗
echo ║        LinawLetra Backend Deployment to Production             ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.

REM Check if backend directory exists
if not exist "backend" (
    echo ❌ backend directory not found. Please run from project root.
    exit /b 1
)

cd backend

echo ✓ Step 1: Checking dependencies...
if not exist "node_modules" (
    echo Installing npm packages...
    call npm install
)

echo ✓ Step 2: Checking environment variables...
if not exist ".env" (
    echo ⚠️  .env file not found. Creating from .env.example...
    copy .env.example .env
    echo Please edit .env with your Firebase and email credentials
    exit /b 1
)

echo ✓ Step 3: Backend ready for deployment
echo.
echo Choose your deployment platform:
echo 1) Firebase Functions + Hosting (Recommended if using Firebase)
echo 2) Render.com (Free, easy to deploy)
echo 3) Railway (Free, integrated with GitHub)
echo 4) Fly.io (Free, fast deployment)
echo.
echo 📋 Firebase Deployment Steps:
echo 1. Install Firebase CLI: npm install -g firebase-tools
echo 2. Login: firebase login
echo 3. Initialize: firebase init hosting
echo 4. Deploy: firebase deploy
echo.
echo After deployment, update your .env files with the Firebase URL.
echo.

endlocal
