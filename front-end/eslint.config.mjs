module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 6,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  rules: {
    "@typescript-eslint/naming-convention": "warn",
    "@typescript-eslint/semi": "warn",
    curly: "warn",
    eqeqeq: "warn",
    "no-throw-literal": "warn",
    semi: "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_", // Ignore parameters starting with underscore
        varsIgnorePattern: "^_", // Ignore variables starting with underscore
        caughtErrorsIgnorePattern: "^_", // Ignore caught errors starting with underscore
      },
    ],
  },
  ignorePatterns: ["out", "dist", "**/*.d.ts"],
};
