// ESLint 9 flat config for the frontend workspaces (apps/*, packages/*, tests/e2e).
// Each workspace runs `eslint .` from its own folder; this root file is found by walking up.
// The infrastructure workspace keeps its own `tsc --noEmit` lint and is not covered here.
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      // Generated from the OpenAPI contract by packages/api-client/scripts/generate.mjs.
      "packages/api-client/src/generated/**",
      "infrastructure/**",
      "backend/**",
      // Playwright output and the signed-in browser state (tests/e2e/.gitignore).
      "tests/e2e/.auth/**",
      "tests/e2e/test-results/**",
      "tests/e2e/playwright-report/**",
      "tests/e2e/blob-report/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["apps/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat["recommended-latest"],
  },
  {
    files: ["apps/**/*.tsx"],
    ...jsxA11y.flatConfigs.recommended,
  },
  {
    // Node scripts and tool configs.
    files: ["**/*.{js,mjs,cjs}", "**/vite.config.ts", "**/vitest.config.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // The Playwright suite and its config run in Node.
    files: ["tests/e2e/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/test/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // Last: turns off every stylistic rule Prettier owns.
  prettier,
);
