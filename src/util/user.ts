import os from 'node:os';
import { gitConfig } from './git.js';

/** Who is acting: KEEL_USER, then git user.name, then the OS user. */
export function currentUser(root: string): string {
  if (process.env.KEEL_USER) return process.env.KEEL_USER;
  const g = gitConfig(root, 'user.name');
  if (g) return g;
  try {
    return os.userInfo().username;
  } catch {
    return 'unknown';
  }
}
