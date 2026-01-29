import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Add browser globals for webview JavaScript files
    languageOptions: {
      globals: {
        console: "readonly",
        window: "readonly",
        document: "readonly",
        acquireVsCodeApi: "readonly",
      },
    },
    // Rules compatible with ESLint 9
    rules: {
      // TypeScript rules
      "@typescript-eslint/naming-convention": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Standard JavaScript rules
      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      semi: "off", // Base rule, not @typescript-eslint/semi
    },
  },
  {
    ignores: ["out/**", "dist/**", "**/*.d.ts"],
  },
];
