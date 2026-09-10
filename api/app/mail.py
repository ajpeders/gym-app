"""The one email this app sends: a password reset code.

Plain SMTP from the standard library, so a self-hosted install needs nothing
beyond an SMTP relay it already has (or none, in which case resets go through
the admin page instead).
"""
from __future__ import annotations

import smtplib
from email.message import EmailMessage

from .config import get_settings


def send_reset_code(to: str, code: str) -> bool:
    """Send the code. False when this server cannot send mail at all."""
    cfg = get_settings()
    if not cfg.mail_configured:
        return False
    msg = EmailMessage()
    msg["Subject"] = "Your gym password reset code"
    msg["From"] = cfg.smtp_from or cfg.smtp_user or f"gym@{cfg.smtp_host}"
    msg["To"] = to
    msg.set_content(
        f"Your reset code is {code}. It works for 30 minutes.\n\n"
        "If you didn't ask for this, ignore it; your password is unchanged."
    )
    with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=15) as smtp:
        if cfg.smtp_starttls:
            smtp.starttls()
        if cfg.smtp_user:
            smtp.login(cfg.smtp_user, cfg.smtp_password)
        smtp.send_message(msg)
    return True
