import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app.dart';

/// App entry point.
///
/// TikGrab has a single-screen flow driven by incoming share intents:
///
///   TikTok → Share → TikGrab  ──►  HomeScreen auto-starts the download
///   (or the user pastes a link manually)
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // A downloader app is a portrait experience.
  await SystemChrome.setPreferredOrientations(<DeviceOrientation>[
    DeviceOrientation.portraitUp,
  ]);

  runApp(const TikGrabApp());
}
