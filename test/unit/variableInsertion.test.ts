import assert from 'node:assert/strict';
import { cachedVariableName } from '../../src/spss/variableInsertion';
import type { SpssVariableMetadata } from '../../src/spss/types';

const variables: SpssVariableMetadata[] = [
  { index: 0, name: 'Age', label: 'Age in years', type: 'Numeric', format: 'F8.0' },
  { index: 1, name: 'HouseholdIncome', label: '', type: 'Numeric', format: 'F12.2' },
];

describe('cached variable insertion validation', () => {
  it('returns only an exact current-cache variable name', () => {
    assert.equal(cachedVariableName(variables, 'HouseholdIncome'), 'HouseholdIncome');
    assert.equal(cachedVariableName(variables, 'householdincome'), undefined);
    assert.equal(cachedVariableName(variables, 'StaleVariable'), undefined);
    assert.equal(cachedVariableName(variables, ''), undefined);
    assert.equal(cachedVariableName(variables, 1), undefined);
  });
});
