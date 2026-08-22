import '../core/format.dart';

/// Immutable view of the backend's `video` object
/// (response of `POST /api/download`).
class TikTokVideo {
  const TikTokVideo({
    required this.downloadUrl,
    this.sourceUrl,
    this.videoId,
    this.title,
    this.coverUrl,
    this.durationSeconds,
    this.sizeBytes,
    this.authorUsername,
    this.authorNickname,
    this.musicTitle,
    this.quality = 'SD',
    this.hdAvailable = false,
  });

  /// Direct watermark-free MP4 link (served by the scraper CDN).
  final String downloadUrl;

  final String? sourceUrl;
  final String? videoId;
  final String? title;
  final String? coverUrl;
  final int? durationSeconds;
  final int? sizeBytes;
  final String? authorUsername;
  final String? authorNickname;
  final String? musicTitle;
  final String quality;
  final bool hdAvailable;

  factory TikTokVideo.fromJson(Map<String, dynamic> json) {
    return TikTokVideo(
      downloadUrl: (json['downloadUrl'] ?? '').toString(),
      sourceUrl: json['sourceUrl'] as String?,
      videoId: json['videoId'] as String?,
      title: json['title'] as String?,
      coverUrl: json['coverUrl'] as String?,
      durationSeconds: (json['durationSeconds'] as num?)?.toInt(),
      sizeBytes: (json['sizeBytes'] as num?)?.toInt(),
      authorUsername: json['authorUsername'] as String?,
      authorNickname: json['authorNickname'] as String?,
      musicTitle: json['musicTitle'] as String?,
      quality: (json['quality'] as String?) ?? 'SD',
      hdAvailable: json['hdAvailable'] as bool? ?? false,
    );
  }

  String get authorDisplay {
    if (authorNickname != null && authorNickname!.isNotEmpty) {
      return authorNickname!;
    }
    if (authorUsername != null && authorUsername!.isNotEmpty) {
      return '@$authorUsername';
    }
    return 'Unknown creator';
  }

  String? get durationLabel =>
      (durationSeconds != null && durationSeconds! > 0)
          ? formatDuration(durationSeconds!)
          : null;

  String? get sizeLabel =>
      (sizeBytes != null && sizeBytes! > 0) ? formatBytes(sizeBytes!) : null;
}
