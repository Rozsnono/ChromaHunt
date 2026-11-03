const expo = require('eslint-config-expo/flat');

module.exports = [
  ...expo,
  { ignores: ['.expo/**', '.export/**', 'node_modules/**', 'dist/**'] },
];
