import next from 'eslint-config-next';

const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'drizzle/**', 'data/**', 'tests/e2e/**'],
  },
  ...next,
];

export default config;
