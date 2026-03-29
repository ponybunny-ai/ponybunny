import {
  BackpressureBuffer,
  DEFAULT_BACKPRESSURE_CONFIG,
} from '../../src/ipc/backpressure-buffer.js';

describe('BackpressureBuffer', () => {
  it('enqueue adds items to buffer', () => {
    const buf = new BackpressureBuffer<number>();
    buf.enqueue(1);
    buf.enqueue(2);
    expect(buf.size).toBe(2);
  });

  it('dequeue returns items in FIFO order', () => {
    const buf = new BackpressureBuffer<string>();
    buf.enqueue('a');
    buf.enqueue('b');
    buf.enqueue('c');
    expect(buf.dequeue()).toBe('a');
    expect(buf.dequeue()).toBe('b');
    expect(buf.dequeue()).toBe('c');
  });

  it('dequeue returns undefined when empty', () => {
    const buf = new BackpressureBuffer<number>();
    expect(buf.dequeue()).toBeUndefined();
  });

  it('oldest drop policy drops oldest when full', () => {
    const buf = new BackpressureBuffer<number>(
      { maxSize: 3, backpressureThreshold: 3, dropPolicy: 'oldest' },
    );
    buf.enqueue(1);
    buf.enqueue(2);
    buf.enqueue(3);
    // Buffer is now full — enqueue should drop oldest (1)
    buf.enqueue(4);
    expect(buf.size).toBe(3);
    expect(buf.dequeue()).toBe(2);
    expect(buf.dequeue()).toBe(3);
    expect(buf.dequeue()).toBe(4);
  });

  it('newest drop policy discards new item when full', () => {
    const buf = new BackpressureBuffer<number>(
      { maxSize: 3, backpressureThreshold: 3, dropPolicy: 'newest' },
    );
    buf.enqueue(1);
    buf.enqueue(2);
    buf.enqueue(3);
    // Buffer is full — new item should be discarded
    buf.enqueue(4);
    expect(buf.size).toBe(3);
    expect(buf.dequeue()).toBe(1);
    expect(buf.dequeue()).toBe(2);
    expect(buf.dequeue()).toBe(3);
  });

  it('throw policy throws when full', () => {
    const buf = new BackpressureBuffer<number>(
      { maxSize: 2, backpressureThreshold: 2, dropPolicy: 'throw' },
    );
    buf.enqueue(1);
    buf.enqueue(2);
    expect(() => buf.enqueue(3)).toThrow(/BackpressureBuffer full/);
    // buffer unchanged
    expect(buf.size).toBe(2);
  });

  it('onDrop callback fires on drop (oldest policy)', () => {
    const dropped: Array<{ item: number; size: number }> = [];
    const buf = new BackpressureBuffer<number>(
      { maxSize: 2, backpressureThreshold: 2, dropPolicy: 'oldest' },
      { onDrop: (item, size) => dropped.push({ item, size }) },
    );
    buf.enqueue(10);
    buf.enqueue(20);
    buf.enqueue(30);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].item).toBe(10);
  });

  it('onDrop callback fires on drop (newest policy)', () => {
    const dropped: Array<{ item: number; size: number }> = [];
    const buf = new BackpressureBuffer<number>(
      { maxSize: 2, backpressureThreshold: 2, dropPolicy: 'newest' },
      { onDrop: (item, size) => dropped.push({ item, size }) },
    );
    buf.enqueue(10);
    buf.enqueue(20);
    buf.enqueue(30); // this one gets discarded
    expect(dropped).toHaveLength(1);
    expect(dropped[0].item).toBe(30);
  });

  it('onPressure callback fires at threshold', () => {
    const pressures: number[] = [];
    const buf = new BackpressureBuffer<number>(
      { maxSize: 5, backpressureThreshold: 3, dropPolicy: 'oldest' },
      { onPressure: (size) => pressures.push(size) },
    );
    buf.enqueue(1); // size 1 — no pressure
    buf.enqueue(2); // size 2 — no pressure
    expect(pressures).toHaveLength(0);
    buf.enqueue(3); // size 3 — at threshold
    expect(pressures).toHaveLength(1);
    expect(pressures[0]).toBe(3);
    buf.enqueue(4); // size 4 — above threshold
    expect(pressures).toHaveLength(2);
    expect(pressures[1]).toBe(4);
  });

  it('drain returns all items and empties buffer', () => {
    const buf = new BackpressureBuffer<number>();
    buf.enqueue(1);
    buf.enqueue(2);
    buf.enqueue(3);
    const items = buf.drain();
    expect(items).toEqual([1, 2, 3]);
    expect(buf.size).toBe(0);
  });

  it('size returns current buffer count', () => {
    const buf = new BackpressureBuffer<string>();
    expect(buf.size).toBe(0);
    buf.enqueue('x');
    expect(buf.size).toBe(1);
    buf.dequeue();
    expect(buf.size).toBe(0);
  });

  it('uses default config when none provided', () => {
    const buf = new BackpressureBuffer<number>();
    // Fill to default maxSize (1000) without throwing
    for (let i = 0; i < DEFAULT_BACKPRESSURE_CONFIG.maxSize; i++) {
      buf.enqueue(i);
    }
    expect(buf.size).toBe(DEFAULT_BACKPRESSURE_CONFIG.maxSize);
    // One more triggers oldest-drop by default
    buf.enqueue(9999);
    expect(buf.size).toBe(DEFAULT_BACKPRESSURE_CONFIG.maxSize);
    expect(buf.dequeue()).toBe(1); // 0 was dropped
  });
});
