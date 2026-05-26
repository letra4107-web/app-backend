@echo off
set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot"
set "ANDROID_SDK_ROOT=C:\Users\Samantha\AppData\Local\Android\Sdk"
set "NDK_VERSION=%~1"
if "%NDK_VERSION%"=="" set "NDK_VERSION=27.1.12297006"
cd /d "%ANDROID_SDK_ROOT%\cmdline-tools\latest\bin"
echo y | sdkmanager.bat --install "ndk;%NDK_VERSION%" --sdk_root="%ANDROID_SDK_ROOT%"
exit /b %ERRORLEVEL%
