import { HOW, type Step, type StepResult } from '../content';

/** A step of the story, by id. */
export function step(id: Step['id']): Step {
  const found = HOW.steps.find((s) => s.id === id);
  if (!found) throw new Error(`No step ${id}`);
  return found;
}

/** A step's result, which must be of the given kind. */
export function result<K extends StepResult['kind']>(id: Step['id'], kind: K): Extract<StepResult, { kind: K }> {
  const found = step(id).result;
  if (found?.kind !== kind) throw new Error(`Step ${id} has no ${kind}`);
  return found as Extract<StepResult, { kind: K }>;
}
