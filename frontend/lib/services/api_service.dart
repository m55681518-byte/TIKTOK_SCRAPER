import 'package:dio/dio.dart';

import '../core/app_config.dart';
import '../models/tiktok_video.dart';

/// Error with a user-presentable message, thrown by [ApiService].
class ApiException implements Exception {
  ApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

/// Talks to our own Express backend (`POST /api/download`).
///
/// The RapidAPI key is NEVER referenced here — it stays on the server.
/// The app only knows the backend base URL (injected via --dart-define).
class ApiService {
  ApiService({String? baseUrl})
      : _dio = Dio(
          BaseOptions(
            baseUrl: baseUrl ?? AppConfig.backendBaseUrl,
            connectTimeout: const Duration(seconds: 15),
            receiveTimeout: const Duration(seconds: 60),
            headers: <String, String>{
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
          ),
        );

  final Dio _dio;

  /// Sends a TikTok URL to the backend and returns the resolved video,
  /// including the direct watermark-free MP4 link ([TikTokVideo.downloadUrl]).
  Future<TikTokVideo> resolveVideo(String tiktokUrl) async {
    try {
      final response = await _dio.post(
        '/api/download',
        data: <String, dynamic>{'url': tiktokUrl},
      );

      final body = response.data;
      if (body is Map<String, dynamic> &&
          body['success'] == true &&
          body['video'] is Map<String, dynamic>) {
        final video =
            TikTokVideo.fromJson(body['video'] as Map<String, dynamic>);
        if (video.downloadUrl.isEmpty) {
          throw ApiException(
            'The backend did not return a downloadable video link.',
          );
        }
        return video;
      }
      throw ApiException('Backend returned an unexpected response.');
    } on DioException catch (e) {
      throw _mapDioException(e);
    }
  }

  /// Translates transport/HTTP failures into friendly, displayable messages.
  ApiException _mapDioException(DioException e) {
    final response = e.response;

    if (response != null) {
      // Server-side errors carry { success:false, error:{ code, message } }.
      String? serverMessage;
      final data = response.data;
      if (data is Map) {
        final error = data['error'];
        if (error is Map && error['message'] is String) {
          serverMessage = error['message'] as String;
        }
      }

      switch (response.statusCode) {
        case 400:
          return ApiException(
            serverMessage ??
                'That doesn\'t look like a valid TikTok video link.',
            statusCode: 400,
          );
        case 422:
          return ApiException(
            serverMessage ??
                'This video can\'t be downloaded (it may be private or deleted).',
            statusCode: 422,
          );
        case 429:
          return ApiException(
            'Whoa, slow down — too many requests. Wait a moment and try again.',
            statusCode: 429,
          );
        case 502:
        case 504:
          return ApiException(
            serverMessage ??
                'The scraper service is unavailable right now. Try again shortly.',
            statusCode: response.statusCode,
          );
        default:
          return ApiException(
            serverMessage ?? 'Backend error (HTTP ${response.statusCode}).',
            statusCode: response.statusCode,
          );
      }
    }

    if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.sendTimeout ||
        e.type == DioExceptionType.receiveTimeout) {
      return ApiException(
        'Timed out talking to the backend. Is it running?',
      );
    }
    return ApiException(
      'Could not reach the backend. Check your connection and BACKEND_URL.',
    );
  }
}
