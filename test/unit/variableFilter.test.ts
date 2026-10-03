import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

interface VariableItem {
  name: string;
  label?: string;
}

interface VariableFilterApi {
  filterVariables<T extends VariableItem>(variables: readonly T[], query: string): T[];
}

function loadFilter(): VariableFilterApi {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../../media/variable-filter.js'),
    'utf8',
  );
  const sandbox: { spssVariableFilter?: VariableFilterApi } = {};
  vm.runInNewContext(source, sandbox);
  assert.ok(sandbox.spssVariableFilter);
  return sandbox.spssVariableFilter;
}

describe('Variables Name/Label filter', () => {
  const variables = [
    { name: 'id', label: '个人编号' },
    { name: 'education', label: '教育年限' },
    { name: 'college', label: '拥有大学学历' },
    { name: 'income', label: '个人收入' },
  ];

  it('matches Name or Label by a trimmed, case-insensitive substring', () => {
    const filter = loadFilter();
    assert.deepEqual(
      Array.from(filter.filterVariables(variables, ' 教育 '), (variable) => variable.name),
      ['education'],
    );
    assert.deepEqual(
      Array.from(filter.filterVariables(variables, 'EDU'), (variable) => variable.name),
      ['education'],
    );
    assert.deepEqual(
      Array.from(filter.filterVariables(variables, '大学'), (variable) => variable.name),
      ['college'],
    );
  });

  it('returns the complete dataset order for a blank query', () => {
    const filter = loadFilter();
    assert.deepEqual(
      Array.from(filter.filterVariables(variables, '  '), (variable) => variable.name),
      ['id', 'education', 'college', 'income'],
    );
  });
});
