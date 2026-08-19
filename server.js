const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const Groq = require('groq-sdk');

// ============================================
// VALIDACION DE CONFIGURACION OBLIGATORIA
// ============================================
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PORT = parseInt(process.env.PORT, 10) || 3000;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET no definido o demasiado corto (min 32 chars). Revisa tu archivo .env');
  process.exit(1);
}
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 6) {
  console.error('[FATAL] ADMIN_PASSWORD no definida o demasiado corta (min 6 chars). Revisa tu archivo .env');
  process.exit(1);
}
if (!GROQ_API_KEY) {
  console.error('[FATAL] GROQ_API_KEY no definida. Revisa tu archivo .env');
  process.exit(1);
}

const ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 12);
const DATA_DIR = path.join(__dirname, 'data');
const CANDIDATURAS_FILE = path.join(DATA_DIR, 'candidaturas.json');
const GROQ_TIMEOUT_MS = 15000;
const GROQ_MAX_TEXT_LENGTH = 12000;

const groq = new Groq({ apiKey: GROQ_API_KEY });

const app = express();

// ============================================
// TRUST PROXY (reverse proxy delante: Nginx Proxy Manager)
// ============================================
// Confia en 1 hop para que req.ip refleje el cliente real (X-Forwarded-For)
// en lugar de la IP del proxy. Necesario para que el rate limiting y los
// logs de intentos de login identifiquen al cliente correcto.
app.set('trust proxy', 1);

// ============================================
// SEGURIDAD - HEADERS HTTP
// ============================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      // 'unsafe-inline' necesario: public/index.html usa un <script> inline
      // y atributos onclick="" en la tabla de candidaturas. scriptSrcAttr
      // es una directiva CSP3 separada de scriptSrc: sin esto helmet la
      // pone a 'none' por defecto y bloquea los onclick="" aunque
      // scriptSrc permita 'unsafe-inline'.
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ============================================
// CORS RESTRICTIVO
// ============================================
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : [];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('CORS bloqueado: origen no permitido'));
    }
  },
  credentials: false
}));

// ============================================
// RATE LIMITING
// ============================================
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login. Intenta de nuevo en 15 minutos.' }
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Ralentiza un poco.' }
});

const groqLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones a Groq. Espera un minuto.' }
});

app.use('/api/login', loginLimiter);
app.use('/api/', apiLimiter);
app.use('/api/analizar', groqLimiter);

// ============================================
// BODY PARSING
// ============================================
app.use(express.json({ limit: '256kb' }));

// ============================================
// ARCHIVOS ESTATICOS (frontend)
// ============================================
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// LOGGER SIMPLE
// ============================================
function log(level, message, meta = {}) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${message}`, meta);
}

// ============================================
// MIDDLEWARE AUTH
// ============================================
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'Token requerido' });

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Formato de token invalido. Usa: Bearer <token>' });
  }

  const token = parts[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(403).json({ error: 'Token expirado. Vuelve a iniciar sesion.' });
    }
    return res.status(403).json({ error: 'Token invalido' });
  }
};

// ============================================
// HELPERS - JSON
// ============================================
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readCandidaturas() {
  ensureDataDir();
  if (!fs.existsSync(CANDIDATURAS_FILE)) {
    fs.writeFileSync(CANDIDATURAS_FILE, JSON.stringify([], null, 2), 'utf-8');
    return [];
  }
  try {
    const data = fs.readFileSync(CANDIDATURAS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    log('ERROR', 'Error leyendo candidaturas.json', { error: e.message });
    return [];
  }
}

function writeCandidaturas(candidaturas) {
  ensureDataDir();
  const tmpFile = CANDIDATURAS_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(candidaturas, null, 2), 'utf-8');
  fs.renameSync(tmpFile, CANDIDATURAS_FILE);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 11);
}

function sanitizeString(str, maxLen = 500) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}

function sanitizeStringArray(arr, maxLen = 300) {
  if (!Array.isArray(arr)) return [];
  return arr.map(a => sanitizeString(a, maxLen)).filter(Boolean);
}

const MATCH_VALUES = ['alto', 'medio', 'bajo'];

function sanitizeMatch(val) {
  const v = sanitizeString(val, 10).toLowerCase();
  return MATCH_VALUES.includes(v) ? v : '';
}

// Acepta tanto strings sueltos (formato antiguo / salida de Groq) como
// objetos { texto, tipo }. tipo por defecto 'warning' si no es 'danger'.
function sanitizeAlertas(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(a => {
    if (typeof a === 'string') {
      const texto = sanitizeString(a, 300);
      return texto ? { texto, tipo: 'warning' } : null;
    }
    if (a && typeof a === 'object') {
      const texto = sanitizeString(a.texto, 300);
      const tipo = a.tipo === 'danger' ? 'danger' : 'warning';
      return texto ? { texto, tipo } : null;
    }
    return null;
  }).filter(Boolean);
}

// ============================================
// ENDPOINTS DE AUTENTICACION
// ============================================
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password requerido' });
  }

  const isValid = bcrypt.compareSync(password, ADMIN_PASSWORD_HASH);
  if (!isValid) {
    log('WARN', 'Intento de login fallido', { ip: req.ip });
    return res.status(401).json({ error: 'Password incorrecto' });
  }

  const token = jwt.sign({ user: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
  log('INFO', 'Login exitoso', { ip: req.ip });
  res.json({ token, expiresIn: '7d' });
});

app.get('/api/verify', authMiddleware, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// ============================================
// ENDPOINTS CRUD CANDIDATURAS
// ============================================
app.get('/api/candidaturas', authMiddleware, (req, res) => {
  const candidaturas = readCandidaturas();
  res.json(candidaturas);
});

app.get('/api/candidaturas/:id', authMiddleware, (req, res) => {
  const candidaturas = readCandidaturas();
  const c = candidaturas.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Candidatura no encontrada' });
  res.json(c);
});

app.post('/api/candidaturas', authMiddleware, (req, res) => {
  const body = req.body || {};
  const candidaturas = readCandidaturas();

  const empresa = sanitizeString(body.empresa, 200);
  const puesto = sanitizeString(body.puesto, 200);

  if (!empresa || !puesto) {
    return res.status(400).json({ error: 'Empresa y puesto son obligatorios' });
  }

  const nueva = {
    id: generateId(),
    empresa,
    puesto,
    portal: sanitizeString(body.portal, 100) || 'No especificado',
    salario: sanitizeString(body.salario, 200) || 'No especificado',
    contrato: sanitizeString(body.contrato, 100) || 'No especificado',
    horario: sanitizeString(body.horario, 100) || 'No especificado',
    ubicacion: sanitizeString(body.ubicacion, 200) || 'No especificado',
    estado: sanitizeString(body.estado, 100) || 'Pendiente',
    fecha_postulacion: sanitizeString(body.fecha_postulacion, 20) || new Date().toISOString().split('T')[0],
    fecha_actualizacion: new Date().toISOString(),
    url_oferta: sanitizeString(body.url_oferta, 500) || '',
    notas: sanitizeString(body.notas, 2000) || '',
    alertas: sanitizeAlertas(body.alertas),
    match: sanitizeMatch(body.match),
    cv: sanitizeString(body.cv, 200) || '',
    carta: sanitizeString(body.carta, 200) || '',
    empresa_desc: sanitizeString(body.empresa_desc, 2000) || '',
    responsabilidades: sanitizeStringArray(body.responsabilidades, 300),
    argumentos: sanitizeStringArray(body.argumentos, 300),
    creado_en: new Date().toISOString()
  };

  candidaturas.push(nueva);
  writeCandidaturas(candidaturas);
  log('INFO', 'Nueva candidatura creada', { id: nueva.id, empresa: nueva.empresa });
  res.status(201).json(nueva);
});

app.put('/api/candidaturas/:id', authMiddleware, (req, res) => {
  const candidaturas = readCandidaturas();
  const idx = candidaturas.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Candidatura no encontrada' });

  const body = req.body || {};

  const updates = {};
  if (body.empresa !== undefined) updates.empresa = sanitizeString(body.empresa, 200);
  if (body.puesto !== undefined) updates.puesto = sanitizeString(body.puesto, 200);
  if (body.portal !== undefined) updates.portal = sanitizeString(body.portal, 100);
  if (body.salario !== undefined) updates.salario = sanitizeString(body.salario, 200);
  if (body.contrato !== undefined) updates.contrato = sanitizeString(body.contrato, 100);
  if (body.horario !== undefined) updates.horario = sanitizeString(body.horario, 100);
  if (body.ubicacion !== undefined) updates.ubicacion = sanitizeString(body.ubicacion, 200);
  if (body.estado !== undefined) updates.estado = sanitizeString(body.estado, 100);
  if (body.fecha_postulacion !== undefined) updates.fecha_postulacion = sanitizeString(body.fecha_postulacion, 20);
  if (body.url_oferta !== undefined) updates.url_oferta = sanitizeString(body.url_oferta, 500);
  if (body.notas !== undefined) updates.notas = sanitizeString(body.notas, 2000);
  if (body.alertas !== undefined) updates.alertas = sanitizeAlertas(body.alertas);
  if (body.match !== undefined) updates.match = sanitizeMatch(body.match);
  if (body.cv !== undefined) updates.cv = sanitizeString(body.cv, 200);
  if (body.carta !== undefined) updates.carta = sanitizeString(body.carta, 200);
  if (body.empresa_desc !== undefined) updates.empresa_desc = sanitizeString(body.empresa_desc, 2000);
  if (body.responsabilidades !== undefined) updates.responsabilidades = sanitizeStringArray(body.responsabilidades, 300);
  if (body.argumentos !== undefined) updates.argumentos = sanitizeStringArray(body.argumentos, 300);

  candidaturas[idx] = {
    ...candidaturas[idx],
    ...updates,
    id: candidaturas[idx].id,
    fecha_actualizacion: new Date().toISOString()
  };

  writeCandidaturas(candidaturas);
  log('INFO', 'Candidatura actualizada', { id: req.params.id });
  res.json(candidaturas[idx]);
});

app.delete('/api/candidaturas/:id', authMiddleware, (req, res) => {
  const candidaturas = readCandidaturas();
  const filtradas = candidaturas.filter(x => x.id !== req.params.id);

  if (filtradas.length === candidaturas.length) {
    return res.status(404).json({ error: 'Candidatura no encontrada' });
  }

  writeCandidaturas(filtradas);
  log('INFO', 'Candidatura eliminada', { id: req.params.id });
  res.json({ ok: true, eliminado: req.params.id });
});

// ============================================
// ENDPOINT GROQ - ANALIZAR OFERTA
// ============================================
app.post('/api/analizar', authMiddleware, async (req, res) => {
  const { texto } = req.body;

  if (!texto || typeof texto !== 'string') {
    return res.status(400).json({ error: 'El campo "texto" es obligatorio y debe ser una cadena' });
  }

  const trimmed = texto.trim();
  if (trimmed.length < 30) {
    return res.status(400).json({ error: 'Texto demasiado corto (minimo 30 caracteres)' });
  }
  if (trimmed.length > GROQ_MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: `Texto demasiado largo (maximo ${GROQ_MAX_TEXT_LENGTH} caracteres)` });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `Eres un asistente especializado en analizar ofertas de empleo.
Extrae la informacion relevante del texto de la oferta y devuelvela EXCLUSIVAMENTE como un objeto JSON valido con esta estructura exacta:

{
  "empresa": "nombre de la empresa",
  "puesto": "titulo del puesto",
  "portal": "nombre del portal (LinkedIn, InfoJobs, Indeed, etc.)",
  "salario": "rango salarial o 'No especificado'",
  "contrato": "tipo de contrato (Indefinido, Temporal, Freelance, Practicas, etc.)",
  "horario": "jornada (Completa, Parcial, Flexible, etc.)",
  "ubicacion": "ciudad / remoto / hibrido",
  "empresa_desc": "breve descripcion de la empresa si aparece en el texto (sector, tamano, etc.), si no vacio",
  "responsabilidades": ["lista de responsabilidades o funciones del puesto tal como aparecen en el texto"],
  "alertas": ["lista de red flags o alertas detectadas, o vacio"],
  "notas": "cualquier detalle relevante adicional",
  "url_oferta": "URL si aparece en el texto, si no vacio"
}

REGLAS:
- Si un dato no aparece, usa "No especificado" o array vacio [].
- No inventes datos que no esten en el texto.
- Las alertas pueden ser: salario no especificado, requisitos excesivos, falta de informacion de empresa, etc.
- Responde SOLO con el JSON, sin markdown, sin explicaciones, sin comillas externas.`
        },
        {
          role: 'user',
          content: trimmed
        }
      ],
      model: 'openai/gpt-oss-120b',
      temperature: 0.2,
      max_tokens: 1536,
      response_format: { type: 'json_object' }
    }, { signal: controller.signal });

    clearTimeout(timeoutId);

    const raw = completion.choices[0]?.message?.content || '{}';
    let resultado;

    try {
      resultado = JSON.parse(raw);
    } catch (e) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) resultado = JSON.parse(match[0]);
      else throw new Error('No se pudo parsear JSON');
    }

    const normalizado = {
      empresa: sanitizeString(resultado.empresa, 200) || 'No especificado',
      puesto: sanitizeString(resultado.puesto, 200) || 'No especificado',
      portal: sanitizeString(resultado.portal, 100) || 'No especificado',
      salario: sanitizeString(resultado.salario, 200) || 'No especificado',
      contrato: sanitizeString(resultado.contrato, 100) || 'No especificado',
      horario: sanitizeString(resultado.horario, 100) || 'No especificado',
      ubicacion: sanitizeString(resultado.ubicacion, 200) || 'No especificado',
      empresa_desc: sanitizeString(resultado.empresa_desc, 2000) || '',
      responsabilidades: sanitizeStringArray(resultado.responsabilidades, 300),
      alertas: sanitizeAlertas(resultado.alertas),
      notas: sanitizeString(resultado.notas, 2000) || '',
      url_oferta: sanitizeString(resultado.url_oferta, 500) || ''
    };

    log('INFO', 'Analisis Groq completado', { empresa: normalizado.empresa });
    res.json(normalizado);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      log('ERROR', 'Timeout en llamada a Groq');
      return res.status(504).json({ error: 'Groq no respondio a tiempo. Intenta de nuevo.' });
    }
    log('ERROR', 'Error en analisis Groq', { error: err.message });
    res.status(500).json({ error: 'Error analizando con Groq: ' + err.message });
  }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.2.0'
  });
});

// ============================================
// MANEJO GLOBAL DE ERRORES
// ============================================
app.use((err, req, res, next) => {
  log('ERROR', 'Error no manejado', {
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path
  });
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : err.message
  });
});

// ============================================
// 404
// ============================================
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado' });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, '0.0.0.0', () => {
  log('INFO', `Registro-Kiko v1.2.0 corriendo en puerto ${PORT}`);
  log('INFO', `Datos en: ${CANDIDATURAS_FILE}`);
  ensureDataDir();
});
