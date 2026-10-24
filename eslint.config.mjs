import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "src/**/*.js",
      "client/**/*.js",
      "load-tests/**/*.js",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Functional core: the domain must stay pure (no I/O, no clock, no randomness, no classes).
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "pg",
                "fastify",
                "zod",
                "node:*",
                "../db/*",
                "../http/*",
                "../consume/*",
              ],
              message:
                "src/domain must stay pure: no I/O or framework imports.",
            },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Date",
          property: "now",
          message: "Pass time in as a value; the domain has no clock.",
        },
        {
          object: "Math",
          property: "random",
          message: "The domain must be deterministic.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Pass time in as a value; the domain has no clock.",
        },
        {
          selector: "ClassDeclaration",
          message: "Prefer plain data and functions in the domain.",
        },
      ],
    },
  },
);
