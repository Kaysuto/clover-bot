# 🍀 Clover Bot

Bot Discord officiel du réseau **Clover Games** (`clovergames.fr` · `play.clovergames.fr`).

## Fonctionnalités

| Fonctionnalité | Commandes | Détail |
|---|---|---|
| 📈 Niveaux | `/rank`, `/classement` | XP par message (anti-spam 60 s) + XP vocal, annonces de niveau, rôles récompense |
| 🎉 Concours | `/giveaway start\|end\|reroll\|list` | Participation par bouton, conditions (rôle, niveau min), reprise après redémarrage |
| 🔗 Invitations | `/invites voir\|classement` | Relié aux invitations natives Discord — les invitations déjà réalisées sont comptées au premier démarrage |
| 🔄 Synchro Minecraft | `/sync moi\|membre\|tout` | Pseudo Discord = pseudo Minecraft + rôle « Synchronisé », via la liaison de comptes du site |
| 🎮 Compteur de joueurs | `/config compteur joueurs-creer` | Salon vocal affichant le nombre de joueurs Minecraft en ligne (actualisé toutes les 6 min) |
| 👥 Compteur de membres | `/config compteur membres-creer` | Salon vocal affichant le nombre de membres du Discord, **bots exclus** |
| 🔊 Vocaux temporaires | `/voc …` | Rejoins « ➕ Créer ton vocal » → vocal + salon texte privé, verrouillage, limite, transfert… |
| 📊 Statut des services | `/statut` | Embed auto-actualisé (site web, serveur Minecraft, RCON) + alerte webhook en cas de panne |
| 🎫 Tickets | `/ticket setup\|add\|remove\|close` | Panneau à boutons, salons privés, transcript HTML archivé à la fermeture |
| ⚙️ Configuration | `/config …` | Tout se configure en slash commands (admin) |

## Installation

### 1. Portail développeur Discord

1. Ouvrir l'application existante sur <https://discord.com/developers/applications> (celle du site, `DISCORD_CLIENT_ID`).
2. Onglet **Bot** → ajouter un bot si absent → **Reset Token** → copier le token.
3. Activer **SERVER MEMBERS INTENT** (laisser *Message Content* et *Presence* **désactivés**).
4. Décocher **Public Bot**.
5. Inviter le bot :

```
https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&scope=bot+applications.commands&permissions=420867184
```

> ⚠️ Placer le rôle du bot **au-dessus** des rôles qu'il gère (« Synchronisé », rôles récompense) dans les paramètres du serveur.

### 2. Configuration locale

```bash
cp .env.example .env    # puis remplir DISCORD_TOKEN, DISCORD_GUILD_ID, DATABASE_URL…
npm install
npm run db:migrate      # crée les tables bot_* sur Supabase
npm run deploy          # publie les slash commands sur la guilde
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
/config niveaux salon-annonces salon:#niveaux
/config niveaux recompense niveau:5 role:@Actif
```

## Production (VPS + Docker)

```bash
# Sur le VPS
git clone <repo> && cd clover-bot
cp .env.example .env    # remplir DISCORD_TOKEN, DATABASE_URL (Supabase)…

docker compose up -d --build
docker compose logs -f bot
```

- `restart: unless-stopped` relance le conteneur automatiquement après un crash ou un redémarrage du VPS (tant que le démon Docker démarre au boot — actif par défaut sur la plupart des distributions).
- Les migrations (`npm run db:migrate`) et le déploiement des slash commands (`npm run deploy`) continuent de s'exécuter **hors du conteneur** (en local ou en CI), directement contre la base Supabase partagée — comme en développement. `DATABASE_URL` pointe sur `postgres_session` : le mode transaction de PgBouncer supporte mal le DDL.
- Mise à jour : `git pull && docker compose up -d --build`.

## Notes

- **Invitations** : l'API Discord ne permet pas de savoir rétroactivement *qui* a invité *qui* avant l'installation du bot — les totaux existants sont repris comme « historiques », le journal nominatif commence à l'installation.
- **Renommages** : Discord limite à 2 renommages / 10 min / salon — d'où l'actualisation des compteurs toutes les 6 min (et la même limite sur `/voc renommer`).
- **Statut du bot** : « Joue à play.clovergames.fr », réglable via `BOT_ACTIVITY_NAME` / `BOT_ACTIVITY_TYPE` dans `.env`. Déclaré à la connexion, donc conservé après une reconnexion gateway.
- Le bot ne peut pas renommer le **propriétaire du serveur** (limite Discord).
- **Phase 2 prévue** : liaison par code in-game (`/link` en jeu → `/lier` sur Discord) — nécessite le module `discordlink` dans le plugin clover-core.
