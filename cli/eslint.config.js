import eslint from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

export default [
  eslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    plugins: { "@typescript-eslint": tseslint },
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: "./tsconfig.json" },
      globals: { ...globals.node },
    },
    rules: {
      // Disable base rule in favour of the TypeScript-aware version below
      "no-unused-vars": "off",
      // Control characters in regex are intentional in terminal code (ANSI escapes)
      "no-control-regex": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": "off",
      "prefer-const": "error",
    },
  },
  {
    ignores: ["dist/**", "web-ui/**"],
  },
];
