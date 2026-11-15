"""Language code helpers for prompt output language."""

import re

# Language code to full name mapping
LANGUAGE_NAMES = {
    "en": "English",
    "es": "Spanish",
    "zh": "Chinese (Simplified)",
    "ja": "Japanese",
    "pt": "Brazilian Portuguese",
    "fr": "French",
    "ko": "Korean",
}


def get_language_name(code: str) -> str:
    """Get full language name from code."""
    return LANGUAGE_NAMES.get(code, "English")


# Scripts that identify a language on their own.
_HANGUL_RE = re.compile(r"[\uac00-\ud7af\u1100-\u11ff]")
_KANA_RE = re.compile(r"[\u3040-\u30ff]")
_HAN_RE = re.compile(r"[\u4e00-\u9fff]")

# Distinctive function words used as a lightweight bag-of-words signal.
_STOPWORDS: dict[str, frozenset[str]] = {
    "en": frozenset(
        {
            "the",
            "and",
            "you",
            "your",
            "with",
            "for",
            "hello",
            "dear",
            "regards",
            "best",
            "my",
            "our",
            "that",
            "this",
            "have",
            "about",
            "from",
            "are",
            "please",
            "would",
        }
    ),
    "fr": frozenset(
        {
            "bonjour",
            "cordialement",
            "merci",
            "je",
            "vous",
            "nous",
            "votre",
            "vos",
            "notre",
            "avec",
            "pour",
            "dans",
            "sur",
            "être",
            "sont",
            "est",
            "une",
            "des",
            "du",
            "aux",
            "cette",
            "mon",
            "mes",
            "ma",
        }
    ),
    "es": frozenset(
        {
            "hola",
            "estimado",
            "estimada",
            "saludos",
            "gracias",
            "usted",
            "ustedes",
            "nuestro",
            "nuestra",
            "estoy",
            "tengo",
            "del",
            "los",
            "las",
            "una",
            "pero",
            "más",
            "sí",
            "su",
            "sus",
            "soy",
        }
    ),
    "pt": frozenset(
        {
            "olá",
            "ola",
            "prezado",
            "prezada",
            "atenciosamente",
            "obrigado",
            "obrigada",
            "você",
            "voce",
            "estou",
            "tenho",
            "meu",
            "minha",
            "não",
            "nao",
            "com",
            "uma",
            "do",
            "da",
            "sou",
            "seu",
            "sua",
        }
    ),
}

# Accented characters that are strong (if not conclusive) hints per language.
_ACCENT_RES: dict[str, re.Pattern[str]] = {
    "fr": re.compile(r"[àâçéèêëîïôùûœ]"),
    "es": re.compile(r"[ñ¿¡]"),
    "pt": re.compile(r"[ãõ]"),
}

_TOKEN_RE = re.compile(r"[^\W\d_]+")
_MIN_WORDS = 3
_MIN_SCORE = 2


def resolve_correspondence_language(job_description: str) -> str:
    """Resolve the output language for generated correspondence.

    An explicit content-language setting always wins. When it is unset, fall
    back to the job description's language, then to English.
    """
    from app.config_cache import load_config

    config = load_config()
    raw = (
        config.get("content_language")
        if "content_language" in config
        else config.get("language")
    )
    configured = str(raw or "").strip()
    if configured:
        return configured
    return detect_language(job_description) or "en"


def detect_language(text: str) -> str | None:
    """Heuristically detect the language of short user-provided text.

    Used to decide the outreach-email language, so it stays deliberately
    simple: script ranges for zh/ja/ko and distinctive function words plus
    accented characters for en/fr/es/pt. Returns ``None`` when the text is
    too short or the signal is not clear enough to act on.
    """
    if not text or not text.strip():
        return None

    if _HANGUL_RE.search(text):
        return "ko"
    if _KANA_RE.search(text):
        return "ja"
    if _HAN_RE.search(text):
        return "zh"

    lowered = text.lower()
    words = _TOKEN_RE.findall(lowered)
    if len(words) < _MIN_WORDS:
        return None

    scores: dict[str, int] = {}
    for code, stopwords in _STOPWORDS.items():
        hits = sum(1 for word in words if word in stopwords)
        accent_re = _ACCENT_RES.get(code)
        accent_hits = len(accent_re.findall(lowered)) if accent_re else 0
        scores[code] = hits + min(accent_hits, 3)

    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    best_code, best_score = ranked[0]
    runner_up_score = ranked[1][1]
    if best_score < _MIN_SCORE or best_score <= runner_up_score:
        return None
    return best_code
