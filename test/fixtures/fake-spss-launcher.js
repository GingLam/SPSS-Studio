#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const readline = require('node:readline');

const capturePath = process.env.SPSS_STUDIO_FAKE_CAPTURE;
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let datasetChangedAfterError = false;

input.on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      id: '', ok: false, errorLevel: 3, output: '', warnings: [],
      error: String(error), durationMs: 0,
    })}\n`);
    return;
  }
  if (capturePath) {
    fs.appendFileSync(capturePath, `${JSON.stringify(request)}\n`, 'utf8');
  }
  const response = {
    id: request.id,
    ok: true,
    errorLevel: 0,
    output: '',
    warnings: [],
    error: null,
    durationMs: 2,
    engineAlive: request.op !== 'shutdown',
  };
  if (request.op === 'run') {
    fs.mkdirSync(request.outputDirectory, { recursive: true });
    const htmlPath = `${request.outputDirectory}/output.html`;
    fs.writeFileSync(htmlPath, '<html><body><table><tr><td>Fake SPSS HTML output</td></tr></table></body></html>', 'utf8');
    if (request.syntax.includes('FORCE_ERROR')) {
      datasetChangedAfterError = true;
      response.ok = false;
      response.errorLevel = 3;
      response.error = 'Synthetic SPSS syntax error after a partial dataset change.';
      response.status = 'ERROR';
    } else {
      response.status = 'SUCCESS';
    }
    response.htmlPath = htmlPath;
  } else if (request.op === 'datasetInfo') {
    const variables = [
      { index: 0, name: 'age', label: 'Age', type: 'Numeric', format: 'F8.0', measurementLevel: 'Scale' },
      { index: 1, name: 'HouseholdIncome', label: 'Income', type: 'Numeric', format: 'F10.2', measurementLevel: 'Scale' },
    ];
    if (datasetChangedAfterError) {
      variables.push({
        index: 2,
        name: 'partiallyChanged',
        label: 'Created before error',
        type: 'Numeric',
        format: 'F8.0',
        measurementLevel: 'Scale',
      });
    }
    response.datasetInfo = {
      active: true,
      datasetName: 'FakeData',
      caseCount: 2,
      variableCount: variables.length,
      variables,
    };
  } else if (request.op === 'datasetPage') {
    response.datasetPage = {
      datasetName: 'FakeData',
      totalCases: 2,
      totalVariables: 2,
      offset: request.offset,
      limit: request.limit,
      variableStart: request.variableStart,
      variableLimit: request.variableLimit,
      variables: [
        { index: 0, name: 'age', label: 'Age', type: 'Numeric', format: 'F8.0', measurementLevel: 'Scale' },
        { index: 1, name: 'HouseholdIncome', label: 'Income', type: 'Numeric', format: 'F10.2', measurementLevel: 'Scale' },
      ],
      rows: [[20, 3000], [30, 5000]],
    };
  }
  const rendered = `${JSON.stringify(response)}\n`;
  const midpoint = Math.floor(rendered.length / 2);
  process.stdout.write(rendered.slice(0, midpoint));
  process.stdout.write(rendered.slice(midpoint));
  if (request.op === 'shutdown') {
    setTimeout(() => process.exit(0), 10);
  }
});
