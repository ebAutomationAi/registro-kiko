// email-monitor.js — /registro-kiko/email-monitor.js — full replacement
'use strict';

const { ImapFlow } = require('imapflow');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const CAND_FILE = path.join(DATA_DIR, 'candidaturas.json');

const GMAIL_USER = () => process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = () => process.env.GMAIL_APP_PASSWORD;
const POLL_MS = () => parseInt(process.env.EMAIL_POLL_MS || '900000', 10);

let lastScan = null;
let lastResult = null;
let scanning = false;
let intervalId = null;

// ============================================
// BLACKLIST — remitentes que NUNCA son respuestas reales
// ============================================
const PORTAL_SENDERS = new Set([
  'ofertas@push.infojobs.net',
  'subscribe@es.jooble.org',
  'contact@jobijoba.com',
  'info@trabajo.org',
  'mailer@jobleads.com',
  'formacionrandstad@aularandstad.es',
  'survey@experiencia.randstad.es',
  'boletines@randstad.es',
  'alertas.empleate@sepe.es',
  'noreply-accounts@google.com',
  'info@glassdoor.com',
  'noreply@glassdoor.com',
  'invitations@linkedin.com',
  'jobs-noreply@linkedin.com',
  'jobalerts-noreply@linkedin.com',
  'newsletters-noreply@linkedin.com',
  'jobs-listings@linkedin.com',
  'messages-noreply@linkedin.com',
  'no-reply@alerts.talent.com',
  'jobemail-es@jobted.com',
  'noreply@joblookup.com',
  'donotreply@jobalert.indeed.com',
  'donotreply@match.indeed.com',
  'no-reply@indeed.com',
  'noreply@indeed.com',        // sin guión — variante Indeed
  'indeedapply@indeed.com',    // confirmaciones automáticas de solicitud Indeed
  'no-reply@manpowergroup.com', // "¡Gracias por inscribirte!", "¡Enhorabuena! Se ha creado tu cuenta"
  'system@info.jobtoday.com',  // alertas spam Jobtoday (≠ system@account.jobtoday.com que sí es real)
  'hello@render.com',
  'coursehero@email.coursehero.com',
]);

// Patrones de dominio siempre excluidos
const PORTAL_DOMAIN_PATTERNS = [
  /^donotreply@jobalert\./i,
  /^donotreply@match\./i,
  /^subscribe@/i,
  /@.*\.jooble\./i,
  /@.*linkedin\.com$/i,
  /^jobs-noreply@/i,
  /^jobalerts-noreply@/i,
  /^newsletters-noreply@/i,
  /^jobs-listings@/i,
  /^messages-noreply@/i,
  /^invitations@/i,
  /^no-reply@alerts\./i,
  /^noreply@joblookup/i,
];

function isPortalSender(from) {
  const addr = (from || '').toLowerCase().trim();
  if (PORTAL_SENDERS.has(addr)) return true;
  return PORTAL_DOMAIN_PATTERNS.some(p => p.test(addr));
}

// ============================================
// Extrae nombre de empresa del dominio remitente
// "emea.careers@transcom.com"           → "transcom"
// "notificaciones.randstad@randstad.es" → "randstad"
// "aldi_noreply@aldi.es"                → "aldi"
// "noreply@viterbit-mail.com"           → "viterbit"
// ============================================
function extractSenderCompany(from) {
  const domain = (from || '').split('@')[1] || '';
  const parts = domain.split('.');
  if (parts.length < 2) return '';
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  const isCcTld = ['co', 'com', 'org', 'net', 'gov', 'edu'].includes(sld) && tld.length === 2;
  const companyPart = isCcTld
    ? (parts.length >= 3 ? parts[parts.length - 3] : sld)
    : sld;
  return companyPart.replace(/-/g, '').toLowerCase();
}

// ============================================
// Limpia nombre de empresa para matching
// "Manpower (ETT — proyecto industria)" → "manpower"
// "ASAMA INTERGROUP SL"                 → "asama intergroup sl"
// "Randstad (grupo restauración)"       → "randstad"
// ============================================
function cleanEmpresaName(empresa) {
  return (empresa || '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s*—.*$/g, '')
    .replace(/[^\w\sáéíóúñü]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ============================================
// Asuntos que son alertas de portal o emails administrativos,
// NO respuestas reales a candidaturas
// ============================================
const ALERT_SUBJECT_PATTERNS = [
  /tu alerta\s*"/i,
  /ofertas de tu alerta/i,
  /se ha activado tu alerta/i,
  /bienvenid[oa@]/i,
  /has compartido.*datos/i,
  /has llegado al lugar/i,
  /te damos la bienvenida/i,
  // Inscripciones automáticas y emails administrativos
  /te has inscrito a una oferta de/i,
  /ya tienes una cuenta en/i,
  /gracias por inscribirte/i,
  /se ha creado tu cuenta/i,
  /validaci[oó]n de email/i,
  /resetea tu contraseña/i,
  /cambio de contraseña/i,
];

function isAlertSubject(subject) {
  return ALERT_SUBJECT_PATTERNS.some(p => p.test(subject || ''));
}

// ============================================
// MATCHING — lógica estricta:
// 1. Sender blacklisted           → false inmediato
// 2. Asunto administrativo        → false inmediato
// 3. Nombre empresa en asunto     → true
// 4. Dominio sender == empresa    → true
// El puesto NO se usa (demasiado genérico)
// ============================================
function emailMatchesCandidatura(subject, from, candidatura) {
  if (isPortalSender(from)) return false;
  if (isAlertSubject(subject)) return false;

  const subjectLower = (subject || '').toLowerCase();
  const empresa = cleanEmpresaName(candidatura.empresa);
  if (!empresa || empresa.length < 4) return false;

  // Nombre completo de empresa en el asunto
  if (empresa.length >= 5 && subjectLower.includes(empresa)) return true;

  // Primer token significativo del nombre en asunto
  // Umbral ≥ 7: evita tokens genéricos ("group", "global", "indeed", etc.)
  const firstToken = empresa.split(/\s+/)[0];
  if (firstToken.length >= 7 && subjectLower.includes(firstToken)) return true;

  // Dominio del remitente coincide con empresa
  const senderCompany = extractSenderCompany(from);
  if (senderCompany.length >= 5) {
    // Umbral ≥ 6 en firstToken: evita "group" (5 chars) matcheando "manpowergroup"
    if (empresa.split(/\s+/)[0].length >= 6 && senderCompany.includes(empresa.split(/\s+/)[0])) return true;
    if (empresa.includes(senderCompany)) return true;
  }

  return false;
}

// ============================================
// HELPERS JSON
// ============================================
function readCandidaturas() {
  if (!fs.existsSync(CAND_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(CAND_FILE, 'utf-8')); }
  catch { return []; }
}

function writeCandidaturas(data) {
  const tmp = CAND_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, CAND_FILE);
}

// ============================================
// SCAN PRINCIPAL
// ============================================
/**
 * Conecta a Gmail via IMAP, busca correos de los ultimos 60 dias y los
 * cruza contra las candidaturas guardadas. Si un email matchea una
 * candidatura que aun no lo tenia registrado, lo anade a
 * `emails_recibidos` y, si el estado seguia en fase de espera, lo pasa a
 * "Respuesta recibida". Persiste candidaturas.json solo si hubo cambios.
 *
 * Es reentrante-safe: si ya hay un scan en curso, devuelve de inmediato
 * `{ skipped: true, reason: ... }` sin abrir una segunda conexion IMAP.
 *
 * @returns {Promise<{scanned?: number, matches?: Array<object>, error?: string, skipped?: boolean, reason?: string}>}
 */
async function scanEmails() {
  if (scanning) return { skipped: true, reason: 'Scan en curso' };

  const user = GMAIL_USER();
  const pass = GMAIL_APP_PASSWORD();
  if (!user || !pass) {
    const err = 'GMAIL_USER o GMAIL_APP_PASSWORD no configurados en .env';
    console.error('[email-monitor]', err);
    return { error: err };
  }

  scanning = true;

  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user, pass },
    logger: false
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      const since = new Date();
      since.setDate(since.getDate() - 60);
      const uids = await client.search({ since }, { uid: true });

      if (!uids || uids.length === 0) {
        lastScan = new Date().toISOString();
        lastResult = { scanned: 0, matches: [] };
        return lastResult;
      }

      const candidaturas = readCandidaturas();
      const matches = [];
      let modified = false;

      for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
        const uid = msg.uid;
        const subject = msg.envelope?.subject || '';
        const from = msg.envelope?.from?.[0]?.address || '';
        const date = msg.envelope?.date || new Date().toISOString();

        for (const cand of candidaturas) {
          if (!Array.isArray(cand.emails_recibidos)) cand.emails_recibidos = [];
          if (cand.emails_recibidos.some(e => e.uid === uid)) continue;

          if (emailMatchesCandidatura(subject, from, cand)) {
            cand.emails_recibidos.push({ uid, fecha: date, de: from, asunto: subject });
            const estadoActual = (cand.estado || '').toLowerCase();
            const esperando = ['pendiente', 'enviada', 'en proceso', 'en revisión'].includes(estadoActual);
            if (esperando) cand.estado = 'Respuesta recibida';
            matches.push({ candidaturaId: cand.id, empresa: cand.empresa, subject, from });
            modified = true;
          }
        }
      }

      if (modified) writeCandidaturas(candidaturas);
      lastScan = new Date().toISOString();
      lastResult = { scanned: uids.length, matches };
      return lastResult;

    } finally {
      lock.release();
    }

  } catch (err) {
    console.error('[email-monitor] Error en scan:', err.message);
    return { error: err.message };
  } finally {
    scanning = false;
    try { await client.logout(); } catch { /* ignore */ }
  }
}

// ============================================
// ARRANQUE DEL MONITOR
// ============================================
/**
 * Lanza un scan inmediato y programa scans periodicos cada
 * `EMAIL_POLL_MS` (por defecto 900000 ms / 15 min). No arranca si ya hay
 * un intervalo activo (llamada repetida es no-op salvo por el scan
 * inmediato). Los rechazos de cada scan se capturan con `.catch` para que
 * nunca lleguen como unhandled rejection y tumben el proceso.
 *
 * @returns {void}
 */
function startMonitor() {
  const interval = POLL_MS();
  console.log(`[email-monitor] Iniciando. Intervalo: ${interval / 60000} min`);
  scanEmails()
    .then(r => console.log('[email-monitor] Scan inicial:', JSON.stringify(r)))
    .catch(e => console.error('[email-monitor] Error scan inicial:', e.message));
  intervalId = setInterval(() => {
    scanEmails()
      .then(r => { if (r.matches?.length) console.log('[email-monitor] Matches:', JSON.stringify(r.matches)); })
      .catch(e => console.error('[email-monitor] Error scan periódico:', e.message));
  }, interval);
}

/**
 * Detiene el intervalo de scans periodicos iniciado por `startMonitor`.
 * Debe llamarse en el apagado ordenado del proceso (SIGTERM/SIGINT) para
 * no dejar el timer vivo. Idempotente: llamarla sin un monitor activo no
 * lanza error.
 *
 * @returns {void}
 */
function stopMonitor() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
  console.log('[email-monitor] Detenido.');
}

/**
 * Estado actual del monitor, usado por /api/email/status y /api/health.
 *
 * @returns {{scanning: boolean, lastScan: string|null, lastResult: object|null}}
 */
function getStatus() {
  return { scanning, lastScan, lastResult };
}

module.exports = { startMonitor, stopMonitor, scanEmails, getStatus };
