import { DEFAULT_SNAPSHOT, deriveWorld, type EnvironmentSnapshot, type WorldState } from "./world";
import { blendWorld, easeInOut } from "./world-blend";

export type Unsubscribe = () => void;
type Listener = (world: WorldState) => void;

/** Duration of the blend between two live updates. */
export const LIVE_TRANSITION_MS = 90_000;
/** How often the blended world is published while a transition runs. */
export const TRANSITION_TICK_MS = 1_000;

interface Transition {
  from: WorldState;
  to: WorldState;
  startedAt: number;
}

/**
 * Holds the current world. Live updates are blended over LIVE_TRANSITION_MS so nothing in a
 * scene ever changes abruptly. The first live update and simulated snapshots apply instantly.
 */
export class WorldStore {
  private live: EnvironmentSnapshot = DEFAULT_SNAPSHOT;
  private hasLive = false;
  private simulated: EnvironmentSnapshot | null = null;
  private current: WorldState = deriveWorld(DEFAULT_SNAPSHOT);
  private transition: Transition | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<Listener>();

  get world(): WorldState {
    return this.current;
  }

  get liveSnapshot(): EnvironmentSnapshot {
    return this.live;
  }

  setLive(snapshot: EnvironmentSnapshot): void {
    this.live = snapshot;
    const first = !this.hasLive;
    this.hasLive = true;
    if (this.simulated !== null) return;
    if (first) this.applyInstantly(deriveWorld(snapshot));
    else this.startTransition(deriveWorld(snapshot));
  }

  setSimulated(snapshot: EnvironmentSnapshot | null): void {
    this.simulated = snapshot;
    this.applyInstantly(deriveWorld(snapshot ?? this.live));
  }

  subscribe(listener: Listener): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private applyInstantly(world: WorldState): void {
    this.stopTransition();
    this.current = world;
    this.publish();
  }

  // Una nueva actualizacion parte del estado visible actual, aunque la anterior no haya terminado.
  private startTransition(target: WorldState): void {
    this.transition = { from: this.current, to: target, startedAt: Date.now() };
    if (this.timer === null) this.timer = setInterval(() => this.step(), TRANSITION_TICK_MS);
    this.step();
  }

  private step(): void {
    if (this.transition === null) return;
    const { from, to, startedAt } = this.transition;
    const progress = (Date.now() - startedAt) / LIVE_TRANSITION_MS;
    this.current = blendWorld(from, to, easeInOut(progress));
    if (progress >= 1) this.stopTransition();
    this.publish();
  }

  private stopTransition(): void {
    this.transition = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private publish(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.current);
      } catch (error) {
        console.error("World listener failed:", error);
      }
    }
  }
}
