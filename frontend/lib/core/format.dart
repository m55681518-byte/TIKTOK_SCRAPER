/// Human-readable formatting helpers shared across the app.

/// `1536` → `1.5 MB`
String formatBytes(int bytes) {
  if (bytes <= 0) return '0 KB';
  const int kb = 1024;
  const int mb = kb * 1024;
  const int gb = mb * 1024;
  if (bytes >= gb) return '${(bytes / gb).toStringAsFixed(2)} GB';
  if (bytes >= mb) return '${(bytes / mb).toStringAsFixed(1)} MB';
  return '${(bytes / kb).toStringAsFixed(0)} KB';
}

/// `74` → `1:14`
String formatDuration(int totalSeconds) {
  final minutes = totalSeconds ~/ 60;
  final seconds = totalSeconds % 60;
  return '$minutes:${seconds.toString().padLeft(2, '0')}';
}
