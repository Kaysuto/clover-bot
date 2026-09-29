# 🍀 Clover Bot

Bot Discord officiel du réseau **Clover Games** (`clovergames.fr` · `play.clovergames.fr`).

## Fonctionnalités

| Fonctionnalité | Commandes | Détail |
|---|---|---|
| 📈 Niveaux | `/rank`, `/classement` | XP par message (anti-spam 60 s) + XP vocal, annonces de niveau **en message privé**, rôles récompense (un MP par grade obtenu) |
| 🎉 Concours | `/giveaway start\|end\|reroll\|list` | Participation par bouton, conditions (rôle, niveau min), reprise après redémarrage |
| 🔗 Invitations | `/invites voir\|classement` | Relié aux invitations natives Discord — les invitations déjà réalisées sont comptées au premier démarrage |
| 🔄 Synchro Minecraft | `/sync moi\|membre\|tout` | Pseudo Discord = pseudo Minecraft + rôle « Synchronisé », via la liaison de comptes du site |
| 🎮 Compteur de joueurs | `/config compteur joueurs-creer` | Salon vocal affichant le nombre de joueurs Minecraft en ligne (actualisé toutes les 6 min) |
| 👥 Compteur de membres | `/config compteur membres-creer` | Salon vocal affichant le nombre de membres du Discord, **bots exclus** |
| 🔊 Vocaux temporaires | `/voc …` | Rejoins « ➕ Créer ton vocal » → vocal + salon texte privé, verrouillage, limite, transfert… |
| 📊 Statut des services | `/statut [serveur]` | Embed auto-actualisé : site web + **un bloc par serveur du réseau** (joueurs, adresse, RCON) et alerte webhook aux transitions |
| 🌐 Réseau | `/reseau liste\|ajouter\|modifier\|supprimer\|compteur` | Registre des serveurs (Lobby, PvP Soup, SkyPvP, Practice, Créatif, BedWars) : ping, RCON dédié, compteur vocal par serveur |
| 🔨 Modération | `/sanction avertir\|muter\|expulser\|bannir\|lever`, `/casier`, `/clear` | Historique complet, mutes et bans temporaires levés automatiquement, **répercussion sur les serveurs Minecraft** quand le compte est lié |
| 🚨 Anti-raid | `/config antiraid seuil\|duree\|age-minimum\|alerte\|deverrouiller\|voir`, `/securite seuils verrouillage` | Rafale d'arrivées → verrouillage (invitations coupées, vérification au maximum) et alerte staff ; compte trop récent → quarantaine ou expulsion, âge minimal relevé pendant un verrouillage |
| 💣 Anti-nuke | `/securite seuils antinuke` | Salons, rôles ou bannissements en série : l'auteur perd ses rôles sensibles, puis salons, permissions, porteurs de rôle et derniers messages sont recréés |
| 💾 Sauvegardes | `/sauvegarde creer\|liste\|voir\|restaurer\|supprimer` | Rôles, salons, permissions et derniers messages, toutes les 6 h et à la demande ; restauration différentielle (ne supprime jamais rien) |
| 🤖 Quarantaine des bots | `/securite bot attente\|autoriser\|expulser` | Chaque nouveau bot arrive avec son rôle vidé de toute permission jusqu'à l'autorisation du propriétaire |
| 🧹 Anti-spam | `/securite seuils antispam`, `/securite exemption salon-…` | Flood, mentions de masse, messages géants, même texte posté par plusieurs comptes ; exclusion temporaire graduée |
| 🎣 Anti-phishing | `/securite seuils phishing`, `/securite exemption domaine-…` | Faux Nitro, domaines imités (sosies de lettres, fautes de frappe) et liste publique de domaines d'hameçonnage : message supprimé, auteur exclu |
| 🪝 Anti-webhook | `/securite module` | Webhook créé par un compte non fiable supprimé ; webhook qui flood supprimé avec ses messages |
| 🔐 Vérification | `/securite verification activer\|desactiver` | Bouton ou captcha image : les arrivants ne voient que le salon de vérification ; expulsion optionnelle des non-vérifiés |
| 🔞 Filtre NSFW | `/securite seuils nsfw` | Liens vers des sites adultes supprimés, images analysées localement (modèle ONNX) hors salons NSFW |
| 👮 Surveillance du staff | `/securite seuils surveillance` | Rôle sensible donné à un compte à risque retiré ; copies du nom ou de l'avatar du staff signalées |
| 🔒 Autorité de sécurité | `/securite role\|confiance\|module\|incidents\|annuler\|statut` | Protections critiques coupables seulement par le propriétaire ou le rôle de sécurité qu'il est seul à donner ; chaque mesure est annulable |
| 🌐 Réseau de serveurs | `/securite reseau …` | Bannissements et incidents partagés entre serveurs d'un même réseau |
| 📤 Webhook sortant | `/securite webhook definir\|retirer\|tester` | Chaque incident POSTé en JSON, signé HMAC-SHA256, rejoué jusqu'à livraison |
| 📡 Événements du jeu | `/config jeu salon\|sanctions\|voir` | Le plugin pousse ses événements sur `/game` : sanction posée en jeu répercutée sur Discord, annonces de démarrage/arrêt des serveurs |
| 🛡️ AutoMod | `/config automod spam\|grossieretes\|mentions\|mots\|invitations\|exemption\|voir` | Règles natives Discord pilotées par le bot : spam, listes de grossièretés, plafond de mentions, mots interdits, liens d'invitation, exemptions de rôles/salons |
| 🧑 Fiche joueur | `/joueur` | Résolution croisée Discord ↔ Minecraft : niveau, sanctions, grades en jeu, dernier vote |
| 🏅 Grades | `/config grades …` | Groupes LuckPerms reflétés en rôles Discord (lecture seule de la base LuckPerms) |
| 🗳️ Votes | `/votes` | Endpoint HTTP pour les listes de serveurs : rôle temporaire, récompense en jeu, classement du mois |
| 💎 Boosts | `/config boosts …` | Remerciement public du booster et récompense in-game |
| 🪙 Boutique & pièces | `/boutique voir\|solde\|acheter` | Catalogue et solde lus sur le site, achat des grades payé en pièces in-game |
| 📨 Parrainage | `/invites`, `/config invitations …` | Annonce « qui a invité qui », XP et pièces versées après maturation et contrôles anti multi-comptes |
| 💡 Suggestions | `/suggestion` | Vote 👍/👎 par bouton, décision du staff en modale, auteur prévenu en MP |
| 📝 Candidatures | `/config candidatures …` | Panneau calqué sur les six postes du site, formulaire par poste, puis **un salon privé candidat ↔ jury** archivé avec transcript à la décision |
| 🎫 Tickets | `/ticket setup\|add\|remove\|note\|notes\|close` | Panneau à boutons, salons privés, notes internes invisibles de l'auteur, transcript HTML et notes archivés à la fermeture |
| 👋 Accueil & départ | `/config accueil …` | MP de bienvenue à l'arrivée, sondage privé « pourquoi es-tu parti ? » au départ, retours publiés côté staff + statistiques |
| 📋 Logs | `/config logs salon\|categorie\|voir` | 13 catégories activables avec l'auteur de chaque modification, salon dédié possible par catégorie |
| ⚙️ Configuration | `/config …` | Tout se configure en slash commands (admin) |

## Installation

### 1. Portail développeur Discord

1. Ouvrir l'application existante sur <https://discord.com/developers/applications> (celle du site, `DISCORD_CLIENT_ID`).
2. Onglet **Bot** → ajouter un bot si absent → **Reset Token** → copier le token.
3. Activer **SERVER MEMBERS INTENT** et **MESSAGE CONTENT INTENT** (ce dernier pour l'anti-phishing, l'anti-spam, le filtre NSFW et la sauvegarde des messages ; laisser *Presence* désactivé).
4. Décocher **Public Bot**.
5. Inviter le bot :

```
https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&scope=bot+applications.commands&permissions=8
```

> ℹ️ Le lien demande **Administrateur** : pour recréer un rôle ou un salon à l'identique, Discord exige que le bot possède lui-même chaque permission qu'il redonne. `/securite statut` liste les permissions manquantes et les rôles placés au-dessus du bot.

> ⚠️ Placer le rôle du bot **tout en haut** de la liste des rôles : il ne peut rien contre le porteur d'un rôle placé au-dessus du sien (anti-nuke, surveillance du staff, rôle de sécurité).

### 2. Configuration locale

```bash
cp .env.example .env    # puis remplir DISCORD_TOKEN, DISCORD_GUILD_ID, DATABASE_URL…
npm install
npm run db:migrate      # facultatif : applique les migrations avant le démarrage
npm run deploy          # publie les slash commands (le bot le fait aussi au démarrage)
npm run dev             # démarre en mode développement
```

### 3. Mise en place sur le serveur Discord

```
/config sync role role:@Synchronisé
/config tickets categorie categorie:🎫 Tickets
/config tickets archive salon:#archives-tickets
/config tickets role-support role:@Support
/ticket setup salon:#support
/config tempvoice creer
/config compteur joueurs-creer
/config compteur membres-creer
/config statut salon:#statut
/config logs salon salon:#logs
/config accueil depart-salon salon:#retours-depart
/config niveaux recompense niveau:5 role:@Actif
/config moderation propagation actif:true
/config suggestions salon salon:#suggestions
/config candidatures salon-staff salon:#candidatures
/config candidatures panneau salon:#recrutement
/config candidatures ouvrir actif:true
/config votes salon salon:#votes
/config boosts salon salon:#boosts
/reseau liste
```

> ℹ️ Les six serveurs du réseau sont enregistrés au premier démarrage. Chacun n'a un RCON opérationnel (statut, sanctions, récompenses) qu'une fois son mot de passe renseigné dans `RCON_PASSWORD_<CLE>` — `/reseau liste` indique lesquels manquent.

## Production (VPS + Docker)

```bash
# Sur le VPS
git clone <repo> && cd clover-bot
cp .env.example .env    # remplir DISCORD_TOKEN, DATABASE_URL (Supabase)…

docker compose up -d --build
docker compose logs -f bot
```

- `restart: unless-stopped` relance le conteneur automatiquement après un crash ou un redémarrage du VPS (tant que le démon Docker démarre au boot — actif par défaut sur la plupart des distributions).
- **Migrations** : le bot applique les migrations embarquées au démarrage, avant de se connecter à Discord et de lancer les jobs. Le journal reste `drizzle.__bot_migrations`, séparé de celui du site ; les migrations déjà appliquées ne sont pas rejouées. En cas d'échec, le processus sort en erreur. `npm run db:migrate` reste disponible en local ou en CI. Utiliser une connexion PostgreSQL directe ou le mode session de PgBouncer (`postgres_session`) pour `DATABASE_URL` : le verrou des migrations exige de conserver la même session.
- **Slash commands** : le bot compare ses commandes à celles enregistrées sur la guilde à chaque démarrage et ne republie qu'en cas d'écart — une commande ajoutée au code ne peut donc plus rester invisible sur Discord. `npm run deploy` reste utile pour publier sans redémarrer. Seules les commandes **de guilde** sont touchées : les commandes globales de l'application (intégration Minecraft) ne sont jamais écrasées.
- Mise à jour : `git pull && docker compose up -d --build`.

## Notes

- **Invitations** : l'API Discord ne permet pas de savoir rétroactivement *qui* a invité *qui* avant l'installation du bot — les totaux existants sont repris comme « historiques », le journal nominatif commence à l'installation.
- **Logs** : treize catégories — **Membres** (arrivées, départs, rôles, boosts), **Modération** (expulsions, bannissements, exclusions temporaires), **Vocal**, **Messages** (supprimés, modifiés, suppressions groupées — messages en cache seulement), **Salons et fils**, **Rôles**, **Serveur** (nom, icône, vérification, URL personnalisée…), **Invitations**, **Profils** (pseudos, noms, photos), **Émojis et stickers**, **Webhooks et intégrations** (dont les bots ajoutés), **AutoMod** et **Sécurité** (incidents des protections). L'auteur vient des logs d'audit quand Discord l'y inscrit. Tout part dans le salon par défaut ; `/config logs salon salon:#x categorie:vocal` dédie un salon à une catégorie et `/config logs categorie categorie:vocal actif:false` la coupe. Les vocaux temporaires sont exclus des logs de salons (sinon le journal serait noyé).
- **Accueil & départ** : à l'arrivée, un **MP de bienvenue** (texte personnalisable avec `/config accueil bienvenue-message`, variables `{user}`, `{server}`, `{count}`). Au départ, un **sondage privé en un clic** — 9 raisons proposées, puis un champ libre facultatif. Les **membres bannis ou expulsés en sont exclus** (vérification des logs d'audit) : ils n'ont pas choisi de partir et fausseraient les statistiques. Chaque réponse est publiée dans `/config accueil depart-salon` (à défaut le salon de logs) et `/config accueil retours [jours]` en donne la synthèse. ⚠️ **Discord n'autorise un MP que vers un utilisateur avec qui le bot partage un serveur** : au moment du départ, ce n'est plus le cas, et le MP ne passe que si une conversation privée existe déjà — c'est précisément le rôle du MP de bienvenue. Les envois impossibles sont comptés (`MP non remis`) pour ne jamais surestimer la représentativité des retours.
- **Niveaux** : les passages de niveau sont annoncés **en message privé** (jamais dans un salon), suivis d'un MP par grade débloqué. Si le membre a fermé ses MP, l'annonce est simplement ignorée — les rôles récompense sont attribués dans tous les cas. Modèle personnalisable : `/config niveaux message` (`{user}`, `{level}`, `{server}`).
- **AutoMod** : les règles sont **natives Discord** — le bot les crée et les modifie via `/config automod`, mais le filtrage est fait par Discord avant publication du message, donc sans l'intent *Message Content*. Cinq règles gérées (spam, listes de grossièretés, plafond de mentions, mots interdits, liens d'invitation) : `bot_automod_rules` ne stocke que leur identifiant, tout le contenu (mots, seuils, exemptions) vit chez Discord et reste visible dans **Paramètres du serveur → AutoMod**. Une règle supprimée à la main est simplement recréée à la prochaine activation. `/config automod exemption` applique un rôle ou un salon exempté à **toutes** les règles à la fois. Les déclenchements sont journalisés dans la catégorie de logs **AutoMod**.
- **Renommages** : Discord limite à 2 renommages / 10 min / salon — d'où l'actualisation des compteurs toutes les 6 min (et la même limite sur `/voc renommer`).
- **Statut du bot** : « Joue à play.clovergames.fr », réglable via `BOT_ACTIVITY_NAME` / `BOT_ACTIVITY_TYPE` dans `.env`. Déclaré à la connexion, donc conservé après une reconnexion gateway.
- Le bot ne peut pas renommer le **propriétaire du serveur** (limite Discord).
- **Liaison par code in-game** : `/lier` en jeu affiche un code, `/lier code:XXXX` sur Discord le consomme (pseudo + rôle lié appliqués aussitôt, `/delier` pour retirer). Nécessite les variables `MINECRAFT_DB_*` ; la liaison faite sur le site est répercutée en ~1 min.
- **Serveurs du réseau** : hôte, port et allocation RCON vivent en base (`/reseau modifier`), les **mots de passe RCON restent dans le `.env`** sous `RCON_PASSWORD_<CLE>` — la base est partagée avec le site. Un serveur sans mot de passe est pingé (statut, compteur) mais n'accepte ni sanction ni récompense.
- **Modération** : `/sanction` historise tout dans `bot_sanctions`, y compris les levées — `/casier` montre l'historique complet. Les mutes courts utilisent le **timeout natif** (il survit à l'arrêt du bot) ; au-delà de 28 jours ou si le timeout est refusé, le rôle de `/config moderation role-muet` prend le relais. La propagation en jeu est **désactivée par défaut** et diffuse la commande à tous les serveurs dont le RCON répond ; les commandes par défaut sont vanilla (`ban`, `pardon`, `kick`) et se redéfinissent avec `/config moderation commande` si un plugin de sanctions est installé. `/clear nombre:1-100` purge le salon (option `membre` pour ne viser qu'un auteur) : les messages épinglés et ceux de plus de 14 jours sont ignorés — limite de l'API Discord — et la purge est journalisée dans la catégorie **Modération**.
- **Votes** : la route `/vote` n'écoute que si `VOTE_HTTP_PORT` **et** `VOTE_TOKEN` sont renseignés. Les listes de serveurs appellent `POST` ou `GET /vote` avec le jeton (en-tête `X-Vote-Token` ou paramètre `token`) et le pseudo (`username`, `player`, `pseudo`…). Le vote d'un joueur non lié est historisé quand même : il comptera dès la liaison. ⚠️ `network_mode: host` oblige à n'ouvrir ce port que vers les IP des listes de serveurs.
- **Événements du jeu** : le plugin clover-core pousse sur `POST /game` (même port que les votes, **jeton distinct** `GAME_TOKEN` — les listes de vote sont des tiers, `/game` déclenche des actions de modération). Deux formes : `{"type":"sanction","action":"BAN|UNBAN|MUTE|UNMUTE|KICK|WARN","player":"Pseudo","uuid":"…","reason":"…","durationMs":3600000,"actor":"Staff","server":"lobby"}` et `{"type":"server","state":"START|STOP|CRASH","server":"lobby","detail":"…"}`. La répercussion des sanctions est **désactivée par défaut** (`/config jeu sanctions`) et ne concerne que les comptes liés ; elle n'est jamais renvoyée en RCON et ignore les échos de la propagation sortante (sanction identique de moins de 2 min, ou sanction Discord déjà en cours).
- **Anti-raid** : deux protections distinctes. Une **rafale d'arrivées** (`/config antiraid seuil`, désactivé par défaut) ferme la porte — invitations coupées et vérification portée au niveau élevé — pendant `/config antiraid duree` (15 min par défaut), avec alerte du staff ; l'échéance vit en base, donc un redémarrage rouvre quand même, et `/config antiraid deverrouiller` lève tout de suite. Un **compte trop récent** (`/config antiraid age-minimum`, désactivé par défaut) reçoit le rôle de quarantaine s'il est configuré, sinon est **expulsé** (jamais banni : un faux positif doit rester réversible) après un MP d'explication. Un verrouillage n'expulse personne : il ne fait qu'arrêter le flux.
- **Sécurité** : tout passe par `/securite` et `/sauvegarde`. Le **propriétaire** et les porteurs du **rôle de sécurité** (`/securite role`, que seul le propriétaire peut donner — tout autre octroi est retiré) sont les seuls à pouvoir couper une protection 🔒 (anti-raid, anti-nuke, anti-spam, anti-webhook, quarantaine des bots), depuis Discord comme depuis le dashboard. Les **comptes de confiance** (`/securite confiance`) ne sont jamais sanctionnés : y inscrire les administrateurs et les bots qui créent ou suppriment beaucoup (sinon trois suppressions de salons en dix secondes leur retirent leurs rôles). Chaque mesure est un **incident** (`/securite incidents`) publié dans `/securite alertes`, annulable par bouton ou `/securite annuler` (rôles rendus, exclusions levées). Une restauration recrée les objets avec de **nouveaux identifiants** : les messages republiés portent le nom et l'avatar de leur auteur et l'heure d'origine en petit, mais ce ne sont pas les originaux. L'activation de la vérification **fait une sauvegarde** puis donne le rôle « Vérifié » à tous les membres présents, par lots, avant de retirer la vue à @everyone. Le filtre d'images NSFW n'est actif qu'avec `NSFW_MODEL_PATH` (modèle ONNX à fournir, monté en volume dans Docker) et le webhook sortant qu'avec `SECURITY_WEBHOOK_KEY`.
- **Grades LuckPerms** : lecture seule d'une base **distincte** de celle du plugin (`LUCKPERMS_DB_*`). Seuls les rôles déclarés par `/config grades lier` sont ajoutés ou retirés — un rôle donné à la main hors de cette table n'est jamais touché.
- **Pièces** : ce sont **ceux du jeu**, pas une monnaie Discord — le bot n'en tient aucun compte. Il interroge `/api/internal/bot/*` du site, qui débite, livre et trace comme un achat fait sur `clovergames.fr`. Sans `SITE_API_URL`/`SITE_API_TOKEN`, la boutique et les pièces de parrainage sont simplement inactifs, le reste fonctionne. Référence : **100 pièces = 1,00 €**, et une heure de jeu actif rapporte 1 pièce.
- **Parrainage** : rien n'est versé à l'arrivée. Chaque invitation mûrit **7 jours** (`/config invitations conditions`), puis n'est validée que si le filleul est toujours là, que son compte Discord avait **30 jours** à son arrivée, qu'il a **lié son compte Minecraft** (ou atteint le niveau 3), qu'il n'était jamais venu, et que le parrain n'a pas dépassé son **plafond mensuel** (30). `/invites` montre les invitations en attente, validées et refusées avec leur motif. Par défaut : **250 XP et 3 pièces** par invitation validée, plus des paliers créés au premier démarrage (5 → 10, 10 → 25, 25 → 75, 50 → 200, 100 → 500 pièces). Cent filleuls réels rapportent donc ~1 110 pièces, l'ordre de grandeur d'un Prestige. ⚠️ Payer une invitation, c'est payer la création d'un compte : ne relever ces montants qu'en connaissance de cause — 3 pièces valent déjà 3 heures de jeu actif.
- **Candidatures** : les six postes et les questions reprennent le formulaire du site (`siteweb/src/lib/db/recruitment-defaults.ts`) — **toute modification y reste à répercuter à la main**, les deux formulaires ne partagent aucune table. Une modale Discord plafonne à **cinq champs texte** : on garde les deux questions communes (disponibilité, sanctions) puis trois questions du poste, et le panneau renvoie à <https://clovergames.fr/recruitment> pour les dossiers à portfolio ou captures. Le pseudo Minecraft n'est pas demandé : il vient de la liaison du candidat. Le formulaire ouvre ensuite **un salon privé** (`candidature-0007-modérateur`) entre le candidat, le jury (`/config candidatures role`) et le bot, dans la catégorie de `/config candidatures categorie` — l'échange se poursuit là, pas en MP. À la décision, le verdict est publié dans le salon puis doublé en MP, et le salon est archivé avec son transcript dans `/config candidatures archives` avant d'être supprimé. Un redémarrage pendant ce délai n'oublie rien : `reconcileApplications` rattrape les salons restés ouverts.
