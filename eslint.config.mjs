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
);