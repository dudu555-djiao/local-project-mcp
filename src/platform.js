import path from 'node:path';
import os from 'node:os';

export function defaultDataDir(platform = process.platform, env = process.env) {
  if (env.LOCALREADER_DATA_DIR) return env.LOCALREADER_DATA_DIR;
  if (platform === 'win32') return path.win32.join(env.LOCALAPPDATA || path.win32.join(os.homedir(), 'AppData', 'Local'), 'LocalReaderMCP');
  return path.join(os.homedir(), 'Library/Application Support/LocalReaderMCP');
}

// Windows accepts aliases (ADS, devices and trailing dots) that must never become
// alternate ways to address files outside the ordinary relative-path contract.
export function validRelative(value, platform = process.platform) {
  if (typeof value !== 'string' || value.includes('\0')) return false;
  const impl = platform === 'win32' ? path.win32 : path;
  if (impl.isAbsolute(value) || value.split(/[\\/]/).includes('..')) return false;
  if (platform === 'win32' && value.split(/[\\/]/).some(part =>
    /[:<>"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) return false;
  return true;
}

export function samePath(a, b, platform = process.platform) {
  const impl = platform === 'win32' ? path.win32 : path;
  const normalize = value => platform === 'win32' ? impl.resolve(value).toLowerCase() : impl.resolve(value);
  return normalize(a) === normalize(b);
}

export function containsPath(root, target, platform = process.platform) {
  const impl = platform === 'win32' ? path.win32 : path;
  const relative = impl.relative(root, target);
  return !relative || (!impl.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + impl.sep));
}
