/** Cached Mongoose connection (reused across serverless invocations and hot reloads). */
import mongoose from 'mongoose';
import { env } from './env';

interface Cache {
  promise?: Promise<typeof mongoose>;
}

const globalCache = globalThis as typeof globalThis & { __chromahuntMongoose?: Cache };
const cache: Cache = (globalCache.__chromahuntMongoose ??= {});

export async function connectDb(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  cache.promise ??= mongoose
    .connect(env().MONGODB_URI, {
      bufferCommands: false,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
    })
    .catch((error: unknown) => {
      cache.promise = undefined; // allow a retry on the next request
      throw error;
    });
  return cache.promise;
}

export async function disconnectDb(): Promise<void> {
  cache.promise = undefined;
  await mongoose.disconnect();
}

/**
 * Runs `work` inside a MongoDB transaction (requires a replica set, which Atlas provides).
 * The callback may run more than once on transient errors, so it must be idempotent.
 */
export async function inTransaction<T>(work: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
  await connectDb();
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
