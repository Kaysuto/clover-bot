const { test } = require("node:test");
const assert = require("node:assert/strict");
const { skeleton, levenshtein, contentFingerprint } = require("../dist/modules/security/text");
const {
  classifyHost,
  extractUrls,
  hostOf,
  isNitroBait,
  defang,
} = require("../dist/modules/security/phishing-detect");
const {
  signPayload,
  parseKey,
  encryptSecret,
  decryptSecret,
  isPrivateAddress,
  validateWebhookUrl,
} = require("../dist/modules/security/signature");
const { randomCode, captchaMatches, captchaSvg } = require("../dist/modules/security/captcha");
const { createHmac } = require("node:crypto");

test("squelette : sosies de lettres et décorations ramenés à la même forme", () => {
  assert.equal(skeleton("Kimiya"), skeleton("K1miya"));
  assert.equal(skeleton("dіscord"), skeleton("discord")); // i cyrillique
  assert.equal(skeleton("Modérateur ✨"), skeleton("moderateur"));
  assert.equal(skeleton("rnod"), skeleton("mod"));
  assert.notEqual(skeleton("alice"), skeleton("bob"));
});

test("distance d'édition bornée", () => {
  assert.equal(levenshtein("discord", "discord"), 0);
  assert.equal(levenshtein("discord", "dicsord"), 2);
  assert.equal(levenshtein("abc", "abcdef", 1), 2); // interrompue au-delà du max
});

test("empreinte de contenu insensible aux variantes cosmétiques", () => {
  assert.equal(contentFingerprint("Rejoignez  VITE !!! discord.gg/x"), contentFingerprint("rejoignez vite discord.gg/x"));
  assert.equal(contentFingerprint("a​b"), contentFingerprint("ab"));
});

test("anti-phishing : domaines officiels, listés et imités", () => {
  const blocklist = new Set(["free-nitro.ru"]);
  assert.equal(classifyHost("discord.com", blocklist), null);
  assert.equal(classifyHost("cdn.discordapp.com", blocklist), null);
  assert.equal(classifyHost("clovergames.fr", blocklist), null);
  assert.equal(classifyHost("free-nitro.ru", blocklist), "liste");
  assert.equal(classifyHost("gift.free-nitro.ru", blocklist), "liste");
  assert.equal(classifyHost("dlscord.gift", blocklist), "imitation");
  assert.equal(classifyHost("disc0rd-app.com", blocklist), "imitation");
  assert.equal(classifyHost("discorrd.com", blocklist), "imitation");
  assert.equal(classifyHost("steamcommunlty.com", blocklist), "imitation");
  assert.equal(classifyHost("discord-nitro-gift.com", blocklist), "imitation");
  // Mots proches mais légitimes : ni « stream » ni « team » n'imitent une marque.
  assert.equal(classifyHost("stream.example.com", blocklist), null);
  assert.equal(classifyHost("teamspeak.com", blocklist), null);
  assert.equal(classifyHost("github.com", blocklist), null);
  // Domaine autorisé par la guilde.
  assert.equal(classifyHost("discordo.fr", blocklist, ["discordo.fr"]), null);
});

test("anti-phishing : extraction et appât Nitro", () => {
  const urls = extractUrls("regarde https://dlscord.gift/abc et [ici](https://x.com/y) ou www.exemple.fr");
  assert.deepEqual(urls, ["https://dlscord.gift/abc", "https://x.com/y", "www.exemple.fr"]);
  assert.equal(hostOf("https://WWW.Discord.com/app"), "discord.com");
  assert.equal(hostOf("pas une url"), null);
  assert.equal(isNitroBait("Free Nitro pour tous !", ["nitro-drop.xyz"]), true);
  assert.equal(isNitroBait("Nitro gratuit sur", ["discord.com"]), false);
  assert.equal(defang("https://a.b/c"), "hxxps://a[.]b/c");
});

test("webhook sortant : signature vérifiable par le destinataire", () => {
  const body = JSON.stringify({ event: "incident" });
  const header = signPayload("whsec_test", 1700000000, body);
  const expected = createHmac("sha256", "whsec_test").update(`1700000000.${body}`).digest("hex");
  assert.equal(header, `t=1700000000,v1=${expected}`);
});

test("webhook sortant : secret chiffré au repos", () => {
  const key = parseKey("a".repeat(64));
  assert.ok(key);
  const stored = encryptSecret(key, "whsec_abc");
  assert.notEqual(stored, "whsec_abc");
  assert.equal(decryptSecret(key, stored), "whsec_abc");
  assert.equal(decryptSecret(parseKey("b".repeat(64)), stored), null);
  assert.equal(parseKey("trop-court"), null);
});

test("webhook sortant : adresses internes refusées (SSRF)", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "198.18.0.1", "::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "2002:7f00:1::1"])
    assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
  assert.equal(validateWebhookUrl("https://hooks.exemple.fr/clover"), null);
  assert.ok(validateWebhookUrl("http://hooks.exemple.fr"));
  assert.ok(validateWebhookUrl("https://127.0.0.1/x"));
  assert.ok(validateWebhookUrl("https://[::ffff:127.0.0.1]/x")); // devient [::ffff:7f00:1] dans URL
  assert.equal(isPrivateAddress("::ffff:8.8.8.8"), false);
  assert.ok(validateWebhookUrl("https://localhost/x"));
  assert.ok(validateWebhookUrl("https://user:pass@exemple.fr"));
});

test("captcha : code lisible et comparaison tolérante à la casse", () => {
  const code = randomCode();
  assert.match(code, /^[A-HJKMNP-Z2-9]{5}$/);
  assert.equal(captchaMatches(code, ` ${code.toLowerCase()} `), true);
  assert.equal(captchaMatches(code, "ZZZZZZ"), false);
  const svg = captchaSvg("AB2CD");
  for (const char of "AB2CD") assert.ok(svg.includes(`>${char}</text>`));
});
