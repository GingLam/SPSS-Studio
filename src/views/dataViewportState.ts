export const DATA_ROW_NUMBER_WIDTH = 64;
export const DATA_VARIABLE_WIDTH = 160;
export const DATA_VARIABLE_CHUNK = 50;
export const DATA_VARIABLE_REQUEST_LIMIT = 200;

export interface VariableWindow {
  variableStart: number;
  variableLimit: number;
}

function alignedWindow(start: number, end: number, totalVariables: number): VariableWindow {
  if (totalVariables <= 0) {
    return { variableStart: 0, variableLimit: 1 };
  }
  const alignedStart = Math.max(0, Math.floor(start / DATA_VARIABLE_CHUNK) * DATA_VARIABLE_CHUNK);
  const alignedEnd = Math.min(
    totalVariables,
    Math.ceil(Math.max(end, alignedStart + 1) / DATA_VARIABLE_CHUNK) * DATA_VARIABLE_CHUNK,
  );
  return {
    variableStart: Math.min(alignedStart, Math.max(0, totalVariables - 1)),
    variableLimit: Math.min(DATA_VARIABLE_REQUEST_LIMIT, Math.max(1, alignedEnd - alignedStart)),
  };
}

export function calculateVariableWindow(
  scrollLeft: number,
  viewportWidth: number,
  totalVariables: number,
): VariableWindow {
  const contentLeft = Math.max(0, scrollLeft - DATA_ROW_NUMBER_WIDTH);
  const visibleStart = Math.floor(contentLeft / DATA_VARIABLE_WIDTH);
  const visibleEnd = Math.ceil((contentLeft + Math.max(1, viewportWidth)) / DATA_VARIABLE_WIDTH);
  const overscanStart = Math.max(0, visibleStart - 4);
  const overscanEnd = Math.min(totalVariables, visibleEnd + 4);
  return alignedWindow(overscanStart, overscanEnd, totalVariables);
}

export function normalizeVariableWindow(
  requestedStart: number,
  totalVariables: number,
  requestedLimit = DATA_VARIABLE_CHUNK,
): VariableWindow {
  if (totalVariables <= 0) {
    return { variableStart: 0, variableLimit: 1 };
  }
  const clamped = Math.min(Math.max(0, Math.trunc(requestedStart)), totalVariables - 1);
  const limit = Math.min(DATA_VARIABLE_REQUEST_LIMIT, Math.max(1, Math.trunc(requestedLimit)));
  return alignedWindow(clamped, clamped + limit, totalVariables);
}
