/** Password hashing with argon2id (OWASP minimum parameters: 19 MiB, 2 iterations, 1 lane). */
import { hash, verify } from '@node-rs/argon2';

const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

/** Never throws: a malformed hash simply fails verification. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Valid argon2id hash of a random value; verified against when the user does not exist (timing parity). */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('chromahunt-dummy-password-for-timing-parity');
  return dummyHash;
}
