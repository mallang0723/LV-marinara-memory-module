// The pinned upstream service.cjs as the upstream tests expect it (`require('../memory-module/lib/service.cjs')`): the same
// factory the extension uses, run once with the real `fs` and the real `process` (tests set DATA_DIR and setEngine themselves).
'use strict';
process.env.DATA_DIR ||= require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'lv-up-'));
const make = require('../src/memory/core/service.generated.cjs');
const cores = require('../src/adapter/cores.cjs');
const path = require('node:path');
const req = name => (name in cores ? cores[name] : require(name));
module.exports = make(req, process, { exports: {} });
