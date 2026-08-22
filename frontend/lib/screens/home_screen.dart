import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/app_colors.dart';
import '../core/app_config.dart';
import '../core/format.dart';
import '../core/tiktok_url_parser.dart';
import '../models/tiktok_video.dart';
import '../services/api_service.dart';
import '../services/download_service.dart';
import '../services/share_handler.dart';

/// Lifecycle of a download, mirrored 1:1 by the UI.
enum DownloadPhase { idle, resolving, downloading, saving, done, error }

/// Single-screen UI:
///   • header + manual URL field with a paste button
///   • gradient download button
///   • live status card (resolving → progress bar 0–100% → saved / error)
///
/// When a link arrives through the native share sheet, [ShareHandler] fills
/// the field AND auto-starts the download (core user flow step 3).
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final TextEditingController _urlController = TextEditingController();
  final ApiService _api = ApiService();
  final DownloadService _downloader = DownloadService();
  late final ShareHandler _shareHandler;

  DownloadPhase _phase = DownloadPhase.idle;
  String _statusMessage = '';
  TikTokVideo? _video;
  DownloadedFile? _file;
  double _progress = 0;
  int _receivedBytes = 0;
  int _totalBytes = 0;
  bool _busy = false;

  static const TextStyle _secondaryStyle = TextStyle(
    color: AppColors.textSecondary,
    fontSize: 12.5,
    height: 1.4,
  );

  /* ───────────────────────── lifecycle ───────────────────────── */

  @override
  void initState() {
    super.initState();
    // Native share intents: TikTok → Share → TikGrab.
    _shareHandler = ShareHandler(onTikTokLink: _handleSharedLink);
    _shareHandler.init();
  }

  @override
  void dispose() {
    _shareHandler.dispose();
    _urlController.dispose();
    _downloader.cancel();
    super.dispose();
  }

  /* ───────────────────────── actions ───────────────────────── */

  /// Called by the share handler (cold or warm start) with a cleaned URL.
  void _handleSharedLink(String url) {
    if (!mounted) return;
    _urlController.text = url;
    // Core flow: sharing auto-starts the download — no extra tap needed.
    _startDownload(url);
  }

  Future<void> _pasteFromClipboard() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text?.trim() ?? '';
    if (text.isEmpty) {
      _snack('Clipboard is empty');
      return;
    }
    final url = TikUrlParser.extract(text) ?? text;
    setState(() => _urlController.text = url);
  }

  /// The full pipeline: resolve via backend → stream MP4 → save to gallery.
  Future<void> _startDownload([String? sharedUrl]) async {
    if (_busy) return;

    final raw = sharedUrl ?? _urlController.text;
    final url = TikUrlParser.extract(raw);
    if (url == null) {
      setState(() {
        _phase = DownloadPhase.error;
        _statusMessage = 'Please share or paste a valid TikTok video link, '
            'e.g. https://vm.tiktok.com/…';
      });
      return;
    }

    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _video = null;
      _file = null;
      _progress = 0;
      _receivedBytes = 0;
      _totalBytes = 0;
      _phase = DownloadPhase.resolving;
      _statusMessage = 'Resolving link…';
      _urlController.text = url;
    });

    try {
      // 1) Backend resolves the share link → watermark-free MP4 URL.
      final video = await _api.resolveVideo(url);
      if (!mounted) return;
      setState(() {
        _video = video;
        _phase = DownloadPhase.downloading;
        _statusMessage = 'Downloading…';
      });

      // 2) Stream the MP4 into the sandbox with live progress (0 → 100%).
      final file = await _downloader.downloadVideo(
        url: video.downloadUrl,
        title: video.title,
        onProgress: (progress, received, total) {
          if (!mounted) return;
          setState(() {
            _progress = progress;
            _receivedBytes = received;
            _totalBytes = total;
          });
        },
      );
      if (!mounted) return;
      setState(() {
        _file = file;
        _phase = DownloadPhase.saving;
        _statusMessage = 'Saving to your gallery…';
      });

      // 3) Import it into Photos / the Android gallery.
      final saved = await _downloader.saveToGallery(file.path);
      _downloader.cleanup(file.path);
      if (!mounted) return;

      if (!saved) {
        throw StateError(
          'The file downloaded, but couldn\'t be added to the gallery. '
          'Check photo/storage permissions in your system settings.',
        );
      }

      setState(() {
        _phase = DownloadPhase.done;
        _progress = 1;
        _busy = false;
        _statusMessage =
            'Saved to your gallery under the "${AppConfig.galleryAlbumName}" album.';
      });
    } on DownloadCancelledException {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _phase = DownloadPhase.idle;
        _statusMessage = '';
      });
      _snack('Download cancelled');
    } on ApiException catch (e) {
      _fail(e.message);
    } catch (e) {
      _fail('Something went wrong: $e');
    }
  }

  void _cancelDownload() {
    _downloader.cancel();
    setState(() {
      _busy = false;
      _phase = DownloadPhase.idle;
      _statusMessage = '';
      _video = null;
      _file = null;
      _progress = 0;
    });
  }

  void _reset() {
    setState(() {
      _phase = DownloadPhase.idle;
      _statusMessage = '';
      _video = null;
      _file = null;
      _progress = 0;
      _receivedBytes = 0;
      _totalBytes = 0;
      _urlController.clear();
    });
  }

  void _fail(String message) {
    if (!mounted) return;
    setState(() {
      _busy = false;
      _phase = DownloadPhase.error;
      _statusMessage = message;
    });
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  /* ───────────────────────── build ───────────────────────── */

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xFF14141F), AppColors.background],
            ),
          ),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 24, 20, 32),
                children: [
                  _buildHeader(),
                  const SizedBox(height: 28),
                  _buildInputCard(),
                  const SizedBox(height: 24),
                  if (_video != null) ...[
                    _buildVideoInfoCard(_video!),
                    const SizedBox(height: 16),
                  ],
                  _buildStatusSection(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Column(
      children: [
        Container(
          width: 64,
          height: 64,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            gradient: const LinearGradient(
              colors: [AppColors.primary, AppColors.accent],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            boxShadow: const [
              BoxShadow(
                color: AppColors.primaryGlow,
                blurRadius: 24,
                offset: Offset(0, 8),
              ),
            ],
          ),
          child: const Icon(
            Icons.music_note_rounded,
            color: Colors.white,
            size: 32,
          ),
        ),
        const SizedBox(height: 14),
        const Text.rich(
          TextSpan(
            style: TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.5,
              color: AppColors.textPrimary,
            ),
            children: [
              TextSpan(text: 'Tik'),
              TextSpan(
                text: 'Grab',
                style: TextStyle(color: AppColors.accent),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Share a TikTok video to this app — or paste its link — and it '
          'lands in your gallery, watermark-free.',
          textAlign: TextAlign.center,
          style: _secondaryStyle,
        ),
      ],
    );
  }

  Widget _buildInputCard() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.hairline),
      ),
      child: Column(
        children: [
          TextField(
            controller: _urlController,
            style: const TextStyle(fontSize: 14),
            keyboardType: TextInputType.url,
            textInputAction: TextInputAction.go,
            onSubmitted: (_) => _startDownload(),
            decoration: InputDecoration(
              hintText: 'Paste a TikTok link…',
              hintStyle: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 14,
              ),
              prefixIcon: const Icon(
                Icons.link_rounded,
                color: AppColors.textSecondary,
                size: 20,
              ),
              suffixIcon: IconButton(
                tooltip: 'Paste from clipboard',
                icon: const Icon(
                  Icons.content_paste_go_rounded,
                  color: AppColors.accent,
                  size: 20,
                ),
                onPressed: _pasteFromClipboard,
              ),
              filled: true,
              fillColor: AppColors.surfaceLight,
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(vertical: 12),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide.none,
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide.none,
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: const BorderSide(
                  color: AppColors.accent,
                  width: 1.2,
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton.icon(
              onPressed: _busy ? null : () => _startDownload(),
              icon: Icon(
                _busy
                    ? Icons.hourglass_top_rounded
                    : Icons.download_rounded,
                size: 20,
              ),
              label: Text(_busy ? 'Working…' : 'Download video'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                disabledBackgroundColor: AppColors.surfaceLight,
                disabledForegroundColor: AppColors.textSecondary,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
                textStyle: const TextStyle(
                  fontSize: 15.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildVideoInfoCard(TikTokVideo video) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.hairline),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
              width: 62,
              height: 88,
              child: video.coverUrl != null
                  ? Image.network(
                      video.coverUrl!,
                      fit: BoxFit.cover,
                      errorBuilder: (context, error, stack) =>
                          _coverPlaceholder(),
                    )
                  : _coverPlaceholder(),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  video.title ?? 'TikTok video',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                    height: 1.3,
                  ),
                ),
                const SizedBox(height: 4),
                Text(video.authorDisplay, style: _secondaryStyle),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    if (video.durationLabel != null)
                      _chip(Icons.timer_outlined, video.durationLabel!),
                    if (video.sizeLabel != null)
                      _chip(Icons.save_alt_rounded, video.sizeLabel!),
                    _chip(Icons.hd_rounded, video.quality),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _coverPlaceholder() {
    return Container(
      color: AppColors.surfaceLight,
      child: const Icon(
        Icons.movie_rounded,
        color: AppColors.textSecondary,
        size: 26,
      ),
    );
  }

  Widget _chip(IconData icon, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.surfaceLight,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: AppColors.textSecondary),
          const SizedBox(width: 4),
          Text(
            label,
            style: const TextStyle(
              fontSize: 11.5,
              color: AppColors.textSecondary,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  /* ───────────────────────── status section ───────────────────────── */

  Widget _buildStatusSection() {
    switch (_phase) {
      case DownloadPhase.idle:
        return _idleHint();
      case DownloadPhase.resolving:
        return _statusCard(
          child: Row(
            children: [
              const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  color: AppColors.accent,
                ),
              ),
              const SizedBox(width: 14),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Resolving link…',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Fetching the watermark-free MP4 link from the scraper API.',
                      style: _secondaryStyle,
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      case DownloadPhase.downloading:
        return _statusCard(child: _buildProgressView());
      case DownloadPhase.saving:
        return _statusCard(
          child: Row(
            children: [
              const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  color: AppColors.success,
                ),
              ),
              const SizedBox(width: 14),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Almost there…',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Adding the video to your Photos / Gallery.',
                      style: _secondaryStyle,
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      case DownloadPhase.done:
        return _doneCard();
      case DownloadPhase.error:
        return _errorCard();
    }
  }

  Widget _buildProgressView() {
    final percent = (_progress * 100).toInt().clamp(0, 100);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(
              Icons.downloading_rounded,
              color: AppColors.accent,
              size: 20,
            ),
            const SizedBox(width: 8),
            const Text(
              'Downloading…',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            const Spacer(),
            Text(
              '$percent%',
              style: const TextStyle(
                color: AppColors.accent,
                fontWeight: FontWeight.w700,
                fontSize: 15,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: LinearProgressIndicator(
            value: _progress,
            minHeight: 10,
            backgroundColor: AppColors.surfaceLight,
            valueColor: const AlwaysStoppedAnimation<Color>(AppColors.accent),
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Text(
              _totalBytes > 0
                  ? '${formatBytes(_receivedBytes)} / ${formatBytes(_totalBytes)}'
                  : formatBytes(_receivedBytes),
              style: _secondaryStyle,
            ),
            const Spacer(),
            TextButton.icon(
              onPressed: _cancelDownload,
              style: TextButton.styleFrom(
                foregroundColor: AppColors.error,
                padding: EdgeInsets.zero,
                minimumSize: const Size(70, 32),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              icon: const Icon(Icons.close_rounded, size: 16),
              label: const Text('Cancel'),
            ),
          ],
        ),
      ],
    );
  }

  Widget _idleHint() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 22),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.hairline),
      ),
      child: const Column(
        children: [
          Icon(Icons.auto_awesome_rounded, color: AppColors.accent, size: 26),
          SizedBox(height: 8),
          Text(
            'No download yet',
            style: TextStyle(fontWeight: FontWeight.w600),
          ),
          SizedBox(height: 4),
          Text(
            'Open a video in TikTok → Share → TikGrab, or paste a link '
            'above. The video is saved to your gallery automatically.',
            textAlign: TextAlign.center,
            style: _secondaryStyle,
          ),
        ],
      ),
    );
  }

  Widget _doneCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.successSoft,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.successBorder),
      ),
      child: Column(
        children: [
          const Icon(
            Icons.check_circle_rounded,
            color: AppColors.success,
            size: 40,
          ),
          const SizedBox(height: 10),
          const Text(
            'Video saved!',
            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
          ),
          const SizedBox(height: 4),
          Text(
            _statusMessage,
            textAlign: TextAlign.center,
            style: _secondaryStyle,
          ),
          if (_file != null) ...[
            const SizedBox(height: 2),
            Text(
              _file!.fileName,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 11,
              ),
            ),
          ],
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: _reset,
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.success,
              side: const BorderSide(color: AppColors.successBorder),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            icon: const Icon(Icons.refresh_rounded, size: 18),
            label: const Text('Download another'),
          ),
        ],
      ),
    );
  }

  Widget _errorCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.errorSoft,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.errorBorder),
      ),
      child: Column(
        children: [
          const Icon(
            Icons.error_outline_rounded,
            color: AppColors.error,
            size: 38,
          ),
          const SizedBox(height: 10),
          const Text(
            'Download failed',
            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
          ),
          const SizedBox(height: 4),
          Text(
            _statusMessage,
            textAlign: TextAlign.center,
            style: _secondaryStyle,
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: () => _startDownload(),
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.error,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            icon: const Icon(Icons.replay_rounded, size: 18),
            label: const Text('Try again'),
          ),
        ],
      ),
    );
  }

  Widget _statusCard({required Widget child}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.hairline),
      ),
      child: child,
    );
  }
}
