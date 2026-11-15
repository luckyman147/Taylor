"""Unit tests for the outreach-email language detection heuristic."""

from app.prompts.language import detect_language


class TestScriptDetection:
    def test_hangul_is_korean(self) -> None:
        assert detect_language("안녕하세요, 채용 담당자님께 연락드립니다.") == "ko"

    def test_kana_is_japanese(self) -> None:
        assert detect_language("こんにちは、御社の求人についてご連絡します。") == "ja"

    def test_han_without_kana_is_chinese(self) -> None:
        assert detect_language("您好，我想咨询贵公司的招聘机会。") == "zh"


class TestStopwordDetection:
    def test_french_template(self) -> None:
        text = (
            "Bonjour, je me permets de vous écrire car je suis très intéressé "
            "par votre entreprise et je pense que mon expérience correspond."
        )
        assert detect_language(text) == "fr"

    def test_english_text(self) -> None:
        text = "Hello, I am writing to you because I am interested in your company."
        assert detect_language(text) == "en"

    def test_spanish_template(self) -> None:
        text = "Hola, le escribo porque estoy interesado en su empresa y tengo experiencia."
        assert detect_language(text) == "es"

    def test_portuguese_template(self) -> None:
        text = "Olá, estou escrevendo porque tenho interesse na sua empresa e meu trabalho é relevante."
        assert detect_language(text) == "pt"

    def test_accented_french_without_stopwords(self) -> None:
        assert detect_language("Développeur émérite, créatif, expérimenté.") == "fr"


class TestReturnsNoneWhenUnsure:
    def test_empty_text(self) -> None:
        assert detect_language("") is None
        assert detect_language("   ") is None

    def test_too_short(self) -> None:
        assert detect_language("Bonjour") is None
        assert detect_language("Merci !") is None

    def test_short_english_meta_instruction(self) -> None:
        assert detect_language("Keep it under 100 words") is None

    def test_tied_scores(self) -> None:
        assert detect_language("soy su sou sua") is None

    def test_digits_only(self) -> None:
        assert detect_language("2026 2025 2024") is None
