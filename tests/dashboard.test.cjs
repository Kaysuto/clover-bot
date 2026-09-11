const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
const http = require("node:http");
const { configPatch, period } = require("../dist/modules/dashboard/validation");
test("configuration bornée et champs sensibles refusés", () => {
  assert.equal(configPatch.safeParse({ guildId: "autre" }).success, false);
  assert.equal(configPatch.safeParse({ inviteMaturityDays: 0 }).success, false);
  assert.equal(
    configPatch.safeParse({ mcBanCommand: "ban test\nstop" }).success,
    false,
  );
  assert.equal(
    configPatch.safeParse({ welcomeDmMessage: "Bienvenue {user}" }).success,
    true,
  );
  assert.equal(
    period.safeParse({ from: "2026-09-12", to: "2026-09-11" }).success,
    false,
  );
});
function load(relative, mocks) {
  const exports = {};
  vm.runInNewContext(
    readFileSync(join(__dirname, "../dist", relative), "utf8"),
    {
      exports,
      require: (id) => (id in mocks ? mocks[id] : require(id)),
      Buffer,
      URL,
      URLSearchParams,
      setTimeout,
      clearTimeout,
      console,
    },
  );
  return exports;
}
test("désactivation conserve les clôtures et révocations", async () => {
  const m = load("modules/dashboard/modules.js", {
    "../../db/guild-config": {
      getGuildConfig: async () => ({ disabledModules: ["levels"] }),
    },
  });
  assert.equal(m.commandModule("sanction", "lever"), null);
  assert.equal(m.commandModule("sanction", "bannir"), "moderation");
  assert.equal(m.commandModule("giveaway", "end"), null);
  assert.equal(m.componentModule("ticket", "closeok"), null);
  assert.equal(m.componentModule("ticket", "open"), "tickets");
  assert.equal(await m.moduleEnabled("g", "levels"), false);
  assert.equal(await m.moduleEnabled("g", "tickets"), true);
});
test("entrée administrative : jeton dédié en en-tête et méthode POST uniquement", async () => {
  const reserve = http.createServer();
  await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
  const port = reserve.address().port;
  await new Promise((r) => reserve.close(r));
  const token = "dashboard-test-token-01234567890123456789";
  const ingress = load("lib/ingress.js", {
    "../config": { env: { VOTE_HTTP_PORT: port } },
    "./logger": { logger: { debug() {}, info() {}, warn() {}, error() {} } },
  });
  ingress.registerIngressRoute({
    path: "/admin",
    token,
    headerOnly: "x-dashboard-token",
    handle: async ({ payload }) => ({
      status: 200,
      message: "OK",
      data: { operation: payload.operation },
    }),
  });
  ingress.startIngress();
  try {
    const url = "http://127.0.0.1:" + port + "/admin";
    const request = (suffix, headers = {}, method = "POST") =>
      fetch(url + suffix, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body:
          method === "POST"
            ? JSON.stringify({ operation: "snapshot" })
            : undefined,
      });
    assert.equal((await request("?token=" + token)).status, 401);
    assert.equal((await request("", { "x-clover-token": token })).status, 401);
    assert.equal(
      (await request("", { "x-dashboard-token": token }, "GET")).status,
      405,
    );
    const valid = await request("", { "x-dashboard-token": token });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), {
      ok: true,
      message: "OK",
      data: { operation: "snapshot" },
    });
  } finally {
    await ingress.stopIngress();
  }
});
