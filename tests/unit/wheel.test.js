import { describe, expect, it } from 'vitest';
import { targetRotation } from '../../public/wheel.js';

describe('wheel landing position', () => {
  it.each([0, 1, 2, 3])('places sector %i beneath the top arrow after repeated spins', (index) => {
    let rotation = 0;
    for (const previousIndex of [2, 0, 3, 1, index]) {
      const next = targetRotation(rotation, previousIndex);
      expect(next - rotation).toBeGreaterThanOrEqual(1800);
      expect((next + previousIndex * 90) % 360).toBe(0);
      rotation = next;
    }
  });

  it.each([-1, 4, 1.5, undefined])('rejects invalid sector %s', (index) => {
    expect(() => targetRotation(0, index)).toThrow(RangeError);
  });
});
