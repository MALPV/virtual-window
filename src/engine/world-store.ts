import { DEFAULT_SNAPSHOT, deriveWorld, type EnvironmentSnapshot, type WorldState } from "./world";

export type Unsubscribe = () => void;
type Listener = (world: WorldState) => void;

/**
 * Holds the current world. The live snapshot comes from the backend; a simulated snapshot
 * (dev tools only) takes precedence while set.
 */
export class WorldStore {
  private live: EnvironmentSnapshot = DEFAULT_SNAPSHOT;
  private simulated: EnvironmentSnapshot | null = null;
  private current: WorldState = deriveWorld(DEFAULT_SNAPSHOT);
  private readonly listeners = new Set<Listener>();

  get world(): WorldState {
    return this.current;
  }

  get liveSnapshot(): EnvironmentSnapshot {
    return this.live;
  }

  setLive(snapshot: EnvironmentSnapshot): void {
    this.live = snapshot;
    if (this.simulated === null) this.publish();
  }

  setSimulated(snapshot: EnvironmentSnapshot | null): void {
    this.simulated = snapshot;
    this.publish();
  }

  subscribe(listener: Listener): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(): void {
    this.current = deriveWorld(this.simulated ?? this.live);
    for (const listener of this.listeners) {
      try {
        listener(this.current);
      } catch (error) {
        console.error("World listener failed:", error);
      }
    }
  }
}
