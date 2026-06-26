import requests
import json
from typing import List, Dict, Any
from app.core.config import settings

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

        try:
            response = requests.post(
                AIService.get_ollama_url(),
                json={
                    "model": "llama3", # or llama3/mistral
                    "prompt": prompt,
                    "stream": False,
                    "format": "json"
                },
                timeout=10 # short timeout to avoid hanging if loading
            )
            if response.status_code == 200:
                result = response.json()
                parsed = json.loads(result.get("response", "{}"))
                # Normalize confidence to a consistent 0-100 scale
                normalized_matches = []
                for match in parsed.get("matches", []) or []:
                    normalized_matches.append({
                        **match,
                        "confidence": AIService._normalize_confidence(match.get("confidence", 0)),
                    })
                parsed["matches"] = normalized_matches
                return parsed
        except Exception as e:
            print(f"Ollama call failed: {e}. Falling back to rule-based or placeholder response.")

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
