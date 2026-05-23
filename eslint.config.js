import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-mobile',
      'release',
      'android/app/build',
      'android/.gradle',
      'build',
      'public/updates',
      'deploy/rnnoise/build',
      '.bolt',
      '.codex_tmp',
      '.vercel',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Treat as warnings rather than CI-blocking errors. We have a large
      // existing surface that uses `any` for Supabase row payloads and event
      // shims; banning it outright is more noise than signal. Re-tighten on
      // a per-file basis when we feel like it.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Unused vars are still useful as a hint, but not worth blocking a
      // release on. Underscored args/vars are explicitly intentional.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  }
);
