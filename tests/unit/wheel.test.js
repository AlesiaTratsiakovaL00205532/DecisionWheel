import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { targetRotation } from '../../public/wheel.js';

describe('wheel landing position', () => {
  for (const index of [0, 1, 2, 3]) {
    it(`places sector ${index} beneath the top arrow after repeated spins`, () => {
      let rotation = 0;
      for (const previousIndex of [2, 0, 3, 1, index]) {
        const next = targetRotation(rotation, previousIndex);
        assert.ok(next - rotation >= 1800);
        assert.equal((next + previousIndex * 90) % 360, 0);
        rotation = next;
      }
    });
  }

  for (const index of [-1, 4, 1.5, undefined]) {
    it(`rejects invalid sector ${index}`, () => {
      assert.throws(() => targetRotation(0, index), RangeError);
    });
  }
});
