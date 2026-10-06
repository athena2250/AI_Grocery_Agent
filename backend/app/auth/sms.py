"""Texting the sign-in code. Pluggable: pick one with SMS_PROVIDER.

- `console` — development only: the code is logged and handed back to the app to show
  (the sandbox banner). Refused when APP_ENV=production.
- `msg91` — India. Needs a DLT-registered template whose OTP variable is `##OTP##`:
  MSG91_AUTH_KEY, MSG91_TEMPLATE_ID.
- `twilio` — international. TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
  (a sender number, or a Messaging Service SID starting "MG"). Indian numbers still need DLT.

The code itself is never logged by the real senders.
"""

from __future__ import annotations

import logging
import os
from typing import Protocol

import httpx

log = logging.getLogger("hearth.sms")

MESSAGE = "{code} is your Hearth code. It expires in 5 minutes. Don't share it with anyone."


class SmsError(RuntimeError):
    pass


class SmsSender(Protocol):
    shows_code: bool
    """True only for the console sender: the API returns the code so the app can show it."""

    async def send_code(self, phone: str, code: str) -> None: ...


class ConsoleSender:
    shows_code = True

    async def send_code(self, phone: str, code: str) -> None:
        log.warning("DEV SMS to %s: %s", phone, code)


class Msg91Sender:
    shows_code = False

    def __init__(self, auth_key: str, template_id: str, client: httpx.AsyncClient | None = None):
        self.auth_key, self.template_id = auth_key, template_id
        self.client = client or httpx.AsyncClient(timeout=10)

    async def send_code(self, phone: str, code: str) -> None:
        r = await self.client.post(
            "https://control.msg91.com/api/v5/flow",
            headers={"authkey": self.auth_key, "accept": "application/json"},
            json={"template_id": self.template_id, "recipients": [{"mobiles": phone.lstrip("+"), "OTP": code}]},
        )
        if r.status_code >= 300 or r.json().get("type") == "error":
            raise SmsError(f"msg91 {r.status_code}")


class TwilioSender:
    shows_code = False

    def __init__(self, sid: str, token: str, sender: str, client: httpx.AsyncClient | None = None):
        self.sid, self.token, self.sender = sid, token, sender
        self.client = client or httpx.AsyncClient(timeout=10)

    async def send_code(self, phone: str, code: str) -> None:
        source = {"MessagingServiceSid": self.sender} if self.sender.startswith("MG") else {"From": self.sender}
        r = await self.client.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{self.sid}/Messages.json",
            auth=(self.sid, self.token),
            data={"To": phone, "Body": MESSAGE.format(code=code), **source},
        )
        if r.status_code >= 300:
            raise SmsError(f"twilio {r.status_code}")


def _need(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} must be set for SMS_PROVIDER={os.environ.get('SMS_PROVIDER')}")
    return value


def sender_from_env() -> SmsSender:
    provider = os.environ.get("SMS_PROVIDER", "console").strip().lower()
    production = os.environ.get("APP_ENV", "").lower() == "production"
    if provider == "console":
        if production:
            raise RuntimeError("SMS_PROVIDER=console shows sign-in codes in the app; not allowed in production")
        return ConsoleSender()
    if provider == "msg91":
        return Msg91Sender(_need("MSG91_AUTH_KEY"), _need("MSG91_TEMPLATE_ID"))
    if provider == "twilio":
        return TwilioSender(_need("TWILIO_ACCOUNT_SID"), _need("TWILIO_AUTH_TOKEN"), _need("TWILIO_FROM"))
    raise RuntimeError(f"unknown SMS_PROVIDER {provider!r} (console, msg91, twilio)")
