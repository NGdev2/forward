#!/usr/bin/env bash
# Frame-rate benchmark on a USB-connected Android phone (debug build).
#   scripts/device/bench.sh            build + install + measure
#   scripts/device/bench.sh nobuild    measure the installed build
#   MODES=balanced scripts/device/bench.sh
# Needs: USB debugging on, Node 22 (nvm), JDK 21+, Android SDK.
set -e
cd "$(dirname "$0")/../.."
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 22 >/dev/null
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/jdk-22}" ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT=$ANDROID_HOME
ADB=$ANDROID_HOME/platform-tools/adb
if [ "${1:-}" != "nobuild" ]; then
  npm run android:debug 2>&1 | grep -E "BUILD|error" || true
  $ADB install -r android/app/build/outputs/apk/debug/app-debug.apk | tail -1
fi
$ADB shell am force-stop com.aidar.forward
$ADB shell monkey -p com.aidar.forward -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
PID=""
for _ in $(seq 1 40); do
  PID=$($ADB shell pidof com.aidar.forward || true)
  [ -n "$PID" ] && $ADB shell cat /proc/net/unix | grep -q "webview_devtools_remote_$PID" && break
  read -t 0.25 < /dev/zero 2>/dev/null || true
done
$ADB forward --remove-all
$ADB forward tcp:9333 "localabstract:webview_devtools_remote_$PID" >/dev/null
node scripts/device/bench.cjs
