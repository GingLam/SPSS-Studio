import assert from 'node:assert/strict';
import { calculateVariableWindow, normalizeVariableWindow } from '../../src/views/dataViewportState';

describe('Data horizontal variable viewport', () => {
  it('aligns visible variables to chunks with overscan', () => {
    assert.deepEqual(calculateVariableWindow(0, 900, 1_000), { variableStart: 0, variableLimit: 50 });
    assert.deepEqual(calculateVariableWindow(8_064, 900, 1_000), { variableStart: 0, variableLimit: 100 });
    assert.deepEqual(calculateVariableWindow(40_064, 900, 1_000), { variableStart: 200, variableLimit: 100 });
  });

  it('clamps the last window and never requests more than 200 variables', () => {
    assert.deepEqual(calculateVariableWindow(159_000, 2_000, 1_000), { variableStart: 950, variableLimit: 50 });
    assert.deepEqual(calculateVariableWindow(0, 100_000, 1_000), { variableStart: 0, variableLimit: 200 });
    assert.deepEqual(calculateVariableWindow(0, 900, 12), { variableStart: 0, variableLimit: 12 });
  });

  it('normalizes untrusted starts to safe aligned windows', () => {
    assert.deepEqual(normalizeVariableWindow(-10, 500), { variableStart: 0, variableLimit: 50 });
    assert.deepEqual(normalizeVariableWindow(237, 500), { variableStart: 200, variableLimit: 100 });
    assert.deepEqual(normalizeVariableWindow(999, 500), { variableStart: 450, variableLimit: 50 });
  });
});
