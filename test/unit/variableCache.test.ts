import assert from 'node:assert/strict';
import type { ActiveDatasetInfo } from '../../src/spss/types';
import { VariableCache } from '../../src/spss/variableCache';

function dataset(name = 'WorkingData'): ActiveDatasetInfo {
  return {
    active: true,
    datasetName: name,
    caseCount: 2,
    variableCount: 2,
    variables: [
      { index: 0, name: 'age', label: 'Age in years', type: 'numeric', format: 'F8.0' },
      { index: 1, name: 'income', label: '', type: 'numeric', format: 'F10.2' },
    ],
  };
}

describe('VariableCache change notifications', () => {
  it('notifies only when the effective Active Dataset metadata changes', () => {
    const cache = new VariableCache();
    let changes = 0;
    const subscription = cache.onDidChange(() => {
      changes += 1;
    });

    cache.replace(dataset());
    cache.replace(dataset());
    cache.replace(dataset('OtherData'));
    cache.clear();
    cache.clear();

    assert.equal(changes, 3);
    assert.deepEqual(cache.variables, []);
    subscription.dispose();
    cache.replace(dataset());
    assert.equal(changes, 3);
  });

  it('treats an inactive dataset as an empty cache', () => {
    const cache = new VariableCache();
    let changes = 0;
    cache.onDidChange(() => {
      changes += 1;
    });
    cache.replace({ ...dataset(), active: false });
    assert.equal(changes, 0);
    assert.equal(cache.info, undefined);
  });
});
