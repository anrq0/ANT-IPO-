# 📈 ant-ipo-watch

Veille IA sur l’introduction en bourse d’Anthropic (**ANT**, Nasdaq) : cours, graphiques, actus avec liens, formateur IA (questions/réponses) et **notifications iPhone** sur les gros événements.

- Zéro dépendance : Node.js 20+ uniquement.
- IA : API Google **Gemini** avec recherche Google (actus Reuters, CNBC, SEC…).
- Notifications : **ntfy** (app gratuite iPhone, aucune inscription).
- Chaque personne déploie sa propre instance avec sa propre clé : pas de coût partagé.

> ⚠️ Informations générées par IA, sans garantie. Ce n’est pas un conseil en investissement. La perte en capital est possible.

## Démarrage local
```bash
cp .env.example .env     # remplis GEMINI_API_KEY et NTFY_TOPIC
npm run dev              # http://localhost:3000
```

## Déploiement Render (gratuit)
1. Pousse ce dossier sur GitHub.
2. Render → **New → Blueprint** (ou Web Service) → choisis le dépôt. `render.yaml` est détecté.
3. Renseigne les variables : `GEMINI_API_KEY`, `NTFY_TOPIC`, (option) `ADMIN_TOKEN`, `PUBLIC_URL`.
4. **UptimeRobot** : monitor HTTP(s) sur `https://TON-APP.onrender.com/health`, intervalle 5 min (garde l’instance éveillée).

## Notifications iPhone (ntfy)
1. Installe l’app **ntfy** (App Store).
2. Appuie sur **+**, saisis ton `NTFY_TOPIC` (nom long et secret : quiconque le connaît lit tes alertes), serveur par défaut `ntfy.sh`.
3. Autorise les notifications iOS, puis clique sur « Envoyer une notification de test » dans le site.

Alertes envoyées : début de cotation, variation ≥ `ALERT_PRICE_PCT` % en 10 min, événement jugé important (≥ `ALERT_MIN_IMPORTANCE` sur 5) par l’IA. Un délai anti-spam s’applique par type.

## Variables
| Variable | Défaut | Rôle |
|---|---|---|
| `GEMINI_API_KEY` | — | Clé Google AI Studio |
| `NTFY_TOPIC` | — | Topic secret ntfy |
| `AI_SECONDS` | 300 | Fréquence analyse IA + actus |
| `PRICE_SECONDS` | 60 | Fréquence lecture du cours |
| `ALERT_PRICE_PCT` | 3 | Seuil d’alerte de variation |
| `ALERT_MIN_IMPORTANCE` | 4 | Seuil d’alerte IA |
| `LISTING_AT` | 2026-11-19T14:30:00Z | Début de lecture du cours |
| `SYMBOL` | ANT | Symbole Nasdaq |
| `ADMIN_TOKEN` | — | Protège le bouton de test |

## Limites connues
- **Quota Gemini** : une analyse par minute dépasserait sans doute le quota gratuit ; garde `AI_SECONDS` à 300 sauf si ton quota le permet.
- **Cours** : lu via une source non officielle (Yahoo), actif seulement après `LISTING_AT` ; peut être retardé ou bloqué. Vérifie toujours sur ton courtier.
- **Disque Render gratuit** : l’historique (`data.json`) est effacé à chaque redéploiement.
- Les questions au formateur sont limitées à 12 par heure et par adresse IP.

Licence MIT.
