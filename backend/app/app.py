# IMPORTS
import os
import sys
import threading
import time
import webbrowser
import json
import re
import unicodedata
from urllib.parse import urlparse
import customtkinter as ctk
from tkinter import messagebox, font as tkfont
from PIL import Image
import hashlib
from bs4 import BeautifulSoup, NavigableString

MODULE_DIR = os.path.dirname(os.path.abspath(__file__))
if MODULE_DIR not in sys.path:
    sys.path.insert(0, MODULE_DIR)
PACKAGE_PARENT = os.path.dirname(MODULE_DIR)
if PACKAGE_PARENT not in sys.path:
    sys.path.insert(0, PACKAGE_PARENT)

try:
    from scraper import core
    from scraper.models import FaqItem
    from scraper.settings import (
        BG,
        FAQ_FORMAT_HELP_TEXT,
        LIGHT_PANEL,
        OAUTH_HELP_TEXT,
        TOPICS_UI,
        UPC_BLUE,
        UPC_BLUE_TAB,
    )
    from scraper.ui.widgets import file_row, help_icon, text_row
except ImportError:
    try:
        from . import core
        from .models import FaqItem
        from .settings import (
            BG,
            FAQ_FORMAT_HELP_TEXT,
            LIGHT_PANEL,
            OAUTH_HELP_TEXT,
            TOPICS_UI,
            UPC_BLUE,
            UPC_BLUE_TAB,
        )
        from .ui.widgets import file_row, help_icon, text_row
    except ImportError:
        import core
        from models import FaqItem
        from settings import (
            BG,
            FAQ_FORMAT_HELP_TEXT,
            LIGHT_PANEL,
            OAUTH_HELP_TEXT,
            TOPICS_UI,
            UPC_BLUE,
            UPC_BLUE_TAB,
        )
        from ui.widgets import file_row, help_icon, text_row

ctk.set_appearance_mode("light")


# HELPERS
def resource_path(relative_path: str) -> str:
    """Retorna una ruta absoluta tant si s'executa en dev com si s'executa dins PyInstaller."""
    if hasattr(sys, "_MEIPASS"):
        base_path = sys._MEIPASS
    else:
        # Project root from this file (src/scraper/app.py -> project root)
        base_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    return os.path.join(base_path, relative_path)
    # Windows taskbar icon (optional)
try:
    import ctypes
except Exception:
    ctypes = None

# CLASSE PRINCIPAL
class App(ctk.CTk):

    # ====Lifecycle / init
    def __init__(self):
        super().__init__()

        self.scraped_items: list[FaqItem] = []
        self.review_filter_only_approved = ctk.BooleanVar(value=False)
        self.review_filter_only_approved.trace_add("write", lambda *_: self._schedule_save_ui_state())
        self.generated_code_cache = ""
        self.failed_sources: list[tuple[str, str]] = []
        self._run_sources_override: list[tuple[str, str]] | None = None
        self._run_started_at = 0.0
        self._state_write_job = None
        self._is_restoring_state = False

        # Fix icona barra de tasques Windows (més fiable a l'EXE)
        if ctypes:
            try:
                myappid = "upc.faq.scraper.v1"
                ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(myappid)
            except Exception:
                pass

        self.title("UPC FAQ Scraper")
        self.geometry("1250x760")
        self._base_min_w = 1100
        self._base_min_h = 680
        self._collapsed_height_fixed = 760
        self._details_extra_h = 140
        self._expanded_height_fixed = self._collapsed_height_fixed + self._details_extra_h
        self._collapsed_width = 1250
        self.minsize(self._base_min_w, self._base_min_h)
        self.configure(fg_color=BG)

        # Taskbar icon
        try:
            self.iconbitmap(resource_path("assets/upc_logo.ico"))
        except Exception as e:
            print("No s'ha pogut carregar .ico:", e)

        # INPUT: sempre CSV
        self.input_mode = ctk.StringVar(value="ui")
        self.output_mode = ctk.StringVar(value="ui")
        self.output_mode.trace_add("write", lambda *_: self._schedule_save_ui_state())

        # Input UI grouped by topic
        self.topic_groups = []
        self.topic_seq = 0

        # Output file (csv)
        self.output_file_path = ctk.StringVar()
        self.output_file_path.trace_add("write", lambda *_: self._schedule_save_ui_state())

        # Output sheets
        self.output_sheet_title = ctk.StringVar()
        self.output_sheet_tab = ctk.StringVar()
        self.output_sheet_title.trace_add("write", lambda *_: self._schedule_save_ui_state())
        self.output_sheet_tab.trace_add("write", lambda *_: self._schedule_save_ui_state())

        # OAuth files (Sheets)
        self.oauth_client_json = ctk.StringVar(value="")
        self.token_file = ctk.StringVar(value="")
        self.oauth_client_json.trace_add("write", lambda *_: self._schedule_save_ui_state())
        self.token_file.trace_add("write", lambda *_: self._schedule_save_ui_state())

        # ---------- Layout ----------
        self._build_header()
        self._build_body()
        self._refresh_ui()
        self._restore_ui_state()
        self.bind("<Configure>", self._on_window_configure)
        self.bind("<Control-f>", self._focus_review_search)
        self.bind("<Control-F>", self._focus_review_search)
        self.bind("<Control-Shift-A>", lambda _e: self._approve_all())
        self.bind("<Control-Shift-D>", lambda _e: self._unapprove_all())
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    # ====Build UI
    # CONSTRUCCIO UI
    def _build_header(self):
        header = ctk.CTkFrame(self, fg_color=UPC_BLUE, corner_radius=0, height=92)
        header.pack(fill="x")
        header.pack_propagate(False)

        # Logo
        try:
            self.logo_source = Image.open(resource_path("assets/upc_logo_2.png"))
            w, h = self.logo_source.size
            target_h = 78
            target_w = max(1, int(w * (target_h / h)))
            self.logo_image = ctk.CTkImage(
                light_image=self.logo_source,
                size=(target_w, target_h),
            )
            ctk.CTkLabel(header, image=self.logo_image, text="").pack(side="left", padx=(18, 10))
        except Exception as e:
            print("No s'ha pogut carregar PNG:", e)
            ctk.CTkLabel(header, text="UPC", text_color="white",
                         font=ctk.CTkFont(size=18, weight="bold")).pack(side="left", padx=(18, 10))


        ctk.CTkLabel(
            header,
            text="FAQ Scraper",
            text_color="white",
            font=ctk.CTkFont(size=18, weight="bold"),
        ).pack(side="right", padx=18)
    def _build_body(self):
        body = ctk.CTkFrame(self, fg_color=BG)
        body.pack(fill="both", expand=True, padx=18, pady=18)

        body.grid_columnconfigure(0, weight=1)
        body.grid_rowconfigure(0, weight=1)

        tabs = ctk.CTkTabview(body)
        tabs.grid(row=0, column=0, sticky="nsew", padx=6, pady=(6, 12))
        self.tabs = tabs
        self.tab_name_scrape = "1) Fonts i descàrrega"
        self.tab_name_review = "2) Revisió i aprovació"
        self.tab_name_export = "3) Exportació"
        self.current_tab_name = self.tab_name_scrape
        self._style_tabview(tabs)
        self.after(50, lambda: self._fix_tab_text_colors(tabs))

        tab_scrape = tabs.add(self.tab_name_scrape)
        tab_review = tabs.add(self.tab_name_review)
        tab_html = tabs.add(self.tab_name_export)

        tab_scrape.grid_columnconfigure(0, weight=1)
        tab_scrape.grid_rowconfigure(0, weight=1)
        self.tab_scrape_scroll = ctk.CTkScrollableFrame(
            tab_scrape,
            fg_color="transparent",
            scrollbar_button_color="#9FB6D3",
            scrollbar_button_hover_color="#7EA2CC",
        )
        self.tab_scrape_scroll.grid(row=0, column=0, sticky="nsew", padx=0, pady=0)
        self.tab_scrape_scroll.grid_columnconfigure(0, weight=1)
        scrape_parent = self.tab_scrape_scroll

        # IMPORTANT: només cridem la que sí existeix
        self._build_tab_review(tab_review)

        tab_html.grid_columnconfigure(0, weight=1)
        tab_html.grid_rowconfigure(3, weight=1)  # la fila del log2


        tabs.configure(command=lambda: self._on_tab_changed())

        # TAB 1: SCRAPE I EXPORTA
        self.in_card = ctk.CTkFrame(scrape_parent, fg_color=LIGHT_PANEL, corner_radius=10)
        self.in_card.grid(row=0, column=0, sticky="ew", padx=6, pady=(0, 10))
        self.in_card.grid_columnconfigure(0, weight=1)

        onboarding = ctk.CTkFrame(self.in_card, fg_color="#DBEAFE", corner_radius=8)
        onboarding.grid(row=0, column=0, sticky="ew", padx=12, pady=(10, 6))
        ctk.CTkLabel(
            onboarding,
            text="Guia ràpida: 1) Afegeix URLs -> 2) Descarrega FAQs -> 3) Revisa i aprova -> 4) Exporta",
            font=ctk.CTkFont(size=12, weight="bold"),
            text_color="#1E3A8A",
            anchor="w",
            justify="left",
        ).pack(fill="x", padx=10, pady=8)

        title_row = ctk.CTkFrame(self.in_card, fg_color="transparent")
        title_row.grid(row=1, column=0, padx=12, pady=(6, 4), sticky="ew")

        title_label = ctk.CTkLabel(
            title_row,
            text="Introdueix la URL de la pàgina d'on extreure les FAQs",
            font=ctk.CTkFont(size=14, weight="bold")
        )
        title_label.pack(side="left")


        q = help_icon(title_row, FAQ_FORMAT_HELP_TEXT, UPC_BLUE)
        q.pack(side="left", padx=(6, 0))
        self.selection_summary_label = ctk.CTkLabel(title_row, text="")
        self.selection_summary_label.pack(side="right")
        self.topics_list = ctk.CTkFrame(self.in_card, fg_color="transparent", height=8)
        self.topics_list.grid(row=2, column=0, sticky="ew", padx=6, pady=(0, 6))
        # Controlem manualment l'alçada per evitar espais buits grans.
        self.topics_list.grid_propagate(False)
        self.topics_list.grid_columnconfigure(0, weight=1)

        actions_row = ctk.CTkFrame(self.in_card, fg_color="transparent")
        actions_row.grid(row=3, column=0, sticky="w", padx=12, pady=(0, 8))

        ctk.CTkButton(
            actions_row,
            text="Afegeix topic",
            command=lambda: self.add_topic_group(add_initial_url=True),
            width=150
        ).pack(side="left")

        self.add_topic_group(topic_name=TOPICS_UI[0], add_initial_url=True)

        # --- SORTIDA card ---
        self.out_card = ctk.CTkFrame(scrape_parent, fg_color=LIGHT_PANEL, corner_radius=10)
        self.out_card.grid(row=1, column=0, sticky="ew", padx=6, pady=(0, 16))
        self.out_card.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            self.out_card, text="Tria on vols revisar i aprobar les FAQs",
            font=ctk.CTkFont(size=14, weight="bold")
        ).grid(row=0, column=0, columnspan=3, padx=12, pady=(10, 6), sticky="w")

        out_mode_frame = ctk.CTkFrame(self.out_card, fg_color="transparent")
        out_mode_frame.grid(row=1, column=0, columnspan=3, sticky="w", padx=12, pady=(6, 14))

        ctk.CTkRadioButton(
            out_mode_frame, text="Aprovar via UI",
            variable=self.output_mode, value="ui",
            command=self._refresh_ui
        ).pack(side="left", padx=(0, 18))

        ctk.CTkRadioButton(
            out_mode_frame, text="CSV",
            variable=self.output_mode, value="csv",
            command=self._refresh_ui
        ).pack(side="left", padx=(0, 18))

        ctk.CTkRadioButton(
            out_mode_frame, text="Google Sheets",
            variable=self.output_mode, value="sheets_oauth",
            command=self._refresh_ui
        ).pack(side="left")

        # CSV output row
        self.out_file_row = ctk.CTkFrame(self.out_card, fg_color="transparent")
        self.out_file_row.grid(row=2, column=0, columnspan=3, sticky="ew", padx=6, pady=(0, 10))
        self.out_file_row.grid_columnconfigure(1, weight=1)

        self.output_file_entry = file_row(
            parent=self.out_file_row,
            row=0,
            label="Fitxer de sortida (CSV)",
            var=self.output_file_path,
            save=True,
            types=[("CSV", "*.csv")],
            icon_color=UPC_BLUE,
        )

        # Sheets rows
        self.out_sheets_row = ctk.CTkFrame(self.out_card, fg_color="transparent")
        self.out_sheets_row.grid(row=3, column=0, columnspan=3, sticky="ew", padx=6, pady=(0, 10))
        self.out_sheets_row.grid_columnconfigure(1, weight=1)

        self.output_sheet_title_entry = text_row(
            self.out_sheets_row, 0, "Títol del Google Sheet", self.output_sheet_title
        )
        self.output_sheet_tab_entry = text_row(
            self.out_sheets_row, 1, "Nom de la pestanya", self.output_sheet_tab
        )

        self.oauth_row = ctk.CTkFrame(self.out_card, fg_color="transparent")
        self.oauth_row.grid(row=4, column=0, columnspan=3, sticky="ew", padx=6, pady=(0, 10))
        self.oauth_row.grid_columnconfigure(1, weight=1)

        # --- OAuth row (TAB 1) ---
        oauth_title_row = ctk.CTkFrame(self.oauth_row, fg_color="transparent")
        oauth_title_row.grid(row=0, column=0, columnspan=3, sticky="w", padx=6, pady=(0, 0))

        ctk.CTkLabel(oauth_title_row, text="OAuth client (oauth_client.json)").pack(side="left")

        oauth_q1 = help_icon(oauth_title_row, OAUTH_HELP_TEXT, UPC_BLUE)
        oauth_q1.pack(side="left", padx=(6, 0))

        self.oauth_entry_1 = file_row(
            parent=self.oauth_row,
            row=0,
            label="OAuth client (oauth_client.json)",
            var=self.oauth_client_json,
            save=False,
            types=[("JSON", "*.json")],
            icon_color=UPC_BLUE,
            button_text="Explora...",
            tooltip_text=OAUTH_HELP_TEXT,
        )

        # --- Botó + progress + log (tab 1) ---
        btns = ctk.CTkFrame(scrape_parent, fg_color="transparent")
        btns.grid(row=2, column=0, sticky="w", padx=6, pady=(4, 6))

        self.run_btn = ctk.CTkButton(
            btns,
            text="Descarregar FAQs",
            command=self.run_clicked,
            width=170,
        )
        self.run_btn.pack(side="left")
        self.retry_failed_btn = ctk.CTkButton(
            btns,
            text="Reintentar fallides",
            command=self.retry_failed_clicked,
            width=160,
            state="disabled",
        )
        self.retry_failed_btn.pack(side="left", padx=(8, 0))

        progress_wrap = ctk.CTkFrame(scrape_parent, fg_color="transparent")
        progress_wrap.grid(row=3, column=0, sticky="ew", padx=6, pady=(6, 8))
        progress_wrap.grid_columnconfigure(0, weight=1)
        progress_wrap.grid_columnconfigure(1, weight=0)

        self.progress = ctk.CTkProgressBar(progress_wrap, height=12)
        self.progress.grid(row=0, column=0, sticky="ew", padx=(0, 10))
        self.progress.configure(progress_color=UPC_BLUE_TAB, fg_color="#DCE3ED")
        self.progress.set(0)
        self.progress_status = ctk.CTkLabel(progress_wrap, text="0% · Preparat")
        self.progress_status.grid(row=0, column=1, sticky="e")

        details_row = ctk.CTkFrame(scrape_parent, fg_color="transparent")
        details_row.grid(row=4, column=0, sticky="w", padx=6, pady=(0, 6))
        self.log_toggle_btn = ctk.CTkButton(
            details_row,
            text="Veure més detalls",
            width=160,
            command=self._toggle_log_details,
        )
        self.log_toggle_btn.pack(side="left")


        # --- LOG card (gris) ---
        self.log_card = ctk.CTkFrame(scrape_parent, fg_color=LIGHT_PANEL, corner_radius=10)
        self.log_card.grid(row=5, column=0, sticky="ew", padx=6, pady=(0, 10))
        self.log_card.configure(height=250)
        self.log_card.grid_propagate(False)
        self.log_card.grid_columnconfigure(0, weight=1)
        self.log_card.grid_rowconfigure(0, weight=1)

        self.log = ctk.CTkTextbox(self.log_card)
        self.println(
            "Aquesta eina té dues funcions:\n\n"
            "1) Descarregador de FAQs: introdueix una URL amb preguntes freqüents "
            "i genera un fitxer per revisar-les i marcar-les com aprovades.\n\n"
            "2) Generador de codi per Genweb: importa el fitxer amb les FAQs "
            "aprovades i obté el codi font llest per enganxar a la web."
        )
        self.log.grid(row=0, column=0, sticky="nsew", padx=12, pady=12)
        # Forcem estat inicial amagat.
        self._log_details_open = True
        self._set_log_details_visible(False)




        # TAB 2: APROVATS -> HTML
        # (variables ja les tens definides en altres llocs? si no, aquí també val)
        self.html_input_mode = ctk.StringVar(value="ui")
        self.html_input_csv_path = ctk.StringVar()
        self.html_sheet_title = ctk.StringVar()
        self.html_sheet_tab = ctk.StringVar()
        self.html_output_path = ctk.StringVar()
        self.html_input_mode.trace_add("write", lambda *_: self._schedule_save_ui_state())
        self.html_input_csv_path.trace_add("write", lambda *_: self._schedule_save_ui_state())
        self.html_sheet_title.trace_add("write", lambda *_: self._schedule_save_ui_state())
        self.html_sheet_tab.trace_add("write", lambda *_: self._schedule_save_ui_state())

        card2 = ctk.CTkFrame(tab_html, fg_color=LIGHT_PANEL, corner_radius=10)
        card2.grid(row=0, column=0, sticky="ew", padx=6, pady=(0, 10))
        card2.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            card2, text="Selecciona el fitxer revisat (agafarà només les FAQs aprovades)",
            font=ctk.CTkFont(size=14, weight="bold")
        ).grid(row=0, column=0, columnspan=3, padx=12, pady=(10, 6), sticky="w")

        mode_frame2 = ctk.CTkFrame(card2, fg_color="transparent")
        mode_frame2.grid(row=1, column=0, columnspan=3, sticky="w", padx=12, pady=(6, 14))

        ctk.CTkRadioButton(
            mode_frame2, text="Aprovades a la UI (recomanat)",
            variable=self.html_input_mode, value="ui",
            command=self._refresh_html_ui
        ).pack(side="left", padx=(0, 18))

        ctk.CTkRadioButton(
            mode_frame2, text="CSV editat",
            variable=self.html_input_mode, value="csv",
            command=self._refresh_html_ui
        ).pack(side="left", padx=(0, 18))

        ctk.CTkRadioButton(
            mode_frame2, text="Google Sheets editat",
            variable=self.html_input_mode, value="sheets_oauth",
            command=self._refresh_html_ui
        ).pack(side="left")

        self.html_csv_row = ctk.CTkFrame(card2, fg_color="transparent")
        self.html_csv_row.grid(row=2, column=0, columnspan=3, sticky="ew", padx=6, pady=(0, 10))
        self.html_csv_row.grid_columnconfigure(1, weight=1)

        self.html_csv_entry = file_row(
            parent=self.html_csv_row,
            row=0,
            label="CSV d'entrada (editat)",
            var=self.html_input_csv_path,
            save=False,
            types=[("CSV", "*.csv")],
            icon_color=UPC_BLUE,
            button_text="Explora...",
            # NO tooltip aquí
        )

        self.html_sheets_row = ctk.CTkFrame(card2, fg_color="transparent")
        self.html_sheets_row.grid(row=3, column=0, columnspan=3, sticky="ew", padx=6, pady=(0, 10))
        self.html_sheets_row.grid_columnconfigure(1, weight=1)

        self.html_sheet_title_entry = text_row(
            self.html_sheets_row, 0, "Títol del Google Sheet", self.html_sheet_title
        )
        self.html_sheet_tab_entry = text_row(
            self.html_sheets_row, 1, "Nom de la pestanya", self.html_sheet_tab
        )

        self.html_oauth_row = ctk.CTkFrame(card2, fg_color="transparent")
        self.html_oauth_row.grid(row=4, column=0, columnspan=3, sticky="ew", padx=6, pady=(0, 10))
        self.html_oauth_row.grid_columnconfigure(1, weight=1)

        # --- OAuth row (TAB 2) ---
        oauth_title_row2 = ctk.CTkFrame(self.html_oauth_row, fg_color="transparent")
        oauth_title_row2.grid(row=0, column=0, columnspan=3, sticky="w", padx=6, pady=(0, 0))

        ctk.CTkLabel(oauth_title_row2, text="OAuth client (oauth_client.json)").pack(side="left")

        oauth_q2 = help_icon(oauth_title_row2, OAUTH_HELP_TEXT, UPC_BLUE)
        oauth_q2.pack(side="left", padx=(6, 0))

        self.oauth_entry_2 = file_row(
            parent=self.html_oauth_row,
            row=0,
            label="OAuth client (oauth_client.json)",
            var=self.oauth_client_json,
            save=False,
            types=[("JSON", "*.json")],
            icon_color=UPC_BLUE,
            button_text="Explora...",
            tooltip_text=OAUTH_HELP_TEXT,
        )

        btns2 = ctk.CTkFrame(tab_html, fg_color="transparent")
        btns2.grid(row=2, column=0, sticky="w", padx=6, pady=(4, 6))

        self.gen_btn = ctk.CTkButton(
            btns2,
            text="Generar HTML Genweb",
            command=self.generate_html_clicked,
            width=260,
        )
        self.gen_btn.pack(side="left")

        self.code_card = ctk.CTkFrame(tab_html, fg_color=LIGHT_PANEL, corner_radius=10)
        self.code_card.grid(row=3, column=0, sticky="nsew", padx=6, pady=10)
        self.code_card.grid_columnconfigure(0, weight=1)
        self.code_card.grid_rowconfigure(0, weight=1)

        self.log2 = ctk.CTkTextbox(self.code_card)
        self.log2.grid(row=0, column=0, sticky="nsew", padx=12, pady=12)

        copy_row = ctk.CTkFrame(tab_html, fg_color="transparent")
        copy_row.grid(row=4, column=0, sticky="w", padx=6, pady=(0, 10))

        ctk.CTkButton(
            copy_row,
            text="Copiar tot el codi",
            command=self.copy_generated_code,
            width=180
        ).pack(side="left")

        self.scrape_validation_label = ctk.CTkLabel(
            scrape_parent,
            text="",
            text_color="#B91C1C",
            anchor="w",
            justify="left",
            font=ctk.CTkFont(size=12),
        )
        self.scrape_validation_label.grid(row=6, column=0, sticky="ew", padx=8, pady=(0, 2))
        self.scrape_validation_label.grid_remove()

        self.export_validation_label = ctk.CTkLabel(
            tab_html, text="", text_color="#B91C1C", anchor="w"
        )
        self.export_validation_label.grid(row=5, column=0, sticky="ew", padx=8, pady=(0, 4))
        self.export_validation_label.grid_remove()

        # Refresh inicials (important)
        self._refresh_ui()
        self._refresh_html_ui()
        self._setup_live_validation()

    # ====UI component helpers
    # ARBRE TOPICS / URLS
    def _get_state_file_path(self) -> str:
        appdata = os.getenv("APPDATA")
        if appdata:
            base_dir = os.path.join(appdata, "UPCFAQScraper")
        else:
            base_dir = os.path.join(os.path.expanduser("~"), ".upc_faq_scraper")
        os.makedirs(base_dir, exist_ok=True)
        return os.path.join(base_dir, "ui_state.json")

    def _serialize_sources_state(self) -> dict:
        groups = []
        for g in self.topic_groups:
            groups.append(
                {
                    "topic": (g["topic_var"].get() or "").strip(),
                    "selected": bool(g["selected_var"].get()),
                    "expanded": bool(g["expanded_var"].get()),
                    "urls": [
                        {
                            "url": (r["url_var"].get() or "").strip(),
                            "selected": bool(r["selected_var"].get()),
                        }
                        for r in g["url_rows"]
                    ],
                }
            )
        scraped_items = []
        for it in self.scraped_items:
            scraped_items.append(
                {
                    "id": it.id,
                    "topic": it.topic,
                    "question": it.question,
                    "answer": it.answer,
                    "source": it.source,
                    "approved": bool(it.approved_var.get()),
                }
            )

        return {
            "version": 3,
            "groups": groups,
            "review_filter_only_approved": bool(self.review_filter_only_approved.get()),
            "scraped_items": scraped_items,
            "generated_code": self.generated_code_cache or self.log2.get("1.0", "end-1c"),
            "scrape_config": {
                "output_mode": self.output_mode.get(),
                "output_file_path": (self.output_file_path.get() or "").strip(),
                "output_sheet_title": (self.output_sheet_title.get() or "").strip(),
                "output_sheet_tab": (self.output_sheet_tab.get() or "").strip(),
                "oauth_client_json": (self.oauth_client_json.get() or "").strip(),
                "token_file": (self.token_file.get() or "").strip(),
            },
            "export_config": {
                "html_input_mode": self.html_input_mode.get(),
                "html_input_csv_path": (self.html_input_csv_path.get() or "").strip(),
                "html_sheet_title": (self.html_sheet_title.get() or "").strip(),
                "html_sheet_tab": (self.html_sheet_tab.get() or "").strip(),
            },
        }

    def _save_ui_state(self):
        if self._is_restoring_state:
            return
        try:
            path = self._get_state_file_path()
            with open(path, "w", encoding="utf-8") as f:
                json.dump(self._serialize_sources_state(), f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def _schedule_save_ui_state(self):
        if self._is_restoring_state:
            return
        if self._state_write_job is not None:
            try:
                self.after_cancel(self._state_write_job)
            except Exception:
                pass
        self._state_write_job = self.after(300, self._save_ui_state)

    def _clear_all_topic_groups(self):
        for g in self.topic_groups:
            try:
                g["frame"].destroy()
            except Exception:
                pass
        self.topic_groups = []
        self.topic_seq = 0

    def _restore_ui_state(self):
        path = self._get_state_file_path()
        if not os.path.exists(path):
            return

        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            return

        groups = data.get("groups") if isinstance(data, dict) else None
        scraped_items = data.get("scraped_items") if isinstance(data, dict) else None
        review_filter_only_approved = (
            bool(data.get("review_filter_only_approved", False)) if isinstance(data, dict) else False
        )
        generated_code = (data.get("generated_code") or "") if isinstance(data, dict) else ""
        scrape_config = data.get("scrape_config") if isinstance(data, dict) else None
        export_config = data.get("export_config") if isinstance(data, dict) else None

        self._is_restoring_state = True
        try:
            if isinstance(scrape_config, dict):
                output_mode = (scrape_config.get("output_mode") or "ui").strip()
                if output_mode not in {"ui", "csv", "sheets_oauth"}:
                    output_mode = "ui"
                self.output_mode.set(output_mode)
                self.output_file_path.set((scrape_config.get("output_file_path") or "").strip())
                self.output_sheet_title.set((scrape_config.get("output_sheet_title") or "").strip())
                self.output_sheet_tab.set((scrape_config.get("output_sheet_tab") or "").strip())
                self.oauth_client_json.set((scrape_config.get("oauth_client_json") or "").strip())
                self.token_file.set((scrape_config.get("token_file") or "").strip())

            if isinstance(export_config, dict):
                html_input_mode = (export_config.get("html_input_mode") or "ui").strip()
                if html_input_mode not in {"ui", "csv", "sheets_oauth"}:
                    html_input_mode = "ui"
                self.html_input_mode.set(html_input_mode)
                self.html_input_csv_path.set((export_config.get("html_input_csv_path") or "").strip())
                self.html_sheet_title.set((export_config.get("html_sheet_title") or "").strip())
                self.html_sheet_tab.set((export_config.get("html_sheet_tab") or "").strip())

            if groups:
                self._clear_all_topic_groups()

                for g in groups:
                    topic_name = (g.get("topic") or "").strip() if isinstance(g, dict) else ""
                    group = self.add_topic_group(topic_name=topic_name, add_initial_url=False)

                    urls = g.get("urls") if isinstance(g, dict) else None
                    if urls:
                        for u in urls:
                            url_value = (u.get("url") or "").strip() if isinstance(u, dict) else ""
                            self.add_url_to_topic(group, url_value=url_value)
                            row = group["url_rows"][-1]
                            row["selected_var"].set(bool(u.get("selected", True)) if isinstance(u, dict) else True)
                    else:
                        self.add_url_to_topic(group)

                    group["selected_var"].set(bool(g.get("selected", True)) if isinstance(g, dict) else True)

                    expanded = bool(g.get("expanded", True)) if isinstance(g, dict) else True
                    if not expanded and group["expanded_var"].get():
                        self.toggle_topic_group(group)

                if not self.topic_groups:
                    self.add_topic_group(topic_name=TOPICS_UI[0], add_initial_url=True)

            if scraped_items and isinstance(scraped_items, list):
                items: list[FaqItem] = []
                for it in scraped_items:
                    if not isinstance(it, dict):
                        continue
                    items.append(
                        self._make_faq_item(
                            topic=(it.get("topic") or "").strip(),
                            question=(it.get("question") or "").strip(),
                            answer=(it.get("answer") or "").strip(),
                            source=(it.get("source") or "").strip(),
                            approved=bool(it.get("approved", False)),
                            forced_id=(it.get("id") or "").strip(),
                        )
                    )
                self.scraped_items = items
                self.review_filter_only_approved.set(review_filter_only_approved)
                self._refresh_review_list()

            if isinstance(generated_code, str) and generated_code.strip():
                self.generated_code_cache = generated_code
                self._show_generated_code(generated_code)

            self._refresh_ui()
            self._refresh_html_ui()
            self._update_source_selection_summary()
            url_count = sum(len(g["url_rows"]) for g in self.topic_groups)
            self._set_restore_summary(len(self.topic_groups), url_count, len(self.scraped_items))
        finally:
            self._is_restoring_state = False

    def _on_close(self):
        self._save_ui_state()
        self.destroy()

    def add_topic_group(self, topic_name: str = "", add_initial_url: bool = True):
        self.topic_seq += 1

        group_frame = ctk.CTkFrame(self.topics_list, fg_color="#E5E7EB", corner_radius=8)
        group_frame.pack(fill="x", padx=6, pady=6)
        # Evita alçades fixes grans dels CTkFrame i ajusta al contingut real.
        group_frame.pack_propagate(True)
        group_frame.grid_propagate(True)
        group_frame.grid_columnconfigure(0, weight=1)

        header = ctk.CTkFrame(group_frame, fg_color="transparent")
        header.grid(row=0, column=0, sticky="ew", padx=8, pady=(8, 6))
        header.grid_columnconfigure(2, weight=1)

        expanded_var = ctk.BooleanVar(value=True)
        selected_var = ctk.BooleanVar(value=True)
        topic_var = ctk.StringVar(value=topic_name or f"Topic {self.topic_seq}")
        selected_var.trace_add("write", lambda *_: self._schedule_save_ui_state())
        topic_var.trace_add("write", lambda *_: self._schedule_save_ui_state())

        toggle_btn = ctk.CTkButton(
            header,
            text="-",
            width=28,
            command=lambda: self.toggle_topic_group(group),
        )
        toggle_btn.grid(row=0, column=0, padx=(0, 6))

        ctk.CTkCheckBox(
            header,
            text="",
            variable=selected_var,
            width=20,
            command=lambda: self._on_topic_selected_changed(group),
        ).grid(row=0, column=1, padx=(0, 6))

        ctk.CTkEntry(header, textvariable=topic_var, placeholder_text="Nom del topic").grid(
            row=0, column=2, sticky="ew", padx=(0, 8)
        )

        count_label = ctk.CTkLabel(header, text="0 URLs")
        count_label.grid(row=0, column=3, padx=(0, 8))

        ctk.CTkButton(
            header,
            text="+ URL",
            width=70,
            command=lambda: self.add_url_to_topic(group),
        ).grid(row=0, column=4, padx=(0, 6))

        ctk.CTkButton(
            header,
            text="X",
            width=34,
            fg_color="#B91C1C",
            hover_color="#991B1B",
            command=lambda: self.remove_topic_group(group_frame),
        ).grid(row=0, column=5)

        body = ctk.CTkFrame(group_frame, fg_color="transparent", height=1)
        body.grid(row=1, column=0, sticky="ew", padx=8, pady=(0, 8))
        body.grid_propagate(True)
        body.grid_columnconfigure(0, weight=1)

        urls_frame = ctk.CTkFrame(body, fg_color="transparent", height=1)
        urls_frame.grid(row=0, column=0, sticky="ew")
        urls_frame.grid_propagate(True)
        urls_frame.grid_columnconfigure(1, weight=1)

        group = {
            "frame": group_frame,
            "body": body,
            "urls_frame": urls_frame,
            "topic_var": topic_var,
            "selected_var": selected_var,
            "expanded_var": expanded_var,
            "toggle_btn": toggle_btn,
            "count_label": count_label,
            "url_rows": [],
        }
        self.topic_groups.append(group)

        if add_initial_url:
            self.add_url_to_topic(group)

        self._update_topic_count(group)
        self._update_source_selection_summary()
        self._schedule_save_ui_state()
        return group

    def toggle_topic_group(self, group):
        is_open = group["expanded_var"].get()
        if is_open:
            group["body"].grid_remove()
            group["toggle_btn"].configure(text="+")
            group["expanded_var"].set(False)
        else:
            group["body"].grid()
            group["toggle_btn"].configure(text="-")
            group["expanded_var"].set(True)
        self._schedule_save_ui_state()

    def remove_topic_group(self, frame):
        frame.destroy()
        self.topic_groups = [g for g in self.topic_groups if g["frame"] != frame]
        self._update_source_selection_summary()
        self._schedule_save_ui_state()
        self._run_live_validation()

    def add_url_to_topic(self, group, url_value: str = ""):
        row_frame = ctk.CTkFrame(group["urls_frame"], fg_color="transparent")
        row_frame.pack(fill="x", pady=4)
        row_frame.grid_columnconfigure(1, weight=1)

        selected_var = ctk.BooleanVar(value=group["selected_var"].get())
        url_var = ctk.StringVar(value=url_value)
        selected_var.trace_add("write", lambda *_: self._schedule_save_ui_state())
        url_var.trace_add("write", lambda *_: self._on_url_value_changed())

        ctk.CTkCheckBox(
            row_frame,
            text="",
            variable=selected_var,
            width=20,
            command=lambda: self._on_url_selected_changed(group),
        ).grid(row=0, column=0, padx=(0, 6), sticky="w")

        entry = ctk.CTkEntry(row_frame, textvariable=url_var, placeholder_text="https://...")
        entry.grid(row=0, column=1, sticky="ew", padx=(0, 8))

        ctk.CTkButton(
            row_frame,
            text="X",
            width=34,
            fg_color="#B91C1C",
            hover_color="#991B1B",
            command=lambda: self.remove_url_row(group, row_frame),
        ).grid(row=0, column=2)

        group["url_rows"].append({
            "frame": row_frame,
            "url_var": url_var,
            "selected_var": selected_var,
            "entry": entry,
        })

        self._update_topic_count(group)
        self._update_source_selection_summary()
        self._schedule_save_ui_state()
        self._run_live_validation()

    def remove_url_row(self, group, frame):
        if len(group["url_rows"]) <= 1:
            messagebox.showinfo("URL requerida", "Cada topic ha de tenir com a mínim una URL.")
            return
        frame.destroy()
        group["url_rows"] = [r for r in group["url_rows"] if r["frame"] != frame]
        self._sync_topic_with_children(group)
        self._update_topic_count(group)
        self._update_source_selection_summary()
        self._schedule_save_ui_state()
        self._run_live_validation()

    def _on_topic_selected_changed(self, group):
        selected = group["selected_var"].get()
        for row in group["url_rows"]:
            row["selected_var"].set(selected)
        self._update_topic_count(group)
        self._update_source_selection_summary()
        self._schedule_save_ui_state()
        self._run_live_validation()

    def _on_url_selected_changed(self, group):
        self._sync_topic_with_children(group)
        self._update_topic_count(group)
        self._update_source_selection_summary()
        self._schedule_save_ui_state()
        self._run_live_validation()

    def _on_url_value_changed(self):
        self._schedule_save_ui_state()
        self._run_live_validation()

    def _sync_topic_with_children(self, group):
        rows = group["url_rows"]
        if not rows:
            return
        any_selected = any(r["selected_var"].get() for r in rows)
        group["selected_var"].set(any_selected)

    def _update_topic_count(self, group):
        total = len(group["url_rows"])
        selected = sum(1 for r in group["url_rows"] if r["selected_var"].get())
        group["count_label"].configure(text=f"{selected}/{total} URLs")

    def _update_source_selection_summary(self):
        total_topics = len(self.topic_groups)
        selected_topics = sum(1 for g in self.topic_groups if g["selected_var"].get())

        total_urls = 0
        selected_urls = 0
        for g in self.topic_groups:
            self._update_topic_count(g)
            total_urls += len(g["url_rows"])
            selected_urls += sum(1 for r in g["url_rows"] if r["selected_var"].get())

        msg = f"Seleccionat: {selected_topics}/{total_topics} topics, {selected_urls}/{total_urls} URLs"

        if hasattr(self, "selection_summary_label"):
            self.selection_summary_label.configure(text=msg)
        self._refresh_topics_list_height()

    def _refresh_topics_list_height(self):
        if not hasattr(self, "topics_list"):
            return

        if not self.topic_groups:
            self.topics_list.configure(height=8)
            return

        estimated_height = 0
        for g in self.topic_groups:
            # Header topic
            estimated_height += 54

            # Cos amb URLs (només si expandit)
            if g["expanded_var"].get():
                url_count = len(g["url_rows"])
                if url_count > 0:
                    estimated_height += url_count * 44
                else:
                    estimated_height += 4

            # Marges del grup
            estimated_height += 18

        # Manté compacte però evita que rebenti tota la pantalla.
        estimated_height = max(8, min(estimated_height, 420))
        self.topics_list.configure(height=estimated_height)
    # CARREGA DE DADES A LA UI
    def _make_faq_item(
        self,
        topic: str,
        question: str,
        answer: str,
        source: str,
        approved: bool = False,
        forced_id: str = "",
    ) -> FaqItem:
        fid = forced_id or self._make_id(topic, question, source)
        approved_var = ctk.BooleanVar(value=approved)
        approved_var.trace_add(
            "write",
            lambda *_: (self._schedule_save_ui_state(), self._run_live_validation()),
        )
        return FaqItem(
            id=fid,
            topic=topic,
            question=question,
            answer=answer,
            source=source,
            approved_var=approved_var,
        )

    def _load_scraped_into_ui(self, flat_items: list[tuple[str, str, str, str]]):
        """
        flat_items: [(topic, question, answer, source), ...]
        Aquesta funció s'executa al fil principal (UI).
        """
        items = [
            self._make_faq_item(topic=topic, question=question, answer=answer, source=source, approved=False)
            for topic, question, answer, source in flat_items
        ]

        self.scraped_items = items
        self.review_filter_only_approved.set(False)
        self._refresh_review_list()
        if hasattr(self, "tabs"):
            self.tabs.set(self.tab_name_review)
            self.current_tab_name = self.tab_name_review
        self._run_live_validation()
        self._schedule_save_ui_state()

    # ====UI Logging / output
    # LOGGING UI
    def println(self, msg):
        self.log.insert("end", msg + "\n")
        self.log.see("end")
    def log2_println(self, msg):
        self.log2.insert("end", msg + "\n")
        self.log2.see("end")
    def ui_log2(self, msg: str):
        self.after(0, lambda: self.log2_println(msg))
    def ui_log(self, msg: str):
        self.after(0, lambda: self.println(msg))

    def _toggle_log_details(self):
        self._set_log_details_visible(not getattr(self, "_log_details_open", False))

    def _on_window_configure(self, event):
        return

    def _set_log_details_visible(self, visible: bool):
        if bool(visible) == bool(getattr(self, "_log_details_open", False)):
            return
        self._details_transition = True
        try:
            if visible:
                self._log_details_open = True
                self.log_card.grid()
                self.log_toggle_btn.configure(text="Amagar detalls")
                self._apply_details_window_size(True)
            else:
                self.log_card.grid_remove()
                self.log_toggle_btn.configure(text="Veure més detalls")
                self._apply_details_window_size(False)
                self._log_details_open = False
        finally:
            self._details_transition = False

    def _apply_details_window_size(self, details_open: bool):
        self.update_idletasks()
        base_w = max(self._base_min_w, int(self._collapsed_width))
        collapsed_h = max(self._base_min_h, int(self._collapsed_height_fixed))
        expanded_h = max(collapsed_h + 1, int(self._expanded_height_fixed))

        if details_open:
            self.minsize(self._base_min_w, expanded_h)
            self.geometry(f"{base_w}x{expanded_h}")
        else:
            self.minsize(self._base_min_w, self._base_min_h)
            self.geometry(f"{base_w}x{collapsed_h}")

    def _show_generated_code(self, code: str):
        self.generated_code_cache = code or ""
        code = self._format_code_for_preview(code)
        self.log2.delete("1.0", "end")
        self.log2.insert("1.0", code)
        self.log2.see("1.0")
        self._schedule_save_ui_state()

    def _format_code_for_preview(self, code: str) -> str:
        text = (code or "").strip()
        if not text:
            return ""

        if "<" in text and ">" in text:
            try:
                return BeautifulSoup(text, "html.parser").prettify()
            except Exception:
                return text
        return text

    def _setup_live_validation(self):
        watched_vars = [
            self.output_mode,
            self.output_file_path,
            self.output_sheet_title,
            self.output_sheet_tab,
            self.oauth_client_json,
            self.html_input_mode,
            self.html_input_csv_path,
            self.html_sheet_title,
            self.html_sheet_tab,
        ]
        for var in watched_vars:
            var.trace_add("write", lambda *_: self._run_live_validation())
        self._run_live_validation()

    def _is_valid_url(self, value: str) -> bool:
        text = (value or "").strip()
        if not text:
            return False
        parsed = urlparse(text)
        return parsed.scheme in {"http", "https"} and bool(parsed.netloc)

    def _set_entry_valid(self, entry, is_valid: bool, *, neutral_when_empty: bool = False, value: str = ""):
        if not entry:
            return
        txt = (value or "").strip()
        if neutral_when_empty and not txt:
            color = "#D1D5DB"
        else:
            color = "#16A34A" if is_valid else "#DC2626"
        try:
            entry.configure(border_color=color)
        except Exception:
            pass

    def _run_live_validation(self):
        self._validate_scrape_form(live_only=True)
        if hasattr(self, "html_input_mode"):
            self._validate_export_form(live_only=True)

    def _validate_scrape_form(self, live_only: bool = False):
        valid_sources = len(self.get_sources_from_ui())
        for group in self.topic_groups:
            for row in group["url_rows"]:
                url = row["url_var"].get()
                selected = row["selected_var"].get()
                is_valid = self._is_valid_url(url)
                self._set_entry_valid(
                    row.get("entry"),
                    is_valid=not selected or is_valid,
                    neutral_when_empty=True,
                    value=url,
                )

        mode = self.output_mode.get()
        msg = ""
        if valid_sources == 0:
            msg = "Afegeix almenys una URL vàlida."
        elif mode == "csv":
            out = self.output_file_path.get().strip()
            ok = bool(out and out.lower().endswith(".csv"))
            self._set_entry_valid(getattr(self, "output_file_entry", None), is_valid=ok, neutral_when_empty=True, value=out)
            if not ok:
                msg = "El fitxer de sortida ha d'acabar en .csv."
        elif mode == "sheets_oauth":
            title = self.output_sheet_title.get().strip()
            tab = self.output_sheet_tab.get().strip()
            oauth = self.oauth_client_json.get().strip() or "oauth_client.json"
            self._set_entry_valid(
                getattr(self, "output_sheet_title_entry", None),
                is_valid=bool(title),
                neutral_when_empty=True,
                value=title,
            )
            self._set_entry_valid(
                getattr(self, "output_sheet_tab_entry", None),
                is_valid=bool(tab),
                neutral_when_empty=True,
                value=tab,
            )
            self._set_entry_valid(
                getattr(self, "oauth_entry_1", None),
                is_valid=os.path.exists(oauth),
                neutral_when_empty=True,
                value=oauth,
            )
            if not title or not tab:
                msg = "Completa títol i pestanya del Google Sheet."
            elif not os.path.exists(oauth):
                msg = f"No es troba OAuth: {oauth}"

        if hasattr(self, "scrape_validation_label"):
            self.scrape_validation_label.configure(text=msg)
            if msg:
                self.scrape_validation_label.grid()
            else:
                self.scrape_validation_label.grid_remove()
        if not live_only:
            return msg == ""
        return True

    def _validate_export_form(self, live_only: bool = False):
        mode = self.html_input_mode.get()
        msg = ""
        if mode == "ui":
            if not self._get_approved_rows():
                msg = "Aprova almenys una FAQ a la pestanya de revisió."
        elif mode == "csv":
            path = self.html_input_csv_path.get().strip()
            ok = bool(path and os.path.exists(path))
            self._set_entry_valid(getattr(self, "html_csv_entry", None), is_valid=ok, neutral_when_empty=True, value=path)
            if not ok:
                msg = "Selecciona un CSV vàlid per exportar."
        elif mode == "sheets_oauth":
            title = self.html_sheet_title.get().strip()
            tab = self.html_sheet_tab.get().strip()
            oauth = self.oauth_client_json.get().strip() or "oauth_client.json"
            self._set_entry_valid(
                getattr(self, "html_sheet_title_entry", None),
                is_valid=bool(title),
                neutral_when_empty=True,
                value=title,
            )
            self._set_entry_valid(
                getattr(self, "html_sheet_tab_entry", None),
                is_valid=bool(tab),
                neutral_when_empty=True,
                value=tab,
            )
            self._set_entry_valid(
                getattr(self, "oauth_entry_2", None),
                is_valid=os.path.exists(oauth),
                neutral_when_empty=True,
                value=oauth,
            )
            if not title or not tab:
                msg = "Completa títol i pestanya del Google Sheet."
            elif not os.path.exists(oauth):
                msg = f"No es troba OAuth: {oauth}"

        if hasattr(self, "export_validation_label"):
            self.export_validation_label.configure(text=msg)
            if msg:
                self.export_validation_label.grid()
            else:
                self.export_validation_label.grid_remove()
        if not live_only:
            return msg == ""
        return True

    def _on_tab_changed(self):
        selected = self.tabs.get()
        if selected == self.tab_name_review and not self.scraped_items:
            self.tabs.set(self.current_tab_name)
            messagebox.showinfo("Pas 1 necessari", "Primer descarrega FAQs a la pestanya 1.")
            return
        self.current_tab_name = selected
        self._fix_tab_text_colors(self.tabs)

    def _focus_review_search(self, _event=None):
        if hasattr(self, "review_search_entry"):
            self.tabs.set(self.tab_name_review)
            self.review_search_entry.focus_set()
            self.review_search_entry.select_range(0, "end")
        return "break"

    def _set_progress(self, done: int, total: int):
        if not hasattr(self, "progress"):
            return
        total_safe = max(1, int(total or 1))
        done_safe = max(0, min(int(done or 0), total_safe))
        ratio = done_safe / total_safe
        pct = int(round(ratio * 100))
        elapsed = max(0.0, time.time() - (self._run_started_at or time.time()))
        eta = int((elapsed / done_safe) * (total_safe - done_safe)) if done_safe else 0
        self.after(0, lambda: self.progress.set(ratio))
        self.after(
            0,
            lambda: self.progress_status.configure(
                text=(
                    f"{pct}% · URL {done_safe}/{total_safe} · ETA {eta}s"
                    if done_safe < total_safe
                    else "100% · Finalitzant..."
                )
            ),
        )

    def _set_restore_summary(self, groups_count: int, url_count: int, faq_count: int):
        self.println(
            f"Estat restaurat: {groups_count} temes, {url_count} URLs i {faq_count} FAQs."
        )

    # ====UI state / refresh
    # REFRESH D'ESTAT UI
    def _refresh_ui(self):
        mode = self.output_mode.get()

        if mode == "ui":
            # No cal mostrar cap sortida: només omplirem la Tab 2
            self.out_file_row.grid_remove()
            self.out_sheets_row.grid_remove()
            self.oauth_row.grid_remove()

        elif mode == "sheets_oauth":
            self.out_file_row.grid_remove()
            self.out_sheets_row.grid()
            self.oauth_row.grid()

        else:  # csv
            self.out_sheets_row.grid_remove()
            self.oauth_row.grid_remove()
            self.out_file_row.grid()
        self._run_live_validation()

    def _refresh_html_ui(self):
        mode = self.html_input_mode.get()

        if mode == "ui":
            self.html_csv_row.grid_remove()
            self.html_sheets_row.grid_remove()
            self.html_oauth_row.grid_remove()
            self.gen_btn.configure(text="Generar HTML Genweb", width=220)

        elif mode == "sheets_oauth":
            self.html_csv_row.grid_remove()
            self.html_sheets_row.grid()
            self.html_oauth_row.grid()
            self.gen_btn.configure(text="Exportar aprovades", width=180)
            self.log2.delete("1.0", "end")

        else:  # csv
            self.html_sheets_row.grid_remove()
            self.html_oauth_row.grid_remove()
            self.html_csv_row.grid()
            self.gen_btn.configure(text="Exportar aprovades", width=180)
            self.log2.delete("1.0", "end")
        self._run_live_validation()
    def _needs_oauth(self) -> bool:
        return self.output_mode.get() == "sheets_oauth"

    # ====Validations
    # VALIDACIONS
    def validate_inputs(self):

        # INPUT (UI rows)
        sources = self._run_sources_override or self.get_sources_from_ui()
        if not sources:
            return False, "Afegeix almenys una URL vàlida a l'entrada."

        # OUTPUT
        mode = self.output_mode.get()

        if mode == "ui":
            pass  # no validem res de sortida
        elif mode == "csv":
            out = self.output_file_path.get().strip()
            if not out:
                return False, "Selecciona un fitxer de sortida."
            if not out.lower().endswith(".csv"):
                return False, "En mode CSV, el fitxer de sortida ha d'acabar en .csv"
        else:  # sheets_oauth
            if not self.output_sheet_title.get().strip():
                return False, "Omple el títol del Google Sheet."
            if not self.output_sheet_tab.get().strip():
                return False, "Omple el nom de la pestanya."
            oauth_file = self.oauth_client_json.get().strip() or "oauth_client.json"
            if not os.path.exists(oauth_file):
                return False, f"Falta el fitxer OAuth: {oauth_file}"

        return True, ""

    def validate_html_inputs(self):
        mode = self.html_input_mode.get()

        if mode == "ui":
            if not self._get_approved_rows():
                return False, "No has aprovat cap FAQ a la pestanya 2."
            return True, ""

        if mode == "csv":
            path = self.html_input_csv_path.get().strip()
            if not path:
                return False, "Selecciona el CSV d'entrada."
            if not os.path.exists(path):
                return False, "El CSV d'entrada no existeix."
            return True, ""

        if mode == "sheets_oauth":
            if not self.html_sheet_title.get().strip():
                return False, "Omple el títol del Google Sheet."
            if not self.html_sheet_tab.get().strip():
                return False, "Omple el nom de la pestanya."
            oauth_file = self.oauth_client_json.get().strip() or "oauth_client.json"
            if not os.path.exists(oauth_file):
                return False, f"Falta el fitxer OAuth: {oauth_file}"
            return True, ""

        return False, "Mode d'entrada desconegut."

    # ====Actions
    # ACCIONS (BOTO EXECUTA / GENERA)
    def run_clicked(self):
        ok, err = self.validate_inputs()
        if not ok:
            messagebox.showerror("Error", err)
            return

        # UI state
        self._run_started_at = time.time()
        self.run_btn.configure(state="disabled")
        self.retry_failed_btn.configure(state="disabled")
        self.progress.configure(mode="determinate")
        self.progress.set(0)
        self.progress_status.configure(text="0% · Iniciant...")

        self.println("\n> Executant...")

        t = threading.Thread(target=self._run_background, daemon=True)
        t.start()

    def retry_failed_clicked(self):
        if not self.failed_sources:
            return
        self._run_sources_override = list(self.failed_sources)
        self.println(f"\nReintentant {len(self.failed_sources)} URL(s) amb error...")
        self.run_clicked()
    def generate_html_clicked(self):
        ok, err = self.validate_html_inputs()
        if not ok:
            messagebox.showerror("Error", err)
            return

        self.gen_btn.configure(state="disabled")
        self.ui_log2(f"\n> Executant ({self.html_input_mode.get()})...")

        t = threading.Thread(target=self._generate_html_background, daemon=True)
        t.start()

    def _reset_ui(self):
        self.progress.configure(mode="determinate")
        self.progress.set(0)
        self.progress_status.configure(text="0% · Preparat")
        self.run_btn.configure(state="normal")
        if self.failed_sources:
            self.retry_failed_btn.configure(state="normal")
        else:
            self.retry_failed_btn.configure(state="disabled")

    # ====Background workers (threads)
    # TREBALL EN SEGON PLA (THREADS)
    def _run_background(self):
        start_time = time.time()
        try:
            output_mode = self.output_mode.get()
            sources = self._run_sources_override or self.get_sources_from_ui()
            self._run_sources_override = None

            def progress_cb(done: int, total: int, _url: str):
                self._set_progress(done, total)

            if output_mode == "ui":
                rows, blocks, stats, errors = core.build_outputs(
                    sources, log=self.ui_log, debug=False, progress_cb=progress_cb
                )

                flat_items: list[tuple[str, str, str, str]] = []
                for b in blocks:
                    topic = b.get("topic", "")
                    source = b.get("source_url", "")
                    for it in b.get("items", []) or []:
                        question = it.get("q", "")
                        answer = it.get("a", "")
                        flat_items.append((topic, question, answer, source))

                # carregar a la UI al fil principal
                self.after(0, lambda: self._load_scraped_into_ui(flat_items))
                self.ui_log(f"Carregades a la UI: {len(flat_items)} FAQs")

            else:
                stats = core.run_pipeline(
                    input_mode="ui",
                    output_mode=output_mode,
                    sources=sources,
                    output_sheet_title=self.output_sheet_title.get().strip()
                    if output_mode == "sheets_oauth" else None,
                    output_sheet_tab=self.output_sheet_tab.get().strip()
                    if output_mode == "sheets_oauth" else None,
                    output_file_path=self.output_file_path.get().strip()
                    if output_mode == "csv" else None,
                    oauth_client_json=self.oauth_client_json.get().strip() or "oauth_client.json",
                    token_file=self.token_file.get().strip() or "token.json",
                    log=self.ui_log,
                    debug=False,
                    progress_cb=progress_cb,
                )
                errors = stats.get("errors", [])

            self.failed_sources = [
                ((e.get("url") or "").strip(), (e.get("topic") or "").strip())
                for e in (errors or [])
                if (e.get("url") or "").strip()
            ]

            elapsed = round(time.time() - start_time, 2)

            summary_lines = [
                "\n" + "-" * 52,
                "PROCESSAMENT FINALITZAT",
                "-" * 52,
                f"URLs processades: {stats.get('total_urls', 0)}",
                f"FAQs trobades: {stats.get('total_faqs', 0)}",
                f"Files generades: {stats.get('total_rows', 0)}",
            ]

            if stats.get("total_errors"):
                summary_lines.append(f"Errors: {stats.get('total_errors')}")
                for failed_url, _topic in self.failed_sources[:5]:
                    summary_lines.append(f"- {failed_url}")
                summary_lines.append("Pots fer clic a 'Reintentar fallides'.")

            summary_lines.append(f"Temps total: {elapsed} s")
            summary_lines.append("-" * 52)

            self.after(0, lambda: self.println("\n".join(summary_lines)))

        except Exception as e:
            error_msg = str(e)
            self.after(0, lambda: self.println(f"Error: {error_msg}"))
            self.after(0, lambda: self._set_log_details_visible(True))
            self.after(0, lambda: messagebox.showerror("Error", error_msg))
        finally:
            self.after(0, self._reset_ui)

    def _generate_html_background(self):
        try:
            mode = self.html_input_mode.get()

            if mode == "ui":
                approved_rows = self._get_approved_rows()

                if not approved_rows:
                    raise RuntimeError("No hi ha cap FAQ aprovada a la pestanya 2.")

                # Ara cridem una funció nova de core
                html_text = core.approved_rows_to_html(approved_rows, log=self.ui_log2)

                self.after(0, lambda: self._show_generated_code(html_text))
                return

            if mode == "sheets_oauth":
                approved_rows = self._get_approved_rows()
                if approved_rows:
                    sheet_rows = self._approved_rows_to_sheets_rows(approved_rows)
                    self.ui_log2(
                        f"FAQs aprovades a la UI: {len(approved_rows)}. Exportant a Google Sheets..."
                    )
                    core.export_rows_to_google_sheets_oauth(
                        rows=sheet_rows,
                        spreadsheet_title=self.html_sheet_title.get().strip(),
                        worksheet_name=self.html_sheet_tab.get().strip(),
                        oauth_client_json=self.oauth_client_json.get().strip() or "oauth_client.json",
                        token_file=self.token_file.get().strip() or "token.json",
                        log=self.ui_log2,
                    )
                    self.ui_log2(
                        "Procés completat. FAQs aprovades exportades al Google Sheets."
                    )
                    return

            # --- MODE CSV / SHEETS (com abans) ---
            core.run_approved_to_html_pipeline(
                input_mode=mode,
                input_csv_path=self.html_input_csv_path.get().strip() if mode == "csv" else None,
                sheet_title=self.html_sheet_title.get().strip() if mode == "sheets_oauth" else None,
                sheet_tab=self.html_sheet_tab.get().strip() if mode == "sheets_oauth" else None,
                oauth_client_json=self.oauth_client_json.get().strip() or "oauth_client.json",
                token_file=self.token_file.get().strip() or "token.json",
                log=self.ui_log2,
            )

            self.ui_log2(
                "Procés completat. En aquest mode no es mostra el codi font a la UI."
            )

        except Exception as e:
            msg = str(e)
            self.ui_log2(f"Error: {msg}")
            self.after(0, lambda: messagebox.showerror("Error", msg))
        finally:
            self.after(0, lambda: self.gen_btn.configure(state="normal"))

    # ====Data extraction from UI
    # EXTRACCIO DE DADES DES DE LA UI
    def get_sources_from_ui(self):
        out = []

        for g in self.topic_groups:
            topic = (g["topic_var"].get() or "").strip() or TOPICS_UI[0]
            topic_selected = g["selected_var"].get()
            if not topic_selected:
                continue

            for r in g["url_rows"]:
                url = (r["url_var"].get() or "").strip()
                if not url:
                    continue
                if not (url.startswith("http://") or url.startswith("https://")):
                    continue
                if not r["selected_var"].get():
                    continue

                out.append((url, topic))

        return out

    # TAB DE REVISIO / APROVACIO
    def _build_tab_review(self, parent):
        parent.configure(fg_color=BG)
        parent.grid_columnconfigure(0, weight=1)
        parent.grid_rowconfigure(1, weight=1)
        self.review_search_var = ctk.StringVar(value="")
        self.review_filter_only_pending = ctk.BooleanVar(value=False)
        self.review_filter_topic = ctk.StringVar(value="Tots")
        self.review_search_var.trace_add("write", lambda *_: self._refresh_review_list())
        self.review_filter_only_pending.trace_add("write", lambda *_: self._refresh_review_list())
        self.review_filter_topic.trace_add("write", lambda *_: self._refresh_review_list())

        top = ctk.CTkFrame(parent, fg_color="transparent")
        top.grid(row=0, column=0, sticky="ew", padx=10, pady=(10, 6))
        top.grid_columnconfigure(5, weight=1)

        ctk.CTkButton(top, text="Aprovar totes", command=self._approve_all).pack(side="left")
        ctk.CTkButton(top, text="Desmarcar totes", command=self._unapprove_all).pack(side="left", padx=(8, 0))

        ctk.CTkCheckBox(
            top,
            text="Mostrar només aprovades",
            variable=self.review_filter_only_approved,
            command=self._refresh_review_list,
        ).pack(side="left", padx=(12, 0))
        ctk.CTkCheckBox(
            top,
            text="Mostrar només pendents",
            variable=self.review_filter_only_pending,
            command=self._refresh_review_list,
        ).pack(side="left", padx=(12, 0))

        self.review_topic_menu = ctk.CTkOptionMenu(
            top,
            variable=self.review_filter_topic,
            values=["Tots"],
            width=180,
        )
        self.review_topic_menu.pack(side="right", padx=(8, 0))
        self.review_search_entry = ctk.CTkEntry(
            top,
            textvariable=self.review_search_var,
            placeholder_text="Cerca pregunta, resposta o URL (Ctrl+F)",
            width=320,
        )
        self.review_search_entry.pack(side="right", padx=(8, 0))

        self.review_list = ctk.CTkScrollableFrame(
            parent,
            fg_color=LIGHT_PANEL,
            scrollbar_button_color="#9FB6D3",
            scrollbar_button_hover_color="#7EA2CC",
        )
        self.review_list.grid(row=1, column=0, sticky="nsew", padx=10, pady=(0, 10))

        self._refresh_review_list()

    def _refresh_review_list(self):
        if not hasattr(self, "review_list"):
            return

        for w in self.review_list.winfo_children():
            w.destroy()

        if not self.scraped_items:
            ctk.CTkLabel(self.review_list, text="Encara no hi ha FAQs. Fes scraping a la pestanya 1.").pack(pady=10)
            return

        only_approved = self.review_filter_only_approved.get()
        only_pending = self.review_filter_only_pending.get()
        selected_topic = (self.review_filter_topic.get() or "Tots").strip()
        query = (self.review_search_var.get() or "").strip().lower()

        topics = sorted({(it.topic or "").strip() for it in self.scraped_items if (it.topic or "").strip()})
        menu_values = ["Tots"] + topics
        if hasattr(self, "review_topic_menu"):
            self.review_topic_menu.configure(values=menu_values)
            if selected_topic not in menu_values:
                self.review_filter_topic.set("Tots")
                selected_topic = "Tots"

        filtered_items: list[FaqItem] = []
        for item in self.scraped_items:
            if only_approved and not item.approved_var.get():
                continue
            if only_pending and item.approved_var.get():
                continue
            if selected_topic != "Tots" and item.topic != selected_topic:
                continue
            if query:
                blob = " ".join([item.question or "", item.answer or "", item.source or ""]).lower()
                if query not in blob:
                    continue
            filtered_items.append(item)

        shown = 0
        total_filtered = len(filtered_items)
        for idx, item in enumerate(filtered_items):
            try:
                self._add_review_row(self.review_list, item)
                shown += 1
            except Exception:
                # Fallback perquè un ítem mal format no trenqui tota la llista.
                row = ctk.CTkFrame(self.review_list, fg_color="transparent")
                row.pack(fill="x", pady=6, padx=6)
                ctk.CTkLabel(
                    row,
                    text=item.question,
                    anchor="w",
                    justify="left",
                    wraplength=900,
                ).pack(fill="x", padx=12, pady=(8, 2))
                plain = BeautifulSoup(item.answer or "", "html.parser").get_text(" ", strip=True)
                ctk.CTkLabel(
                    row,
                    text=plain,
                    anchor="w",
                    justify="left",
                    wraplength=900,
                    text_color="#4B5563",
                ).pack(fill="x", padx=12, pady=(0, 8))
                shown += 1
            if idx < total_filtered - 1:
                self._add_review_separator(self.review_list)
        if shown == 0:
            ctk.CTkLabel(
                self.review_list,
                text="No hi ha resultats amb els filtres actuals.",
                text_color="#6B7280",
            ).pack(pady=10)
        self._run_live_validation()

    def _add_review_separator(self, parent):
        sep_wrap = ctk.CTkFrame(parent, fg_color="transparent")
        sep_wrap.pack(fill="x", padx=8, pady=(4, 8))
        # Línia minimalista però visible sobre el fons gris de la llista.
        sep = ctk.CTkFrame(sep_wrap, fg_color="#B7CBE3", height=2, corner_radius=1)
        sep.pack(fill="x", padx=(58, 12))

    def _add_review_row(self, parent, item: FaqItem):
        row = ctk.CTkFrame(parent, fg_color="transparent")
        row.pack(fill="x", pady=6, padx=6)

        cb = ctk.CTkCheckBox(row, text="", variable=item.approved_var)
        cb.grid(row=0, column=0, padx=(8, 8), pady=8, sticky="n")

        # Columna 2: Pregunta
        q = ctk.CTkLabel(
            row,
            text=item.question,
            anchor="w",
            justify="left",
            wraplength=340,
        )
        q.grid(row=0, column=1, sticky="nw", padx=(0, 12), pady=8)

        # Columna 3: Resposta (enllaços clicables i negreta)
        a = ctk.CTkTextbox(row, height=96, wrap="word")
        a.grid(row=0, column=2, sticky="nsew", padx=(0, 12), pady=8)
        question_font = q.cget("font")
        a.configure(
            fg_color="transparent",
            text_color="#4B5563",
            border_width=0,
            font=question_font,
        )
        self._render_html_to_textbox(a, item.answer, item.question)

        # Columna 4: Topic
        topic = ctk.CTkLabel(
            row,
            text=item.topic,
            width=140,
            anchor="nw",
            text_color="#6B7280",
            font=ctk.CTkFont(size=12, weight="bold"),
        )
        topic.grid(row=0, column=3, padx=(0, 12), pady=8, sticky="ne")

        row.grid_columnconfigure(2, weight=1)
        row.grid_columnconfigure(3, weight=0)

    def _render_html_to_textbox(self, textbox: ctk.CTkTextbox, html_text: str, question_text: str = ""):
        text = (html_text or "").strip()
        tk_text = getattr(textbox, "_textbox", textbox)
        textbox.configure(state="normal")
        textbox.delete("1.0", "end")

        if not text:
            textbox.configure(state="disabled")
            return

        if "<" not in text or ">" not in text:
            plain = text.strip()
            q = (question_text or "").strip()
            if q and plain.lower().startswith(q.lower()):
                plain = plain[len(q):].lstrip(" :-\n\t")
            textbox.insert("1.0", plain)
            textbox.configure(state="disabled")
            return

        soup = BeautifulSoup(text, "html.parser")
        link_count = 0
        first_meaningful_seen = False
        normalized_question = re.sub(r"\s+", " ", (question_text or "").strip()).lower()

        # Manté exactament la mateixa font/mida de la pregunta.
        try:
            base_font = tkfont.nametofont(tk_text.cget("font"))
            bold_font = base_font.copy()
            bold_font.configure(weight="bold")
            textbox._bold_font = bold_font
            tk_text.tag_configure("bold", font=bold_font)
        except Exception:
            tk_text.tag_configure("bold", font=ctk.CTkFont(size=13, weight="bold"))

        def _insert(t: str, tags=()):
            if t:
                textbox.insert("end", t, tags)

        def _insert_newline(tags=()):
            if textbox.compare("end-1c", ">", "1.0"):
                last = textbox.get("end-2c", "end-1c")
                if last == "\n":
                    return
            _insert("\n", tags)

        def _walk(node, active_tags=()):
            nonlocal link_count, first_meaningful_seen

            if isinstance(node, NavigableString):
                raw = str(node)
                if not raw or not raw.strip():
                    return
                normalized = re.sub(r"\s+", " ", raw)
                if not normalized.strip():
                    return

                _insert(normalized, active_tags)
                return

            name = getattr(node, "name", None)
            if not name:
                return
            name = name.lower()

            # Si el primer bloc visible és exactament la pregunta, el saltem complet.
            if not first_meaningful_seen and normalized_question and name in {"p", "div", "span", "strong", "b"}:
                node_text = re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip().lower()
                if node_text == normalized_question:
                    first_meaningful_seen = True
                    return

            next_tags = list(active_tags)
            if name in {"b", "strong"}:
                next_tags.append("bold")

            if name == "a":
                href = (node.get("href") or "").strip()
                if href:
                    tag_name = f"link_{link_count}"
                    link_count += 1
                    tk_text.tag_configure(tag_name, foreground="#1D4ED8", underline=True)
                    tk_text.tag_bind(
                        tag_name, "<Button-1>", lambda _e, u=href: webbrowser.open_new_tab(u)
                    )
                    next_tags.append(tag_name)

            if name == "br":
                _insert_newline(active_tags)
                return

            if name == "li":
                _insert("- ", active_tags)

            for child in getattr(node, "children", []):
                _walk(child, tuple(next_tags))

            if name in {"p", "ul", "ol", "li"}:
                _insert_newline(active_tags)

            if not first_meaningful_seen:
                node_text = re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip()
                if node_text:
                    first_meaningful_seen = True

        for n in soup.contents:
            _walk(n)

        # Treu espais/salts inicials que venen de l'HTML original (indentació).
        while textbox.compare("1.0", "<", "end-1c"):
            ch = textbox.get("1.0", "1.1")
            if ch in {" ", "\t", "\n", "\r"}:
                textbox.delete("1.0", "1.1")
                continue
            break

        def _norm_cmp(value: str) -> str:
            norm = unicodedata.normalize("NFKD", (value or "").strip().lower())
            norm = "".join(c for c in norm if unicodedata.category(c) != "Mn")
            norm = re.sub(r"[^a-z0-9]+", "", norm)
            return norm

        # Si la resposta comença repetint la pregunta, elimina aquest prefix.
        q = (question_text or "").strip()
        if q:
            current = textbox.get("1.0", "end-1c").strip()
            if current.lower().startswith(q.lower()):
                textbox.delete("1.0", f"1.0 + {len(q)}c")
                while textbox.compare("1.0", "<", "end-1c"):
                    ch = textbox.get("1.0", "1.1")
                    if ch in {" ", ":", "-", "\n", "\t", "\r"}:
                        textbox.delete("1.0", "1.1")
                        continue
                    break

        # Tall segur del prefix de pregunta encara que hi hagi apostrofs/accents diferents.
        if q and textbox.compare("end-1c", ">", "1.0"):
            body = textbox.get("1.0", "end-1c")
            lines = body.splitlines()
            if lines:
                first = lines[0].strip()
                if _norm_cmp(first) == _norm_cmp(q):
                    textbox.delete("1.0", "2.0")
                    while textbox.compare("1.0", "<", "end-1c"):
                        ch = textbox.get("1.0", "1.1")
                        if ch in {" ", ":", "-", "\n", "\t", "\r"}:
                            textbox.delete("1.0", "1.1")
                            continue
                        break

        # Si ha quedat una primera línia idèntica a la pregunta, la traiem.
        if q and textbox.compare("end-1c", ">", "1.0"):
            first_line = textbox.get("1.0", "1.end").strip()
            if _norm_cmp(first_line) == _norm_cmp(q):
                textbox.delete("1.0", "2.0")
                while textbox.compare("1.0", "<", "end-1c"):
                    ch = textbox.get("1.0", "1.1")
                    if ch in {" ", "\n", "\t", "\r"}:
                        textbox.delete("1.0", "1.1")
                        continue
                    break

        # Compacta salts múltiples: màxim 1 línia en blanc entre blocs.
        while textbox.compare("1.0", "<", "end-1c"):
            body = textbox.get("1.0", "end-1c")
            m = re.search(r"\n{3,}", body)
            if not m:
                break
            start = f"1.0 + {m.start()}c"
            end = f"1.0 + {m.end()}c"
            textbox.delete(start, end)
            textbox.insert(start, "\n\n")

        # Assegura que la caixa sempre mostri l'inici (evita "espais" aparents per scroll intern).
        try:
            textbox.yview_moveto(0.0)
        except Exception:
            pass

        # Manté els tags (bold/enllaços): no reescriure el contingut.
        # Només traiem salts finals sobrants.
        if textbox.compare("end-1c", ">", "1.0"):
            end_text = textbox.get("end-2c", "end-1c")
            while end_text == "\n" and textbox.compare("end-2c", ">", "1.0"):
                textbox.delete("end-2c", "end-1c")
                end_text = textbox.get("end-2c", "end-1c")
        try:
            tk_text.configure(disabledforeground="#4B5563")
        except Exception:
            pass
        textbox.configure(state="disabled")


    def _approve_all(self):
        for it in self.scraped_items:
            it.approved_var.set(True)
        self._refresh_review_list()
        self._run_live_validation()


    def _unapprove_all(self):
        for it in self.scraped_items:
            it.approved_var.set(False)
        self._refresh_review_list()
        self._run_live_validation()


    def _get_approved_rows(self) -> list[list[str]]:
        rows = []
        for it in self.scraped_items:
            if it.approved_var.get():
                rows.append([it.topic, it.question, it.answer, it.source])
        return rows

    def _approved_rows_to_sheets_rows(self, approved_rows: list[list[str]]) -> list[list[str]]:
        rows: list[list[str]] = []
        for topic, question, answer, source in approved_rows:
            rows.append(
                [
                    topic or "",
                    question or "",
                    answer or "",
                    "aprovat",
                    "",
                    "",
                    "",
                    "",
                    source or "",
                ]
            )
        return rows


    def _make_id(self, topic: str, question: str, source: str) -> str:
        s = f"{topic}|{question}|{source}".encode("utf-8")
        return hashlib.sha1(s).hexdigest()[:12]

    def copy_generated_code(self):
        try:
            text = self.log2.get("1.0", "end-1c")  # tot menys l'últim salt de línia
            if not text.strip():
                messagebox.showinfo("Copiar", "No hi ha cap codi per copiar.")
                return

            self.clipboard_clear()
            self.clipboard_append(text)
            self.update()  # assegura que queda al clipboard
            messagebox.showinfo("Copiat", "Codi copiat al porta-retalls")
        except Exception as e:
            messagebox.showerror("Error", f"No s'ha pogut copiar: {e}")

    # ESTILS DE TABS
    def _style_tabview(self, tabview: ctk.CTkTabview):
        tabview.configure(
            fg_color=BG,

            segmented_button_fg_color="#E5E7EB",
            segmented_button_selected_color=UPC_BLUE_TAB,
            segmented_button_selected_hover_color=UPC_BLUE_TAB,
            segmented_button_unselected_color="#F3F4F6",
            segmented_button_unselected_hover_color="#E5E7EB",

            # IMPORTANT: aquí NO posem blanc, posem fosc perquè les no seleccionades es llegeixin
            text_color="#111827",
            text_color_disabled="#9CA3AF",
        )

        try:
            sb = tabview._segmented_button
            sb.configure(
                corner_radius=12,
                border_width=0,
                height=38,
                font=ctk.CTkFont(size=13, weight="bold"),

                # Algunes versions permeten aquests camps i arreglen del tot el tema del text:
                text_color="#111827",
                text_color_disabled="#9CA3AF",
            )
        except Exception:
            pass

    def _fix_tab_text_colors(self, tabview: ctk.CTkTabview):
        """Força colors de text: selected blanc, unselected fosc (per versions de CTk que ho liïn)."""
        try:
            sb = tabview._segmented_button
            current = tabview.get()

            # Posa totes fosques
            for name, btn in sb._buttons_dict.items():
                btn.configure(text_color="#111827")

            # La seleccionada en blanc
            if current in sb._buttons_dict:
                sb._buttons_dict[current].configure(text_color="white")
        except Exception:
            pass

# ENTRY POINT
if __name__ == "__main__":
    App().mainloop()



