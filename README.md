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
| 🔨 Modération | `/sanction avertir\|muter\|expulser\|bannir\|lever`, `/casier` | Historique complet, mutes et bans temporaires levés automatiquement, **répercussion sur les serveurs Minecraft** quand le compte est lié |
| 🧑 Fiche joueur | `/joueur` | Résolution croisée Discord ↔ Minecraft : niveau, sanctions, grades en jeu, dernier vote |
| 🏅 Grades | `/config grades …` | Groupes LuckPerms reflétés en rôles Discord (lecture seule de la base LuckPerms) |
| 🗳️ Votes | `/votes` | Endpoint HTTP pour les listes de serveurs : rôle temporaire, récompense en jeu, classement du mois |
| 💎 Boosts | `/config boosts …` | Remerciement public du booster et récompense in-game |
| 🪙 Boutique & crédits | `/boutique voir\|solde\|acheter` | Catalogue et solde lus sur le site, achat des grades payé en crédits in-game |
| 📨 Parrainage | `/invites`, `/config invitations …` | Annonce « qui a invité qui », XP et crédits versés après maturation et contrôles anti multi-comptes |
| 💡 Suggestions | `/suggestion` | Vote 👍/👎 par bouton, décision du staff en modale, auteur prévenu en MP |
| 📝 Candidatures | `/config candidatures …` | Panneau de recrutement calqué sur les six postes du site, formulaire par poste, décision du staff et réponse en MP |
| 🎫 Tickets | `/ticket setup\|add\|remove\|close` | Panneau à boutons, salons privés, transcript HTML archivé à la fermeture |
| 👋 Accueil & départ | `/config accueil …` | MP de bienvenue à l'arrivée, sondage privé « pourquoi es-tu parti ? » au départ, retours publiés côté staff + statistiques |
| 📋 Logs | `/config logs salon\|categorie\|voir` | Arrivées/départs, profils, modération, vocal, salons & rôles — 4 catégories activables, salon dédié possible par catégorie |
| ⚙️ Configuration | `/config …` | Tout se configure en slash commands (admin) |

## Installation

### 1. Portail développeur Discord

1. Ouvrir l'application existante sur <https://discord.com/developers/applications> (celle du site, `DISCORD_CLIENT_ID`).
2. Onglet **Bot** → ajouter un bot si absent → **Reset Token** → copier le token.
3. Activer **SERVER MEMBERS INTENT** (laisser *Message Content* et *Presence* **désactivés**).
4. Décocher **Public Bot**.
5. Inviter le bot :

```
https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&scope=bot+applications.commands&permissions=420867312
```

> ℹ️ Par rapport à l'invitation d'origine, ce lien ajoute **Voir les logs d'audit** : c'est ce qui permet aux logs d'indiquer *qui* a expulsé, banni ou supprimé un salon. Sans cette permission le bot journalise quand même l'événement, mais sans son auteur.

> ⚠️ Placer le rôle du bot **au-dessus** des rôles qu'il gère (« Synchronisé », rôles récompense) dans les paramètres du serveur.

### 2. Configuration locale

```bash
cp .env.example .env    # puis remplir DISCORD_TOKEN, DISCORD_GUILD_ID, DATABASE_URL…
npm install
npm run db:migrate      # crée les tables bot_* sur Supabase
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
- Les migrations (`npm run db:migrate`) continuent de s'exécuter **hors du conteneur** (en local ou en CI), directement contre la base Supabase partagée — comme en développement. `DATABASE_URL` pointe sur `postgres_session` : le mode transaction de PgBouncer supporte mal le DDL.
- **Slash commands** : le bot compare ses commandes à celles enregistrées sur la guilde à chaque démarrage et ne republie qu'en cas d'écart — une commande ajoutée au code ne peut donc plus rester invisible sur Discord. `npm run deploy` reste utile pour publier sans redémarrer. Seules les commandes **de guilde** sont touchées : les commandes globales de l'application (intégration Minecraft) ne sont jamais écrasées.
- Mise à jour : `git pull && docker compose up -d --build`.

## Notes

- **Invitations** : l'API Discord ne permet pas de savoir rétroactivement *qui* a invité *qui* avant l'installation du bot — les totaux existants sont repris comme « historiques », le journal nominatif commence à l'installation.
- **Logs** : quatre catégories — **Membres** (arrivées avec âge du compte et invitation utilisée, départs, pseudos, rôles, boosts, photo de profil et nom d'utilisateur), **Modération** (expulsions, bannissements, exclusions temporaires), **Vocal** (connexions, déconnexions, déplacements), **Serveur** (salons, rôles, invitations). Tout part dans le salon par défaut ; `/config logs salon salon:#x categorie:vocal` dédie un salon à une catégorie et `/config logs categorie categorie:vocal actif:false` la coupe. Les vocaux temporaires sont exclus des logs de salons (sinon le journal serait noyé). **Pas de log de messages supprimés/édités** : cela demanderait l'intent *Message Content*, volontairement désactivé.
- **Accueil & départ** : à l'arrivée, un **MP de bienvenue** (texte personnalisable avec `/config accueil bienvenue-message`, variables `{user}`, `{server}`, `{count}`). Au départ, un **sondage privé en un clic** — 9 raisons proposées, puis un champ libre facultatif. Les **membres bannis ou expulsés en sont exclus** (vérification des logs d'audit) : ils n'ont pas choisi de partir et fausseraient les statistiques. Chaque réponse est publiée dans `/config accueil depart-salon` (à défaut le salon de logs) et `/config accueil retours [jours]` en donne la synthèse. ⚠️ **Discord n'autorise un MP que vers un utilisateur avec qui le bot partage un serveur** : au moment du départ, ce n'est plus le cas, et le MP ne passe que si une conversation privée existe déjà — c'est précisément le rôle du MP de bienvenue. Les envois impossibles sont comptés (`MP non remis`) pour ne jamais surestimer la représentativité des retours.
- **Niveaux** : les passages de niveau sont annoncés **en message privé** (jamais dans un salon), suivis d'un MP par grade débloqué. Si le membre a fermé ses MP, l'annonce est simplement ignorée — les rôles récompense sont attribués dans tous les cas. Modèle personnalisable : `/config niveaux message` (`{user}`, `{level}`, `{server}`).
- **Renommages** : Discord limite à 2 renommages / 10 min / salon — d'où l'actualisation des compteurs toutes les 6 min (et la même limite sur `/voc renommer`).
- **Statut du bot** : « Joue à play.clovergames.fr », réglable via `BOT_ACTIVITY_NAME` / `BOT_ACTIVITY_TYPE` dans `.env`. Déclaré à la connexion, donc conservé après une reconnexion gateway.
- Le bot ne peut pas renommer le **propriétaire du serveur** (limite Discord).
- **Liaison par code in-game** : `/lier` en jeu affiche un code, `/lier code:XXXX` sur Discord le consomme (pseudo + rôle lié appliqués aussitôt, `/delier` pour retirer). Nécessite les variables `MINECRAFT_DB_*` ; la liaison faite sur le site est répercutée en ~1 min.
- **Serveurs du réseau** : hôte, port et allocation RCON vivent en base (`/reseau modifier`), les **mots de passe RCON restent dans le `.env`** sous `RCON_PASSWORD_<CLE>` — la base est partagée avec le site. Un serveur sans mot de passe est pingé (statut, compteur) mais n'accepte ni sanction ni récompense.
- **Modération** : `/sanction` historise tout dans `bot_sanctions`, y compris les levées — `/casier` montre l'historique complet. Les mutes courts utilisent le **timeout natif** (il survit à l'arrêt du bot) ; au-delà de 28 jours ou si le timeout est refusé, le rôle de `/config moderation role-muet` prend le relais. La propagation en jeu est **désactivée par défaut** et diffuse la commande à tous les serveurs dont le RCON répond ; les commandes par défaut sont vanilla (`ban`, `pardon`, `kick`) et se redéfinissent avec `/config moderation commande` si un plugin de sanctions est installé.
- **Votes** : l'endpoint n'écoute que si `VOTE_HTTP_PORT` **et** `VOTE_TOKEN` sont renseignés. Les listes de serveurs appellent `POST` ou `GET /vote` avec le jeton (en-tête `X-Vote-Token` ou paramètre `token`) et le pseudo (`username`, `player`, `pseudo`…). Le vote d'un joueur non lié est historisé quand même : il comptera dès la liaison. ⚠️ `network_mode: host` oblige à n'ouvrir ce port que vers les IP des listes de serveurs.
- **Grades LuckPerms** : lecture seule d'une base **distincte** de celle du plugin (`LUCKPERMS_DB_*`). Seuls les rôles déclarés par `/config grades lier` sont ajoutés ou retirés — un rôle donné à la main hors de cette table n'est jamais touché.
- **Crédits** : ce sont **ceux du jeu**, pas une monnaie Discord — le bot n'en tient aucun compte. Il interroge `/api/internal/bot/*` du site, qui débite, livre et trace comme un achat fait sur `clovergames.fr`. Sans `SITE_API_URL`/`SITE_API_TOKEN`, la boutique et les crédits de parrainage sont simplement inactifs, le reste fonctionne. Référence : **100 crédits = 1,00 €**, et une heure de jeu actif rapporte 1 crédit.
- **Parrainage** : rien n'est versé à l'arrivée. Chaque invitation mûrit **7 jours** (`/config invitations conditions`), puis n'est validée que si le filleul est toujours là, que son compte Discord avait **30 jours** à son arrivée, qu'il a **lié son compte Minecraft** (ou atteint le niveau 3), qu'il n'était jamais venu, et que le parrain n'a pas dépassé son **plafond mensuel** (30). `/invites` montre les invitations en attente, validées et refusées avec leur motif. Par défaut : **250 XP et 3 crédits** par invitation validée, plus des paliers créés au premier démarrage (5 → 10, 10 → 25, 25 → 75, 50 → 200, 100 → 500 crédits). Cent filleuls réels rapportent donc ~1 110 crédits, l'ordre de grandeur d'un Prestige. ⚠️ Payer une invitation, c'est payer la création d'un compte : ne relever ces montants qu'en connaissance de cause — 3 crédits valent déjà 3 heures de jeu actif.
- **Candidatures** : les six postes et les questions reprennent le formulaire du site (`siteweb/src/lib/db/recruitment-defaults.ts`) — **toute modification y reste à répercuter à la main**, les deux formulaires ne partagent aucune table. Une modale Discord plafonne à **cinq champs texte** : on garde les deux questions communes (disponibilité, sanctions) puis trois questions du poste, et le panneau renvoie à <https://clovergames.fr/recruitment> pour les dossiers à portfolio ou captures. Le pseudo Minecraft n'est pas demandé : il vient de la liaison du candidat.
