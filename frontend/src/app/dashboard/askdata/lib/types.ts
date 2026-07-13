export interface Connection {
  id: number;
  name: string;
  type: string;
}

export interface AskDataAskResponse {
  session_id: string;
  sql: string | null;
  grounded: boolean;
  confidence: number;
  method: string;
  executed: boolean;
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  masked_columns: string[];
  summary: string | null;
  warnings: string[];
  error: string | null;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  response?: AskDataAskResponse;
}
