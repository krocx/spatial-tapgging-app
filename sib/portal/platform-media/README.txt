Drop product screenshots here: wi-1..3.jpg, sv-1..3.jpg, gw-1..3.jpg, lo-1..3.jpg — they appear on /platform automatically.

Logos (every web page, top-right): logo-amat.png (Applied Materials) and logo-appliedx.png (AppliedX).
Drop them into DATA_DIR/platform/media/ on the server — brand assets stay deployment-local, like the deck template.

/platform scorecard hooks: metrics.json in DATA_DIR/platform/media/ fills the "Today / POC target" values and the decision window:
  { "askDate": "Q1 FY27",
    "productivity": { "today": "TTC 14 d · SLH 2.1", "target": "TTC 7 d · SLH 1.4" },
    "velocity":     { "today": "CT 3 wk",            "target": "CT 2 d" },
    "trust":        { "today": "Field NCs 6/qtr",    "target": "≤ 2/qtr" } }

Self-assessment wording: assessment.json in DATA_DIR/platform/media/ overrides the six questions and the four levels — no code change.
  { "questions": [ { "q": "…", "o": ["worst", "…", "…", "best"] }, … 6 items ],
    "levels":    [ { "n": "Aware", "d": "what it means", "next": "next rung" }, … 4 items ] }
