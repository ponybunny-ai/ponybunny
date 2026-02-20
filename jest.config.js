export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  setupFiles: ['<rootDir>/test/jest-setup.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.m?tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.test.json',
      },
    ],
  },
  testMatch: ['**/test/**/*.test.ts', '**/src/**/*.test.ts'],
  collectCoverageFrom: [
    'src/cli/**/*.ts',
    '!src/cli/index.ts',
  ],
  coverageDirectory: 'coverage',
};
