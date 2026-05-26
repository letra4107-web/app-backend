@echo off
cd /d "%~dp0.."
set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot"
set "ANDROID_SDK_ROOT=C:\Users\Samantha\AppData\Local\Android\Sdk"
call npm run android:verify-env || exit /b %ERRORLEVEL%
call npx expo prebuild --no-install --platform android || exit /b %ERRORLEVEL%
cd android
call gradlew.bat clean assembleRelease --no-daemon --stacktrace
exit /b %ERRORLEVEL%
