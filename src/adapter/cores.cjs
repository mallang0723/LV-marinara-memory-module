// The memory cores as the service requires them ('./ledger.cjs' ...). Where the Lumiverse patches exist (src/memory/core-patch.mjs)
// the generated module is used, exactly as the screens' routes did before. Static requires so the bundler sees every module.
'use strict';
const table = {
  './ledger.cjs': require('../memory/core/ledger.cjs'),
  './scenes.cjs': require('../memory/core/scenes.generated.cjs'),
  './recall.cjs': require('../memory/core/recall.generated.cjs'),
  './vectors.cjs': require('../memory/core/vectors.cjs'),
  './speakers.cjs': require('../memory/core/speakers.cjs'),
  './translate.cjs': require('../memory/core/translate.cjs'),
  './selected.cjs': require('../memory/core/selected.cjs'),
  './aliases.cjs': require('../memory/core/aliases.cjs'),
  './names.cjs': require('../memory/core/names.generated.cjs'),
  './features.cjs': require('../memory/core/features.cjs'),
  './backup.cjs': require('../memory/core/backup.generated.cjs'),
  './address.cjs': require('../memory/core/address.generated.cjs'),
  './state.cjs': require('../memory/core/state.generated.cjs'),
  './places.cjs': require('../memory/core/places.generated.cjs'),
  './conflicts.cjs': require('../memory/core/conflicts.generated.cjs'),
  './keepsakes.cjs': require('../memory/core/keepsakes.generated.cjs'),
  './notebook.cjs': require('../memory/core/notebook.cjs'),
  './trackers.cjs': require('../memory/core/trackers.generated.cjs'),
  './reasons.cjs': require('../memory/core/reasons.generated.cjs'),
};
module.exports = table;
