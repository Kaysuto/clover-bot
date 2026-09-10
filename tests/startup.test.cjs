const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const { readMigrationFiles } = require("drizzle-orm/migrator");

function load(file, dependencies, globals = {}) {
  const filename = path.resolve(__dirname, "../dist", file);
  const exports = {};
  runInNewContext(readFileSync(filename, "utf8"), {
    exports,
    __dirname: path.dirname(filename),
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Import inattendu : ${name}`);
      return dependencies[name];
    },
    ...globals,
  }, { filename });
  return exports;
}

for (const failure of [null, "migration", "unlock"]) {
  test(`Migrations : journal isolé, verrou et libération (${failure ?? "succès"})`, async () => {
    const calls = [];
    const expectedError = new Error("Échec simulé");
    const connection = {
      async query(sql) {
        const action = sql.includes("pg_advisory_unlock") ? "unlock" : "lock";
        calls.push(action);
        if (failure === action) throw expectedError;
      },
      release(destroy) {
        assert.equal(destroy, true);
        calls.push("release");
      },
    };
    const { migrateDatabase } = load("db/migrate.js", {
      "node:path": path,
      "./index": { pool: { connect: async () => connection } },
      "drizzle-orm/node-postgres": { drizzle: (client) => {
        assert.equal(client, connection);
        return client;
      } },
      "drizzle-orm/node-postgres/migrator": { migrate: async (client, config) => {
        calls.push("migration");
        assert.equal(client, connection);
        assert.equal(config.migrationsSchema, "drizzle");
        assert.equal(config.migrationsTable, "__bot_migrations");
        // Lit réellement le journal et tous les SQL au chemin utilisé en production.
        const migrations = readMigrationFiles(config);
        assert.ok(migrations.some(({ sql }) => sql.some((statement) =>
          statement.includes('ADD COLUMN "game_event_channel_id"'))));
        if (failure === "migration") throw expectedError;
      } },
    });
    if (failure) await assert.rejects(migrateDatabase(), (err) => err === expectedError);
    else await migrateDatabase();
    assert.deepEqual(calls, ["lock", "migration", "unlock", "release"]);
  });
}

for (const failMigration of [false, true]) {
  test(`Démarrage : ${failMigration ? "échec des migrations sans connexion Discord" : "Discord attend les migrations"}`, async () => {
    let finishMigration;
    let rejectMigration;
    const migration = new Promise((resolve, reject) => {
      finishMigration = resolve;
      rejectMigration = reject;
    });
    const logins = [];
    const exits = [];
    const fatals = [];
    class CloverClient {
      commands = new Map();
      components = new Map();
      dmComponents = new Map();
      async login(token) { logins.push(token); }
    }
    load("index.js", {
      "./client": { CloverClient },
      "./commands": { commands: [] },
      "./components": { componentHandlers: {}, dmComponentHandlers: {} },
      "./config": { env: { DISCORD_TOKEN: "test-token" } },
      "./db": { pool: {} },
      "./db/migrate": { migrateDatabase: () => migration },
      "./events": { events: [] },
      "./lib/logger": { logger: { info() {}, fatal: (...args) => fatals.push(args) } },
      "./lib/ingress": {},
      "./lib/scheduler": {},
    }, { process: { on() {}, exit(code) { exits.push(code); } } });
    assert.deepEqual(logins, []);
    if (failMigration) rejectMigration(new Error("Colonne manquante"));
    else finishMigration();
    await new Promise(setImmediate);
    assert.deepEqual(logins, failMigration ? [] : ["test-token"]);
    if (failMigration) {
      assert.deepEqual(exits, [1]);
      assert.match(fatals[0][1], /Migration de la base impossible/);
    } else {
      assert.deepEqual(exits, []);
    }
  });
}
