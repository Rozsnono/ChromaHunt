const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

// Expo's default config already understands pnpm workspaces (packages/shared).
const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css' });
