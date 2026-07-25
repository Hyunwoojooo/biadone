import { FlatCompat } from "@eslint/eslintrc";
import nextVitals from "eslint-config-next/core-web-vitals.js";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname
});

const eslintConfig = [
  ...compat.config(nextVitals),
  {
    ignores: [".next/**", ".open-next/**", ".wrangler/**", "node_modules/**"]
  }
];

export default eslintConfig;
