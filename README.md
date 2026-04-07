# Scraper Web

Aplicació per gestionar el cicle complet de FAQs de la UPC:

- capturar preguntes freqüents des de pàgines web,
- revisar-les i guardar-les en un Google Sheet,
- recuperar només les files aprovades,
- generar el codi HTML final preparat per publicar-lo a Genweb.

El projecte està dividit en dos blocs:

- `frontend/`: interfície web en React + Vite.
- `backend/`: API en FastAPI que fa el scraping, gestiona els jobs, integra Google OAuth/Drive/Sheets i genera l'HTML final.

## Objectiu de l'aplicació

L'eina resol un flux de treball concret:

1. L'usuari defineix un conjunt de `topics` i URLs d'on extreure FAQs.
2. El backend analitza aquestes pàgines i detecta estructures habituals d'acordions o llistats FAQ.
3. El resultat es transforma en files estructurades amb aquest esquema:

`Tema | Subtopic | Pregunta | Resposta | Estat | Data creació | Darrera modificació | Persona darrera modificació | Dades amb actualització anual | Font`

4. Aquestes files es poden exportar a Google Sheets per fer la revisió editorial.
5. Quan les files estan marcades com a `Aprovat`, l'aplicació les torna a llegir i genera l'HTML final amb estructura d'acordió compatible amb Genweb.

## Arquitectura general

### Frontend

El frontend principal és [App.jsx](c:\Users\eugeni.puigdomenech\Documents\Projectes\Scraper_web\frontend\src\App.jsx).

Des d'aquesta pantalla es fa tot el flux:

- portada amb els dos accessos principals,
- vista `scrape` per preparar fonts i llançar el scraping,
- connexió amb Google,
- explorador de Google Drive per triar un Sheet existent o crear-ne un de nou,
- seguiment dels jobs i dels logs,
- vista `export` per generar el codi HTML final a partir del Google Sheet seleccionat.

El frontend:

- desa estat a `localStorage`,
- recorda les fonts configurades,
- manté l'últim job seleccionat,
- fa polling dels jobs del backend,
- arrenca el login amb Google via popup OAuth,
- exporta i importa configuració de fonts en CSV.

### Backend

L'API principal és a [main.py](c:\Users\eugeni.puigdomenech\Documents\Projectes\Scraper_web\backend\app\main.py).

El backend s'encarrega de:

- exposar els endpoints HTTP,
- gestionar la sessió de navegador i la sessió Google,
- crear jobs asíncrons de scraping,
- convertir els resultats en elements revisables,
- exportar dades a Google Sheets,
- llegir Google Sheets o CSV,
- generar l'HTML final.

Els mòduls més importants són:

- [job_manager.py](c:\Users\eugeni.puigdomenech\Documents\Projectes\Scraper_web\backend\app\job_manager.py): gestió en memòria dels jobs, estat, logs i ítems de revisió.
- [scraping.py](c:\Users\eugeni.puigdomenech\Documents\Projectes\Scraper_web\backend\app\scraping.py): extracció de FAQs des de pàgines web.
- [sheets.py](c:\Users\eugeni.puigdomenech\Documents\Projectes\Scraper_web\backend\app\sheets.py): autenticació Google OAuth, Drive i Sheets.
- [html_export.py](c:\Users\eugeni.puigdomenech\Documents\Projectes\Scraper_web\backend\app\html_export.py): filtratge de files aprovades i construcció del codi HTML final.
- [constants.py](c:\Users\eugeni.puigdomenech\Documents\Projectes\Scraper_web\backend\app\constants.py): capçaleres del full i `scopes` OAuth.

## Flux funcional complet

### 1. Preparació de fonts

L'usuari crea un o més blocs de `topic`.

Cada `topic` pot contenir diverses URLs, i cada URL es pot activar o desactivar. El frontend normalitza aquesta configuració i elimina duplicats combinant:

- `topic`
- `url`

També permet:

- exportar la configuració a CSV,
- reimportar-la després,
- conservar-la entre sessions al navegador.

### 2. Connexió amb Google

Per poder treballar amb Drive i Google Sheets, l'usuari ha d'iniciar sessió amb Google.

El backend implementa un flux OAuth amb aquestes característiques:

- ús de `SessionMiddleware` per identificar el navegador,
- generació d'un `session_id` propi,
- emmagatzematge de tokens per sessió a `google_tokens/<session_id>.json`,
- inici del login amb `/api/google/connect`,
- retorn a `/api/google/callback`,
- notificació al frontend via `postMessage` o redirecció.

Quan la sessió és vàlida, el frontend pot:

- consultar l'estat de la sessió,
- mostrar nom, correu i avatar,
- explorar carpetes i Sheets de Google Drive,
- llistar pestanyes d'un full concret,
- tancar la sessió.

### 3. Execució del scraping

Quan l'usuari prem `Descarregar FAQs`, el frontend crida:

- `POST /api/jobs/scrape`

El backend crea un job asíncron i el processa en un fil separat. Cada job conserva:

- `job_id`,
- estat (`queued`, `running`, `done`, `error`),
- dates de creació i actualització,
- progrés,
- URL actual,
- logs,
- resultat final.

El frontend va consultant:

- `GET /api/jobs`
- `GET /api/jobs/{job_id}`
- `GET /api/jobs/{job_id}/result`

### 4. Com funciona el motor de scraping

El motor de [scraping.py](c:\Users\eugeni.puigdomenech\Documents\Projectes\Scraper_web\backend\app\scraping.py) fa peticions HTTP amb `requests` i parseja el contingut amb `BeautifulSoup`.

Detecta diversos formats habituals de FAQs, entre ells:

- blocs numerats dins `.accordion-body`,
- estructures UPC antigues amb `collapse`,
- `#faqAccordion`,
- acordions niats amb `#faqTopicAccordion`,
- `accordion-item` de Bootstrap 5,
- estructures Genweb GW4,
- casos genèrics amb `button.accordion-button[data-bs-target]`.

Per cada FAQ trobada, el sistema intenta obtenir:

- `topic` principal, aportat per la configuració de l'usuari,
- `subtopic`, si la pàgina té agrupacions internes,
- pregunta,
- resposta,
- URL d'origen.

El resultat es transforma en files preparades per revisió. Per defecte, cada fila surt amb:

- `Estat = Pendent`
- `Persona darrera modificació = Agent IA`
- `Dades amb actualització anual = -`

### 5. Exportació a Google Sheets

Quan el job acaba i hi ha una sessió Google activa, el frontend pot exportar automàticament el resultat al Sheet seleccionat.

L'endpoint és:

- `POST /api/jobs/{job_id}/export/sheets`

La funció d'exportació:

- obre un full existent per ID o títol,
- crea el Google Sheet si no existeix,
- crea la pestanya si no existeix,
- garanteix la capçalera correcta,
- converteix respostes HTML a text llegible per Sheet,
- evita duplicats exactes de resposta per una mateixa combinació `Tema + Pregunta + Font`,
- escriu el bloc de dades,
- aplica format bàsic al full:
  - text embolicat,
  - alineació superior,
  - amplades de columna,
  - desplegable de validació per a la columna `Estat`.

La capçalera esperada és:

`Tema | Subtopic | Pregunta | Resposta | Estat | Data creació | Darrera modificació | Persona darrera modificació | Dades amb actualització anual | Font`

### 6. Revisió editorial

La revisió final es pensa sobretot perquè passi per Google Sheets.

El criteri important és la columna `Estat`. Quan es genera l'HTML final, només es tenen en compte les files marcades com a:

- `Aprovat`
- `Aprovada`
- `Approved`

També s'admeten altres variants equivalents en el filtratge intern com `ok`, `yes`, `true` o `1`.

Si una fila aprovada no té `Subtopic`, el sistema hi posa `-` per defecte abans de generar l'HTML.

### 7. Generació del codi HTML final

Des de la vista `export`, el frontend demana al backend que llegeixi la font externa seleccionada i construeixi el codi final.

L'endpoint principal és:

- `POST /api/export/html-from-source`

Aquest endpoint admet dues fonts:

- `csv`
- `sheets_oauth`

El procés és:

1. llegir les files del CSV o del Google Sheet,
2. normalitzar noms de columnes,
3. filtrar només les files aprovades,
4. completar `Subtopic` si falta,
5. validar que els camps essencials existeixen,
6. generar l'acordió HTML final.

La generació d'HTML:

- agrupa per `Subtopic` si n'hi ha,
- si no n'hi ha, agrupa per `Tema`,
- crea una estructura d'acordió amb estils inline,
- afegeix CSS i JavaScript per al comportament expandir/contraure,
- deixa el resultat llest per enganxar-lo en un bloc HTML de Genweb.

## Endpoints principals

### Salut i estat

- `GET /health`: comprova que el backend està viu.
- `GET /api/jobs`: llista jobs existents.
- `GET /api/jobs/{job_id}`: detall del job i logs.
- `GET /api/jobs/{job_id}/result`: resultat final del job si ha acabat.

### Google OAuth / Drive / Sheets

- `GET /api/google/session`: estat de la sessió Google.
- `POST /api/google/connect`: inicia el flux OAuth.
- `GET /api/google/callback`: callback del login.
- `POST /api/google/logout`: tanca la sessió Google.
- `GET /api/google/spreadsheets`: llista Sheets accessibles.
- `GET /api/google/drive/items`: llista carpetes i Google Sheets del Drive.
- `GET /api/google/spreadsheets/worksheets`: llista les pestanyes d'un spreadsheet.

### Scraping i revisió

- `POST /api/jobs/scrape`: crea un job de scraping.
- `GET /api/jobs/{job_id}/review`: retorna els ítems de revisió.
- `PUT /api/jobs/{job_id}/review/{item_id}`: actualitza un ítem.
- `PUT /api/jobs/{job_id}/review`: aprova o desmarca un conjunt d'ítems.
- `PUT /api/jobs/{job_id}/review/all`: aprova o desmarca tots els ítems.

### Exportació

- `GET /api/jobs/{job_id}/export/csv`: exporta el resultat del job a CSV.
- `POST /api/jobs/{job_id}/export/sheets`: exporta el resultat del job a Google Sheets.
- `POST /api/jobs/{job_id}/export/html`: genera HTML a partir dels ítems aprovats del job.
- `POST /api/export/html-from-source`: genera HTML a partir d'un CSV o d'un Google Sheet extern.

## Estructura de carpetes

```text
Scraper_web/
├─ backend/
│  ├─ app/
│  │  ├─ main.py
│  │  ├─ job_manager.py
│  │  ├─ scraping.py
│  │  ├─ sheets.py
│  │  ├─ html_export.py
│  │  ├─ schemas.py
│  │  └─ constants.py
│  ├─ requirements.txt
│  └─ src/
│     └─ scraper/
├─ frontend/
│  ├─ src/
│  │  ├─ App.jsx
│  │  ├─ App.css
│  │  └─ main.jsx
│  ├─ package.json
│  └─ vite.config.js
└─ README.md
```

## Requisits

### Backend

- Python 3.11 o superior recomanat
- dependències de [requirements.txt](c:\Users\eugeni.puigdomenech\Documents\Projectes\Scraper_web\backend\requirements.txt)

Llibreries destacades:

- `fastapi`
- `uvicorn`
- `requests`
- `beautifulsoup4`
- `gspread`
- `google-auth`
- `google-auth-oauthlib`
- `python-multipart`

### Frontend

- Node.js 20 o superior recomanat
- npm

Dependències principals:

- `react`
- `react-dom`
- `vite`

## Posada en marxa en desenvolupament

### 1. Arrencar el backend

Des de `backend/`:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Arrencar el frontend

Des de `frontend/`:

```powershell
npm install
npm run dev
```

Per defecte, el frontend intenta connectar amb el backend a:

`http://<host>:8000`

Si cal, es pot configurar manualment amb:

`VITE_API_URL`

Exemple:

```powershell
$env:VITE_API_URL="http://localhost:8000"
npm run dev
```

## Configuració Google OAuth

L'aplicació necessita credencials OAuth per treballar amb Google Drive i Google Sheets.

Es poden proporcionar de dues maneres:

- amb un fitxer `oauth_client.json`,
- amb variables d'entorn:
  - `GOOGLE_OAUTH_CLIENT_ID`
  - `GOOGLE_OAUTH_CLIENT_SECRET`
  - `GOOGLE_OAUTH_PROJECT_ID`
  - `GOOGLE_OAUTH_REDIRECT_URI`

Scopes utilitzats:

- `openid`
- `userinfo.email`
- `userinfo.profile`
- `spreadsheets`
- `drive`

La URI de callback per defecte és:

`http://localhost:8000/api/google/callback`

## Variables d'entorn útils

- `VITE_API_URL`: URL base del backend per al frontend.
- `BACKEND_CORS_ORIGINS`: llista d'orígens permesos pel backend separats per comes.
- `APP_SESSION_SECRET`: secret de sessió de FastAPI/Starlette.
- `SESSION_COOKIE_SECURE`: activa cookies segures.
- `FRONTEND_PUBLIC_URL`: URL pública del frontend.
- `GOOGLE_OAUTH_REDIRECT_URI`: callback OAuth explícita.
- `GOOGLE_OAUTH_CLIENT_ID`: client id de Google.
- `GOOGLE_OAUTH_CLIENT_SECRET`: secret de Google.
- `GOOGLE_OAUTH_PROJECT_ID`: projecte de Google Cloud.

## Format de CSV de configuració de fonts

El frontend pot importar i exportar un CSV de configuració amb aquestes columnes:

`topic;url;enabled`

Exemple:

```csv
topic;url;enabled
Admissions;https://exemple.upc.edu/faqs-admissions;true
Admissions;https://exemple.upc.edu/faqs-matricula;true
Masters;https://exemple.upc.edu/faqs-masters;false
```

## Format de dades per al full de revisió

La plantilla funcional del Google Sheet és aquesta:

```text
Tema | Subtopic | Pregunta | Resposta | Estat | Data creació | Darrera modificació | Persona darrera modificació | Dades amb actualització anual | Font
```

És important respectar especialment aquestes columnes:

- `Tema`
- `Subtopic`
- `Pregunta`
- `Resposta`
- `Estat`
- `Font`

## Notes de disseny i comportament

- Els jobs es guarden en memòria; si es reinicia el backend, es perden.
- Els tokens Google es desen per sessió local de navegador.
- El backend està preparat per CORS local amb Vite (`5173`) i localhost.
- El frontend llança exportació automàtica a Google Sheets quan el job acaba i hi ha un full seleccionat.
- El codi HTML generat incorpora estils i script d'acordió dins del mateix bloc exportat.

## Limitacions actuals

- El scraping depèn de patrons HTML coneguts; pàgines amb estructures molt diferents poden no ser detectades.
- No hi ha persistència de jobs en base de dades.
- La revisió principal està pensada per fer-se a Google Sheets; la UI web no implementa encara una revisió editorial completa equivalent.
- Si una pàgina canvia l'estructura del DOM, pot caldre ampliar la lògica de [scraping.py](c:\Users\eugeni.puigdomenech\Documents\Projectes\Scraper_web\backend\app\scraping.py).

## Resum ràpid del funcionament

1. Configures `topics` i URLs al frontend.
2. Inicies sessió amb Google.
3. Llances el scraping.
4. El backend extreu les FAQs i crea files estructurades.
5. El resultat s'exporta a Google Sheets.
6. Marques com `Aprovat` les files vàlides.
7. Des de la vista d'exportació, generes l'HTML final.
8. Copies el codi i l'enganxes a Genweb.
