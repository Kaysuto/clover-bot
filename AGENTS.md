# AGENTS.md — Clover Bot

Bot Discord officiel du réseau Clover Games. Dépôt git indépendant au sein du workspace `Clover Games` (voir l'`AGENTS.md` racine pour les règles globales).

## Règles du dépôt

- **Aucun secret commité** : le token du bot et les identifiants vivent dans `.env` (non suivi). `.env.example` liste les clés attendues sans valeur.
- **Tout texte visible par un utilisateur est en français** (réponses de commandes, embeds, messages d'erreur).
- **Lecture seule sur les tables du site** : `users_meta` (miroir dans `src/db/site-schema.ts`) appartient au site — le bot ne doit JAMAIS y écrire. Les tables du bot sont préfixées `bot_*` et gérées par les migrations de CE dépôt uniquement (`tablesFilter: ["bot_*"]` dans `drizzle.config.ts`).
- **Pas de timer long en mémoire** : tout ce qui doit survivre à un redémarrage (giveaways, compteurs…) est relu depuis la DB par les jobs périodiques (`src/lib/scheduler.ts`).
- **Intent MessageContent activé pour la sécurité** (privilégié, coché dans le portail développeur) : anti-phishing, filtre NSFW, anti-spam de contenu et sauvegarde des derniers messages en dépendent. Le contenu ne se conserve que là où une protection l'exige (sauvegardes, incidents) ; l'XP, les statistiques et les autres modules ne le lisent pas. Au-delà de 100 guildes, Discord exige une demande justifiée pour le garder.
- **Les protections passent toutes par `modules/security`** : `isTrusted` (propriétaire, rôle de sécurité, bot, liste `bot_security_trusted`) décide qui n'est jamais sanctionné, `hasSecurityAuthority` (propriétaire ou rôle de sécurité) qui peut couper une protection, et `recordIncident` trace chaque mesure avant d'alerter, livrer le webhook sortant et relayer au réseau. Une sanction automatique est toujours réversible — rôles retirés plutôt que bannissement, exclusion temporaire plutôt qu'expulsion — et ce qu'il faut pour l'annuler va dans `restore`. Le rôle de sécurité ne se donne que par le propriétaire — tout autre octroi est retiré. Un module de `PROTECTED_MODULES` ne se coupe, depuis le dashboard comme depuis ses réglages `/config`, que par cette autorité.
- **Le bot ne doit jamais se prendre pour un attaquant** : ses propres actions (tickets fermés, vocaux temporaires, restaurations) passent par `isTrusted`, et les webhooks qu'il crée pour republier des messages sont dans `ownWebhooks` — l'anti-spam et l'anti-webhook les ignorent. Toute nouvelle action de masse du bot doit rester dans l'une de ces deux voies.
- **L'anti-nuke capture avant d'attendre** : un salon ou un rôle supprimé n'existe plus après le premier `await`. Les gestionnaires `on*Delete` photographient l'objet (et le cache de ses messages) dans leur partie synchrone, et les événements les appellent en parallèle des logs, jamais après. Les compteurs sont en mémoire (fenêtre de secondes) ; les sauvegardes, les restaurations (`bot_restore_jobs.idMap`), la préparation de la vérification (`verifyState`) et les livraisons du webhook sortant vivent en base et reprennent après un redémarrage.
- **Une restauration est différentielle** : elle recrée le manquant et remet l'existant à l'état sauvegardé, mais ne supprime jamais ce qui a été ajouté depuis. Les salons des catégories de tickets, candidatures et vocaux temporaires ne sont ni sauvegardés ni restaurés.
- **Le webhook sortant est une sortie vers une URL choisie par un tiers** : HTTPS seulement, adresses internes refusées à la résolution DNS même (`guardedLookup`, pas avant la requête), pas de redirection, secret chiffré au repos par `SECURITY_WEBHOOK_KEY` et montré une seule fois.
- **Réseau de serveurs ≠ `/reseau`** : `modules/network` partage bannissements et incidents entre guildes (tables `bot_networks*`) ; `/reseau` et `bot_servers` décrivent les serveurs Minecraft de Clover. Une guilde n'entre dans un réseau que par un code émis par le propriétaire du réseau et consommé par le propriétaire de la guilde. Les raisons préfixées `Réseau «` sont la garde anti-boucle : ne jamais les réutiliser ailleurs.
- **Deux tables de routage de composants** : `componentHandlers` (en guilde, typé `"cached"`) et `dmComponentHandlers` (en MP, sans guilde ni membre). Le sondage de départ est reçu en MP — son contexte vient donc du customId et de la base, jamais de `interaction.guild`.
- **La config de guilde est en cache mémoire** (`db/guild-config.ts`, TTL 60 s) : elle est lue à chaque message, chaque log et chaque tick de job. Toute écriture dans `bot_guild_config` passe par `updateGuildConfig`, ou appelle `invalidateGuildConfig` juste après (cas de l'incrément atomique du compteur de tickets). Même règle pour `bot_log_settings` via `setLogSetting`.
- **Les logs ne doivent jamais faire échouer un événement** : `sendLog` avale ses erreurs, et chaque appel depuis `events/` est suffixé d'un `.catch()`. Toute nouvelle catégorie s'ajoute dans `modules/logs/channel.ts` (`LOG_CATEGORIES`), le reste suit.

- **Les serveurs du réseau vivent en base, les mots de passe RCON dans le `.env`** : `bot_servers` (sans `guild_id` : elle décrit le réseau, pas la guilde) porte hôte, port et allocation RCON ; le mot de passe se lit dans `RCON_PASSWORD_<CLE>`, jamais en base — elle est partagée avec le site. `seedServers()` crée les six serveurs au démarrage, `/reseau` les modifie ensuite.
- **Une sanction est répercutée en jeu par des commandes configurables** : les défauts (`ban`, `pardon`, `kick`…) sont vanilla ; un plugin de sanctions impose de les redéfinir avec `/config moderation commande`. La propagation est diffusée à TOUS les serveurs dont le RCON répond (`rconBroadcast`) — un bannissement qui ne couvre que le lobby ne vaut rien.
- **Les règles AutoMod appartiennent à Discord** : `bot_automod_rules` ne retient que leur identifiant, jamais les mots, seuils ou exemptions, qui restent éditables dans les Paramètres du serveur. Le filtrage étant fait par Discord avant publication, il ne demande pas l'intent MessageContent — en revanche `content` et `matchedContent` de `autoModerationActionExecution` arrivent vides tant que cet intent est absent : ne jamais bâtir un traitement sur ces champs. Créer ou modifier une règle exige la permission « Gérer le serveur ».
- **LuckPerms est lu dans sa propre base** (`LUCKPERMS_DB_*`, `lib/lp-db.ts`), jamais via `mc-db.ts` : la base du plugin clover-core reste limitée aux tables du module `link`.
- **Le bot ne déplace jamais d'argent lui-même** : les crédits sont l'économie in-game du plugin (`economy`), pas une monnaie Discord. Toute lecture de solde, tout achat et tout versement passe par `lib/site-api.ts` → `/api/internal/bot/*` du site, qui tient le verrou, le débit RCON et la trace dans `shop_orders`. Ne jamais écrire dans l'économie MySQL ni recréer un catalogue : `bot_*` ne contient aucun solde.
- **Échelle de valeur : 100 crédits = 1,00 €**, et le jeu rapporte 1 crédit par heure active (`Plugin/clover/documentation/modules/economy.md`). Toute nouvelle récompense en crédits se compare à cette échelle avant d'être activée — une invitation payée trop cher devient une prime à la création de comptes.
- **Les récompenses de parrainage mûrissent avant d'être versées** : rien à l'arrivée, tout à J+7 après contrôle (âge du compte, filleul toujours présent, compte lié ou niveau atteint, anti-recyclage, plafond mensuel). Les crédits se versent **avant** l'XP, parce qu'ils sont idempotents côté site et l'XP non : un site injoignable doit laisser la ligne rejouable.
- **Le serveur d'entrée HTTP est un port public** (`lib/ingress.ts`) : il ne s'ouvre que si `VOTE_HTTP_PORT` est défini, et **chaque route porte son propre jeton** — `VOTE_TOKEN` pour `/vote`, `GAME_TOKEN` pour `/game`. Jamais de jeton partagé : celui des votes est distribué à des tiers (chaque liste le détient), alors que `/game` déclenche des actions de modération. Les jetons sont comparés en temps constant, c'est la seule protection ; ne jamais ajouter de route qui écrit sans passer par `registerIngressRoute`.
- **Une sanction reçue du jeu n'est jamais repropagée** : `applySanction`/`revokeSanction` acceptent `propagate: false`, que `modules/game` utilise systématiquement — sinon le bannissement repart en RCON, le plugin le renvoie, et la boucle s'installe. Deuxième garde-fou obligatoire côté entrée : sanction Discord déjà active, ou sanction identique de moins de deux minutes (`hasRecentSanction`), sont ignorées comme des échos de notre propre propagation.
- **L'anti-raid ne fait jamais d'action de masse** : un verrouillage ferme la porte (invitations coupées, vérification relevée) et n'expulse personne ; seul le contrôle d'âge écarte un compte, par quarantaine ou expulsion — jamais par bannissement, un faux positif devant rester réversible. L'échéance du verrouillage vit en base (`raidUntil`) et non en mémoire : un redémarrage ne doit pas laisser un serveur fermé sans personne pour le rouvrir (job `raid-lockdown`).

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
├─ modules/<feature>/  logique métier (antiraid, applications, automod, boost, game,
│                      giveaways, invites, leveling, logs, moderation, mc-counter,
│                      ranks, security, status, suggestions, sync, tempvoice, tickets, vote,
│                      welcome)
├─ db/                 schema.ts (tables bot_*), site-schema.ts (miroir RO),
│                      guild-config.ts (helper + cache), index.ts (pool pg + drizzle)
└─ lib/                logger, scheduler, ingress, servers, mc-status, rcon, lp-db,
                       heartbeat, embeds, ids, duration
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
