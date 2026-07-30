// icons.ts — curated inline icon set (single SVG paths, 24×24 viewBox).
// No icon fonts, no external requests — everything ships in the bundle.
// Stroke-style paths rendered with stroke=currentColor, fill=none.

export const ICON_PATHS: Record<string, string> = {
  flag: 'M5 21V4m0 1h12l-2.5 3.5L17 12H5',
  star: 'M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z',
  bolt: 'M13 2L4.5 13.5H11L10 22l8.5-11.5H12z',
  gear: 'M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10l2.1 2.1m0-14.2l-2.1 2.1m-10 10l-2.1 2.1',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6zm10 2.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  camera: 'M4 8h3l2-2.5h6L17 8h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1zm8 8.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  cube: 'M12 2l9 5v10l-9 5-9-5V7zm0 0v10m9-5l-9 5-9-5',
  robot: 'M9 3h6M12 3v4M5 9h14a1 1 0 011 1v9a1 1 0 01-1 1H5a1 1 0 01-1-1v-9a1 1 0 011-1zm4 5h.01M15 14h.01M9 17.5h6',
  wrench: 'M14.5 6.5a4 4 0 015.5 3.7 4 4 0 01-5.6 3.7L8 20.3a2 2 0 01-2.8-2.8l6.4-6.4a4 4 0 013.7-5.6z',
  chip: 'M8 8h8v8H8zM5 5h14v14H5zM9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3',
  qr: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 3h3m3-3v6m-6 0h3m3-6h-3m-3 3v3',
  tag: 'M3 3h8l10 10-8 8L3 11zm5 4.5h.01',
  check: 'M4 12l5 5L20 6',
  alert: 'M12 3l10 18H2zm0 6v5m0 3v.5',
  bulb: 'M9 18h6m-5 3h4m3-11a5 5 0 10-8.4 3.6c.9.8 1.4 1.5 1.4 2.4h4c0-.9.5-1.6 1.4-2.4A5 5 0 0017 10z',
  target: 'M12 12m-9 0a9 9 0 1018 0 9 9 0 10-18 0m9 0m-5 0a5 5 0 1010 0 5 5 0 10-10 0m9 0m-4 0a1 1 0 102 0 1 1 0 10-2 0',
  layers: 'M12 3l9 5-9 5-9-5zm-9 9l9 5 9-5m-18 4l9 5 9-5',
  doc: 'M6 2h8l4 4v16H6zm8 0v4h4M9 12h6m-6 4h6',
  user: 'M12 11a4 4 0 100-8 4 4 0 000 8zm-8 10c0-4 4-6 8-6s8 2 8 6',
  clock: 'M12 12m-9 0a9 9 0 1018 0 9 9 0 10-18 0M12 7v5l3.5 2',
};

export const ICON_NAMES = Object.keys(ICON_PATHS);
