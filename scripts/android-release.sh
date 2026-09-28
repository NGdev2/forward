#!/usr/bin/env bash
# Builds a signed Android App Bundle for Google Play.
#
#   1. First time only: create an upload keystore (KEEP IT SAFE — losing it
#      means you can never update the app on Play):
#        ./scripts/android-release.sh keystore
#      It writes android/keystore/upload.jks and android/keystore.properties
#      (both gitignored). Store copies of both somewhere safe.
#   2. Build the bundle:
#        ./scripts/android-release.sh bundle
#      Output: android/app/build/outputs/bundle/release/app-release.aab
#
# Env: JAVA_HOME (JDK 17) and ANDROID_HOME are auto-detected if unset.
set -euo pipefail
cd "$(dirname "$0")/.."

export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

KS_DIR=android/keystore
KS=$KS_DIR/upload.jks
PROPS=android/keystore.properties

# Refuses to build a release that would ship test ads, placeholder ids or no
# AdMob app id (the app would crash on launch without one).
check_ads() {
  local env=.env.production.local admob=android/admob.properties test=ca-app-pub-3940256099942544 fake=ca-app-pub-0000000000000000
  [ -f "$env" ] || { echo "Missing $env — copy .env.example and fill in the real ad unit ids."; exit 1; }
  [ -f "$admob" ] || { echo "Missing $admob — copy android/admob.properties.example and fill in the AdMob app id."; exit 1; }
  grep -q '^VITE_ADS_MODE=live' "$env" || { echo "$env must set VITE_ADS_MODE=live for a release."; exit 1; }
  for key in VITE_ADMOB_REWARDED_DOUBLE VITE_ADMOB_REWARDED_REVIVE VITE_ADMOB_REWARDED_GEMS; do
    local v; v=$(grep "^$key=" "$env" | cut -d= -f2-)
    [[ "$v" == ca-app-pub-*/* ]] || { echo "$key is missing or not an ad unit id (ca-app-pub-…/…)."; exit 1; }
    [[ "$v" == $test* || "$v" == $fake* ]] && { echo "$key is still a test/placeholder id."; exit 1; }
  done
  local app; app=$(grep '^appId=' "$admob" | cut -d= -f2-)
  [[ "$app" == ca-app-pub-*~* ]] || { echo "$admob appId must be an AdMob APP id (ca-app-pub-…~…)."; exit 1; }
  [[ "$app" == $test* || "$app" == $fake* ]] && { echo "$admob appId is still a test/placeholder id."; exit 1; }
  echo "Ads config OK (live ad units, real app id)."
}

case "${1:-bundle}" in
  keystore)
    mkdir -p "$KS_DIR"
    if [ -f "$KS" ]; then echo "Keystore already exists at $KS — refusing to overwrite."; exit 1; fi
    read -rsp "Choose a keystore password: " PASS; echo
    "$JAVA_HOME/bin/keytool" -genkeypair -v -keystore "$KS" -alias upload \
      -keyalg RSA -keysize 2048 -validity 10000 \
      -storepass "$PASS" -keypass "$PASS" \
      -dname "CN=Forward, OU=Games, O=NGdev, L=Unknown, ST=Unknown, C=US"
    printf 'storeFile=keystore/upload.jks\nstorePassword=%s\nkeyAlias=upload\nkeyPassword=%s\n' "$PASS" "$PASS" > "$PROPS"
    chmod 600 "$PROPS"
    echo "Wrote $KS and $PROPS. Back them up now."
    ;;
  bundle)
    [ -f "$PROPS" ] || { echo "No $PROPS — run: $0 keystore"; exit 1; }
    check_ads
    npm run build
    npx cap sync android
    ( cd android && ./gradlew bundleRelease )
    echo
    ls -la android/app/build/outputs/bundle/release/*.aab
    ;;
  apk)
    [ -f "$PROPS" ] || { echo "No $PROPS — run: $0 keystore"; exit 1; }
    check_ads
    npm run build
    npx cap sync android
    ( cd android && ./gradlew assembleRelease )
    ls -la android/app/build/outputs/apk/release/*.apk
    ;;
  *) echo "usage: $0 [keystore|bundle|apk]"; exit 1;;
esac
