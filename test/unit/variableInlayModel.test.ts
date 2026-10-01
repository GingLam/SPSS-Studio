import assert from 'node:assert/strict';
import type { SpssVariableMetadata } from '../../src/spss/types';
import { buildVariableInlayModel } from '../../src/language/variableInlayModel';

function variables(count: number): SpssVariableMetadata[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    name: `variable_${String(index + 1)}`,
    label: index === 0 ? 'First variable' : '',
    type: 'numeric',
    format: 'F8.2',
  }));
}

describe('variable inlay model', () => {
  it('shows every variable when there are no more than 50', () => {
    const model = buildVariableInlayModel(variables(50));
    assert.equal(model.variables.length, 50);
    assert.equal(model.hasMore, false);
    assert.equal(model.variables[0]?.tooltip, 'First variable');
    assert.equal(model.variables[1]?.tooltip, 'No label');
  });

  it('limits the inlay to 50 variables and exposes the complete picker', () => {
    const model = buildVariableInlayModel(variables(51));
    assert.equal(model.variables.length, 50);
    assert.equal(model.hasMore, true);
    assert.equal(model.total, 51);
  });

  it('returns no visible entries for an empty cache', () => {
    assert.deepEqual(buildVariableInlayModel([]), { variables: [], hasMore: false, total: 0 });
  });
});
