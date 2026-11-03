/** Starts one in-memory MongoDB replica set (transactions need a replica set) for all tests. */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

export default async function setup({ provide }: TestProject) {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  provide('mongoUri', replSet.getUri('chromahunt_test'));
  return async () => {
    await replSet.stop();
  };
}
