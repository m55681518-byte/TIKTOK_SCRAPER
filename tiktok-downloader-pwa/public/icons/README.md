# App icons

Generated set (already wired into manifest.json / index.html):

| File                  | Size      | Purpose                                        |
|-----------------------|-----------|------------------------------------------------|
| icon-192.png          | 192×192   | Android "any" icon + favicon + apple-touch     |
| icon-512.png          | 512×512   | Android "any" icon (install-splash)            |
| icon-maskable-512.png | 512×512   | Android adaptive icon — content padded to the 80% safe zone so circular/squircle masks never clip it |
| apple-touch-icon.png  | 180×180   | iOS home-screen icon                           |

To regenerate with your own artwork: drop a 1024×1024 PNG (full-bleed
background, logo centred within the middle 80%) and re-run:

    convert base.png -resize 512x512 icon-512.png
    convert base.png -resize 192x192 icon-192.png
    convert base.png -resize 180x180 apple-touch-icon.png
    convert base.png -resize 410x410 -gravity center -background '#0b0b10' -extent 512x512 icon-maskable-512.png
