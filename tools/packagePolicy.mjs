import path from 'node:path';

const ROOT_FILES = new Set([
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'language-configuration.json',
  'package.json',
  'package.nls.json',
  'package.nls.zh-cn.json',
]);

const ASSET_PATTERNS = [
  /^images\/(?:[^/]+\.(?:png|svg))$/u,
  /^media\/(?:[^/]+\.(?:css|js))$/u,
  /^syntax\/(?:[^/]+\.json)$/u,
  /^syntaxes\/(?:[^/]+\.json)$/u,
  /^themes\/(?:[^/]+\.json)$/u,
  /^out\/src\/(?:.+\.js)$/u,
];

const ARCHIVE_METADATA = new Set([
  '[Content_Types].xml',
  'extension.vsixmanifest',
]);

const VSCE_RENAMED_FILES = new Map([
  ['changelog.md', 'CHANGELOG.md'],
  ['LICENSE.txt', 'LICENSE'],
  ['readme.md', 'README.md'],
]);

export function normalizePackagePath(value) {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (
    !normalized
    || normalized.startsWith('/')
    || normalized.includes('\0')
    || normalized.split('/').some((segment) => segment === '..')
  ) {
    throw new Error(`Unsafe package path: ${value}`);
  }
  return normalized;
}

export function isAllowedSourceFile(value) {
  const normalized = normalizePackagePath(value);
  return ROOT_FILES.has(normalized)
    || normalized === 'resources/bridge/spss_bridge.py'
    || ASSET_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function assertAllowedSourceFiles(values, phase = 'package input') {
  const files = values
    .map((value) => normalizePackagePath(value))
    .filter((value) => !value.endsWith('/'));
  const rejected = files.filter((value) => !isAllowedSourceFile(value));
  if (rejected.length > 0) {
    throw new Error(`${phase} contains forbidden files:\n${rejected.join('\n')}`);
  }
  const required = [
    'package.json',
    'media/spss-highlighter.js',
    'media/spss-syntax-data.js',
    'out/src/extension.js',
    'resources/bridge/spss_bridge.py',
    'themes/spss-studio-light-color-theme.json',
    'themes/spss-studio-dark-color-theme.json',
  ];
  const missing = required.filter((value) => !files.includes(value));
  if (missing.length > 0) {
    throw new Error(`${phase} is missing required files:\n${missing.join('\n')}`);
  }
  return files;
}

export function assertAllowedVsixEntries(values) {
  const sourceFiles = [];
  const rejected = [];
  for (const value of values) {
    const normalized = normalizePackagePath(value);
    if (normalized.endsWith('/')) {
      continue;
    }
    if (ARCHIVE_METADATA.has(normalized)) {
      continue;
    }
    if (!normalized.startsWith('extension/')) {
      rejected.push(normalized);
      continue;
    }
    const archiveFile = normalized.slice('extension/'.length);
    const sourceFile = VSCE_RENAMED_FILES.get(archiveFile) ?? archiveFile;
    if (!isAllowedSourceFile(sourceFile)) {
      rejected.push(normalized);
      continue;
    }
    sourceFiles.push(sourceFile);
  }
  if (rejected.length > 0) {
    throw new Error(`VSIX archive contains forbidden files:\n${rejected.join('\n')}`);
  }
  return assertAllowedSourceFiles(sourceFiles, 'VSIX archive');
}

export function listZipEntries(buffer) {
  const minimumEocdSize = 22;
  const maximumCommentSize = 0xffff;
  const firstCandidate = Math.max(0, buffer.length - minimumEocdSize - maximumCommentSize);
  let eocdOffset = -1;
  for (let offset = buffer.length - minimumEocdSize; offset >= firstCandidate; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('VSIX archive has no ZIP end-of-central-directory record.');
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    throw new Error('ZIP64 VSIX archives are not supported by the package verifier.');
  }
  if (centralDirectoryOffset + centralDirectorySize > eocdOffset) {
    throw new Error('VSIX central directory is outside the archive bounds.');
  }

  const entries = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('VSIX central directory contains an invalid entry.');
    }
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > buffer.length) {
      throw new Error('VSIX central directory contains a truncated filename.');
    }
    entries.push(buffer.toString('utf8', nameStart, nameEnd));
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

export function relativePackagePath(root, value) {
  return normalizePackagePath(path.relative(root, value));
}
