// TagDirectionArrow
// A CSS-only arrow pinned to the screen edge that points toward the tag's
// world-space position when it is off-screen.
//
// Usage:
//   const arrow = new TagDirectionArrow(document.getElementById('tag-arrow')!);
//   // every frame:
//   arrow.update(marker.getScreenPosition(camera, W, H));

const EDGE_MARGIN = 40;   // px from screen edge where arrow sits
const HALF_ARROW  = 22;   // half arrow div size (px)

export class TagDirectionArrow {
  constructor(private readonly el: HTMLElement) {}

  /**
   * Call every frame with the tag's current screen position.
   * Shows/hides and rotates the arrow accordingly.
   */
  update(
    pos: { x: number; y: number; inFront: boolean },
    screenW: number,
    screenH: number,
  ): void {
    const onScreen =
      pos.inFront &&
      pos.x >= 0 && pos.x <= screenW &&
      pos.y >= 0 && pos.y <= screenH;

    if (onScreen) {
      this.el.style.display = 'none';
      return;
    }

    // Compute angle from screen centre to the tag's (possibly off-screen) point.
    const cx    = screenW / 2;
    const cy    = screenH / 2;
    // If tag is behind camera, flip the direction so arrow points "away" correctly.
    const tx    = pos.inFront ? pos.x : screenW - pos.x;
    const ty    = pos.inFront ? pos.y : screenH - pos.y;
    const angle = Math.atan2(ty - cy, tx - cx); // radians, 0 = right

    // Clamp the arrow position to the screen edge along that angle.
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // How far can we travel in this direction before hitting an edge?
    const maxDist = Math.min(
      cos !== 0 ? (cos > 0 ? screenW - cx - EDGE_MARGIN : cx - EDGE_MARGIN) / Math.abs(cos) : Infinity,
      sin !== 0 ? (sin > 0 ? screenH - cy - EDGE_MARGIN : cy - EDGE_MARGIN) / Math.abs(sin) : Infinity,
    );
    const arrowX = cx + cos * maxDist - HALF_ARROW;
    const arrowY = cy + sin * maxDist - HALF_ARROW;

    // Arrow SVG points RIGHT (0°); rotate to face the tag.
    const deg = (angle * 180) / Math.PI;

    this.el.style.display    = 'flex';
    this.el.style.left       = `${arrowX}px`;
    this.el.style.top        = `${arrowY}px`;
    this.el.style.transform  = `rotate(${deg}deg)`;
  }

  hide(): void { this.el.style.display = 'none'; }
}
