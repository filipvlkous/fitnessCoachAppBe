const { ProgramsController } = await import('./dist/src/program/programs.controller.js');

// Tick counter: dels issued in the same tick are pipelined into ONE round trip
// by node-redis. Distinct tick values = distinct round trips.
let tick = 0;
const bump = () => { tick++; setImmediate(bump); };
setImmediate(bump);

const ticksUsed = new Set();
const keys = [];
const cacheManager = { del: async (k) => { keys.push(k); ticksUsed.add(tick); } };

const programsService = {
  getDayContext: async () => ({ athleteId: 'athlete-1', programId: 'prog-1', dayNumber: 3 }),
};
const ctrl = new ProgramsController(programsService, {}, {}, cacheManager);

// Coach edits a day belonging to their athlete - the common case.
await ctrl.invalidateDayCache('coach-1', 'day-9');

console.log(`keys deleted:            ${keys.length}`);
console.log(`distinct keys:           ${new Set(keys).size}`);
console.log(`redis round trips:       ${ticksUsed.size}   (was 4 before this change)`);
console.log('\nkeys cleared:');
for (const k of [...new Set(keys)].sort()) console.log('  ' + k);
