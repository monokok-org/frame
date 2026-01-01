/**
 * Seed Frames - intentionally empty
 *
 * Keep task-agnostic; learned frames should be created from observed behavior.
 */

import { LearnedFrame } from '../types/learned-frames.js';

export const NODEJS_FRAMES: LearnedFrame[] = [];
export const PYTHON_FRAMES: LearnedFrame[] = [];
export const RUST_FRAMES: LearnedFrame[] = [];
export const GO_FRAMES: LearnedFrame[] = [];

/**
 * Get ALL seed frames (empty in task-agnostic mode)
 */
export function getAllSeedFrames(): LearnedFrame[] {
  return [];
}

/**
 * Initialize workspace with seed frames (no-op by default)
 */
export async function seedFrames(frameStore: any): Promise<void> {
  const allFrames = getAllSeedFrames();

  if (allFrames.length === 0) {
    console.log('[SeedFrames] No seed frames configured (task-agnostic mode).');
    return;
  }

  let seededCount = 0;

  console.log(`[SeedFrames] Seeding ${allFrames.length} frames (task-agnostic)`);

  for (const frame of allFrames) {
    const existing = await frameStore.get(frame.id);
    if (!existing) {
      await frameStore.store(frame);
      seededCount++;
    }
  }

  console.log(`[SeedFrames] Seeded ${seededCount} new frames.`);
}
