TOPICS_UI = ["Graus", "Masters", "TFE", "Mobilitat", "Empresa", "Acte de graduaci\u00f3"]

OAUTH_HELP_TEXT = (
    "Com aconseguir oauth_client.json (Google OAuth):\n\n"
    "1) Ves a Google Cloud Console.\n"
    "2) Crea un projecte (o usa'n un existent).\n"
    "3) APIs & Services -> Library:\n"
    "   - Habilita Google Sheets API\n"
    "   - Habilita Google Drive API\n"
    "4) APIs & Services -> OAuth consent screen:\n"
    "   - Tipus: External (normalment)\n"
    "   - Omple dades b\u00e0siques\n"
    "   - Afegeix el teu usuari com a Test user (si est\u00e0 en mode Testing)\n"
    "5) APIs & Services -> Credentials -> Create credentials -> OAuth client ID:\n"
    "   - Application type: Desktop app\n"
    "6) Descarrega el JSON i guarda'l com: oauth_client.json\n\n"
    "Notes:\n"
    "- La primera vegada que executis, s'obrir\u00e0 el navegador per autoritzar.\n"
    "- Es crear\u00e0 un fitxer token.json al costat del programa (no el perdis)."
)

FAQ_FORMAT_HELP_TEXT = (
    "Quines p\u00e0gines puc extreure?\n\n"
    "Aquest programa detecta autom\u00e0ticament aquests formats de FAQs:\n"
    "- UPC antic: #collapse-base (enlla\u00e7os que obren respostes)\n"
    "- Bootstrap 5: .accordion-item / .accordion-body\n"
    "- UPC/Plone nou: #faqAccordion (botons amb data-bs-target=\"#cX\")\n"
    "- Genweb GW4: .accordion.accordion-gw4 (links open-accordionX + .accordion-content)\n\n"
    "Si una p\u00e0gina t\u00e9 un format diferent, pot donar 0 resultats.\n"
    "En aquest cas cal afegir un selector nou al scraper."
)

UPC_BLUE = "#0079BF"
UPC_BLUE_TAB = "#006EAD"
BG = "#FFFFFF"
LIGHT_PANEL = "#C9D3E2"
TEXT_MUTED = "#4B5563"
