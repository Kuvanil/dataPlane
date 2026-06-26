from typing import List, Dict, Any

class SecurityService:
    @staticmethod
    def classify_column(column_name: str) -> Dict[str, Any]:
        """
        Classifies columns based on common naming conventions into PII/Sensitive levels.
        """
        name = column_name.lower()
        
        # High Risk: PII / Identity
        if any(w in name for w in ["email", "phone", "number", "ssn", "password", "cc", "credit", "card"]):
            return {
                "label": "PII",
                "level": "High",
                "policy": "Mask on Export",
                "color": "red",
                "dama_metadata": {
                    "data_owner": "Information Security Office",
                    "data_steward": "Privacy Manager",
                    "retention": "3 Years after Inactivity"
                }
            }
            
        elif any(w in name for w in ["name", "zip", "city", "address", "state", "birth", "date_of"]):
            return {
                "label": "Sensitive",
                "level": "Medium",
                "policy": "Restrict Access",
                "color": "amber",
                "dama_metadata": {
                    "data_owner": "Human Resources / CRM Ops",
                    "data_steward": "Data Steward - Tier 2",
                    "retention": "7 Years Standard"
                }
            }
            
        return {
            "label": "Public",
            "level": "Low",
            "policy": "No Restrictions",
            "color": "green",
            "dama_metadata": {
                "data_owner": "General Public / IT",
                "data_steward": "System Admin",
                "retention": "Indefinite"
            }
        }

    @staticmethod
    def classify_schema(schema_data: Dict[str, List[Dict[str, Any]]]) -> Dict[str, Any]:
        """
        Applies classification directly across multiple tables structures properly formats results sets.
        """
        classifications = {}
        for table, cols in schema_data.items():
            classifications[table] = []
            for col in cols:
                classifications[table].append({
                    "column": col["name"],
                    "classification": SecurityService.classify_column(col["name"])
                })
        return classifications
