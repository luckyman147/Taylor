"""Chat response evaluator using DeepEval metrics.

Runs asynchronously after each chat turn to score response quality
without blocking the user-facing response.
"""

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class EvaluationResult:
    """Result of evaluating a single chat response."""

    relevancy_score: float | None = None
    faithfulness_score: float | None = None
    hallucination_score: float | None = None
    bias_score: float | None = None
    coherence_score: float | None = None
    overall_score: float | None = None
    errors: list[str] | None = None


def _get_eval_model():
    """Get a DeepEval-compatible model instance using the app's LLM provider."""
    from deepeval.models import DeepEvalBaseLLM

    class _Wrapper(DeepEvalBaseLLM):
        def __init__(self):
            from app.config import settings as _s
            # Use dedicated eval settings, falling back to app settings
            self._model = _s.deepeval_model or (
                f"{_s.llm_provider}/{_s.llm_model}" if "/" not in _s.llm_model else _s.llm_model
            )
            self._api_key = _s.deepeval_api_key or _s.llm_api_key
            self._api_base = _s.deepeval_api_base or _s.llm_api_base or ""

        def load_model(self):
            return self

        def generate(self, prompt: str, *args, **kwargs) -> str:
            import litellm
            kwargs_call = {"temperature": 0, "api_key": self._api_key}
            if self._api_base:
                kwargs_call["api_base"] = self._api_base
            response = litellm.completion(
                model=self._model,
                messages=[{"role": "user", "content": prompt}],
                **kwargs_call,
            )
            return response.choices[0].message.content or ""

        async def a_generate(self, prompt: str, *args, **kwargs) -> str:
            return self.generate(prompt, *args, **kwargs)

        def get_model_name(self) -> str:
            return self._model

        def supports_json_mode(self) -> bool:
            return False

        def supports_log_probs(self) -> bool:
            return False

    return _Wrapper()


def _run_metrics_sync(
    input_text: str,
    actual_output: str,
    context: str | None,
    threshold: float,
) -> EvaluationResult:
    """Run DeepEval metrics synchronously (called in a thread)."""
    from deepeval.test_case import LLMTestCase
    from deepeval.metrics import (
        AnswerRelevancyMetric,
        FaithfulnessMetric,
        HallucinationMetric,
        BiasMetric,
        GEval,
    )
    from deepeval.test_case.llm_test_case import SingleTurnParams

    model = _get_eval_model()
    result = EvaluationResult(errors=[])

    # Build retrieval_context from context if available
    retrieval_context = [context] if context else None

    # Faithfulness and Hallucination require retrieval_context / context
    has_context = bool(context)

    test_case = LLMTestCase(
        input=input_text,
        actual_output=actual_output,
        **({"retrieval_context": retrieval_context} if has_context else {}),
    )

    # Answer Relevancy
    try:
        metric = AnswerRelevancyMetric(threshold=threshold, model=model)
        metric.measure(test_case)
        result.relevancy_score = metric.score
    except Exception as e:
        logger.debug("Relevancy metric failed: %s", e)
        result.errors.append(f"relevancy: {e}")

    # Faithfulness (requires retrieval_context)
    if has_context:
        try:
            metric = FaithfulnessMetric(threshold=threshold, model=model)
            metric.measure(test_case)
            result.faithfulness_score = metric.score
        except Exception as e:
            logger.debug("Faithfulness metric failed: %s", e)
            result.errors.append(f"faithfulness: {e}")

    # Hallucination (requires context, lower is better)
    if has_context:
        try:
            metric = HallucinationMetric(threshold=threshold, model=model)
            metric.measure(test_case)
            result.hallucination_score = metric.score
        except Exception as e:
            logger.debug("Hallucination metric failed: %s", e)
            result.errors.append(f"hallucination: {e}")

    # Bias (lower is better)
    try:
        metric = BiasMetric(threshold=threshold, model=model)
        metric.measure(test_case)
        result.bias_score = metric.score
    except Exception as e:
        logger.debug("Bias metric failed: %s", e)
        result.errors.append(f"bias: {e}")

    # Coherence (custom G-Eval with evaluation_params)
    try:
        metric = GEval(
            name="Coherence",
            criteria="Determine if the actual_output is logically consistent, well-structured, and flows naturally.",
            evaluation_params=[SingleTurnParams.INPUT, SingleTurnParams.ACTUAL_OUTPUT],
            threshold=threshold,
            model=model,
        )
        metric.measure(test_case)
        result.coherence_score = metric.score
    except Exception as e:
        logger.debug("Coherence metric failed: %s", e)
        result.errors.append(f"coherence: {e}")

    # Compute overall score (average of available scores)
    scores = [
        s for s in [
            result.relevancy_score,
            result.faithfulness_score,
            result.hallucination_score,
            result.bias_score,
            result.coherence_score,
        ]
        if s is not None
    ]
    if scores:
        result.overall_score = sum(scores) / len(scores)

    if not result.errors:
        result.errors = None

    return result


class ChatEvaluator:
    """Evaluates chat responses asynchronously using DeepEval metrics."""

    async def evaluate_response(
        self,
        thread_id: str,
        input_text: str,
        actual_output: str,
        context: str | None = None,
        message_id: str | None = None,
    ) -> EvaluationResult | None:
        """Evaluate a chat response and persist scores to the database.

        This runs in a background thread to avoid blocking the chat response.
        """
        if not settings.deepeval_enabled:
            return None

        try:
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                _run_metrics_sync,
                input_text,
                actual_output,
                context,
                settings.deepeval_threshold,
            )

            # Persist to database
            await self._persist_result(
                thread_id=thread_id,
                message_id=message_id,
                input_text=input_text,
                output_text=actual_output,
                context=context,
                result=result,
            )

            return result
        except Exception as e:
            logger.warning("Chat evaluation failed: %s", e)
            return None

    async def _persist_result(
        self,
        thread_id: str,
        message_id: str | None,
        input_text: str,
        output_text: str,
        context: str | None,
        result: EvaluationResult,
    ) -> None:
        """Save evaluation scores to the chat_evaluations table."""
        from app.database import db

        eval_id = f"eval_{uuid.uuid4().hex[:12]}"
        try:
            await db.save_chat_evaluation(
                eval_id=eval_id,
                thread_id=thread_id,
                message_id=message_id,
                input_text=input_text[:5000],
                output_text=output_text[:10000],
                context=(context or "")[:5000],
                relevancy_score=result.relevancy_score,
                faithfulness_score=result.faithfulness_score,
                hallucination_score=result.hallucination_score,
                bias_score=result.bias_score,
                coherence_score=result.coherence_score,
                overall_score=result.overall_score,
                metadata_json=json.dumps({"errors": result.errors}) if result.errors else None,
            )
        except Exception as e:
            logger.warning("Failed to persist evaluation result: %s", e)


# Global singleton
chat_evaluator = ChatEvaluator()
