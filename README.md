# Registro Kiko

> Panel privado de control y seguimiento de candidaturas laborales.
> Sin base de datos. Sin servidor externo. Todo en tu Orange Pi 5 Max.

---

## Qué es

**Registro Kiko** es una aplicación web autoalojada que te permite:

- **Registrar** cada oferta de empleo a la que te postulas.
- **Seguir el estado** de cada candidatura (Pendiente, En proceso, Entrevista, Oferta, Rechazado...).
- **Detectar alertas** automáticamente (salario no especificado, requisitos excesivos, contratos dudosos).
- **Extraer datos automáticamente** pegando el texto de la oferta: una IA (Groq) analiza el texto y rellena los campos por ti.
- **Visualizar estadísticas** en tiempo real: total, en proceso, entrevistas, ofertas, rechazos.
- **Filtrar y buscar** por empresa, puesto, estado, portal o ubicación.
- **Editar y eliminar** candidaturas desde el mismo panel.

Todo se guarda en un **archivo JSON local** (`data/candidaturas.json`). No necesitas MySQL, MongoDB ni ninguna base de datos externa.

---

## Funcionalidades principales

| Función | Descripción |
|---------|-------------|
| **Panel de control** | Tabla ordenable con todas tus candidaturas, estados visualizados con badges de color y alertas destacadas. |
| **Estadísticas** | 5 tarjetas de resumen: Total, En Proceso, Entrevistas, Ofertas, Rechazos. |
| **Filtros y búsqueda** | Busca por texto libre (empresa, puesto, notas) y filtra por estado o portal. |
| **Añadir candidatura** | Pega el texto de la oferta y Groq extrae automáticamente: empresa, puesto, salario, contrato, horario, ubicación, alertas. |
| **Edición manual** | Revisa los campos extraídos por la IA, corrige lo que necesites y guarda. |
| **Seguridad** | Acceso protegido con contraseña (bcrypt) + JWT, headers endurecidos (helmet/CSP) y rate limiting. La API key de Groq nunca sale del servidor. |
| **Persistencia** | El JSON se guarda en disco vía volumen Docker. Sobrevive a reinicios y actualizaciones del contenedor. |
| **Responsive** | Panel usable desde móvil, tablet y PC. |

---

## Stack técnico

| Capa | Tecnología |
|------|------------|
| **Frontend** | HTML5 + CSS3 + Vanilla JavaScript (SPA monolítica, sin frameworks) |
| **Backend** | Node.js 20 + Express |
| **Autenticación** | JWT (jsonwebtoken) + bcryptjs (12 rounds) |
| **Seguridad HTTP** | helmet (CSP), CORS con whitelist, express-rate-limit |
| **IA / NLP** | Groq API (Llama 3.1 70B) — plan gratuito |
| **Persistencia** | JSON en disco (fs nativo de Node.js, escritura atómica) |
| **Contenerización** | Docker (usuario no-root) + Docker Compose |
| **Proxy / SSL** | Nginx Proxy Manager (ya instalado en el Orange Pi) |
| **DNS** | DuckDNS (registro-kiko.duckdns.org) |
| **Hardware** | Orange Pi 5 Max (ARM64 / aarch64) |

---

## Estructura del proyecto

```
registro-kiko/
├── docker-compose.yml      # Orquestación del contenedor
├── Dockerfile              # Imagen base node:20-alpine + tu código
├── package.json            # Dependencias Node.js
├── server.js               # API Express (auth, CRUD, Groq)
├── .env                    # Variables secretas (NO subir a Git)
├── .env.example             # Plantilla de variables de entorno
├── .gitignore               # Excluye .env, node_modules, JSON de datos
├── .dockerignore             # Excluye archivos innecesarios de la imagen
├── README.md                # Este archivo
├── public/
│   └── index.html            # Panel visual completo (login + dashboard)
└── data/
    └── candidaturas.json     # Tus candidaturas (persiste en volumen Docker)
```

---

## Requisitos previos

- Orange Pi 5 Max (o cualquier servidor Linux con Docker)
- Docker y Docker Compose instalados
- Nginx Proxy Manager ya funcionando (con red Docker `proxy`)
- Dominio apuntando a tu IP (ej. `registro-kiko.duckdns.org`)
- Cuenta gratuita en [Groq](https://console.groq.com/keys) con API key generada

---

## Despliegue paso a paso

### 1. Clonar o copiar el proyecto

```bash
cd /home/kiko/docker_apps
git clone https://github.com/ebAutomationAi/registro-kiko.git
# o copia la carpeta manualmente si la creaste en local
```

### 2. Configurar variables de entorno

```bash
cd registro-kiko
cp .env.example .env
nano .env
```

Rellena los 3 valores **obligatorios** — el servidor no arranca sin ellos:

```env
# Clave secreta para firmar los tokens JWT (mínimo 32 caracteres)
JWT_SECRET=pon_aqui_una_clave_larga_y_aleatoria_generada_con_openssl

# Contraseña para acceder al panel web (se hashea con bcrypt)
ADMIN_PASSWORD=tu_password_seguro

# API key de Groq (gratuita en https://console.groq.com/keys)
GROQ_API_KEY=gsk_tu_api_key_aqui
```

Genera `JWT_SECRET` con: `openssl rand -base64 48`

Variables opcionales:

| Variable | Descripción | Default |
|---|---|---|
| `NODE_ENV` | `production` o `development`. En `development` el CORS permite cualquier origen. | `production` |
| `ALLOWED_ORIGINS` | Orígenes permitidos por CORS en producción, separados por coma (ej. `https://registro-kiko.duckdns.org`). Vacío = bloquea todo origen en producción. | (vacío) |
| `PORT` | Puerto interno del contenedor. No cambiar si usas `docker-compose.yml` tal cual. | `3000` |

### 3. Levantar el contenedor

```bash
docker-compose up -d --build
```

Verifica que está corriendo:

```bash
docker ps
docker logs -f registro-kiko
```

Si falta o es inválida alguna variable obligatoria, el contenedor se reiniciará en bucle (`restart: unless-stopped`) mostrando en los logs un `[FATAL]` indicando cuál falta.

### 4. Configurar Nginx Proxy Manager

1. Abre el panel de NPM: `http://IP_DEL_ORANGE_PI:81`
2. **Proxy Hosts → Add Proxy Host**
3. Rellena:
   - **Domain Names:** `registro-kiko.duckdns.org`
   - **Scheme:** `http`
   - **Forward Hostname / IP:** `registro-kiko` (nombre del contenedor)
   - **Forward Port:** `3000`
4. Pestaña **SSL**:
   - **SSL Certificate:** Request a new SSL certificate
   - **Force SSL:** ON
   - **Agree to Terms:** ON
5. Guarda.

### 5. Acceder

Abre en el navegador:

```
https://registro-kiko.duckdns.org
```

Introduce la contraseña que pusiste en `ADMIN_PASSWORD`.

---

## Uso del panel

### Añadir una candidatura con IA

1. Clic en "Nueva Candidatura"
2. Pega el texto completo de la oferta de empleo en el cuadro de texto
3. Clic en "Analizar con Groq"
4. La IA rellena automáticamente: empresa, puesto, salario, contrato, horario, ubicación, alertas
5. Revisa los campos, corrige si es necesario
6. Clic en "Guardar"
7. La candidatura aparece en la tabla y se guarda en `data/candidaturas.json`

### Añadir manualmente

En el modal de nueva candidatura, clic en "Rellenar manual" y escribe los campos tú mismo.

### Filtrar y ordenar

- **Búsqueda:** escribe en el campo de texto para buscar por empresa, puesto, ubicación o notas.
- **Filtro de estado:** selecciona "En proceso", "Entrevista técnica", etc.
- **Filtro de portal:** LinkedIn, InfoJobs, Indeed...
- **Ordenar:** clic en cualquier cabecera de columna (Empresa, Estado, Salario, Fecha...).

### Editar o eliminar

En cada fila de la tabla hay dos botones:
- **Editar:** abre el modal con los datos precargados.
- **Eliminar:** pide confirmación y borra la candidatura.

---

## API Endpoints

| Método | Endpoint | Auth | Rate limit | Descripción |
|---|---|---|---|---|
| POST | `/api/login` | No | 10 / 15 min | Login, devuelve JWT |
| GET | `/api/verify` | JWT | 60 / min | Verificar token válido |
| GET | `/api/candidaturas` | JWT | 60 / min | Listar todas las candidaturas |
| GET | `/api/candidaturas/:id` | JWT | 60 / min | Ver una candidatura |
| POST | `/api/candidaturas` | JWT | 60 / min | Crear nueva candidatura |
| PUT | `/api/candidaturas/:id` | JWT | 60 / min | Editar candidatura |
| DELETE | `/api/candidaturas/:id` | JWT | 60 / min | Eliminar candidatura |
| POST | `/api/analizar` | JWT | 10 / min | Enviar texto de oferta a Groq, devuelve JSON extraído |
| GET | `/api/health` | No | — | Health check |

---

## Comandos útiles

```bash
# Ver logs en tiempo real
docker logs -f registro-kiko

# Reiniciar el servicio
docker-compose restart

# Reconstruir tras cambios en el código
docker-compose up -d --build

# Backup manual del JSON
cp data/candidaturas.json data/candidaturas.json.backup.$(date +%Y%m%d)

# Entrar al contenedor
docker exec -it registro-kiko sh

# Ver estado de la red Docker compartida con NPM
docker network inspect proxy
```

---

## Seguridad

- **Sin base de datos:** no hay SQL que inyectar.
- **Configuración obligatoria validada al arrancar:** si falta `JWT_SECRET` (o mide menos de 32 caracteres), `ADMIN_PASSWORD` (menos de 6 caracteres) o `GROQ_API_KEY`, el proceso termina con `[FATAL]` en vez de arrancar con valores por defecto inseguros.
- **Password hasheada:** bcrypt con 12 rounds. Nunca se guarda en texto plano.
- **JWT en header:** el token se almacena en `localStorage` del navegador, no en cookies (sin CORS `credentials`, sin riesgo CSRF vía cookies).
- **Headers HTTP endurecidos:** `helmet` con Content-Security-Policy restrictiva (`default-src 'self'`, sin scripts externos).
- **CORS con whitelist:** en producción solo se aceptan los orígenes listados en `ALLOWED_ORIGINS`; en desarrollo (`NODE_ENV != production`) se permite cualquier origen.
- **Rate limiting:** login (10 intentos / 15 min), API general (60 req/min), análisis con Groq (10 req/min) — ver tabla de endpoints.
- **Escritura atómica del JSON:** cada guardado escribe primero a un `.tmp` y luego renombra, evitando corrupción si el proceso se interrumpe a mitad de escritura.
- **API key oculta:** Groq nunca se llama desde el frontend. El frontend manda el texto al backend, el backend llama a Groq.
- **Contenedor no-root:** el proceso Node corre como usuario `nodejs` (uid 1001) dentro de la imagen, no como root.
- **`no-new-privileges` + límites de recursos:** en `docker-compose.yml` (1 CPU / 512MB máx.).
- **Healthcheck:** Docker verifica `/api/health` cada 30s y reinicia el contenedor si no responde.
- **Puerto no expuesto:** el contenedor no abre puertos al exterior. Solo Nginx Proxy Manager (443) es accesible desde fuera.
- **`.env` ignorado:** el archivo de secretos nunca se sube a Git gracias a `.gitignore`, y queda excluido de la imagen Docker vía `.dockerignore`.

---

## Troubleshooting

### El contenedor se reinicia en bucle / "[FATAL] ... Revisa tu archivo .env"

Falta o es inválida una variable obligatoria (`JWT_SECRET`, `ADMIN_PASSWORD` o `GROQ_API_KEY`). Revisa `docker logs registro-kiko` para ver cuál, corrígela en `.env` y reinicia:

```bash
docker-compose up -d --build
```

### "Cannot find module" al arrancar

```bash
docker-compose down
docker-compose up -d --build
```

### Error de permisos en `data/candidaturas.json`

El proceso corre como usuario no-root (`nodejs`, uid 1001) dentro del contenedor. Ajusta el propietario del volumen en el host:

```bash
sudo chown -R 1001:1001 data/
```

### "429 Too Many Requests" / "Demasiados intentos de login"

Has superado el rate limit (10 logins / 15 min, 60 peticiones API / min, 10 análisis Groq / min). Espera el tiempo indicado en la respuesta y reintenta.

### "CORS bloqueado: origen no permitido"

En producción, añade el dominio exacto desde el que accedes a `ALLOWED_ORIGINS` en `.env` (separado por coma si hay varios) y reinicia el contenedor.

### El contenedor no arranca en ARM64

Asegúrate de que el Dockerfile usa `node:20-alpine`. Verifica:

```bash
docker run --rm node:20-alpine uname -m
# Debe decir: aarch64
```

### Groq devuelve "rate limit"

El plan gratuito tiene límites. Espera unos minutos y reintenta.

### NPM no encuentra el contenedor `registro-kiko`

Verifica que ambos contenedores están en la misma red:

```bash
docker network inspect proxy
```

Si no aparece, asegúrate de que la red `proxy` existe:

```bash
docker network create proxy
```

---

## Licencia

Uso personal. Proyecto privado.

## Autor

Creado para uso personal en Orange Pi 5 Max.
