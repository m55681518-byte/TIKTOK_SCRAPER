import 'dart:io';

import 'package:dio/dio.dart';
import 'package:gallery_saver_plus/gallery_saver.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';

import '../core/app_config.dart';

/// Thrown when the user cancels an in-flight download.
class DownloadCancelledException implements Exception {
  const DownloadCancelledException();

  @override
  String toString() => 'Download cancelled';
}

/// A fully downloaded MP4 sitting in the app's temporary directory,
/// ready to be pushed into the gallery.
class DownloadedFile {
  const DownloadedFile({
    required this.path,
    required this.fileName,
    required this.sizeBytes,
  });

  final String path;
  final String fileName;
  final int sizeBytes;
}

/// Downloads the MP4 from the CDN with live progress, then saves it into the
/// device gallery (iOS Photos / Android MediaStore).
class DownloadService {
  DownloadService({Dio? dio})
      : _dio = dio ??
            Dio(
              BaseOptions(
                // Some TikTok videos are large; give the stream plenty of room.
                receiveTimeout: const Duration(minutes: 10),
                sendTimeout: const Duration(minutes: 2),
              ),
            );

  final Dio _dio;
  CancelToken? _cancelToken;

  /// Streams [url] into the app sandbox while reporting 0..1 progress.
  ///
  /// We deliberately download to a temp file first (instead of letting the
  /// gallery plugin fetch the network URL itself) because only Dio gives us
  /// the per-chunk progress events the UI's progress bar needs.
  Future<DownloadedFile> downloadVideo({
    required String url,
    String? title,
    void Function(double progress, int receivedBytes, int totalBytes)?
        onProgress,
  }) async {
    _cancelToken = CancelToken();

    final tempDir = await getTemporaryDirectory();
    final fileName = buildFileName(title);
    final filePath = p.join(tempDir.path, fileName);

    try {
      await _dio.download(
        url,
        filePath,
        cancelToken: _cancelToken,
        options: Options(headers: <String, String>{'User-Agent': _userAgent}),
        onReceiveProgress: (received, total) {
          if (total > 0) {
            final progress = (received / total).clamp(0.0, 1.0).toDouble();
            onProgress?.call(progress, received, total);
          }
        },
      );
    } on DioException catch (e) {
      _deleteQuietly(filePath);
      if (CancelToken.isCancel(e)) throw const DownloadCancelledException();
      throw StateError(
        'Video download failed: ${e.message ?? 'network error'}',
      );
    }

    final size = await File(filePath).length();
    return DownloadedFile(path: filePath, fileName: fileName, sizeBytes: size);
  }

  /// Adds the MP4 to the device gallery, under the "TikGrab" album.
  ///
  /// Returns true on success. Permissions:
  ///   • iOS — Photos handles add-only authorization automatically
  ///     (requires NSPhotoLibraryAddUsageDescription in Info.plist).
  ///   • Android 10+ — MediaStore insert, no permission needed.
  ///   • Android ≤ 9 — legacy WRITE_EXTERNAL_STORAGE, requested here.
  Future<bool> saveToGallery(String filePath) async {
    if (Platform.isAndroid) {
      try {
        // On modern Android this resolves instantly without showing any UI.
        await Permission.storage.request();
      } catch (_) {
        // Fall through — saving may still succeed via MediaStore.
      }
    }

    try {
      final saved = await GallerySaver.saveVideo(
        filePath,
        albumName: AppConfig.galleryAlbumName,
      );
      return saved ?? false;
    } catch (_) {
      return false;
    }
  }

  /// Removes the temp copy once it has been imported into the gallery.
  void cleanup(String filePath) => _deleteQuietly(filePath);

  /// Cancels the in-flight download (no-op if none).
  void cancel() => _cancelToken?.cancel('cancelled by user');

  void _deleteQuietly(String path) {
    try {
      final file = File(path);
      if (file.existsSync()) file.deleteSync();
    } catch (_) {
      // Best effort — temp files are purged by the OS eventually anyway.
    }
  }

  /// Builds a filesystem-safe, emoji/hashtag-free name from the caption,
  /// e.g. `funny_cat_moment_1737466200000.mp4`.
  static String buildFileName(String? title) {
    var base = (title ?? '')
        .replaceAll(RegExp(r'#\S+'), ' ') // drop hashtags
        .replaceAll(
          RegExp(r'[^\p{L}\p{N}\s\-]+', unicode: true),
          ' ',
        ) // drop emoji & punctuation, keep unicode letters
        .trim()
        .replaceAll(RegExp(r'\s+'), '_');
    if (base.length > 48) base = base.substring(0, 48);
    if (base.isEmpty) base = 'tiktok_video';
    final stamp = DateTime.now().millisecondsSinceEpoch;
    return '${base}_$stamp.mp4';
  }

  static const String _userAgent =
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/126.0 Mobile Safari/537.36 TikGrab/1.0';
}
