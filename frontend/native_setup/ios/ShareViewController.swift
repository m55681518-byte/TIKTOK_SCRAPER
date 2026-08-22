//
//  ShareViewController.swift
//  Share Extension (iOS)
//
//  ═══════════════════════════════════════════════════════════════════════════
//  Paste this file into the Share Extension target, replacing the generated
//  ShareViewController.swift:   ios/Share Extension/ShareViewController.swift
//
//  It subclasses RSIShareViewController from the `receive_sharing_intent`
//  Swift package — the plugin does all the heavy lifting (reading the shared
//  text/URL, stashing it in the shared App Group, redirecting to TikGrab).
//
//  Prerequisites (see README.md → "iOS share-sheet setup"):
//    • Swift Package Manager enabled:  flutter config --enable-swift-package-manager
//    • The `receive-sharing-intent` library linked to the Share Extension
//      target (General → Frameworks and Libraries → +).
//    • App Groups capability with the SAME container on Runner + extension,
//      and CUSTOM_GROUP_ID user-defined build setting on both targets.
//    • Build Phases (Runner): "Embed Foundation Extension" moved ABOVE
//      "Thin Binary".
//  ═══════════════════════════════════════════════════════════════════════════
//
import receive_sharing_intent

class ShareViewController: RSIShareViewController {

    // true → zero-extension-UI flow: the moment the user taps "TikGrab" in
    // TikTok's share sheet, the link is handed over and our Flutter app opens
    // with the download already starting. This is the UX we want.
    //
    // Set it to false if you'd rather show a compose card with a Send button.
    override func shouldAutoRedirect() -> Bool {
        return true
    }
}
