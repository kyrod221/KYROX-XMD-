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

    logger.info(`🔄 Génération du code d'appairage pour: ${phoneNumber}`);

    // Créer un dossier de session temporaire
    const tempSessionDir = join(__dirname, `.sessions_temp_${Date.now()}`);

    try {
      // Initialiser l'état de session
      const { state, saveCreds } = await useMultiFileAuthState(tempSessionDir);

      let pairingCode = null;
      let sessionId = null;
      let socket = null;
      let responseSent = false;
      const connectionTimeout = setTimeout(() => {
        if (!responseSent && socket) {
          responseSent = true;
          res.status(500).json({
            status: false,
            message: 'Timeout: Impossible de générer le code d\'appairage. Vérifiez votre numéro.',
          });
          socket.logout().catch(() => {});
        }
      }, 60000); // 60 secondes timeout

      // Créer l'instance Baileys
      socket = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
      });

      // Événement de mise à jour de connexion
      socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        logger.info(`📊 Mise à jour connexion: ${connection}`);

        if (qr) {
          logger.info('📱 Code QR généré (mode QR)');
        }

        // Si connexion établie avec succès
        if (connection === 'open') {
          logger.info('✅ Connexion établie avec succès!');

          try {
            // Attendre que les credentials soient sauvegardés
            await new Promise((resolve) => setTimeout(resolve, 500));

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

                if (!responseSent) {
                  responseSent = true;
                  clearTimeout(connectionTimeout);
                  res.json({
                    status: true,
                    message: 'Session ID généré et envoyé sur WhatsApp',
                    sessionId: sessionId,
                    number: phoneNumber,
                  });
                }
              } catch (sendErr) {
                logger.error('⚠️ Erreur lors de l\'envoi du message:', sendErr.message);
                if (!responseSent) {
                  responseSent = true;
                  clearTimeout(connectionTimeout);
                  res.json({
                    status: true,
                    message: 'Session ID généré mais erreur lors de l\'envoi du message',
                    sessionId: sessionId,
                    number: phoneNumber,
                  });
                }
              }
            } else {
              logger.error('❌ Fichier creds.json non trouvé');
              if (!responseSent) {
                responseSent = true;
                clearTimeout(connectionTimeout);
                res.status(500).json({
                  status: false,
                  message: 'Erreur: fichier de credentials non trouvé',
                });
              }
            }
          } catch (error) {
            logger.error('❌ Erreur lors de la récupération du Session ID:', error.message);
            if (!responseSent) {
              responseSent = true;
              clearTimeout(connectionTimeout);
              res.status(500).json({
                status: false,
                message: 'Erreur lors de la génération du Session ID',
                error: error.message,
              });
            }
          } finally {
            // Déconnecter et nettoyer après 2 secondes
            setTimeout(async () => {
              try {
                await socket.logout();
                socket.ev.removeAllListeners();
                logger.info('✅ Déconnexion complète');
              } catch (e) {
                logger.warn('⚠️ Erreur lors de la déconnexion:', e.message);
              }

              // Supprimer le dossier de session temporaire
              try {
                if (fs.existsSync(tempSessionDir)) {
                  fs.rmSync(tempSessionDir, { recursive: true, force: true });
                  logger.info('🗑️ Dossier de session temporaire supprimé');
                }
              } catch (cleanErr) {
                logger.error('⚠️ Erreur lors du nettoyage:', cleanErr.message);
              }
            }, 2000);
          }
        }

        // Si déconnecté
        if (connection === 'close') {
          const shouldReconnect =
            lastDisconnect?.error?.output?.statusCode !==
            DisconnectReason.loggedOut;

          if (!shouldReconnect) {
            logger.info('👋 Utilisateur déconnecté volontairement');
            clearTimeout(connectionTimeout);
            // Nettoyer le dossier
            try {
              if (fs.existsSync(tempSessionDir)) {
                fs.rmSync(tempSessionDir, { recursive: true, force: true });
              }
            } catch (cleanErr) {
              logger.error('⚠️ Erreur lors du nettoyage final:', cleanErr.message);
            }
          }
        }
      });

      // Événement de mise à jour des credentials
      socket.ev.on('creds.update', saveCreds);

      // Événement d'erreur
      socket.ev.on('connection.error', (error) => {
        logger.error('❌ Erreur de connexion:', error);
        if (!responseSent) {
          responseSent = true;
          clearTimeout(connectionTimeout);
          res.status(500).json({
            status: false,
            message: 'Erreur de connexion: ' + error.message,
          });
        }
      });

      // Générer le code d'appairage en temps réel
      try {
        logger.info('📞 Demande du code d\'appairage...');
        pairingCode = await socket.requestPairingCode(phoneNumber);
        logger.info(`✅ Code d'appairage généré: ${pairingCode}`);

        if (!responseSent) {
          responseSent = true;
          clearTimeout(connectionTimeout);
          res.json({
            status: true,
            message: 'Code d\'appairage généré avec succès',
            code: pairingCode,
            number: phoneNumber,
          });
        }

        // Garder la connexion ouverte pour recevoir le Session ID
        // La connexion se ferme automatiquement après 60 secondes
      } catch (error) {
        logger.error('❌ Erreur lors de la génération du code:', error.message);
        if (!responseSent) {
          responseSent = true;
          clearTimeout(connectionTimeout);
          res.status(500).json({
            status: false,
            message: 'Erreur lors de la génération du code d\'appairage: ' + error.message,
          });
        }

        // Nettoyer en cas d'erreur
        try {
          await socket.logout();
          socket.ev.removeAllListeners();
        } catch (e) {
          logger.warn('⚠️ Erreur lors de la déconnexion:', e.message);
        }

        try {
          if (fs.existsSync(tempSessionDir)) {
            fs.rmSync(tempSessionDir, { recursive: true, force: true });
          }
        } catch (cleanErr) {
          logger.error('⚠️ Erreur lors du nettoyage:', cleanErr.message);
        }
      }
    } catch (error) {
      logger.error('❌ Erreur lors de l\'initialisation:', error.message);
      if (!responseSent) {
        res.status(500).json({
          status: false,
          message: 'Erreur lors de l\'initialisation: ' + error.message,
        });
      }

      // Nettoyer le dossier
      try {
        if (fs.existsSync(tempSessionDir)) {
          fs.rmSync(tempSessionDir, { recursive: true, force: true });
        }
      } catch (cleanErr) {
        logger.error('⚠️ Erreur lors du nettoyage:', cleanErr.message);
      }
    }
  } catch (error) {
    logger.error('❌ Erreur générale:', error.message);
    res.status(500).json({
      status: false,
      message: 'Erreur serveur: ' + error.message,
    });
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
  logger.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('❌ Uncaught Exception:', error);
  process.exit(1);
});
