# Registro Kiko — Panel de Candidaturas Laborales

> Panel privado de seguimiento de candidaturas con monitor automático de email.
> Sin base de datos externa. Autoalojado en Docker.

---

## 1. Descripción

**Registro Kiko** es una aplicación web autoalojada para llevar el control de un
proceso de búsqueda de empleo. Combina dos piezas:

- Un **panel de candidaturas**: registra cada oferta a la que te postulas, su
  estado, condiciones y notas, con análisis automático del texto de la oferta
  mediante IA (Groq).
- Un **monitor de email**: revisa periódicamente tu bandeja de Gmail por IMAP
  y detecta automáticamente qué empresas han respondido, sin que tengas que
  ir mirando el correo candidatura por candidatura.

Todo se guarda en un archivo JSON local (`data/candidaturas.json`), persistido
en disco vía volumen Docker. No requiere MySQL, MongoDB ni ninguna base de
datos externa.

---

## 2. Características

- 🔐 Panel web con autenticación JWT
- 📋 CRUD completo de candidaturas
- 🤖 Análisis automático de ofertas con Groq AI
- 📧 Monitor de email Gmail (IMAP) con matching inteligente
- 🔍 Detección automática de respuestas de empresas
- 🏷️ Badge visual de emails recibidos por candidatura
- 📊 Estadísticas en tiempo real (total, proceso, entrevistas, ofertas, rechazos, resp. email)
- 💾 Exportable a JSON

---

## 3. Stack técnico

| Componente | Tecnología |
|---|---|
| Runtime | Node.js 20 |
| Framework HTTP | Express 4 |
| Cliente IMAP | imapflow |
| Autenticación | JWT (jsonwebtoken) |
| Hashing de contraseñas | bcryptjs |
| Análisis de ofertas | Groq SDK |
| Contenedor | Docker |
| Proxy inverso | Nginx Proxy Manager |

---

## 4. Requisitos previos

- Docker + Docker Compose
- Cuenta Gmail con **IMAP habilitado** y una **App Password** generada
  (requiere verificación en 2 pasos activa): https://myaccount.google.com/apppasswords
- Groq API key gratuita: https://console.groq.com/keys

---

## 5. Instalación

```bash
# Clonar el repositorio
git clone https://github.com/ebAutomationAi/registro-kiko.git
cd registro-kiko

# Copiar la plantilla de configuración
cp .env.example .env

# Generar un JWT_SECRET seguro
openssl rand -base64 48

# Editar .env con tu editor y rellenar los valores obligatorios
nano .env
```

---

## 6. Configuración (.env)

| Variable | Descripción | Obligatoria | Default |
|---|---|---|---|
| `JWT_SECRET` | Clave para firmar los tokens JWT (mínimo 32 caracteres) | Sí | — |
| `ADMIN_PASSWORD` | Contraseña de acceso al panel (mínimo 6 caracteres, se hashea con bcrypt) | Sí | — |
| `GROQ_API_KEY` | API key de Groq para el análisis automático de ofertas | Sí | — |
| `NODE_ENV` | Entorno de ejecución (`production` \| `development`) | No | `production` |
| `ALLOWED_ORIGINS` | Orígenes permitidos para CORS, separados por coma | No | vacío (permite cualquiera) |
| `PORT` | Puerto interno del contenedor | No | `3000` |
| `GMAIL_USER` | Cuenta Gmail a monitorizar por IMAP | No* | — |
| `GMAIL_APP_PASSWORD` | App Password de Gmail (no la contraseña normal de la cuenta) | No* | — |
| `EMAIL_POLL_MS` | Intervalo entre escaneos automáticos del buzón, en milisegundos | No | `900000` (15 min) |

\* El monitor de email arranca automáticamente si `GMAIL_USER` y
`GMAIL_APP_PASSWORD` están definidos; si faltan, el resto de la app funciona
con normalidad y el monitor queda desactivado.

---

## 7. Despliegue

```bash
# Construir y levantar el contenedor
docker compose up -d --build

# Ver logs en tiempo real
docker compose logs -f

# Reiniciar tras cambiar .env
docker compose restart

# Parar
docker compose down
```

El servicio se une a la red externa `proxy` (Nginx Proxy Manager); el panel
no se expone directamente a Internet sin pasar por ahí.

---

## 8. Estructura del proyecto

```
registro-kiko/
├── server.js              # API Express, auth, CRUD, endpoint Groq
├── email-monitor.js       # Cliente IMAP, matching y scan periódico
├── public/
│   ├── index.html         # Shell del panel
│   ├── app.js              # Lógica de frontend (fetch, render, modales)
│   └── style.css           # Estilos
├── data/                  # Volumen persistente (candidaturas.json) — no versionado
├── Dockerfile
├── docker-compose.yml
├── package.json
├── .env.example
├── .gitignore
└── .dockerignore
```

---

## 9. API endpoints

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/login` | No | Login con contraseña, devuelve JWT (expira en 7d) |
| GET | `/api/verify` | Sí | Verifica validez del token actual |
| GET | `/api/candidaturas` | Sí | Lista todas las candidaturas |
| GET | `/api/candidaturas/:id` | Sí | Obtiene una candidatura |
| POST | `/api/candidaturas` | Sí | Crea una candidatura |
| PUT | `/api/candidaturas/:id` | Sí | Actualiza una candidatura |
| DELETE | `/api/candidaturas/:id` | Sí | Elimina una candidatura |
| POST | `/api/analizar` | Sí | Analiza texto de oferta con Groq y devuelve campos extraídos |
| GET | `/api/email/scan` | Sí | Lanza un escaneo manual del buzón Gmail |
| GET | `/api/email/status` | Sí | Estado del monitor: si está escaneando, última ejecución y último resultado |
| GET | `/api/health` | No | Health check (estado, versión, estado del email monitor) |

---

## 10. Monitor de Email

Cada `EMAIL_POLL_MS` (por defecto 15 min), y también al arrancar el
contenedor, el monitor:

1. Se conecta a `imap.gmail.com` con las credenciales de `GMAIL_USER` /
   `GMAIL_APP_PASSWORD`.
2. Busca correos de los últimos 60 días en la bandeja de entrada.
3. Cruza cada correo contra las candidaturas guardadas.
4. Si detecta una coincidencia nueva, la añade a `emails_recibidos` de esa
   candidatura y, si su estado seguía en fase de espera (Pendiente, Enviada,
   En proceso, En revisión), lo cambia automáticamente a **"Respuesta
   recibida"**.

**Lógica de matching** (por orden, `false` inmediato si aplica alguna regla
de exclusión):

1. **Remitente en lista negra** → se descarta. Cubre remitentes de portales
   (LinkedIn, Indeed, InfoJobs, Glassdoor, Randstad, etc.) que nunca son una
   respuesta real de la empresa, aunque mencionen el nombre de la empresa en
   el asunto.
2. **Asunto administrativo** → se descarta. Patrones tipo "tu alerta...",
   "bienvenido/a", "gracias por inscribirte", confirmaciones de cuenta,
   resets de contraseña, etc.
3. **Nombre de la empresa en el asunto** → coincidencia.
4. **Dominio del remitente coincide con la empresa** → coincidencia.

El puesto de trabajo **no** se usa para matchear: es demasiado genérico y
generaría falsos positivos.

**Limitación conocida — ETTs y fan-out:** cuando la candidatura es a través
de una ETT (Randstad, Manpower, Adecco...), la empresa final que ofrece el
puesto suele comunicarse desde un dominio propio distinto al de la ETT, o
directamente no lo hace por email. El matching por dominio/nombre de empresa
puede no capturar esas respuestas — revisa el estado manualmente en esos
casos.

---

## 11. Seguridad

- **Helmet + CSP estricta**: `default-src 'self'`, sin scripts ni estilos
  inline salvo `scriptSrcAttr` (necesario para los `onclick=""` del HTML).
- **JWT** con expiración de 7 días.
- **bcrypt** (cost factor 12) para la contraseña de acceso — nunca se guarda
  en texto plano.
- **Rate limiting** por endpoint: login (10/15min), API general (60/min),
  análisis Groq (10/min), escaneo de email (5/min).
- **CORS restrictivo** vía `ALLOWED_ORIGINS` en producción.
- Contenedor con `no-new-privileges:true` y usuario **no-root** (`nodejs`,
  UID 1001) dentro de la imagen.

---

## 12. Backup

La aplicación no genera backups automáticos. Antes de operaciones
delicadas (migraciones, ediciones manuales del JSON), copia
`data/candidaturas.json` a `data/candidaturas.json.bak` a mano. Todo el
directorio `data/` está excluido de git y de la imagen Docker — nunca se
sube a ningún repositorio, backups incluidos.

---

## 13. Licencia

MIT
