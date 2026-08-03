/**
 * Suíte de ponta a ponta: sobe o AppModule inteiro contra um MySQL real.
 *
 * Fica fora do `npm run verify` de propósito. `verify` roda em qualquer
 * máquina, sem banco, e precisa continuar rápido; estes testes exigem
 * infraestrutura e são chamados por `npm run test:e2e`.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  rootDir: ".",
  testEnvironment: "node",
  testMatch: ["<rootDir>/test-e2e/**/*.e2e-spec.ts"],
  globalSetup: "<rootDir>/test-e2e/global-setup.ts",
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
  },
  testTimeout: 60_000,
  clearMocks: true,
};
