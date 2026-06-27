import logging
import requests
import json
from typing import List, Dict, Any
from app.core.config import settings
from app.core.circuit_breaker import ollama_circuit, CircuitBreakerOpen

logger = logging.getLogger(__name__)

class AIService:
    @staticmethod
    def get_ollama_url() -> str:
        return f"{settings.OLLAMA_HOST}/api/generate"

    @staticmethod
    def _normalize_confidence(conf: Any) -> float:
        if conf is None:
            return 0.0
        # Ollama returns fractions (0.0-1.0); fallback returns integers (0-100)
        if isinstance(conf, (int, float)) and conf <= 1.0:
            return float(conf) * 100.0
        return float(conf)

    @staticmethod
    def match_schemas(source_name: str, source_schema: List[Dict[str, Any]], target_name: str, target_schema: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Calls local Ollama to find semantic matches between source and target column fields.
        """
        source_cols = [c["name"] for c in source_schema]
        target_cols = [c["name"] for c in target_schema]

        prompt = f"""
        You are an AI Database mapping agent.
        Match columns from the Source Table '{source_name}' to the Target Table '{target_name}'.
        
        Source Columns: {source_cols}
        Target Columns: {target_cols}

        Output a JSON object ONLY in this format:
        {{
          "matches": [
             {{ "source": "src_col_name", "target": "target_col_name", "confidence": 0.95, "reason": "Exact match" }}
          ]
        }}
        """

        import time as _time
        for attempt in range(settings.OLLAMA_MAX_RETRIES + 1):
            try:
                def _post():
                    return requests.post(
                        AIService.get_ollama_url(),
                        json={
                            "model": settings.OLLAMA_MODEL,
                            "prompt": prompt,
                            "stream": False,
                            "format": "json",
                        },
                        timeout=settings.OLLAMA_TIMEOUT,
                    )
                response = ollama_circuit.call(_post)
                if response.status_code == 200:
                    result = response.json()
                    parsed = json.loads(result.get("response", "{}"))
                    normalized_matches = []
                    for match in parsed.get("matches", []) or []:
                        normalized_matches.append({
                            **match,
                            "confidence": AIService._normalize_confidence(match.get("confidence", 0)),
                        })
                    parsed["matches"] = normalized_matches
                    return parsed
                logger.warning("Ollama returned status %s on attempt %d", response.status_code, attempt + 1)
            except CircuitBreakerOpen as e:
                logger.warning("Ollama circuit open, skipping retries: %s", e)
                break
            except Exception as e:
                logger.warning("Ollama call failed (attempt %d/%d): %s", attempt + 1, settings.OLLAMA_MAX_RETRIES + 1, e)
                if attempt < settings.OLLAMA_MAX_RETRIES:
                    _time.sleep(2 ** attempt)
        logger.info("Falling back to rule-based matching")

        # Fallback Mockup Response mimicking semantic matching
        matches = []
        for src in source_cols:
            best_match = None
            score = 0
            for tgt in target_cols:
                # Rule-based simple contains/exact match simulator
                if src.lower() == tgt.lower():
                    best_match = tgt
                    score = 98
                    break
                elif src.lower() in tgt.lower() or tgt.lower() in src.lower():
                    best_match = tgt
                    score = 85
            if best_match:
                matches.append({
                    "source": src,
                    "target": best_match,
                    "confidence": AIService._normalize_confidence(score),
                    "reason": "Rule-based structural match substring"
                })

        return {"matches": matches, "source": source_name, "target": target_name, "ai_processed": False}
