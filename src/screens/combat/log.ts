import type { CombatEvent } from '../../game/combat';
import { STATUS_INFO } from '../../game/data/abilities';
import { statusName, t } from '../../i18n';

/* ============================================================================
 * The fight log. The engine hands over bare events ("damage 24 to enemy");
 * this turns them into the prose the player asked for:
 *
 *   Round 3
 *   You — Strike → 24 to Goblin
 *   Goblin — Rake → 8 + 7 to you · Bleed (2)
 *   You parried! (−70%)
 *
 * Every sentence comes from `log.*` keys with params, so the French reads
 * "Vous — Frappe → 24 à Gobelin" / "Gobelin — Griffure → 8 + 7 sur vous".
 *
 * Lines are built incrementally: an action opens a line, the hits and
 * statuses that follow are appended to it, and the next action closes it.
 * ========================================================================== */

export type LogTone = 'you' | 'foe' | 'good' | 'bad' | 'note' | 'parry' | 'round' | 'crit';

export interface LogLine {
  text: string;
  tone: LogTone;
  icon?: string;
  /** Round headers carry the number; ordinary lines don't. */
  round?: number;
}

export interface FightSummary {
  rounds: number;
  dealt: number;
  taken: number;
  healed: number;
  parries: number;
  crits: number;
}

type Side = 'player' | 'enemy';

interface OpenLine {
  who: Side;
  label: string;
  icon?: string;
  hits: string[];
  hitTarget: Side | null;
  extras: string[];
  crit: boolean;
}

export class FightLog {
  readonly lines: LogLine[] = [];
  readonly summary: FightSummary = { rounds: 0, dealt: 0, taken: 0, healed: 0, parries: 0, crits: 0 };
  /** The line most recently written or amended — the one-line strip shows it. */
  last: LogLine | null = null;
  onChange: (() => void) | null = null;

  private open: OpenLine | null = null;
  private reflectNext = false;
  private round = 0;

  constructor(private enemyName: string) {}

  /* ------------------------------------------------------------- rounds -- */

  startRound(n: number) {
    if (n === this.round) return;
    this.flush();
    this.round = n;
    this.summary.rounds = n;
    this.push({ text: t('log.round', { n }), tone: 'round', round: n });
  }

  /** A hand-written line (revive, boss reset…). */
  note(text: string, tone: LogTone = 'note', icon?: string) {
    this.flush();
    this.push({ text, tone, icon });
  }

  /* ------------------------------------------------------------- events -- */

  /** Feeds one event as it is played, so the log never runs ahead of the screen. */
  record(ev: CombatEvent) {
    const name = this.enemyName;
    const who = (s: Side) => (s === 'player' ? t('common.you') : name);
    /** "you" / the enemy as an object of a verb ("hit you", "Bleed on Goblin"). */
    const whom = (s: Side) => (s === 'player' ? t('log.on_you') : t('log.on_foe', { name }));
    /** "to you" / "to Goblin" — where a hit or a tick lands. */
    const toWhom = (s: Side) => (s === 'player' ? t('log.to_you') : t('log.to_foe', { name }));

    switch (ev.kind) {
      case 'turn':
        // The 'action' event that follows carries the same label; the turn
        // marker only matters when the enemy is stunned (no action follows).
        if (ev.label === 'Stunned') {
          this.flush();
          this.push({ text: t('log.stunned', { name }), tone: 'good', icon: ev.icon });
        }
        return;
      case 'action':
        this.flush();
        this.open = {
          who: ev.source ?? 'player',
          label: ev.label ?? ev.text,
          icon: ev.icon,
          hits: [],
          hitTarget: null,
          extras: [],
          crit: false
        };
        this.render();
        return;
      case 'damage':
      case 'crit': {
        const amt = Math.round(ev.amount ?? 0);
        const crit = ev.kind === 'crit';
        if (ev.target === 'enemy') this.summary.dealt += amt;
        else this.summary.taken += amt;
        if (crit) this.summary.crits += 1;
        if (this.reflectNext) {
          this.reflectNext = false;
          this.flush();
          this.push({ text: t('log.reflected', { n: amt, whom: toWhom(ev.target) }), tone: ev.target === 'player' ? 'bad' : 'good', icon: '🌵' });
          return;
        }
        // A hit on the enemy while the enemy is acting is the iron-brace bite-back.
        if (this.open && this.open.who === 'enemy' && ev.target === 'enemy') {
          this.open.extras.push(t('log.reflected_back', { n: amt }));
          this.render();
          return;
        }
        if (!this.open) {
          this.push({
            text: t('log.hit', { who: who(ev.source ?? (ev.target === 'player' ? 'enemy' : 'player')), whom: whom(ev.target), n: amt }),
            tone: ev.target === 'player' ? 'bad' : 'you',
            icon: ev.icon
          });
          return;
        }
        this.open.hits.push(crit ? `${amt}!` : String(amt));
        this.open.hitTarget = ev.target;
        if (crit) this.open.crit = true;
        this.render();
        return;
      }
      case 'block': {
        const amt = Math.round(ev.amount ?? 0);
        if (this.open) {
          this.open.hits.push(t('log.blocked_hit', { n: amt }));
          this.open.hitTarget = ev.target;
          this.render();
        } else {
          this.push({ text: t('log.blocked', { who: who(ev.target), n: amt }), tone: 'good', icon: '🛡️' });
        }
        return;
      }
      case 'heal': {
        const amt = Math.round(ev.amount ?? 0);
        if (ev.target === 'player') this.summary.healed += amt;
        if (this.open && this.open.who === ev.target) {
          this.open.extras.push(t('log.hp_gain', { n: amt }));
          this.render();
        } else if (this.open && ev.target === 'enemy') {
          // Drain / siphon: the enemy healed off its own hit.
          this.open.extras.push(t('log.drains', { name, n: amt }));
          this.render();
        } else if (this.open && ev.target === 'player') {
          this.open.extras.push(t('log.you_drain', { n: amt }));
          this.render();
        } else {
          this.push({ text: ev.target === 'player' ? t('log.recover', { n: amt }) : t('log.heals', { name, n: amt }), tone: ev.target === 'player' ? 'good' : 'foe', icon: ev.icon ?? '💚' });
        }
        return;
      }
      case 'shield': {
        const amt = Math.round(ev.amount ?? 0);
        if (this.open) {
          this.open.extras.push(t('log.shield_extra', { n: amt }));
          this.render();
        } else {
          this.push({ text: ev.target === 'player' ? t('log.you_shield', { n: amt }) : t('log.foe_shield', { name, n: amt }), tone: ev.target === 'player' ? 'good' : 'foe', icon: '⛊' });
        }
        return;
      }
      case 'status': {
        const label = this.statusLabel(ev);
        const line = t('log.status_on', { status: label, whom: whom(ev.target) });
        if (this.open) {
          this.open.extras.push(line);
          this.render();
        } else {
          this.push({ text: line, tone: ev.target === 'player' ? 'bad' : 'good', icon: ev.icon });
        }
        return;
      }
      case 'dot': {
        this.flush();
        const amt = Math.round(ev.amount ?? 0);
        if (ev.target === 'enemy') this.summary.dealt += amt;
        else this.summary.taken += amt;
        const sname = ev.fx && STATUS_INFO[ev.fx as keyof typeof STATUS_INFO] ? statusName(ev.fx as keyof typeof STATUS_INFO) : t('log.dot_generic');
        this.push({ text: t('log.dot', { status: sname, n: amt, whom: toWhom(ev.target) }), tone: ev.target === 'player' ? 'bad' : 'good', icon: ev.icon });
        return;
      }
      case 'parry':
        this.summary.parries += 1;
        // Sits under the enemy's action line; the reduced hits still amend that line.
        this.push({ text: t('log.parried'), tone: 'parry', icon: '⛨' });
        if (this.open) this.open.extras.push(t('log.parried_extra'));
        return;
      case 'info':
        // The engine tags these (`fx`); the text match is a fallback for older events.
        if (ev.fx === 'reflect' || /^Reflected/.test(ev.text)) {
          this.reflectNext = true;
          return;
        }
        if (this.open && (ev.fx === 'incoming' || /incoming/.test(ev.text))) {
          this.open.extras.push(ev.text);
          this.render();
          return;
        }
        this.flush();
        this.push({ text: ev.text, tone: 'note', icon: ev.icon });
        return;
      case 'phase':
        this.flush();
        this.push({ text: ev.label ? t('log.phase', { name: ev.label, banner: ev.text }) : ev.text, tone: 'bad', icon: ev.icon ?? '⚡' });
        return;
      case 'revive':
        this.flush();
        this.push({ text: ev.text, tone: 'bad', icon: ev.icon });
        return;
      case 'death':
        this.flush();
        this.push({ text: ev.text, tone: ev.target === 'enemy' ? 'good' : 'bad', icon: ev.icon });
        return;
      case 'flee':
        this.flush();
        this.push({ text: ev.text, tone: 'note', icon: ev.icon });
        return;
      default:
        return;
    }
  }

  /** Closes the open action line. Call when a batch of beats finishes. */
  flush() {
    if (!this.open) return;
    this.render();
    this.open = null;
    this.openLine = null;
  }

  /* ----------------------------------------------------------- internals -- */

  private statusLabel(ev: CombatEvent): string {
    // Engine text is "Bleed x2" / "Cleansed!" — normalise to "Bleed (2)".
    const m = /^(.+?)(?:\s+x(\d+))?$/.exec(ev.text.trim());
    if (!m) return ev.text;
    return m[2] ? `${m[1]} (${m[2]})` : m[1];
  }

  /** Writes (or rewrites) the line for the open action, in place. */
  private render() {
    const o = this.open;
    if (!o) return;
    const name = this.enemyName;
    const toWhom = (s: Side) => (s === 'player' ? t('log.to_you') : t('log.to_foe', { name }));
    let text = t('log.line', { who: o.who === 'player' ? t('common.you') : name, label: o.label });
    if (o.hits.length) text += ` → ${o.hits.join(' + ')} ${toWhom(o.hitTarget ?? (o.who === 'player' ? 'enemy' : 'player'))}`;
    if (o.extras.length) text += ` · ${o.extras.join(' · ')}`;
    const tone: LogTone = o.crit ? 'crit' : o.who === 'player' ? 'you' : 'foe';
    if (this.openLine) {
      this.openLine.text = text;
      this.openLine.tone = tone;
      this.last = this.openLine;
    } else {
      this.openLine = { text, tone, icon: o.icon };
      this.lines.push(this.openLine);
      this.last = this.openLine;
    }
    this.onChange?.();
  }

  /** The LogLine object the open action writes into; amended in place. */
  private openLine: LogLine | null = null;

  private push(line: LogLine) {
    this.lines.push(line);
    this.last = line;
    this.onChange?.();
  }
}
