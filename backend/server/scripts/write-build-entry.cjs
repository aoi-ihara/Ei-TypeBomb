const { writeFileSync } = require('node:fs');

// tsc emits server and shared sources with their backend directory layout.
// Preserve the existing compiled entry point at dist/index.js.
writeFileSync('dist/index.js', 'require("./server/src/index.js");\n');
