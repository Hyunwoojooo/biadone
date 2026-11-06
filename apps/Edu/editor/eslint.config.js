import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {ignores: ['node_modules/**', 'dist/**', 'data/**', '.cache/**', 'qa-artifacts/**']},
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {languageOptions: {globals: {...globals.browser, ...globals.node}}, rules: {'@typescript-eslint/no-explicit-any': 'error'}},
  {files: ['src/**/*.tsx'], plugins: {'react-hooks': hooks}, rules: {...hooks.configs.recommended.rules}},
);
