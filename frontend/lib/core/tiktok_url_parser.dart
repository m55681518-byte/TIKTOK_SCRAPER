/// Extracts and cleans TikTok URLs out of arbitrary shared/pasted text.
class TikUrlParser {
  TikUrlParser._();

  /// Matches every TikTok link flavour: tiktok.com, www., m., vm. and vt.
  static final RegExp _tiktokRegExp = RegExp(
    r"""https?://(?:www\.|m\.|vm\.|vt\.)?tiktok\.com/[^\s"'<>()\[\]]+""",
    caseSensitive: false,
  );

  static final RegExp _anyUrlRegExp = RegExp(
    r"""https?://[^\s"'<>()\[\]]+""",
    caseSensitive: false,
  );

  static final RegExp _tiktokHostRegExp = RegExp(
    r'^(?:www\.|m\.|vm\.|vt\.)?tiktok\.com$',
    caseSensitive: false,
  );

  /// Pulls the first TikTok video link out of [text].
  ///
  /// [text] may be the full shared payload, e.g.
  /// `"check this out 😂 https://vm.tiktok.com/ZSxxx/ #fyp"`.
  /// Returns a cleaned https URL, or null when nothing valid was found.
  static String? extract(String? text) {
    if (text == null || text.trim().isEmpty) return null;

    final trimmed = text.trim();
    final tiktokMatch = _tiktokRegExp.firstMatch(trimmed);
    if (tiktokMatch != null) return _clean(tiktokMatch.group(0)!);

    // Last resort: any URL — accept it only if it points at tiktok.com.
    final anyMatch = _anyUrlRegExp.firstMatch(trimmed);
    if (anyMatch != null) {
      final candidate = anyMatch.group(0)!;
      if (isTikTokUrl(candidate)) return _clean(candidate);
    }
    return null;
  }

  static bool isTikTokUrl(String url) {
    final host = Uri.tryParse(url)?.host.toLowerCase();
    return host != null && _tiktokHostRegExp.hasMatch(host);
  }

  /// Forces https and strips every query parameter/fragment.
  ///
  /// The TikTok app appends tracking junk to shared links
  /// (`_r`, `_t`, `is_copy_url`, `is_from_webapp`, `share_app_id`, `utm_*`…).
  /// None of it is needed: the video identifier lives entirely in the path.
  static String _clean(String url) {
    final uri = Uri.tryParse(url);
    if (uri == null || !uri.hasAuthority) return url;
    return Uri(
      scheme: 'https',
      host: uri.host,
      port: uri.hasPort ? uri.port : null,
      path: uri.path.isEmpty ? '/' : uri.path,
    ).toString();
  }
}
