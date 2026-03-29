/**
 * Backpressure Buffer — configurable bounded buffer with drop policy.
 *
 * Designed as a standalone utility that can wrap any message queue.
 * Does NOT modify the existing IPCClient; intended for future integration.
 *
 * ADR-002 Phase E3: IPC backpressure configuration.
 */

export type DropPolicy = 'oldest' | 'newest' | 'throw';

export interface BackpressureConfig {
  /** Maximum number of items the buffer will hold. */
  maxSize: number;
  /** Buffer size at which onPressure is called. */
  backpressureThreshold: number;
  /** What to do when the buffer is full. */
  dropPolicy: DropPolicy;
}

export const DEFAULT_BACKPRESSURE_CONFIG: BackpressureConfig = {
  maxSize: 1000,
  backpressureThreshold: 800,
  dropPolicy: 'oldest',
};

export interface BackpressureCallbacks<T> {
  /** Called when an item is dropped due to a full buffer. */
  onDrop?: (item: T, bufferSize: number) => void;
  /** Called when buffer size reaches or exceeds the backpressure threshold. */
  onPressure?: (bufferSize: number) => void;
}

export class BackpressureBuffer<T> {
  private readonly buffer: T[] = [];
  private readonly config: BackpressureConfig;
  private readonly callbacks: BackpressureCallbacks<T>;

  constructor(
    config: Partial<BackpressureConfig> = {},
    callbacks: BackpressureCallbacks<T> = {},
  ) {
    this.config = { ...DEFAULT_BACKPRESSURE_CONFIG, ...config };
    this.callbacks = callbacks;
  }

  /**
   * Add an item to the buffer, applying the configured drop policy
   * when the buffer is full and firing backpressure warnings as needed.
   */
  enqueue(item: T): void {
    if (this.buffer.length >= this.config.maxSize) {
      switch (this.config.dropPolicy) {
        case 'oldest': {
          const dropped = this.buffer.shift() as T;
          this.callbacks.onDrop?.(dropped, this.buffer.length);
          break;
        }
        case 'newest': {
          this.callbacks.onDrop?.(item, this.buffer.length);
          return; // discard the new item entirely
        }
        case 'throw': {
          throw new Error(
            `BackpressureBuffer full (maxSize=${this.config.maxSize}): cannot enqueue`,
          );
        }
      }
    }

    this.buffer.push(item);

    if (this.buffer.length >= this.config.backpressureThreshold) {
      this.callbacks.onPressure?.(this.buffer.length);
    }
  }

  /** Remove and return the oldest item, or undefined if empty. */
  dequeue(): T | undefined {
    return this.buffer.shift();
  }

  /** Current number of items in the buffer. */
  get size(): number {
    return this.buffer.length;
  }

  /** Return all items and clear the buffer. */
  drain(): T[] {
    const items = this.buffer.splice(0);
    return items;
  }
}
