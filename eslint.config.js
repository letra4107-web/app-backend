// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");
const globals = require("globals");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    files: ["backend/**/*.js", "metro.config.cjs", "babel.config.js", "jest.setup.js"],
    languageOptions: {
      globals: globals.node,
    },
  },
]);
