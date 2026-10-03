import assert from 'node:assert/strict';
import {
  cachedVariableName,
  orderedCachedVariableNames,
} from '../../src/spss/variableInsertion';
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

  it('validates and returns multiple selected variables in dataset order', () => {
    assert.deepEqual(
      orderedCachedVariableNames(variables, ['HouseholdIncome', 'Age']),
      ['Age', 'HouseholdIncome'],
    );
    assert.deepEqual(orderedCachedVariableNames(variables, ['Age', 'Age']), ['Age']);
    assert.equal(orderedCachedVariableNames(variables, ['Age', 'StaleVariable']), undefined);
    assert.equal(orderedCachedVariableNames(variables, []), undefined);
  });
});
