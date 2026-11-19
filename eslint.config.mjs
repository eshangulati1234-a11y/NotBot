import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**'] },
  ...ts.configs.recommended,
  { rules: { '@typescript-eslint/no-unused-vars': 'off', 'prefer-const': 'off' } },
);
