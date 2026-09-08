/* ============================================================================
 * Vital bars with a legible "ghost" segment: on damage the lost chunk stays
 * red for a beat and drains away; on a heal the gained chunk shows green and
 * the fill grows into it. Either way the eye has ~0.8 s to read the change.
 *
 *   <div class="bar bar-hp cb-vital">
 *     <i class="cb-bar-ghost"></i>
 *     <i class="bar-fill"></i>
 *     <u class="cb-shield"></u>
 *     <b class="bar-label"></b>
 *   </div>
 * ========================================================================== */

const DRAIN = 'width 800ms cubic-bezier(0.22, 1, 0.36, 1) 260ms';

export class VitalBar {
  private fill: HTMLElement;
  private ghost: HTMLElement;
  private frac = -1;

  constructor(private el: HTMLElement) {
    this.fill = el.querySelector('.bar-fill') as HTMLElement;
    this.ghost = el.querySelector('.cb-bar-ghost') as HTMLElement;
  }

  /** Sets the bar to `frac` (0..1). The first call snaps, later ones animate. */
  set(frac: number) {
    const f = Math.max(0, Math.min(1, frac));
    const prev = this.frac;
    this.frac = f;
    const pct = `${f * 100}%`;

    if (prev < 0 || Math.abs(prev - f) < 0.0005) {
      this.fill.style.transition = 'none';
      this.ghost.style.transition = 'none';
      this.fill.style.width = pct;
      this.ghost.style.width = pct;
      this.ghost.className = 'cb-bar-ghost';
      return;
    }

    if (f < prev) {
      // Damage: fill snaps down, red ghost lingers at the old value then drains.
      this.ghost.style.transition = 'none';
      this.ghost.style.width = `${prev * 100}%`;
      this.ghost.className = 'cb-bar-ghost is-dmg';
      this.fill.style.transition = 'none';
      this.fill.style.width = pct;
      void this.ghost.offsetWidth;
      this.ghost.style.transition = DRAIN;
      this.ghost.style.width = pct;
    } else {
      // Heal: green ghost jumps to the new value, fill grows into it.
      this.ghost.style.transition = 'none';
      this.ghost.style.width = pct;
      this.ghost.className = 'cb-bar-ghost is-heal';
      this.fill.style.transition = 'none';
      this.fill.style.width = `${prev * 100}%`;
      void this.fill.offsetWidth;
      this.fill.style.transition = DRAIN;
      this.fill.style.width = pct;
    }
    this.el.classList.toggle('is-low', f <= 0.25);
  }
}
