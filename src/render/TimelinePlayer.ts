import type { TimelineEvent, TurnResult, Vec2 } from '../engine/types';
import { lerp } from '../engine/vec';

/** Scrubs through a TurnResult's keyframes in real time and fires its events as they pass. */
export class TimelinePlayer {
  private result: TurnResult | null = null;
  private t = 0;
  private nextEvent = 0;
  private resolve: (() => void) | null = null;

  constructor(
    private readonly onFrame: (players: readonly Vec2[], ball: Vec2) => void,
    private readonly onEvent: (e: TimelineEvent) => void,
  ) {}

  get playing(): boolean {
    return this.result !== null;
  }

  play(result: TurnResult, speed = 1): Promise<void> {
    this.result = result;
    this.t = 0;
    this.nextEvent = 0;
    this.speed = speed;
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  private speed = 1;

  update(dtSeconds: number): void {
    const r = this.result;
    if (!r) return;
    this.t += dtSeconds * this.speed;
    const frames = r.keyframes;
    const last = frames[frames.length - 1];

    // Fire every event whose time we've passed, in order.
    while (this.nextEvent < r.events.length && r.events[this.nextEvent].t <= this.t) {
      this.onEvent(r.events[this.nextEvent++]);
    }

    if (this.t >= last.t) {
      this.onFrame(last.players, last.ball);
      while (this.nextEvent < r.events.length) this.onEvent(r.events[this.nextEvent++]);
      this.result = null;
      const done = this.resolve;
      this.resolve = null;
      done?.();
      return;
    }

    // Keyframes are evenly spaced, so jump straight to the bracket.
    let i = Math.min(frames.length - 2, Math.floor(this.t / (last.t / (frames.length - 1))));
    while (i > 0 && frames[i].t > this.t) i--;
    while (i < frames.length - 2 && frames[i + 1].t < this.t) i++;
    const a = frames[i];
    const b = frames[i + 1];
    const k = b.t > a.t ? (this.t - a.t) / (b.t - a.t) : 1;
    this.onFrame(
      a.players.map((p, j) => lerp(p, b.players[j], k)),
      lerp(a.ball, b.ball, k),
    );
  }
}
