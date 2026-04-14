const fs = require('fs');
const path = require('path');

const playground = path.join(__dirname, '..', '..', 'playground');
if (!fs.existsSync(playground)) {
  console.error('[local] playground not found:', playground);
  console.error('  Create it at repo root or clone the monorepo layout (…/auto-remoteclient/playground).');
  process.exit(1);
}

process.env.SCAN_DIRS = playground;
process.env.LOCAL_PLAYGROUND_ONLY = '1';
