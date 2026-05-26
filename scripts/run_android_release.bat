@echo off
cd /d "%~dp0.."
set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot"
set "ANDROID_SDK_ROOT=C:\Users\Samantha\AppData\Local\Android\Sdk"
npm run android:release
exit /b %ERRORLEVEL%
