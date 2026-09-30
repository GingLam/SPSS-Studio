import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', 'syntaxes/*.json', '.vscode-test/**', '.work/**', 'test/fixtures/**/*.js'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    },
  },
  {
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['media/**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        acquireVsCodeApi: 'readonly',
        document: 'readonly',
        window: 'readonly',
      },
    },
  },
);
