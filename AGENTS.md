# AGENTS.md — Clover Bot

Bot Discord officiel du réseau Clover Games. Dépôt git indépendant au sein du workspace `Clover Games` (voir l'`AGENTS.md` racine pour les règles globales).

## Règles du dépôt

- **Aucun secret commité** : le token du bot et les identifiants vivent dans `.env` (non suivi). `.env.example` liste les clés attendues sans valeur.
- **Tout texte visible par un utilisateur est en français** (réponses de commandes, embeds, messages d'erreur).
- **Lecture seule sur les tables du site** : `users_meta` (miroir dans `src/db/site-schema.ts`) appartient au site — le bot ne doit JAMAIS y écrire. Les tables du bot sont préfixées `bot_*` et gérées par les migrations de CE dépôt uniquement (`tablesFilter: ["bot_*"]` dans `drizzle.config.ts`).
- **Pas de timer long en mémoire** : tout ce qui doit survivre à un redémarrage (giveaways, compteurs…) est relu depuis la DB par les jobs périodiques (`src/lib/scheduler.ts`).
- **Intent MessageContent volontairement absent** : l'XP par message n'en a pas besoin (`messageCreate` s'émet sans lui). Ne pas l'ajouter sans raison forte — c'est aussi pourquoi les logs ne couvrent pas les messages supprimés/édités.
- **Deux tables de routage de composants** : `componentHandlers` (en guilde, typé `"cached"`) et `dmComponentHandlers` (en MP, sans guilde ni membre). Le sondage de départ est reçu en MP — son contexte vient donc du customId et de la base, jamais de `interaction.guild`.
- **La config de guilde est en cache mémoire** (`db/guild-config.ts`, TTL 60 s) : elle est lue à chaque message, chaque log et chaque tick de job. Toute écriture dans `bot_guild_config` passe par `updateGuildConfig`, ou appelle `invalidateGuildConfig` juste après (cas de l'incrément atomique du compteur de tickets). Même règle pour `bot_log_settings` via `setLogSetting`.
- **Les logs ne doivent jamais faire échouer un événement** : `sendLog` avale ses erreurs, et chaque appel depuis `events/` est suffixé d'un `.catch()`. Toute nouvelle catégorie s'ajoute dans `modules/logs/channel.ts` (`LOG_CATEGORIES`), le reste suit.

## Architecture

```
src/
├─ index.ts            bootstrap (client, events, arrêt propre)
├─ client.ts           CloverClient (intents, collections commands/components)
├─ config.ts           validation zod du .env (fail-fast)
├─ deploy-commands.ts  déploiement des slash commands (guild-scoped)
├─ components.ts       routage des customId "prefix:action:args" par préfixe
├─ commands/<domaine>/ commandes slash (1 fichier = 1 commande)
├─ events/             1 fichier = 1 événement gateway, logique déléguée aux modules
├─ modules/<feature>/  logique métier (leveling, giveaways, invites, logs, sync,
│                      mc-counter, status, tempvoice, tickets, welcome)
├─ db/                 schema.ts (tables bot_*), site-schema.ts (miroir RO),
│                      guild-config.ts (helper), index.ts (pool pg + drizzle)
└─ lib/                logger, scheduler, mc-status, rcon, embeds, ids, duration
```

## Commandes utiles

```bash
npm run dev          # tsx watch
npm run deploy       # déployer les slash commands sur DISCORD_GUILD_ID
npm run build && npm start
npm run db:generate  # nouvelle migration après modif de src/db/schema.ts
npm run db:migrate   # appliquer les migrations (Neon)
```

## Intégrations

- **PostgreSQL Neon** (partagé avec le site) : tables `bot_*` + lecture `users_meta`. Suivi de migrations séparé (`drizzle.__bot_migrations`).
- **Serveur Minecraft** : ping SLP via `minecraft-server-util` (`lib/mc-status.ts`), RCON optionnel (`lib/rcon.ts`, adapté de `siteweb/src/lib/rcon.ts`).
- **Liaison par code in-game** : `/lier` en jeu (module `link` du plugin clover-core) génère un code dans la table MySQL `clover_link_codes` ; `/lier code:XXXX` sur Discord le consomme (`src/lib/mc-db.ts`, UPDATE gardé à usage unique — contrat : `Plugin/clover/documentation/modules/link.md`) et écrit dans `bot_minecraft_links`. `users_meta` (site) prime toujours et le job `site-links-delta` (60 s) répercute les liaisons faites sur le site ; ne jamais écrire dans `users_meta`. Le bot recopie ensuite la liaison dans le miroir MySQL `clover_link_accounts` (`recordLinkMirror` / `forgetLinkMirror`) pour que `/lier` en jeu cesse de proposer Discord : écriture consultative, best-effort, et **uniquement les lignes `source = 'BOT'`** — celles du site décrivent une liaison Discord qui survit à un `/delier`.
