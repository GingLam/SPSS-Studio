(function () {
  'use strict';

  function normalizedText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function filterVariables(variables, query) {
    const needle = normalizedText(query);
    if (!needle) return Array.from(variables);
    return variables.filter((variable) => (
      normalizedText(variable.name).includes(needle)
      || normalizedText(variable.label).includes(needle)
    ));
  }

  globalThis.spssVariableFilter = Object.freeze({ filterVariables });
}());
