import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import pino from 'pino';
import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} from '@whiskeysockets/baileys';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Configuration
const PORT = process.env.PORT || 3000;
const BOT_PREFIX = process.env.BOT_PREFIX || 'KYROX';

// Endpoint pour générer le code d'appairage
app.get('/code', async (req, res) => {
  const requestId = Date.now();
  let socket = null;
  let tempSessionDir = null;
  let responseSent = false;

  try {
    const { number } = req.query;

    if (!number) {
      return res.status(400).json({
        status: false,
        message: 'Veuillez fournir un numéro de téléphone (paramètre: number)',
      });
    }

    // Validation du numéro (format international)
    const phoneNumber = number.replace(/\D/g, '');
    if (phoneNumber.length < 10) {
      return res.status(400).json({
        status: false,
        message: 'Numéro de téléphone invalide',
      });
    }

    logger.info(`[${requestId}] 🔄 Génération du code d'appairage pour: ${phoneNumber}`);

    // Créer un dossier de session temporaire
    tempSessionDir = join(__dirname, `.sessions_temp_${requestId}`);

    // Initialiser l'état de session
    const { state, saveCreds } = await useMultiFileAuthState(tempSessionDir);

    let pairingCode = null;
    let sessionId = null;
    let connected = false;

    // Créer l'instance Baileys
    socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    // Timeout global pour la requête
    const globalTimeout = setTimeout(() => {
      if (!responseSent) {
        responseSent = true;
        logger.warn(`[${requestId}] ⏱️ Timeout global atteint`);
        res.status(500).json({
          status: false,
          message: 'Timeout: Impossible de générer le code. Vérifiez votre numéro et réessayez.',
        });
        cleanup();
      }
    }, 90000); // 90 secondes

    // Événement de mise à jour de connexion
    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      logger.info(`[${requestId}] 📊 État connexion: ${connection}`);

      if (qr) {
        logger.info(`[${requestId}] 📱 QR Code généré (mode scanning)`);
      }

      // Si connexion établie
      if (connection === 'open') {
        connected = true;
        logger.info(`[${requestId}] ✅ Connexion établie!`);

        try {
          // Attendre un peu pour que les credentials soient sauvegardés
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Lire le fichier creds.json
          const credsPath = join(tempSessionDir, 'creds.json');
          if (fs.existsSync(credsPath)) {
            const credsData = fs.readFileSync(credsPath, 'utf8');
            const credsBase64 = Buffer.from(credsData).toString('base64');

            // Créer le Session ID avec le préfixe personnalisé
            sessionId = `${BOT_PREFIX}~${credsBase64}`;

            logger.info(`[${requestId}] ✅ Session ID généré avec succès`);

            // Envoyer le Session ID en message privé sur WhatsApp
            try {
              const jid = `${phoneNumber}@s.whatsapp.net`;
              await socket.sendMessage(jid, {
                text: `🤖 *${BOT_PREFIX} Bot Session*\n\n📋 *Session ID:*\n\`\`\`\n${sessionId}\n\`\`\`\n\n✅ Votre session est prête à l'emploi!\n\n⚠️ Gardez ce Session ID secret!`,
              });

              logger.info(`[${requestId}] ✅ Session ID envoyé sur WhatsApp`);

              if (!responseSent) {
                responseSent = true;
                clearTimeout(globalTimeout);
                res.json({
                  status: true,
                  message: 'Session ID généré et envoyé sur WhatsApp',
                  sessionId: sessionId,
                  number: phoneNumber,
                });
              }
            } catch (sendErr) {
              logger.warn(`[${requestId}] ⚠️ Erreur lors de l'envoi du message: ${sendErr.message}`);
              if (!responseSent) {
                responseSent = true;
                clearTimeout(globalTimeout);
                res.json({
                  status: true,
                  message: 'Session ID généré (mais erreur lors de l\'envoi du message)',
                  sessionId: sessionId,
                  number: phoneNumber,
                });
              }
            }
          } else {
            logger.error(`[${requestId}] ❌ Fichier creds.json non trouvé`);
            if (!responseSent) {
              responseSent = true;
              clearTimeout(globalTimeout);
              res.status(500).json({
                status: false,
                message: 'Erreur: credentials non trouvés',
              });
            }
          }
        } catch (error) {
          logger.error(`[${requestId}] ❌ Erreur Session ID: ${error.message}`);
          if (!responseSent) {
            responseSent = true;
            clearTimeout(globalTimeout);
            res.status(500).json({
              status: false,
              message: 'Erreur lors de la génération du Session ID: ' + error.message,
            });
          }
        }

        // Nettoyer après 3 secondes
        setTimeout(() => cleanup(), 3000);
      }

      // Si déconnecté
      if (connection === 'close') {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !==
          DisconnectReason.loggedOut;

        if (!shouldReconnect) {
          logger.info(`[${requestId}] 👋 Déconnecté`);
          clearTimeout(globalTimeout);
        }
      }
    });

    // Événement de mise à jour des credentials
    socket.ev.on('creds.update', saveCreds);

    // Événement d'erreur de connexion
    socket.ev.on('connection.error', (error) => {
      logger.error(`[${requestId}] ❌ Erreur connexion: ${error?.message || error}`);
      if (!responseSent) {
        responseSent = true;
        clearTimeout(globalTimeout);
        res.status(500).json({
          status: false,
          message: 'Erreur de connexion: ' + (error?.message || 'Connexion échouée'),
        });
      }
      cleanup();
    });

    // Générer le code d'appairage
    try {
      logger.info(`[${requestId}] 📞 Demande du code d'appairage...`);

      // Vérifier que requestPairingCode existe
      if (typeof socket.requestPairingCode !== 'function') {
        throw new Error('requestPairingCode n\'est pas une fonction disponible');
      }

      pairingCode = await socket.requestPairingCode(phoneNumber);
      logger.info(`[${requestId}] ✅ Code d'appairage: ${pairingCode}`);

      if (!responseSent) {
        responseSent = true;
        clearTimeout(globalTimeout);
        res.json({
          status: true,
          message: 'Code d\'appairage généré avec succès',
          code: pairingCode,
          number: phoneNumber,
        });
      }

      // Garder la connexion ouverte pour le Session ID
      // Elle se ferme automatiquement après 60-90 secondes
    } catch (error) {
      logger.error(`[${requestId}] ❌ Erreur génération code: ${error.message}`);
      if (!responseSent) {
        responseSent = true;
        clearTimeout(globalTimeout);
        res.status(500).json({
          status: false,
          message: 'Erreur lors de la génération du code d\'appairage: ' + error.message,
        });
      }

      cleanup();
    }

    // Fonction de nettoyage
    async function cleanup() {
      try {
        if (socket) {
          await socket.logout();
          socket.ev.removeAllListeners();
          logger.info(`[${requestId}] ✅ Socket fermé`);
        }
      } catch (e) {
        logger.warn(`[${requestId}] ⚠️ Erreur déconnexion: ${e.message}`);
      }

      // Supprimer le dossier de session temporaire
      setTimeout(() => {
        try {
          if (tempSessionDir && fs.existsSync(tempSessionDir)) {
            fs.rmSync(tempSessionDir, { recursive: true, force: true });
            logger.info(`[${requestId}] 🗑️ Dossier temporaire supprimé`);
          }
        } catch (cleanErr) {
          logger.warn(`[${requestId}] ⚠️ Erreur nettoyage: ${cleanErr.message}`);
        }
      }, 500);
    }
  } catch (error) {
    logger.error(`[${requestId}] ❌ Erreur générale: ${error.message}`);
    if (!responseSent) {
      res.status(500).json({
        status: false,
        message: 'Erreur serveur: ' + error.message,
      });
    }

    // Nettoyage d'urgence
    if (socket) {
      try {
        await socket.logout();
        socket.ev.removeAllListeners();
      } catch (e) {
        logger.warn(`[${requestId}] ⚠️ Erreur nettoyage d'urgence: ${e.message}`);
      }
    }

    if (tempSessionDir && fs.existsSync(tempSessionDir)) {
      try {
        fs.rmSync(tempSessionDir, { recursive: true, force: true });
      } catch (e) {
        logger.warn(`[${requestId}] ⚠️ Erreur suppression dossier: ${e.message}`);
      }
    }
  }
});

// Route de santé
app.get('/health', (req, res) => {
  res.json({
    status: true,
    message: 'Serveur OK',
    timestamp: new Date(),
    uptime: process.uptime(),
  });
});

// Route pour lister les sessions temporaires (debug)
app.get('/debug/sessions', (req, res) => {
  try {
    const files = fs.readdirSync(__dirname).filter((f) =>
      f.startsWith('.sessions_temp_')
    );
    res.json({
      status: true,
      tempSessions: files,
      count: files.length,
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      error: error.message,
    });
  }
});

// Démarrer le serveur
app.listen(PORT, () => {
  logger.info(`🚀 Serveur de pairing WhatsApp en écoute sur le port ${PORT}`);
  logger.info(`📱 Accédez à: http://localhost:${PORT}`);
  logger.info(`🔗 API: GET /code?number=33612345678`);
});

// Gestion des erreurs non capturées
process.on('unhandledRejection', (reason, promise) => {
  logger.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('❌ Uncaught Exception:', error);
});
