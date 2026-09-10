// Icon.tsx — inline SVG icon from the AppliedX set (utils/icons.ts).
// Renders with stroke=currentColor so it inherits the surrounding text color;
// pass `size` in px. Unknown names render nothing (never a broken glyph).

import { ICON_PATHS } from '../utils/icons.js';

interface Props {
  name: string;
  size?: number;
  /** Stroke width on the 24-grid; 2 is the house weight. */
  strokeWidth?: number;
  className?: string;
  title?: string;
}

export function Icon({ name, size = 16, strokeWidth = 2, className, title }: Props): JSX.Element | null {
  const d = ICON_PATHS[name];
  if (!d) return null;
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : true}
      style={{ verticalAlign: '-0.15em', flex: 'none' }}
    >
      {title && <title>{title}</title>}
      <path d={d} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
