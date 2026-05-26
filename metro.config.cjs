const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = path.resolve(__dirname);
const config = getDefaultConfig(projectRoot);
config.resolver.sourceExts = [...config.resolver.sourceExts, 'ts', 'tsx'];
module.exports = config;
