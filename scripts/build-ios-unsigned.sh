#!/usr/bin/env bash
# Run from mobile/ after Expo prebuild and pod install, on a Mac with full Xcode.
# This creates an ARM64 device IPA without signing; it cannot install directly on iOS.
set -euo pipefail

mkdir -p build
xcodebuild \
  -workspace ios/Hearth.xcworkspace \
  -scheme Hearth \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath build/DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY='' \
  build 2>&1 | tee build/xcodebuild.log

APP_PATH='build/DerivedData/Build/Products/Release-iphoneos/Hearth.app'
test -d "$APP_PATH"
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist" | \
  /usr/bin/grep -Fx 'com.rithvikat.hearth'
test -s "$APP_PATH/main.jsbundle"
file "$APP_PATH/Hearth" | /usr/bin/grep 'arm64'
mkdir -p build/package/Payload
/usr/bin/ditto "$APP_PATH" build/package/Payload/Hearth.app
(
  cd build/package
  /usr/bin/zip -qry ../Hearth-unsigned.ipa Payload
)
/usr/bin/unzip -tq build/Hearth-unsigned.ipa
printf '%s\n' 'Created build/Hearth-unsigned.ipa — unsigned, requires signing before device installation.'
