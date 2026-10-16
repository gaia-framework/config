import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'artifacts/**', '.evidence/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.mocha } },
    rules: {
      curly: ['error', 'all'],
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: ['return', 'function', 'class'] },
        { blankLine: 'always', prev: 'block-like', next: '*' }
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true
      }
    },
    rules: { '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }] }
  }
);
