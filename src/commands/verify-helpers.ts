import { filesForItem } from '../verify/review.js';
import type { ArtifactNode } from '../model/types.js';
import type { Project } from '../project.js';

export { escalateIfSensitive } from './lifecycle.js';

export function filesForItemSafe(project: Project, item: ArtifactNode): string[] {
  try {
    return filesForItem(project, item);
  } catch {
    return [];
  }
}
