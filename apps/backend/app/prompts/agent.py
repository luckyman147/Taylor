"""Autonomous agent loop prompts."""

# ── Agent Loop Prompts ─────────────────────────────────────────────

AGENT_THINK_PROMPT = """You are an autonomous agent with access to tools. Given the user's query
and the available tools, decide what to do next.

User query: {query}

Available tools:
{tools}

Previously collected data:
{previous_results}

Data gaps to fill: {data_gaps}

Respond with a JSON object:
{{
  "thought": "Your reasoning about what to do next",
  "actions": [
    {{"tool_name": "tool_name", "arguments": {{"arg": "value"}}}}
  ],
  "sufficient": false,
  "answer_draft": ""
}}

RULES:
- Only call tools that are actually needed. Prefer fewer, more targeted calls.
- If you have enough data to answer, set "sufficient": true and "actions": [].
- "answer_draft" should contain a draft answer if sufficient, empty string otherwise.
- Never call destructive tools without explicit user confirmation.
- Maximum 3 tool calls per iteration."""


AGENT_ANSWER_PROMPT = """Based on the following data, provide a helpful, concise answer
to the user's question.

User question: {query}

Available data:
{data_summary}

Provide a clear, direct answer. Use the data to support your response.
Write in {output_language}."""
