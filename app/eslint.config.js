// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*'] },
  {
    rules: {
      // React Native Text nodes are not HTML; entity escaping would show literally on native.
      'react/no-unescaped-entities': 'off',
      // Live polling, photo URLs and capacity freshness are intentional, not render bugs.
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
