@echo off
set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot"
set "ANDROID_SDK_ROOT=C:\Users\Samantha\AppData\Local\Android\Sdk"
cd /d "%ANDROID_SDK_ROOT%\cmdline-tools\latest\bin"
sdkmanager.bat --list | findstr ndk
exit /b 0
