/**
 * For tests: a small in-memory stand-in for a Mongoose model. It applies the filter and update
 * operators Taro's calendar code uses one document at a time, the way MongoDB does, so a test can run
 * real sync logic without a database. Anything it doesn't know throws, rather than quietly matching.
 */

import { randomBytes } from 'crypto';
import type { TestContext } from 'node:test';

export type Doc = Record<string, unknown> & { _id: string };
type Filter = Record<string, unknown>;
type Sort = Record<string, 1 | -1>;

const isPlain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

export function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (isPlain(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  return value;
}

/** A copy to hand out, with the one document method the calendar code calls. */
function handOut(doc: Doc | undefined | null): Doc | null {
  if (!doc) return null;
  const copy = clone(doc);
  Object.defineProperty(copy, 'toObject', { value: () => clone(doc), enumerable: false });
  return copy;
}

function get(doc: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (isPlain(value) ? value[key] : undefined), doc);
}

function put(doc: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let at = doc;
  for (const key of keys.slice(0, -1)) {
    if (!isPlain(at[key])) at[key] = {};
    at = at[key] as Record<string, unknown>;
  }
  at[keys[keys.length - 1]] = value;
}

function drop(doc: Record<string, unknown>, path: string) {
  const keys = path.split('.');
  const parent = keys.length > 1 ? get(doc, keys.slice(0, -1).join('.')) : doc;
  if (isPlain(parent)) delete parent[keys[keys.length - 1]];
}

const comparable = (value: unknown) => (value instanceof Date ? value.getTime() : value);

// A scalar matches an array field that contains it, as in MongoDB.
function equals(value: unknown, condition: unknown): boolean {
  if (Array.isArray(value) && !Array.isArray(condition)) return value.some((v) => comparable(v) === comparable(condition));
  if (condition === null) return value === undefined || value === null;
  return comparable(value) === comparable(condition);
}

function compare(value: unknown, bound: unknown, test: (a: number | string, b: number | string) => boolean): boolean {
  const a = comparable(value);
  const b = comparable(bound);
  return (typeof a === 'number' || typeof a === 'string') && typeof a === typeof b && test(a, b as number | string);
}

function matchCondition(value: unknown, condition: unknown): boolean {
  if (!isPlain(condition) || !Object.keys(condition).some((key) => key.startsWith('$'))) return equals(value, condition);
  return Object.entries(condition).every(([op, arg]) => {
    switch (op) {
      case '$in':
        return (arg as unknown[]).some((a) => equals(value, a));
      case '$nin':
        return !(arg as unknown[]).some((a) => equals(value, a));
      case '$ne':
        return !equals(value, arg);
      case '$exists':
        return (value !== undefined) === arg;
      case '$size':
        return Array.isArray(value) && value.length === arg;
      case '$type':
        return arg === 'string' ? typeof value === 'string' : arg === 'date' ? value instanceof Date : false;
      case '$gt':
        return compare(value, arg, (a, b) => a > b);
      case '$gte':
        return compare(value, arg, (a, b) => a >= b);
      case '$lt':
        return compare(value, arg, (a, b) => a < b);
      case '$lte':
        return compare(value, arg, (a, b) => a <= b);
      default:
        throw new Error(`memoryModel doesn't know ${op}`);
    }
  });
}

export function matches(doc: Doc, filter: Filter): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return (condition as Filter[]).some((f) => matches(doc, f));
    if (key === '$and') return (condition as Filter[]).every((f) => matches(doc, f));
    return matchCondition(get(doc, key), condition);
  });
}

function applyUpdate(doc: Doc, update: Record<string, unknown>, inserting: boolean) {
  for (const [op, fields] of Object.entries(update)) {
    if (!op.startsWith('$')) {
      // Mongoose reads a plain object as $set
      put(doc, op, clone(fields));
      continue;
    }
    for (const [path, value] of Object.entries(fields as Record<string, unknown>)) {
      switch (op) {
        case '$set':
          put(doc, path, clone(value));
          break;
        case '$unset':
          drop(doc, path);
          break;
        case '$inc':
          put(doc, path, ((get(doc, path) as number | undefined) ?? 0) + (value as number));
          break;
        case '$addToSet': {
          const list = (get(doc, path) as unknown[] | undefined) ?? [];
          put(doc, path, list.some((v) => equals(v, value)) ? list : [...list, clone(value)]);
          break;
        }
        case '$pull': {
          const list = get(doc, path);
          if (Array.isArray(list)) put(doc, path, list.filter((v) => !equals(v, value)));
          break;
        }
        case '$setOnInsert':
          if (inserting) put(doc, path, clone(value));
          break;
        default:
          throw new Error(`memoryModel doesn't know ${op}`);
      }
    }
  }
}

function sortDocs(docs: Doc[], sort?: Sort): Doc[] {
  if (!sort) return docs;
  return [...docs].sort((a, b) => {
    for (const [field, direction] of Object.entries(sort)) {
      const x = comparable(get(a, field)) as number | string | undefined;
      const y = comparable(get(b, field)) as number | string | undefined;
      if (x === y) continue;
      if (x === undefined) return -direction;
      if (y === undefined) return direction;
      return x < y ? -direction : direction;
    }
    return 0;
  });
}

const newId = () => randomBytes(12).toString('hex');

/** A query that runs when awaited, after select, sort, and limit are chained on, as Mongoose's do. */
function query<T>(run: (options: { sort?: Sort; limit?: number }) => T) {
  const options: { sort?: Sort; limit?: number } = {};
  const q = {
    select: () => q,
    lean: () => q,
    sort: (sort: Sort) => {
      options.sort = sort;
      return q;
    },
    limit: (limit: number) => {
      options.limit = limit;
      return q;
    },
    // Resolved on a later turn, so concurrent callers interleave the way they would against a database
    exec: () => new Promise<T>((resolve, reject) => setImmediate(() => {
      try {
        resolve(run(options));
      } catch (error) {
        reject(error);
      }
    })),
    then: <A, B = never>(onFulfilled?: (value: T) => A | PromiseLike<A>, onRejected?: (reason: unknown) => B | PromiseLike<B>) =>
      q.exec().then(onFulfilled, onRejected),
    catch: <B>(onRejected: (reason: unknown) => B | PromiseLike<B>) => q.exec().catch(onRejected),
  };
  return q;
}

export type MemoryModel = ReturnType<typeof memoryModel>;

export function memoryModel(initial: Array<Record<string, unknown>> = []) {
  const docs: Doc[] = initial.map((doc) => ({ _id: newId(), ...clone(doc) }) as Doc);
  const found = (filter: Filter) => docs.filter((doc) => matches(doc, filter));

  return {
    docs,
    find: (filter: Filter = {}) =>
      query(({ sort, limit }) => sortDocs(found(filter), sort).slice(0, limit ?? Infinity).map((doc) => handOut(doc)!)),
    findOne: (filter: Filter = {}) => query(({ sort }) => handOut(sortDocs(found(filter), sort)[0])),
    findById: (id: unknown) => query(() => handOut(docs.find((doc) => doc._id === String(id)))),
    exists: (filter: Filter) => query(() => (found(filter)[0] ? { _id: found(filter)[0]._id } : null)),
    countDocuments: (filter: Filter = {}) => query(() => found(filter).length),
    create: async (doc: Record<string, unknown>) => {
      const created = { _id: newId(), ...clone(doc) } as Doc;
      docs.push(created);
      return handOut(created)!;
    },
    findOneAndUpdate: (filter: Filter, update: Record<string, unknown>, options: { upsert?: boolean; new?: boolean; sort?: Sort } = {}) =>
      query(() => {
        const doc = sortDocs(found(filter), options.sort)[0];
        if (doc) {
          const before = clone(doc);
          applyUpdate(doc, update, false);
          return handOut(options.new ? doc : before);
        }
        if (!options.upsert) return null;
        const inserted = { _id: newId() } as Doc;
        for (const [key, value] of Object.entries(filter)) if (!key.startsWith('$') && !isPlain(value)) put(inserted, key, clone(value));
        applyUpdate(inserted, update, true);
        docs.push(inserted);
        return options.new ? handOut(inserted) : null;
      }),
    findOneAndDelete: (filter: Filter) =>
      query(() => {
        const doc = found(filter)[0];
        if (!doc) return null;
        docs.splice(docs.indexOf(doc), 1);
        return handOut(doc);
      }),
    updateOne: (filter: Filter, update: Record<string, unknown>) =>
      query(() => {
        const doc = found(filter)[0];
        if (!doc) return { matchedCount: 0, modifiedCount: 0 };
        const before = JSON.stringify(doc);
        applyUpdate(doc, update, false);
        return { matchedCount: 1, modifiedCount: JSON.stringify(doc) === before ? 0 : 1 };
      }),
    updateMany: (filter: Filter, update: Record<string, unknown>) =>
      query(() => {
        let modifiedCount = 0;
        const hit = found(filter);
        for (const doc of hit) {
          const before = JSON.stringify(doc);
          applyUpdate(doc, update, false);
          if (JSON.stringify(doc) !== before) modifiedCount++;
        }
        return { matchedCount: hit.length, modifiedCount };
      }),
    deleteOne: (filter: Filter) =>
      query(() => {
        const doc = found(filter)[0];
        if (doc) docs.splice(docs.indexOf(doc), 1);
        return { deletedCount: doc ? 1 : 0 };
      }),
    deleteMany: (filter: Filter) =>
      query(() => {
        const hit = found(filter);
        for (const doc of hit) docs.splice(docs.indexOf(doc), 1);
        return { deletedCount: hit.length };
      }),
  };
}

const METHODS = [
  'find',
  'findOne',
  'findById',
  'exists',
  'countDocuments',
  'create',
  'findOneAndUpdate',
  'findOneAndDelete',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
] as const;

/** Points a Mongoose model's queries at the in-memory one for the length of a test. */
export function useMemory(t: TestContext, model: object, memory: MemoryModel): MemoryModel {
  for (const name of METHODS) t.mock.method(model as Record<string, never>, name, memory[name] as never);
  return memory;
}
