import customtkinter as ctk
from tkinter import filedialog


class ToolTip:
    def __init__(self, widget, text):
        self.widget = widget
        self.text = text
        self.tip_window = None

        widget.bind("<Enter>", self.show_tooltip)
        widget.bind("<Leave>", self.hide_tooltip)

    def show_tooltip(self, event=None):
        if self.tip_window or not self.text:
            return

        x = self.widget.winfo_rootx() + 18
        y = self.widget.winfo_rooty() + self.widget.winfo_height() + 6

        self.tip_window = tw = ctk.CTkToplevel(self.widget)
        tw.wm_overrideredirect(True)
        tw.geometry(f"+{x}+{y}")
        tw.attributes("-topmost", True)

        label = ctk.CTkLabel(
            tw,
            text=self.text,
            justify="left",
            wraplength=420,
            fg_color="#111827",
            text_color="white",
            corner_radius=8,
            padx=10,
            pady=8,
        )
        label.pack()

    def hide_tooltip(self, event=None):
        if self.tip_window:
            self.tip_window.destroy()
            self.tip_window = None


def help_icon(parent, text, color):
    icon = ctk.CTkLabel(
        parent,
        text="?",
        width=18,
        height=18,
        corner_radius=9,
        fg_color=color,
        text_color="white",
        font=ctk.CTkFont(size=12, weight="bold"),
        anchor="center",
        cursor="hand2",
    )
    ToolTip(icon, text)
    return icon


def file_row(
    parent,
    row,
    label,
    var,
    save,
    types,
    icon_color,
    button_text="Navega...",
    tooltip_text=None,
):
    label_frame = ctk.CTkFrame(parent, fg_color="transparent")
    label_frame.grid(row=row, column=0, padx=6, pady=10, sticky="w")

    ctk.CTkLabel(label_frame, text=label).pack(side="left")

    if tooltip_text:
        qbtn = help_icon(label_frame, tooltip_text, icon_color)
        qbtn.pack(side="left", padx=(6, 0))

    entry = ctk.CTkEntry(parent, textvariable=var)
    entry.grid(row=row, column=1, padx=6, pady=10, sticky="ew")

    def browse():
        if save:
            path = filedialog.asksaveasfilename(
                defaultextension=types[0][1].replace("*", ""),
                filetypes=types,
            )
        else:
            path = filedialog.askopenfilename(filetypes=types)
        if path:
            var.set(path)

    ctk.CTkButton(parent, text=button_text, width=110, command=browse).grid(
        row=row, column=2, padx=6, pady=10
    )
    return entry


def text_row(parent, row, label, var):
    ctk.CTkLabel(parent, text=label).grid(row=row, column=0, padx=10, pady=6, sticky="w")
    entry = ctk.CTkEntry(parent, textvariable=var)
    entry.grid(row=row, column=1, padx=6, pady=6, sticky="ew")
    ctk.CTkLabel(parent, text="").grid(row=row, column=2, padx=6, pady=6)
    return entry
