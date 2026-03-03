"""Compatibility facade.

Manté la API antiga de core.py mentre la implementació real ja és en mòduls
separats: scraping, sheets, html_export i pipeline.
"""

try:
    from .html_export import (
        _answer_to_html_paragraph,
        approved_rows_to_html,
        export_text,
        filter_approved,
        render_upc_faqaccordion,
    )
    from ..src.scraper.pipeline import (
        export_genweb_json,
        export_like_sheets_csv,
        read_rows_from_csv_like_sheets,
        read_sources_csv,
        run_approved_to_html_pipeline,
        run_pipeline,
    )
    from .scraping import build_outputs, scrape_faqs
    from .sheets import (
        export_rows_to_google_sheets_oauth,
        get_client,
        get_oauth_client,
        open_or_create_worksheet,
        open_sheet_by_title,
        read_rows_from_sheets_oauth,
    )
except ImportError:
    from html_export import (
        _answer_to_html_paragraph,
        approved_rows_to_html,
        export_text,
        filter_approved,
        render_upc_faqaccordion,
    )
    from backend.src.scraper.pipeline import (
        export_genweb_json,
        export_like_sheets_csv,
        read_rows_from_csv_like_sheets,
        read_sources_csv,
        run_approved_to_html_pipeline,
        run_pipeline,
    )
    from scraping import build_outputs, scrape_faqs
    from sheets import (
        export_rows_to_google_sheets_oauth,
        get_client,
        get_oauth_client,
        open_or_create_worksheet,
        open_sheet_by_title,
        read_rows_from_sheets_oauth,
    )
