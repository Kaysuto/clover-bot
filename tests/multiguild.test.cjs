const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

test("la production démarre sans guilde Discord obligatoire", () => {
  const result = spawnSync(process.execPath, ["-e", "require('./dist/config.js')"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      DISCORD_TOKEN: "token",
      DISCORD_CLIENT_ID: "123456789012345678",
      DATABASE_URL: "postgresql://user:password@example.test/database",
      DISCORD_GUILD_ID: "",
      DEV_GUILD_ID: "",
      CLOVER_GUILD_IDS: "",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("les commandes publiques sont globales et le développement reste ciblé", () => {
  const source = readFileSync(path.resolve(__dirname, "../src/lib/command-sync.ts"), "utf8");
  assert.match(source, /Routes\.applicationCommands\(applicationId\)/);
  assert.match(source, /env\.DEV_GUILD_ID/);
  assert.match(source, /cloverCommands/);
});

test("le cycle d’installation est durable et idempotent", () => {
  const migration = readFileSync(path.resolve(__dirname, "../drizzle/0015_fearless_jimmy_woo.sql"), "utf8");
  const lifecycle = readFileSync(path.resolve(__dirname, "../src/db/guild-installations.ts"), "utf8");
  assert.match(migration, /bot_guild_installations/);
  assert.match(lifecycle, /onConflictDoUpdate/);
  assert.match(lifecycle, /removedAt: null/);
});
