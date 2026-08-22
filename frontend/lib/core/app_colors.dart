import 'package:flutter/material.dart';

/// TikTok-inspired palette used across the app.
class AppColors {
  AppColors._();

  static const Color background = Color(0xFF0B0B10);
  static const Color surface = Color(0xFF14141C);
  static const Color surfaceLight = Color(0xFF1E1E28);

  /// TikTok pink/red — primary actions.
  static const Color primary = Color(0xFFFE2C55);

  /// TikTok cyan — progress & highlights.
  static const Color accent = Color(0xFF25F4EE);

  static const Color textPrimary = Color(0xFFF5F5F7);
  static const Color textSecondary = Color(0xFF9A9AA8);

  static const Color success = Color(0xFF34C77B);
  static const Color error = Color(0xFFFF5A6A);

  // Pre-computed translucent variants (avoids deprecated `withOpacity`).
  static const Color successSoft = Color(0x1F34C77B);
  static const Color successBorder = Color(0x6634C77B);
  static const Color errorSoft = Color(0x1FFF5A6A);
  static const Color errorBorder = Color(0x66FF5A6A);
  static const Color hairline = Color(0x1AFFFFFF);
  static const Color primaryGlow = Color(0x59FE2C55);
}
