import os
from dotenv import load_dotenv

load_dotenv()
_OPENAI_DOTENV = os.path.join(os.path.dirname(__file__), ".env.openai")
if os.path.exists(_OPENAI_DOTENV):
    load_dotenv(_OPENAI_DOTENV, override=True)

LINQ_API_KEY = os.getenv("LINQ_API_KEY", "")
LINQ_WEBHOOK_SECRET = os.getenv("LINQ_WEBHOOK_SECRET", "")
LINQ_SANDBOX_NUMBER = os.getenv("LINQ_SANDBOX_NUMBER", "")
LINQ_USER_ADDRESS = os.getenv("LINQ_USER_ADDRESS", "")

SERPAPI_KEY = os.getenv("SERPAPI_KEY", "")

PRAVA_SECRET_KEY = os.getenv("PRAVA_SECRET_KEY", "")
PRAVA_PUBLISHABLE_KEY = os.getenv("PRAVA_PUBLISHABLE_KEY", "")
PRAVA_API_URL = os.getenv("PRAVA_API_URL", "https://sandbox.api.prava.space/v1")

PRIVA_SERVER_HOST = os.getenv("PRIVA_SERVER_HOST", "0.0.0.0")
PRIVA_SERVER_PORT = int(os.getenv("PRIVA_SERVER_PORT", "8766"))
PRIVA_WEBHOOK_URL = os.getenv("PRIVA_WEBHOOK_URL", "")

NOTE_LLM = os.getenv("NOTE_LLM", "")
DEMO_MODE = os.getenv("DEMO_MODE", "0") == "1"

# Real-world pacing by default, demo pacing when DEMO_MODE=1.
# NOTE_OFFER_DELAY: how long after the user STOPS editing a note before PRIVA
# texts about its buy intent. Real: 3h (proactive check-in). Demo: 5s (immediate buzz).
NOTE_OFFER_DELAY = int(os.getenv("NOTE_OFFER_DELAY", "5" if DEMO_MODE else "10800"))
# URGENT_OFFER_DELAY: time-pressure notes (flight today, ASAP...) text right
# away — just a few seconds of debounce so a mid-typing edit still resets it.
URGENT_OFFER_DELAY = int(os.getenv("URGENT_OFFER_DELAY", "8"))
# SHIPPING_INTERVAL: time between silent shipping stage advances.
# Real: 3h per stage. Demo: 3 min per stage (confirmed -> shipped -> out_for_delivery -> delivered).
SHIPPING_INTERVAL = int(os.getenv("SHIPPING_INTERVAL", "180" if DEMO_MODE else "10800"))

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
