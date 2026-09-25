# Open Sans — the company's standard web font, self-hosted

`npm run brand:fonts` downloads the five latin WOFF2 files (OFL-1.1) from the
fontsource build of Google's Open Sans into this folder; commit them. Until
they are here `tokens.css` falls back to the system sans (SF on Apple, Segoe
on Windows), so nothing breaks — it just isn't Open Sans yet.

No SIB surface ever loads a font from the internet.
