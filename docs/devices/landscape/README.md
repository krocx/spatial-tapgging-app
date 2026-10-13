# AR glasses landscape

One file per entry, YAML frontmatter, read by `GET /devices/landscape` and
shown newest first on `/devices/landscape`. Fields: `id` (the file name),
`date` (YYYY-MM-DD), `maker`, `title`, `class` (handheld · binocular-headset
· binocular-glasses · monocular · no-display), `signal` (candidate · watch ·
exited · optics), `summary` (two sentences, what was announced), `source`
(who said it) and `url` (the public page), `means` (one line: what it means
for us - shown only with the IP key, because it is our strategy, not the
news). SENZ™ is always written with the ™.

`sources.md` lists the public feeds the server reads for the "On the wire"
strip: one `name | url` per line under `feeds`, and the `keep` words a
headline must contain to be shown. The strip is external and labelled as
such; it is refreshed hourly and the page says when.
