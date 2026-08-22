/// Central place for compile-time configuration.
///
/// The backend base URL is injected at build time so the same code works on
/// emulators, physical devices and production without any code change:
///
/// ```sh
/// # Android emulator → host machine loopback (the default)
/// flutter run
///
/// # Physical device → your dev machine's LAN IP
/// flutter run --dart-define=BACKEND_URL=http://192.168.1.20:3000
///
/// # Production build → your deployed HTTPS backend
/// flutter build appbundle --dart-define=BACKEND_URL=https://api.your-domain.com
/// ```
class AppConfig {
  AppConfig._();

  static const String appName = 'TikGrab';

  /// Base URL of the Express backend (no trailing slash).
  ///
  /// `10.0.2.2` is the Android emulator's alias for the host loopback.
  /// The iOS Simulator can use `http://localhost:3000` instead.
  static const String backendBaseUrl = String.fromEnvironment(
    'BACKEND_URL',
    defaultValue: 'http://10.0.2.2:3000',
  );

  /// Album the saved videos appear under inside the device gallery.
  static const String galleryAlbumName = 'TikGrab';
}
