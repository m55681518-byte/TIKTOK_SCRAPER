import 'package:flutter/material.dart';

import 'core/app_colors.dart';
import 'screens/home_screen.dart';

/// Root widget: Material app, dark TikTok-inspired theme and routing.
///
/// Routing: TikGrab is a single-screen app, so `home:` is the only route.
/// If more screens are added later, switch to `routes:` / `onGenerateRoute`
/// here — everything else (services, state) is already decoupled from routing.
class TikGrabApp extends StatelessWidget {
  const TikGrabApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'TikGrab',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: AppColors.background,
        colorScheme: const ColorScheme.dark(
          primary: AppColors.primary,
          secondary: AppColors.accent,
          surface: AppColors.surface,
          error: AppColors.error,
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: AppColors.background,
          elevation: 0,
          centerTitle: true,
        ),
        snackBarTheme: const SnackBarThemeData(
          behavior: SnackBarBehavior.floating,
          backgroundColor: AppColors.surfaceLight,
          contentTextStyle: TextStyle(color: AppColors.textPrimary),
        ),
      ),
      home: const HomeScreen(),
    );
  }
}
