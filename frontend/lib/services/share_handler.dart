import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';

import '../core/tiktok_url_parser.dart';

/// Bridges the native OS share sheet into Flutter.
///
/// This is what makes TikGrab appear in TikTok's "Share" menu and auto-start
/// a download the moment a link arrives — both when the app is already in
/// memory (warm) and when it was closed (cold start).
///
/// ═══════════════════════════════════════════════════════════════════════════
/// NATIVE SETUP REQUIRED — the Dart side alone is not enough.
/// ═══════════════════════════════════════════════════════════════════════════
///
/// ── ANDROID ── android/app/src/main/AndroidManifest.xml ────────────────────
///
/// Register an ACTION_SEND intent filter on MainActivity so Android lists
/// TikGrab in the share sheet for shared text (TikTok shares the link as
/// text/plain). A ready-to-use manifest lives in
/// `frontend/native_setup/android/AndroidManifest.xml`. The essential part:
///
/// ```xml
/// <activity
///     android:name=".MainActivity"
///     android:exported="true"
///     android:launchMode="singleTask"   <!-- reuse the activity, don't stack -->
///     ...>
///
///     <!-- ══ Share-sheet integration ══ -->
///     <intent-filter>
///         <action android:name="android.intent.action.SEND" />
///         <category android:name="android.intent.category.DEFAULT" />
///         <data android:mimeType="text/plain" />
///     </intent-filter>
///
///     <!-- ══ Optional: also open tiktok.com links directly ══ -->
///     <intent-filter android:autoVerify="true">
///         <action android:name="android.intent.action.VIEW" />
///         <category android:name="android.intent.category.DEFAULT" />
///         <category android:name="android.intent.category.BROWSABLE" />
///         <data android:scheme="https" android:host="tiktok.com" />
///         <data android:scheme="https" android:host="www.tiktok.com" />
///         <data android:scheme="https" android:host="m.tiktok.com" />
///         <data android:scheme="https" android:host="vm.tiktok.com" />
///         <data android:scheme="https" android:host="vt.tiktok.com" />
///     </intent-filter>
/// </activity>
/// ```
///
/// Storage permissions (saving to the gallery):
///   • Android 10+ (API 29+): gallery_saver_plus writes through MediaStore —
///     NO permission is required, nothing to declare.
///   • Android ≤ 9: declare WRITE_EXTERNAL_STORAGE (capped with
///     `android:maxSdkVersion="28"`); permission_handler requests it at
///     runtime inside [DownloadService.saveToGallery].
///
/// ── iOS ── share extension + Runner Info.plist ─────────────────────────────
///
/// iOS requires a separate Share Extension target. Full paste-ready files are
/// in `frontend/native_setup/ios/`. Checklist:
///
///   1. Xcode → File → New → Target → "Share Extension" (name it e.g.
///      "Share Extension"). Same minimum deployment target as Runner.
///   2. Enable Swift Package Manager once:
///        flutter config --enable-swift-package-manager
///      then link the `receive-sharing-intent` library to the Share Extension
///      target (General → Frameworks and Libraries → +).
///   3. Replace the generated ShareViewController.swift with the file from
///      native_setup/ios/ShareViewController.swift (it subclasses the
///      plugin's RSIShareViewController and auto-redirects into TikGrab).
///   4. Replace the extension's Info.plist with
///      native_setup/ios/share_extension_Info.plist — the important keys:
///        AppGroupId = $(CUSTOM_GROUP_ID)
///        NSExtensionActivationRule → NSExtensionActivationSupportsText = true
///                                 NSExtensionActivationSupportsWebURLWithMaxCount = 1
///        NSExtensionPointIdentifier = com.apple.share-services
///   5. In the MAIN app (ios/Runner/Info.plist) add:
///        <key>AppGroupId</key>
///        <string>$(CUSTOM_GROUP_ID)</string>
///        <key>CFBundleURLTypes</key>
///        <array>
///          <dict>
///            <key>CFBundleTypeRole</key><string>Editor</string>
///            <key>CFBundleURLSchemes</key>
///            <array><string>ShareMedia-$(PRODUCT_BUNDLE_IDENTIFIER)</string></array>
///          </dict>
///        </array>
///        <!-- gallery saving (photos) -->
///        <key>NSPhotoLibraryUsageDescription</key>
///        <string>TikGrab saves downloaded videos to your Photos library.</string>
///        <key>NSPhotoLibraryAddUsageDescription</key>
///        <string>TikGrab saves downloaded videos to your Photos library.</string>
///   6. Signing & Capabilities → add "App Groups" to BOTH targets with the
///      same container (e.g. group.com.yourcompany.tikgrab), and add a
///      user-defined build setting CUSTOM_GROUP_ID = that group id to BOTH.
///   7. Runner target → Build Phases → move "Embed Foundation Extension"
///      ABOVE "Thin Binary".
/// ═══════════════════════════════════════════════════════════════════════════
class ShareHandler {
  ShareHandler({required this.onTikTokLink});

  /// Called with a cleaned TikTok URL whenever a share arrives.
  /// Always invoked on the UI isolate — safe to call setState from it.
  final void Function(String url) onTikTokLink;

  StreamSubscription<List<SharedMediaFile>>? _subscription;
  String? _lastHandledUrl;
  bool _initialised = false;

  /// Starts listening. Call once from `initState()`.
  Future<void> init() async {
    if (_initialised) return;
    _initialised = true;

    // 1) App already in memory (warm start): live stream of incoming shares.
    _subscription = ReceiveSharingIntent.instance.getMediaStream().listen(
      _handleSharedMedia,
      onError: (Object error) {
        debugPrint('ShareHandler stream error: $error');
      },
    );

    // 2) App was closed (cold start): read the intent that launched us.
    try {
      final initial = await ReceiveSharingIntent.instance.getInitialMedia();
      _handleSharedMedia(initial);
      // Tell the plugin the launch intent was consumed so it is not
      // re-delivered on the next hot restart.
      ReceiveSharingIntent.instance.reset();
    } catch (error) {
      debugPrint('ShareHandler initial-media error: $error');
    }
  }

  void _handleSharedMedia(List<SharedMediaFile> media) {
    for (final item in media) {
      // For text/URL shares `content` is the shared text; for media shares it
      // is a local file path — TikUrlParser simply won't match those, which
      // is exactly what we want (we only accept TikTok links).
      final url = TikUrlParser.extract(item.content);
      if (url != null && url != _lastHandledUrl) {
        _lastHandledUrl = url;
        onTikTokLink(url);
        return; // one video per share
      }
    }
  }

  /// Stops listening. Call from `dispose()`.
  void dispose() {
    _subscription?.cancel();
    _subscription = null;
    _initialised = false;
  }
}
