# AGENTS.md — Clover Bot

Bot Discord officiel du réseau Clover Games. Dépôt git indépendant au sein du workspace `Clover Games` (voir l'`AGENTS.md` racine pour les règles globales).

## Règles du dépôt

- **Aucun secret commité** : le token du bot et les identifiants vivent dans `.env` (non suivi). `.env.example` liste les clés attendues sans valeur.
- **Tout texte visible par un utilisateur est en français** (réponses de commandes, embeds, messages d'erreur).
- **Lecture seule sur les tables du site** : `users_meta` (miroir dans `src/db/site-schema.ts`) appartient au site — le bot ne doit JAMAIS y écrire. Les tables du bot sont préfixées `bot_*` et gérées par les migrations de CE dépôt uniquement (`tablesFilter: ["bot_*"]` dans `drizzle.config.ts`).
- **Pas de timer long en mémoire** : tout ce qui doit survivre à un redémarrage (giveaways, compteurs…) est relu depuis la DB par les jobs périodiques (`src/lib/scheduler.ts`).
- **Intent MessageContent volontairement absent** : l'XP par message n'en a pas besoin (`messageCreate` s'émet sans lui). Ne pas l'ajouter sans raison forte — c'est aussi pourquoi les logs ne couvrent pas les messages supprimés/édités.
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
│                      mc-counter, status, tempvoice, tickets)
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
- **Phase 2 prévue** : liaison par code in-game via une table MySQL `clover_discord_link_codes` écrite par le module `discordlink` (à créer) du plugin clover-core — voir le pattern inbox dans `Plugin de Clover Games/clover/documentation/GADGET_SITE_INTEGRATION.md`. Le lien résultant vit dans `bot_minecraft_links` ; `users_meta` (site) prime toujours.
