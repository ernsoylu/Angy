import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/next-env.d.ts",
      "**/coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // NestJS DI needs value imports for injected classes (emitDecoratorMetadata);
    // auto-fixing them to `import type` breaks injection at runtime.
    files: ["apps/api/**"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
  {
    // Plain-JS tooling scripts run under Node. Every .ts file in the workspace
    // escapes `no-undef` through typescript-eslint's eslint-recommended
    // overrides — the compiler already resolves those names — so these are the
    // only files in the repo the rule actually fires on, and it fires on
    // `console`/`process` because the config declares no environment.
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", Buffer: "readonly" },
    },
  },
);
