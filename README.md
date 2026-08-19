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
| **Seguridad** | Acceso protegido con contraseña (bcrypt) + JWT. La API key de Groq nunca sale del servidor. |
| **Persistencia** | El JSON se guarda en disco vía volumen Docker. Sobrevive a reinicios y actualizaciones del contenedor. |
| **Responsive** | Panel usable desde móvil, tablet y PC. |

---

## Stack técnico

| Capa | Tecnología |
|------|------------|
| **Frontend** | HTML5 + CSS3 + Vanilla JavaScript (SPA monolítica, sin frameworks) |
| **Backend** | Node.js 20 + Express |
| **Autenticación** | JWT (jsonwebtoken) + bcryptjs |
| **IA / NLP** | Groq API (Llama 3.1 70B) — plan gratuito |
| **Persistencia** | JSON en disco (fs nativo de Node.js) |
| **Contenerización** | Docker + Docker Compose |
| **Proxy / SSL** | Nginx Proxy Manager (ya instalado en el Orange Pi) |
| **DNS** | DuckDNS (registro-kiko.duckdns.org) |
| **Hardware** | Orange Pi 5 Max (ARM64 / aarch64) |

---

## Estructura del proyecto
registro-kiko/
├── docker-compose.yml      # Orquestación del contenedor
├── Dockerfile              # Imagen base node:20-alpine + tu código
├── package.json            # Dependencias Node.js
├── server.js               # API Express (auth, CRUD, Groq)
├── .env                    # Variables secretas (NO subir a Git)
├── .gitignore              # Excluye .env, node_modules, JSON de datos
├── README.md               # Este archivo
├── public/
│   └── index.html          # Panel visual completo (login + dashboard)
└── data/
└── candidaturas.json   # Tus candidaturas (persiste en volumen Docker)
plain

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
2. Configurar variables de entorno
bash
cd registro-kiko
cp .env.example .env
nano .env
Rellena los 3 valores obligatorios:
env
# Clave secreta para firmar los tokens JWT (mínimo 32 caracteres)
JWT_SECRET=pon_aqui_una_clave_larga_y_aleatoria_generada_con_openssl

# Contraseña para acceder al panel web (se hashea con bcrypt)
ADMIN_PASSWORD=tu_password_seguro

# API key de Groq (gratuita en https://console.groq.com/keys)
GROQ_API_KEY=gsk_tu_api_key_aqui
Genera JWT_SECRET con: openssl rand -base64 48
3. Levantar el contenedor
bash
docker-compose up -d --build
Verifica que está corriendo:
bash
docker ps
docker logs -f registro-kiko
4. Configurar Nginx Proxy Manager
Abre el panel de NPM: http://IP_DEL_ORANGE_PI:81
Proxy Hosts → Add Proxy Host
Rellena:
Domain Names: registro-kiko.duckdns.org
Scheme: http
Forward Hostname / IP: registro-kiko (nombre del contenedor)
Forward Port: 3000
Pestaña SSL:
SSL Certificate: Request a new SSL certificate
Force SSL: ON
Agree to Terms: ON
Guarda.
5. Acceder
Abre en navegador:
plain
https://registro-kiko.duckdns.org
Introduce la contraseña que pusiste en ADMIN_PASSWORD.
Uso del panel
Añadir una candidatura con IA
Clic en "Nueva Candidatura"
Pega el texto completo de la oferta de empleo en el cuadro de texto
Clic en "Analizar con Groq"
La IA rellena automáticamente: empresa, puesto, salario, contrato, horario, ubicación, alertas
Revisa los campos, corrige si es necesario
Clic en "Guardar"
La candidatura aparece en la tabla y se guarda en data/candidaturas.json
Añadir manualmente
En el modal de nueva candidatura, clic en "Rellenar manual" y escribe los campos tú mismo.
Filtrar y ordenar
Búsqueda: escribe en el campo de texto para buscar por empresa, puesto, ubicación o notas.
Filtro de estado: selecciona "En proceso", "Entrevista técnica", etc.
Filtro de portal: LinkedIn, InfoJobs, Indeed...
Ordenar: clic en cualquier cabecera de columna (Empresa, Estado, Salario, Fecha...).
Editar o eliminar
En cada fila de la tabla hay dos botones:
Editar: abre el modal con los datos precargados.
Eliminar: pide confirmación y borra la candidatura.
API Endpoints
Table
Método	Endpoint	Auth	Descripción
POST	/api/login	No	Login, devuelve JWT
GET	/api/verify	JWT	Verificar token válido
GET	/api/candidaturas	JWT	Listar todas las candidaturas
GET	/api/candidaturas/:id	JWT	Ver una candidatura
POST	/api/candidaturas	JWT	Crear nueva candidatura
PUT	/api/candidaturas/:id	JWT	Editar candidatura
DELETE	/api/candidaturas/:id	JWT	Eliminar candidatura
POST	/api/analizar	JWT	Enviar texto de oferta a Groq, devuelve JSON extraído
GET	/api/health	No	Health check
Comandos útiles
bash
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
Seguridad
Sin base de datos: no hay SQL que inyectar.
JWT en header: el token se almacena en localStorage del navegador, no en cookies.
API key oculta: Groq nunca se llama desde el frontend. El frontend manda el texto al backend, el backend llama a Groq.
Puerto no expuesto: el contenedor no abre puertos al exterior. Solo Nginx Proxy Manager (443) es accesible desde fuera.
.env ignorado: el archivo de secretos nunca se sube a Git gracias a .gitignore.
Troubleshooting
"Cannot find module" al arrancar
bash
docker-compose down
docker-compose up -d --build
Error de permisos en data/candidaturas.json
bash
chmod 666 data/candidaturas.json
El contenedor no arranca en ARM64
Asegúrate de que el Dockerfile usa node:20-alpine. Verifica:
bash
docker run --rm node:20-alpine uname -m
# Debe decir: aarch64
Groq devuelve "rate limit"
El plan gratuito tiene límites. Espera unos minutos y reintenta.
NPM no encuentra el contenedor registro-kiko
Verifica que ambos contenedores están en la misma red:
bash
docker network inspect proxy
Si no aparece, asegúrate de que la red proxy existe:
bash
docker network create proxy
Licencia
Uso personal. Proyecto privado.
Autor
Creado para uso personal en Orange Pi 5 Max.
