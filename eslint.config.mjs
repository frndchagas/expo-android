import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Build output, plain Node test scripts, and tooling are not part of the
    // linted TypeScript sources.
    ignores: ["dist/", "node_modules/", "tests/", "**/*.mjs"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        // ignoreRestSiblings covers the `const { serial: _serial, ...rest }`
        // idiom used to drop a key before forwarding options.
        { argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  }
);
