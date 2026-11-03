/**
 * Client side colour pre-check (UX only: it avoids uploading obviously wrong photos and drives
 * the live hint). The server verification is authoritative and never trusts this value.
 * Uses the same colour math and centre weighting as the backend.
 */
import { evaluateColorMatch, type ColorEvaluation } from '@chromahunt/shared';
import { decode } from 'jpeg-js';

/** Evaluates a small JPEG (e.g. 48 px wide) against the target colour. Null if it cannot be decoded. */
export function precheckFromJpeg(bytes: Uint8Array, targetHex: string): ColorEvaluation | null {
  try {
    const image = decode(bytes, { useTArray: true, formatAsRGBA: false });
    if (image.width < 2 || image.height < 2) return null;
    return evaluateColorMatch(image.data, image.width, image.height, targetHex, { seed: 20240611 });
  } catch {
    return null;
  }
}

export type Hint = 'close' | 'almost' | 'far';

/** Maps a closeness score to the live hint shown on the camera. */
export function hintFor(closeness: number, threshold: number): Hint {
  if (closeness >= threshold) return 'close';
  return closeness >= threshold - 20 ? 'almost' : 'far';
}

/**
 * Photos far below the server threshold are blocked before uploading. The margin keeps the
 * client from rejecting photos the (more careful) server would still accept.
 */
export const BLOCK_MARGIN = 15;
export const blockThreshold = (serverThreshold: number): number => Math.max(0, serverThreshold - BLOCK_MARGIN);
