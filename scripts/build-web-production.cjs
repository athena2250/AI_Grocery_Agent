// A hosted app must explicitly select the shared API rather than silently ship sandbox mode.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const value = process.env.EXPO_PUBLIC_API_URL;
let url;
try { url = new URL(value); } catch {}
if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || url.pathname !== '/' || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
  console.error('Set EXPO_PUBLIC_API_URL to your public HTTPS API origin before building for production.');
  process.exit(1);
}
const result = spawnSync('npm', ['run', 'build:web', '--', '--clear'], {
  cwd: path.join(__dirname, '..', 'mobile'), stdio: 'inherit', env: process.env,
});
if (result.error) console.error(result.error.message);
if (result.status !== 0) process.exit(result.status ?? 1);
const bundleDir = path.join(__dirname, '..', 'mobile', 'dist', '_expo', 'static', 'js', 'web');
const expected = value.replace(/\/+$/, '');
const containsApi = fs.readdirSync(bundleDir).filter((name) => name.endsWith('.js'))
  .some((name) => fs.readFileSync(path.join(bundleDir, name), 'utf8').includes(expected));
if (!containsApi) {
  console.error('Production bundle does not contain the configured API origin; refusing release.');
  process.exit(1);
}
console.log('Verified production web bundle API origin: ' + expected);
