import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "runtime/**", "apps/api/src/generated/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["scripts/**/*.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly" } } },
  { rules: { "@typescript-eslint/no-explicit-any": "off" } }
);
