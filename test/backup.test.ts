import assert from "node:assert/strict";
import { describe, test } from "node:test";
import mongoose from "mongoose";

import {
  BackupError,
  applyBackup,
  collectBackup,
  defaultBackupPath,
  parseBackup,
  serializeBackup,
  validateBackup,
  type BackupCollection,
  type BackupDatabase,
  type BackupFile,
} from "../src/server/backup";

class FakeCollection implements BackupCollection {
  docs: Record<string, unknown>[];

  constructor(docs: Record<string, unknown>[] = []) {
    this.docs = docs.map((doc) => ({ ...doc }));
  }

  find(_filter: Record<string, unknown> = {}) {
    return {
      toArray: async () => this.docs.map((doc) => ({ ...doc })),
    };
  }

  async deleteMany(_filter: Record<string, unknown>) {
    const deleted = this.docs.length;
    this.docs = [];
    return { deletedCount: deleted };
  }

  async insertMany(docs: unknown[], _options?: Record<string, unknown>) {
    const rows = docs as Record<string, unknown>[];
    this.docs.push(...rows.map((doc) => ({ ...doc })));
    return { insertedCount: rows.length };
  }

  async bulkWrite(ops: Record<string, unknown>[], _options?: Record<string, unknown>) {
    for (const op of ops) {
      const replace = op.replaceOne as {
        filter: { _id: unknown };
        replacement: Record<string, unknown>;
        upsert: boolean;
      };
      const index = this.docs.findIndex((doc) => String(doc._id) === String(replace.filter._id));
      if (index >= 0) this.docs[index] = { ...replace.replacement };
      else if (replace.upsert) this.docs.push({ ...replace.replacement });
    }
    return { ok: 1 };
  }
}

class FakeDb implements BackupDatabase {
  databaseName = "doochy_test";
  collections = new Map<string, FakeCollection>();

  constructor(initial: Record<string, Record<string, unknown>[]> = {}) {
    for (const [name, docs] of Object.entries(initial)) {
      this.collections.set(name, new FakeCollection(docs));
    }
  }

  listCollections() {
    return {
      toArray: async () =>
        [...this.collections.keys()].sort().map((name) => ({ name })),
    };
  }

  collection(name: string): FakeCollection {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new FakeCollection();
      this.collections.set(name, collection);
    }
    return collection;
  }
}

function validBackup(collections: Record<string, unknown[]>): BackupFile {
  return validateBackup({
    format: "doochy-backup",
    version: 1,
    createdAt: "2026-11-13T10:00:00.000Z",
    database: "doochy",
    collections,
  });
}

describe("backup snapshot", () => {
  test("collects every non-system collection and preserves BSON types", async () => {
    const id = new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
    const when = new Date("2026-11-12T14:00:00.000Z");
    const db = new FakeDb({
      users: [{ _id: id, createdAt: when }],
      "system.indexes": [{ _id: "ignored" }],
    });

    const backup = await collectBackup(db, {
      now: new Date("2026-11-13T10:00:00.000Z"),
      database: "doochy",
    });
    assert.deepEqual(Object.keys(backup.collections), ["users"]);

    const parsed = parseBackup(serializeBackup(backup));
    const user = parsed.collections.users[0] as { _id: unknown; createdAt: unknown };
    assert.ok(user._id instanceof mongoose.Types.ObjectId);
    assert.ok(user.createdAt instanceof Date);
    assert.equal(String(user._id), "507f1f77bcf86cd799439011");
    assert.equal((user.createdAt as Date).toISOString(), when.toISOString());
  });

  test("rejects malformed or future backups", () => {
    assert.throws(() => parseBackup("{}"), BackupError);
    assert.throws(() => parseBackup("not json"), BackupError);
    assert.throws(
      () => validateBackup({ ...validBackup({ users: [] }), version: 99 }),
      /unsupported backup version/
    );
    assert.throws(
      () => validateBackup({ ...validBackup({ users: [] }), collections: { users: "bad" } }),
      /not an array/
    );
    assert.throws(
      () => validateBackup({ ...validBackup({ users: [{ name: "missing id" }] }) }),
      /without _id/
    );
    assert.throws(
      () => validateBackup({ ...validBackup({ "system.indexes": [] }) }),
      /invalid collection name/
    );
  });

  test("builds a timestamped default path", () => {
    assert.equal(
      defaultBackupPath(new Date("2026-11-13T10:11:12.345Z")),
      "backups/doochy-2026-11-13T10-11-12-345Z.json"
    );
  });
});

describe("backup restore", () => {
  test("replace wipes collections present in the backup and leaves others alone", async () => {
    const db = new FakeDb({
      users: [
        { _id: "old", value: 1 },
        { _id: "extra", value: 2 },
      ],
      signals: [{ _id: "keep-me", value: 3 }],
    });

    const result = await applyBackup(
      db,
      validBackup({ users: [{ _id: "new", value: 9 }], empty: [] }),
      "replace"
    );

    assert.deepEqual(db.collection("users").docs, [{ _id: "new", value: 9 }]);
    assert.deepEqual(db.collection("signals").docs, [{ _id: "keep-me", value: 3 }]);
    assert.equal(db.collections.has("empty"), true);
    assert.deepEqual(result.collections, [
      { name: "empty", documents: 0 },
      { name: "users", documents: 1 },
    ]);
  });

  test("merge overwrites matching ids and keeps unrelated documents", async () => {
    const db = new FakeDb({
      users: [
        { _id: "a", value: 1 },
        { _id: "b", value: 2 },
      ],
    });

    const result = await applyBackup(
      db,
      validBackup({
        users: [
          { _id: "a", value: 10 },
          { _id: "c", value: 3 },
        ],
      }),
      "merge"
    );

    const byId = new Map(db.collection("users").docs.map((doc) => [String(doc._id), doc.value]));
    assert.equal(byId.get("a"), 10);
    assert.equal(byId.get("b"), 2);
    assert.equal(byId.get("c"), 3);
    assert.deepEqual(result.collections, [{ name: "users", documents: 2 }]);
  });
});
