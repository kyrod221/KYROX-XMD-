import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} from '@whiskeysockets/baileys';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const logger = pino();

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Configuration
const PORT = process.env.PORT || 3000;
const BOT_PREFIX = process.env.BOT_PREFIX || 'KYROX';

// Endpoint pour générer le code d'appairage
app.get('/code', async (req, res) => {
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

    logger.info(`Génération du code d'appairage pour: ${phoneNumber}`);

    // Créer un dossier de session temporaire
    const tempSessionDir = join(__dirname, `.sessions_temp_${Date.now()}`);

    // Initialiser l'état de session
    const { state, saveCreds } = await useMultiFileAuthState(tempSessionDir);

    let sessionId = null;
    let socket = null;

    // Créer l'instance Baileys
    socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['KYROX Pairing Server', 'Safari', '2.0.0'],
    });

    // Événement de connexion
    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('Code QR généré (non utilisé en mode pairing)');
      }

      if (connection === 'open') {
        logger.info('✅ Connexion établie, récupération du Session ID...');

        try {
          // Attendre un peu pour que les credentials soient complètement sauvegardés
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Lire le fichier creds.json
          const credsPath = join(tempSessionDir, 'creds.json');
          if (fs.existsSync(credsPath)) {
            const credsData = fs.readFileSync(credsPath, 'utf8');
            const credsBase64 = Buffer.from(credsData).toString('base64');

            // Créer le Session ID avec le préfixe personnalisé
            sessionId = `${BOT_PREFIX}~${credsBase64}`;

            logger.info('✅ Session ID généré avec succès');

            // Envoyer le Session ID en message privé sur WhatsApp
            try {
              const jid = `${phoneNumber}@s.whatsapp.net`;
              await socket.sendMessage(jid, {
                text: `🤖 *${BOT_PREFIX} Bot Session*\n\n📋 *Session ID:*\n\`\`\`\n${sessionId}\n\`\`\`\n\n✅ Votre session est prête à l'emploi!\n\n⚠️ Gardez ce Session ID secret!`,
              });

              logger.info(`✅ Session ID envoyé à ${phoneNumber}`);

              // Retourner le Session ID au client
              res.json({
                status: true,
                message: 'Session ID généré et envoyé sur WhatsApp',
                sessionId: sessionId,
                number: phoneNumber,
              });
            } catch (sendErr) {
              logger.error('Erreur lors de l\'envoi du message:', sendErr);
              res.json({
                status: true,
                message:
                  'Session ID généré mais erreur lors de l\'envoi du message',
                sessionId: sessionId,
                number: phoneNumber,
              });
            }
          } else {
            logger.error('Fichier creds.json non trouvé');
            res.status(500).json({
              status: false,
              message: 'Erreur: fichier de credentials non trouvé',
            });
          }
        } catch (error) {
          logger.error('Erreur lors de la récupération du Session ID:', error);
          res.status(500).json({
            status: false,
            message: 'Erreur lors de la génération du Session ID',
            error: error.message,
          });
        } finally {
          // Déconnecter et nettoyer
          try {
            await socket.logout();
            socket.ev.removeAllListeners();
          } catch (e) {
            logger.warn('Erreur lors de la déconnexion:', e.message);
          }

          // Supprimer le dossier de session temporaire
          setTimeout(() => {
            try {
              if (fs.existsSync(tempSessionDir)) {
                fs.rmSync(tempSessionDir, { recursive: true, force: true });
                logger.info('Dossier de session temporaire supprimé');
              }
            } catch (cleanErr) {
              logger.error('Erreur lors du nettoyage:', cleanErr.message);
            }
          }, 1000);
        }
      }

      if (connection === 'close') {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !==
          DisconnectReason.loggedOut;

        if (shouldReconnect) {
          logger.warn('Reconnexion...');
        } else {
          logger.info('Utilisateur déconnecté');
          // Nettoyer le dossier
          try {
            if (fs.existsSync(tempSessionDir)) {
              fs.rmSync(tempSessionDir, { recursive: true, force: true });
            }
          } catch (cleanErr) {
            logger.error('Erreur lors du nettoyage final:', cleanErr.message);
          }
        }
      }
    });

    // Événement de creds-update
    socket.ev.on('creds.update', saveCreds);

    // Générer le code d'appairage
    try {
      const code = await socket.requestPairingCode(phoneNumber);
      logger.info(`📱 Code d'appairage: ${code}`);

      res.json({
        status: true,
        message: 'Code d\'appairage généré',
        code: code,
        number: phoneNumber,
      });
    } catch (error) {
      logger.error('Erreur lors de la génération du code:', error);
      res.status(500).json({
        status: false,
        message: 'Erreur lors de la génération du code d\'appairage',
        error: error.message,
      });

      // Nettoyer en cas d'erreur
      try {
        await socket.logout();
        socket.ev.removeAllListeners();
      } catch (e) {
        logger.warn('Erreur lors de la déconnexion:', e.message);
      }

      try {
        if (fs.existsSync(tempSessionDir)) {
          fs.rmSync(tempSessionDir, { recursive: true, force: true });
        }
      } catch (cleanErr) {
        logger.error('Erreur lors du nettoyage:', cleanErr.message);
      }
    }
  } catch (error) {
    logger.error('Erreur générale:', error);
    res.status(500).json({
      status: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
});

// Route de santé
app.get('/health', (req, res) => {
  res.json({
    status: true,
    message: 'Serveur OK',
    timestamp: new Date(),
  });
});

// Démarrer le serveur
app.listen(PORT, () => {
  logger.info(`🚀 Serveur de pairing WhatsApp en écoute sur le port ${PORT}`);
  logger.info(`📱 Accédez à: http://localhost:${PORT}`);
  logger.info(`🔗 API: GET /code?number=33612345678`);
});
