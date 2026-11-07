// Render the pinned screen through the production Lumiverse patches, without generated-file prerequisites.
const fs = require('node:fs');
const path = require('node:path');
const { patchMemory } = require('../src/memory/ui/patch.mjs');
module.exports = () => patchMemory({ runtime: fs.readFileSync(path.join(__dirname, '../src/memory/ui/runtime.orig.js'), 'utf8'), uiCss: '', themeCss: '', version: 'test' });
