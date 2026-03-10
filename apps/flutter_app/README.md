# Hudle Streaming — Flutter App

Same features as the React frontend: **upload videos** and **play HLS streams** with adaptive quality switching.

## Setup

### 1. Install Flutter

```bash
brew install --cask flutter
flutter doctor   # follow any outstanding steps
```

### 2. Scaffold the project (run once)

```bash
cd apps/flutter_app
flutter create . --project-name hudle_streaming --org com.hudle
```

This generates Android/iOS platform code. The `lib/` files and `pubspec.yaml` already exist and will be kept.

### 3. Install dependencies

```bash
flutter pub get
```

### 4. Android — internet permission

In `android/app/src/main/AndroidManifest.xml`, make sure these are inside `<manifest>`:

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"/>
```

And inside `<application>` add (for HTTP access to localhost):

```xml
android:usesCleartextTraffic="true"
```

### 5. iOS — HTTP + file access

In `ios/Runner/Info.plist` add:

```xml
<!-- Allow HTTP to local dev backend -->
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoads</key>
    <true/>
</dict>

<!-- Allow video file picking from Photos -->
<key>NSPhotoLibraryUsageDescription</key>
<string>Required to pick videos for upload</string>
```

### 6. Backend URL

Edit [`lib/services/api_service.dart`](lib/services/api_service.dart):

| Target | URL |
|---|---|
| Android emulator | `http://10.0.2.2:3000` (default) |
| iOS simulator | `http://localhost:3000` |
| Physical device | `http://<your-LAN-IP>:3000` |

### 7. Run

```bash
# Android emulator / iOS simulator
flutter run

# Release build
flutter build apk --release        # Android
flutter build ios --release        # iOS
```

## Architecture

```
lib/
  main.dart                  # app entry, bottom nav (Upload / Play)
  services/
    api_service.dart         # POST /videos/upload-url, PUT S3, GET /videos/:id
  pages/
    upload_page.dart         # file picker → presigned PUT → show videoId
    player_page.dart         # videoId input → HLS proxy URL → chewie player
```

## Notes

- HLS is played natively: **ExoPlayer** on Android, **AVPlayer** on iOS — both support adaptive bitrate automatically
- `chewie` provides the player UI (fullscreen, seek bar, volume)
- Upload uses `dio` for progress tracking; playback data flows through the NestJS HLS proxy (private S3 bucket)
