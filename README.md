# 🤖 KYROX Bot - WhatsApp Pairing Code Server

Serveur d'appairage WhatsApp autonome et complet basé sur **Baileys** et **Express**. Générez facilement des codes d'appairage 8 chiffres et des Session IDs pour connecter vos appareils WhatsApp.

## ✨ Caractéristiques

- ✅ **Génération de Pair Code** - Crée des codes d'appairage 8 chiffres
- ✅ **Session ID Base64** - Génère des Session IDs encodés en Base64 avec préfixe personnalisé
- ✅ **Interface Web** - UI moderne et réactive avec design gradient
- ✅ **Envoi WhatsApp** - Envoie automatiquement le Session ID par message privé
- ✅ **Nettoyage Automatique** - Supprime les sessions temporaires après utilisation
- ✅ **API REST** - Endpoints simples et documentés
- ✅ **Support Multi-Onglets** - Basculez entre Pair Code et Session ID
- ✅ **Responsive Design** - Fonctionne sur mobile et desktop

## 📋 Prérequis

- **Node.js** >= 16.x
- **npm** ou **yarn**
- Connexion Internet stable

## 🚀 Installation

### 1. Cloner le repository
```bash
git clone https://github.com/kyrod221/KYROX-XMD-.git
cd KYROX-XMD-
```

### 2. Installer les dépendances
```bash
npm install
```

### 3. Configurer l'environnement
```bash
cp .env.example .env
```

Éditez `.env` selon vos besoins :
```env
PORT=3000
BOT_PREFIX=KYROX
NODE_ENV=production
```

### 4. Démarrer le serveur
```bash
npm start
```

Ou en mode développement avec hot-reload :
```bash
npm run dev
```

Le serveur démarre sur `http://localhost:3000`

## 🎯 Utilisation

### Via l'Interface Web

1. Ouvrez `http://localhost:3000` dans votre navigateur
2. Entrez votre numéro WhatsApp au format international (ex: `33612345678`)
3. Cliquez sur **"Générer Pair Code"** ou **"Générer Session ID"**
4. Copiez le code/Session ID généré

### Via l'API REST

#### Générer un Pair Code

```bash
curl "http://localhost:3000/code?number=33612345678"
```

**Réponse:**
```json
{
  "status": true,
  "message": "Code d'appairage généré",
  "code": "12345678",
  "number": "33612345678"
}
```

#### Générer un Session ID

```bash
curl "http://localhost:3000/code?number=33612345678"
```

**Réponse:**
```json
{
  "status": true,
  "message": "Session ID généré et envoyé sur WhatsApp",
  "sessionId": "KYROX~eyJub2lzZUtleSI6eyJwcml2YXRlIjp7InR5cGUiOiJCdWZmZXIiLCJkYXRhIjpbMzEsNjcsOTYsNjEsLi4uXX0sInB1YmxpYyI6eyJ0eXBlIjoiQnVmZmVyIiwiZGF0YSI6WzE2NCwxNzIsNTQsNjIsLi4uXX19fQ==",
  "number": "33612345678"
}
```

#### Vérifier la santé du serveur

```bash
curl "http://localhost:3000/health"
```

**Réponse:**
```json
{
  "status": true,
  "message": "Serveur OK",
  "timestamp": "2026-08-28T10:30:00.000Z"
}
```

## 📁 Structure du Projet

```
KYROX-XMD-/
├── index.js                 # Serveur Express principal
├── package.json             # Dépendances Node.js
├── .env.example             # Configuration exemple
├── .gitignore               # Fichiers à ignorer
├── README.md                # Ce fichier
└── public/
    └── index.html           # Interface web frontend
```

## 🔧 Configuration Avancée

### Variables d'Environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `PORT` | Port du serveur | `3000` |
| `BOT_PREFIX` | Préfixe du Session ID | `KYROX` |
| `NODE_ENV` | Environnement (production/development) | `production` |

### Personnaliser le Préfixe Session ID

Modifiez `BOT_PREFIX` dans `.env`:

```env
BOT_PREFIX=MonBot
```

Le Session ID sera alors formaté comme: `MonBot~eyJ...`

## 🛡️ Sécurité

⚠️ **Important:**
- Ne partagez JAMAIS votre Session ID avec d'autres personnes
- Gardez vos credentials privés et sécurisés
- Utilisez HTTPS en production
- Configurez les variables d'environnement de manière sécurisée

## 🐛 Dépannage

### Le serveur ne démarre pas

```bash
# Vérifier si le port est déjà utilisé
lsof -i :3000

# Changer le port dans .env
PORT=3001
```

### Erreur: "Numéro de téléphone invalide"

- Assurez-vous d'utiliser le format international
- Exemple valides: `33612345678`, `212612345678`, `1234567890`

### Le Session ID n'est pas envoyé via WhatsApp

- Vérifiez votre connexion Internet
- Assurez-vous que le numéro est correct
- Attendez quelques secondes, l'envoi peut être lent

### Dossiers de session qui ne se nettoient pas

Les dossiers `.sessions_temp_*` sont supprimés automatiquement après utilisation. S'ils persistent:

```bash
# Supprimer manuellement
rm -rf .sessions_temp_*
```

## 📦 Dépendances

- **@whiskeysockets/baileys** - Bibliothèque WhatsApp
- **express** - Framework web
- **pino** - Logger performant
- **pino-pretty** - Formateur de logs
- **dotenv** - Gestion des variables d'environnement

## 🤝 Contribution

Les contributions sont bienvenues! N'hésitez pas à:
- Signaler des bugs
- Proposer des améliorations
- Soumettre des pull requests

## 📄 Licence

MIT © 2026 KYROX

## 👨‍💻 Auteur

**KYROX Bot** - [GitHub Profile](https://github.com/kyrod221)

---

## 🔗 Ressources Utiles

- [Baileys Documentation](https://github.com/WhiskeySockets/Baileys)
- [Express.js Guide](https://expressjs.com/)
- [WhatsApp Business API](https://www.whatsapp.com/business/developers)

## 💡 Tips & Astuces

### Héberger sur un serveur

```bash
# Avec PM2
npm install -g pm2
pm2 start index.js --name "kyrox-pairing"
pm2 save
pm2 startup
```

### Utiliser avec un domaine personnalisé

Configurez un reverse proxy (nginx/Apache):

```nginx
server {
    listen 80;
    server_name pairing.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Docker Support (optionnel)

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

---

**Besoin d'aide?** Consultez la section Dépannage ou ouvrez une issue sur GitHub.
