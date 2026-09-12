"""Hybrid RAG engine: smart chunking + embedding + BM25 + reranking + context builder.

Embedding uses litellm.aembedding() (same provider as chat completions).
BM25 is pure Python (no external dependencies).
Reranking uses the LLM itself as a cross-encoder scorer.
Context builder deduplicates, compresses, and cites retrieved chunks.
"""

from __future__ import annotations

import json
import logging
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from app.database import db

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


CHUNK_MAX_TOKENS = 150  # approximate token count per chunk
CONTEXT_BUDGET_TOKENS = 800  # max tokens for retrieved context block


# ---------------------------------------------------------------------------
# Smart Chunking
# ---------------------------------------------------------------------------

@dataclass
class Chunk:
    text: str
    metadata: dict[str, Any]
    source_id: str = ""
    source_type: str = ""  # "resume" | "job" | "memory" | "skill"


def chunk_resume(resume_data: dict[str, Any], resume_id: str = "") -> list[Chunk]:
    """Chunk a resume by section with overlap preservation."""
    chunks: list[Chunk] = []

    # Skills chunk (compact)
    skills = resume_data.get("skills") or []
    if skills:
        skill_names = [s.get("name", "") for s in skills if s.get("name")]
        if skill_names:
            chunks.append(Chunk(
                text=f"Skills: {', '.join(skill_names)}",
                metadata={"section": "skills"},
                source_id=resume_id,
                source_type="resume",
            ))

    # Work experience — one chunk per entry
    for i, exp in enumerate(resume_data.get("workExperience", [])):
        company = exp.get("company", "")
        title = exp.get("title", "")
        bullets = exp.get("description", [])
        bullet_text = " ".join(b for b in bullets[:4] if isinstance(b, str))
        text = f"{title} at {company}: {bullet_text}".strip()
        if text and text != ":":
            chunks.append(Chunk(
                text=text,
                metadata={"section": "work_experience", "company": company, "index": i},
                source_id=resume_id,
                source_type="resume",
            ))

    # Education — one chunk per entry
    for edu in resume_data.get("education", []):
        institution = edu.get("institution", "")
        degree = edu.get("degree", "")
        text = f"{degree} — {institution}".strip(" —")
        if text:
            chunks.append(Chunk(
                text=text,
                metadata={"section": "education"},
                source_id=resume_id,
                source_type="resume",
            ))

    # Projects — one chunk per entry
    for proj in resume_data.get("personalProjects", []):
        name = proj.get("name", "")
        bullets = proj.get("description", [])
        bullet_text = " ".join(b for b in bullets[:3] if isinstance(b, str))
        text = f"Project {name}: {bullet_text}".strip(": ")
        if text and text != "Project":
            chunks.append(Chunk(
                text=text,
                metadata={"section": "project", "name": name},
                source_id=resume_id,
                source_type="resume",
            ))

    # Summary chunk (if exists and short enough)
    summary = resume_data.get("summary", "")
    if summary and len(summary.split()) < 60:
        chunks.append(Chunk(
            text=f"Summary: {summary}",
            metadata={"section": "summary"},
            source_id=resume_id,
            source_type="resume",
        ))

    return chunks


def chunk_job(job: dict[str, Any]) -> list[Chunk]:
    """Chunk a job description into a single chunk."""
    title = job.get("title", "")
    company = job.get("company", "")
    desc = job.get("description") or ""
    text = f"{title} at {company}: {desc[:500]}".strip(": ")
    if not text:
        return []
    return [Chunk(
        text=text,
        metadata={"title": title, "company": company},
        source_id=job.get("job_id", ""),
        source_type="job",
    )]


def chunk_memory(memory: dict[str, Any]) -> list[Chunk]:
    """Chunk a chat memory into a single chunk."""
    statement = memory.get("statement", "")
    if not statement:
        return []
    return [Chunk(
        text=statement,
        metadata={"memory_id": memory.get("memory_id", "")},
        source_id=memory.get("memory_id", ""),
        source_type="memory",
    )]


def chunk_skill(skill: dict[str, Any]) -> list[Chunk]:
    """Chunk a career skill into a single chunk."""
    name = skill.get("name", "")
    category = skill.get("category", "")
    if not name:
        return []
    return [Chunk(
        text=f"{name} ({category})" if category else name,
        metadata={"skill_id": skill.get("skill_id", ""), "category": category},
        source_id=skill.get("skill_id", ""),
        source_type="skill",
    )]


# ---------------------------------------------------------------------------
# Embedding layer
# ---------------------------------------------------------------------------

# Providers that natively support embeddings → (model, dimension)
_EMBEDDING_PROVIDERS: dict[str, tuple[str, int]] = {
    "openai": ("text-embedding-3-small", 1536),
    "openai_compatible": ("text-embedding-3-small", 1536),
    "gemini": ("gemini/gemini-embedding-001", 3072),
    "ollama": ("ollama/nomic-embed-text", 768),
    "azure_foundry": ("text-embedding-3-small", 1536),
}

# Fallback embedding model for providers without native embeddings
_FALLBACK_EMBEDDING = ("text-embedding-3-small", 1536)


def _get_embedding_config() -> tuple[str | None, int]:
    """Return (model, dimension) or (None, 0) if embedding is unsupported.

    Priority: explicit config.json > provider default > None (skip embedding).
    """
    default_dim = 1536
    try:
        from app.config import load_config_file
        from app.llm import get_llm_config
        stored = load_config_file()

        # User explicitly set embedding_model → honour it
        if "embedding_model" in stored and stored["embedding_model"]:
            model = stored["embedding_model"]
            dimension = stored.get("embedding_dimension", default_dim)
            return model, dimension

        # Auto-detect from provider
        llm_config = get_llm_config()
        if llm_config.provider in _EMBEDDING_PROVIDERS:
            return _EMBEDDING_PROVIDERS[llm_config.provider]

        # Provider has no native embeddings — skip (BM25-only mode)
        logger.info(
            "Provider '%s' has no embedding model; RAG will use BM25 keyword search only",
            llm_config.provider,
        )
        return None, 0
    except Exception:
        return _FALLBACK_EMBEDDING


async def embed_text(text: str) -> list[float]:
    """Embed a single text string using litellm.aembedding()."""
    results = await embed_batch([text])
    return results[0] if results else []


async def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed multiple texts via litellm.aembedding(). Falls back to zero vectors on failure."""
    if not texts:
        return []
    model, dimension = _get_embedding_config()
    if model is None:
        # No embedding support — return zero vectors (BM25-only mode)
        return [[0.0] * 1536 for _ in texts]
    try:
        import litellm
        from app.llm import get_llm_config
        llm_config = get_llm_config()
        kwargs: dict[str, Any] = {"model": model, "input": texts}
        # Only pass api_key for providers that need it (not ollama)
        if llm_config.provider != "ollama" and llm_config.api_key:
            kwargs["api_key"] = llm_config.api_key
        response = await litellm.aembedding(**kwargs)
        return [item["embedding"] for item in response.data]
    except Exception:
        logger.warning("Embedding failed (model=%s), falling back to zero vectors", model, exc_info=True)
        return [[0.0] * dimension for _ in texts]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Pure Python cosine similarity."""
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


# ---------------------------------------------------------------------------
# BM25 index (keyword search)
# ---------------------------------------------------------------------------

class BM25Index:
    """Lightweight BM25 index — pure Python, no dependencies."""

    def __init__(self, documents: list[str], k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.documents = documents
        self.doc_count = len(documents)
        self.avgdl = 0.0
        self.doc_lens: list[int] = []
        self.tf: list[Counter] = []
        self.df: Counter = Counter()

        if not documents:
            return

        for doc in documents:
            tokens = self._tokenize(doc)
            self.doc_lens.append(len(tokens))
            self.tf.append(Counter(tokens))
            for token in set(tokens):
                self.df[token] += 1

        self.avgdl = sum(self.doc_lens) / self.doc_count if self.doc_count else 1.0

    def _tokenize(self, text: str) -> list[str]:
        return re.findall(r"\w+", text.lower())

    def search(self, query: str, top_k: int = 20) -> list[tuple[int, float]]:
        """Return (doc_index, score) pairs sorted by descending score."""
        if not self.documents or not query:
            return []

        query_tokens = self._tokenize(query)
        scores: list[tuple[int, float]] = []

        for i in range(self.doc_count):
            score = 0.0
            dl = self.doc_lens[i]
            for token in query_tokens:
                if token not in self.tf[i]:
                    continue
                tf_val = self.tf[i][token]
                df_val = self.df.get(token, 0)
                idf = math.log((self.doc_count - df_val + 0.5) / (df_val + 0.5) + 1.0)
                tf_norm = (tf_val * (self.k1 + 1)) / (
                    tf_val + self.k1 * (1 - self.b + self.b * dl / self.avgdl)
                )
                score += idf * tf_norm
            if score > 0:
                scores.append((i, score))

        scores.sort(key=lambda x: x[1], reverse=True)
        return scores[:top_k]


# ---------------------------------------------------------------------------
# Hybrid retrieval (vector + BM25 + Reciprocal Rank Fusion)
# ---------------------------------------------------------------------------

def reciprocal_rank_fusion(
    rank_lists: list[list[int]],
    k: int = 60,
) -> list[tuple[int, float]]:
    """Merge multiple rank lists using Reciprocal Rank Fusion.

    Returns (item, fused_score) sorted by descending score.
    """
    scores: dict[int, float] = {}
    for rank_list in rank_lists:
        for rank, item_id in enumerate(rank_list):
            scores[item_id] = scores.get(item_id, 0.0) + 1.0 / (k + rank + 1)
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)


# ---------------------------------------------------------------------------
# Reranking (LLM-as-cross-encoder)
# ---------------------------------------------------------------------------

async def rerank_chunks(
    query: str,
    chunks: list[Chunk],
    top_k: int = 5,
) -> list[Chunk]:
    """Re-rank chunks using the LLM as a relevance scorer.

    For small candidate sets (<8), skips reranking and returns as-is.
    """
    if len(chunks) <= top_k:
        return chunks

    # Score each chunk with the LLM
    scored: list[tuple[float, Chunk]] = []
    for chunk in chunks[:20]:  # cap at 20 to limit LLM calls
        score = await _score_relevance(query, chunk.text)
        scored.append((score, chunk))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [chunk for _, chunk in scored[:top_k]]


async def _score_relevance(query: str, document: str) -> float:
    """Score relevance of a document to a query (0-10 scale) using the LLM."""
    try:
        from app.llm import complete
        score_text = await complete(
            prompt=f"Score the relevance of this document to the query. Return ONLY a number 0-10.\n\nQuery: {query}\nDocument: {document[:400]}\n\nScore:",
            max_tokens=5,
            temperature=0.0,
        )
        # Extract numeric score
        match = re.search(r"(\d+(?:\.\d+)?)", score_text.strip())
        if match:
            return min(float(match.group(1)), 10.0)
    except Exception:
        pass
    return 5.0  # neutral score on failure


# ---------------------------------------------------------------------------
# Context builder (dedup, compress, cite)
# ---------------------------------------------------------------------------

def build_context_block(
    retrieved: dict[str, list[tuple[Chunk, float]]],
    budget_tokens: int = CONTEXT_BUDGET_TOKENS,
) -> str:
    """Build a structured, cited context block from retrieved chunks.

    Args:
        retrieved: {"resumes": [(chunk, score), ...], "jobs": [...], "memories": [...]}
        budget_tokens: approximate max tokens for the output block.
    """
    sections: list[str] = []
    citation_map: dict[str, int] = {}
    citation_counter = 0
    total_chars = 0
    max_chars = budget_tokens * 4  # rough char-to-token ratio

    for source_type, items in retrieved.items():
        if not items:
            continue
        section_lines: list[str] = []
        for chunk, score in items:
            # Dedup: skip if similar text already seen
            text_lower = chunk.text.lower()[:100]
            if text_lower in citation_map:
                continue
            citation_counter += 1
            citation_map[text_lower] = citation_counter
            tag = f"[{citation_counter}]"

            if total_chars + len(chunk.text) > max_chars:
                # Truncate to fit budget
                remaining = max_chars - total_chars
                if remaining > 50:
                    section_lines.append(f"{tag} {chunk.text[:remaining]}...")
                break
            section_lines.append(f"{tag} {chunk.text}")
            total_chars += len(chunk.text)

        if section_lines:
            label = source_type.replace("_", " ").title()
            sections.append(f"### {label}\n" + "\n".join(section_lines))

    return "\n\n".join(sections) if sections else "(no relevant context found)"


# ---------------------------------------------------------------------------
# RAG index (singleton)
# ---------------------------------------------------------------------------

class RAGIndex:
    """In-memory RAG index with lazy embedding sync."""

    def __init__(self) -> None:
        self.resumes: list[dict[str, Any]] = []  # {"chunk": Chunk, "embedding": list[float]}
        self.jobs: list[dict[str, Any]] = []
        self.memories: list[dict[str, Any]] = []
        self.skills: list[dict[str, Any]] = []
        self.resume_bm25: BM25Index = BM25Index([])
        self.job_bm25: BM25Index = BM25Index([])
        self.memory_bm25: BM25Index = BM25Index([])
        self.skill_bm25: BM25Index = BM25Index([])
        self._indexed = False

    async def ensure_indexed(self) -> None:
        """Lazy-sync: embed any new records, then index."""
        await self._sync_new_records()
        if not self._indexed:
            await self._rebuild_indices()
            self._indexed = True

    async def _sync_new_records(self) -> None:
        """Embed only records that don't have embeddings yet."""
        # Resumes
        unembedded = await db.get_unembedded_resumes()
        for resume in unembedded:
            processed = resume.get("processed_data") or {}
            chunks = chunk_resume(processed, resume.get("resume_id", ""))
            if chunks:
                embeddings = await embed_batch([c.text for c in chunks])
                for chunk, emb in zip(chunks, embeddings):
                    await db.update_resume_embedding(
                        chunk.source_id, json.dumps(emb)
                    )
                    self.resumes.append({"chunk": chunk, "embedding": emb})

        # Jobs
        unembedded = await db.get_unembedded_jobs()
        for job in unembedded:
            chunks = chunk_job(job)
            if chunks:
                embeddings = await embed_batch([c.text for c in chunks])
                for chunk, emb in zip(chunks, embeddings):
                    await db.update_job_embedding(
                        chunk.source_id, json.dumps(emb)
                    )
                    self.jobs.append({"chunk": chunk, "embedding": emb})

        # Memories
        unembedded = await db.get_unembedded_memories()
        for mem in unembedded:
            chunks = chunk_memory(mem)
            if chunks:
                embeddings = await embed_batch([c.text for c in chunks])
                for chunk, emb in zip(chunks, embeddings):
                    await db.update_memory_embedding(
                        chunk.source_id, json.dumps(emb)
                    )
                    self.memories.append({"chunk": chunk, "embedding": emb})

        # Skills
        unembedded = await db.get_unembedded_skills()
        for skill in unembedded:
            chunks = chunk_skill(skill)
            if chunks:
                embeddings = await embed_batch([c.text for c in chunks])
                for chunk, emb in zip(chunks, embeddings):
                    await db.update_skill_embedding(
                        chunk.source_id, json.dumps(emb)
                    )
                    self.skills.append({"chunk": chunk, "embedding": emb})

    async def _rebuild_indices(self) -> None:
        """Rebuild BM25 indices from current in-memory data."""
        self.resume_bm25 = BM25Index([d["chunk"].text for d in self.resumes])
        self.job_bm25 = BM25Index([d["chunk"].text for d in self.jobs])
        self.memory_bm25 = BM25Index([d["chunk"].text for d in self.memories])
        self.skill_bm25 = BM25Index([d["chunk"].text for d in self.skills])

    def add_resume(self, chunk: Chunk, embedding: list[float]) -> None:
        """Add a single resume chunk to the in-memory index."""
        self.resumes.append({"chunk": chunk, "embedding": embedding})

    def add_job(self, chunk: Chunk, embedding: list[float]) -> None:
        self.jobs.append({"chunk": chunk, "embedding": embedding})

    def add_memory(self, chunk: Chunk, embedding: list[float]) -> None:
        self.memories.append({"chunk": chunk, "embedding": embedding})

    def add_skill(self, chunk: Chunk, embedding: list[float]) -> None:
        self.skills.append({"chunk": chunk, "embedding": embedding})

    async def query(
        self,
        search_text: str,
        *,
        include_resumes: bool = True,
        include_jobs: bool = True,
        include_memories: bool = True,
        include_skills: bool = True,
        top_k: int = 5,
        rerank: bool = True,
    ) -> dict[str, list[tuple[Chunk, float]]]:
        """Hybrid retrieval: vector + BM25 + RRF fusion + optional reranking."""
        await self.ensure_indexed()

        query_emb = await embed_text(search_text)
        results: dict[str, list[tuple[Chunk, float]]] = {}

        if include_resumes and self.resumes:
            results["resumes"] = self._hybrid_search(
                search_text, query_emb, self.resumes, self.resume_bm25, top_k * 2
            )
        if include_jobs and self.jobs:
            results["jobs"] = self._hybrid_search(
                search_text, query_emb, self.jobs, self.job_bm25, top_k * 2
            )
        if include_memories and self.memories:
            results["memories"] = self._hybrid_search(
                search_text, query_emb, self.memories, self.memory_bm25, top_k
            )
        if include_skills and self.skills:
            results["skills"] = self._hybrid_search(
                search_text, query_emb, self.skills, self.skill_bm25, top_k
            )

        # Optional reranking with LLM
        if rerank:
            for source_type in results:
                results[source_type] = [
                    (c, s) for c, s in await rerank_chunks(
                        search_text, [c for c, _ in results[source_type]], top_k
                    )
                ][:top_k]
        else:
            for source_type in results:
                results[source_type] = results[source_type][:top_k]

        return results

    def _hybrid_search(
        self,
        query_text: str,
        query_emb: list[float],
        data: list[dict[str, Any]],
        bm25: BM25Index,
        top_k: int,
    ) -> list[tuple[Chunk, float]]:
        """Combine vector similarity + BM25 via RRF."""
        # Vector scores
        vector_scores = [
            cosine_similarity(query_emb, d["embedding"])
            for d in data
        ]

        # BM25 scores
        bm25_results = bm25.search(query_text, top_k=top_k)
        bm25_rank = {idx: rank for rank, (idx, _) in enumerate(bm25_results)}

        # Vector ranking
        vector_ranked = sorted(range(len(data)), key=lambda i: vector_scores[i], reverse=True)
        vector_rank = {idx: rank for rank, idx in enumerate(vector_ranked)}

        # RRF fusion
        all_indices = set(range(len(data)))
        fused = reciprocal_rank_fusion(
            [vector_ranked, [idx for idx, _ in bm25_results]],
            k=60,
        )

        # Build results with combined scores
        results: list[tuple[Chunk, float]] = []
        for idx, rrf_score in fused[:top_k]:
            combined_score = 0.6 * vector_scores[idx] + 0.4 * (1.0 / (60 + bm25_rank.get(idx, top_k) + 1))
            results.append((data[idx]["chunk"], combined_score))

        return sorted(results, key=lambda x: x[1], reverse=True)


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

rag_index = RAGIndex()


# ---------------------------------------------------------------------------
# Startup indexer
# ---------------------------------------------------------------------------

async def startup_index() -> None:
    """Index all unembedded records on startup."""
    try:
        await rag_index.ensure_indexed()
        total = (
            len(rag_index.resumes)
            + len(rag_index.jobs)
            + len(rag_index.memories)
            + len(rag_index.skills)
        )
        logger.info("RAG index built: %d chunks", total)
    except Exception:
        logger.warning("RAG startup indexing failed", exc_info=True)
