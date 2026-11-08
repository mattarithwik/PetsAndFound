const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// The device and the API score drills from the same rules, including during offline play.
config.watchFolders.push(path.resolve(__dirname, '../services/agent/src/drills'));
config.server.enhanceMiddleware = require('./dev-api-proxy.cjs');
module.exports = config;
