/**
 * Starts a throw-away local MongoDB replica set for development (data in .data/mongo).
 * Usage: node scripts/dev-db.mjs   (keeps running; Ctrl+C to stop)
 */
import { mkdirSync } from 'node:fs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

mkdirSync('.data/mongo', { recursive: true });
const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger', dbName: 'chromahunt' },
  instanceOpts: [{ port: 27018, dbPath: '.data/mongo', storageEngine: 'wiredTiger' }],
});
console.log(`MongoDB ready: ${replSet.getUri('chromahunt')}`);
const stop = async () => {
  await replSet.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => undefined, 1 << 30);
