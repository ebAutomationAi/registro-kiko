const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const Groq = require('groq-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'cambia_esto_por_algo_seguro';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD 
  ? bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10)
  : bcrypt.hashSync('admin123', 10);

const DATA_DIR = path.join(__dirname, 'data');
const CANDIDATURAS_FILE = path.join(DATA_DIR, 'candidaturas.json');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'Token requerido' });
  
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token malformado' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token invalido o expirado' });
  }
};

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
    console.error('Error leyendo candidaturas:', e);
    return [];
  }
}

function writeCandidaturas(candidaturas) {
  ensureDataDir();
  fs.writeFileSync(CANDIDATURAS_FILE, JSON.stringify(candidaturas, null, 2), 'utf-8');
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password requerido' });

  const isValid = bcrypt.compareSync(password, ADMIN_PASSWORD_HASH);
  if (!isValid) return res.status(401).json({ error: 'Password incorrecto' });

  const token = jwt.sign({ user: 'admin' }, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
  res.json({ token, expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
});

app.get('/api/verify', authMiddleware, (req, res) => {
  res.json({ valid: true, user: req.user });
});

app.get('/api/candidaturas', authMiddleware, (req, res) => {
  const candidaturas = readCandidaturas();
  res.json(candidaturas);
});

app.get('/api/candidaturas/:id', authMiddleware, (req, res) => {
  const candidaturas = readCandidaturas();
  const c = candidaturas.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrada' });
  res.json(c);
});

app.post('/api/candidaturas', authMiddleware, (req, res) => {
  const candidaturas = readCandidaturas();
  const nueva = {
    id: generateId(),
    ...req.body,
    fecha_postulacion: req.body.fecha_postulacion || new Date().toISOString().split('T')[0],
    fecha_actualizacion: new Date().toISOString(),
    creado_en: new Date().toISOString()
  };
  
  if (!nueva.empresa || !nueva.puesto) {
    return res.status(400).json({ error: 'Empresa y puesto son obligatorios' });
  }

  candidaturas.push(nueva);
  writeCandidaturas(candidaturas);
  res.status(201).json(nueva);
});

app.put('/api/candidaturas/:id', authMiddleware, (req, res) => {
  const candidaturas = readCandidaturas();
  const idx = candidaturas.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrada' });

  candidaturas[idx] = {
    ...candidaturas[idx],
    ...req.body,
    id: candidaturas[idx].id,
    fecha_actualizacion: new Date().toISOString()
  };
  
  writeCandidaturas(candidaturas);
  res.json(candidaturas[idx]);
});

app.delete('/api/candidaturas/:id', authMiddleware, (req, res) => {
  const candidaturas = readCandidaturas();
  const filtradas = candidaturas.filter(x => x.id !== req.params.id);
  
  if (filtradas.length === candidaturas.length) {
    return res.status(404).json({ error: 'No encontrada' });
  }
  
  writeCandidaturas(filtradas);
  res.json({ ok: true, eliminado: req.params.id });
});

app.post('/api/analizar', authMiddleware, async (req, res) => {
  const { texto } = req.body;
  if (!texto || texto.trim().length < 20) {
    return res.status(400).json({ error: 'Texto demasiado corto o vacio' });
  }

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
          content: texto
        }
      ],
      model: 'llama-3.1-70b-versatile',
      temperature: 0.2,
      max_tokens: 1024,
      response_format: { type: 'json_object' }
    });

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
      empresa: resultado.empresa || 'No especificado',
      puesto: resultado.puesto || 'No especificado',
      portal: resultado.portal || 'No especificado',
      salario: resultado.salario || 'No especificado',
      contrato: resultado.contrato || 'No especificado',
      horario: resultado.horario || 'No especificado',
      ubicacion: resultado.ubicacion || 'No especificado',
      alertas: Array.isArray(resultado.alertas) ? resultado.alertas : [],
      notas: resultado.notas || '',
      url_oferta: resultado.url_oferta || ''
    };

    res.json(normalizado);
  } catch (err) {
    console.error('Error Groq:', err.message);
    res.status(500).json({ error: 'Error analizando con Groq: ' + err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Registro-Kiko corriendo en puerto ' + PORT);
  console.log('Datos en: ' + CANDIDATURAS_FILE);
  ensureDataDir();
});
