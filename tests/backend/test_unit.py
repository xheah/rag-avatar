"""
tests/backend/test_unit.py
--------------------------
Layer 1 — Pure function / unit tests.

All external I/O (Groq API, ChromaDB, SentenceTransformer) is mocked so
these tests run instantly offline without consuming any API credits.

Test groups
  1. adaptive_router   — routing enum values
  2. rewrite_query     — query rewriting passthrough
  3. generate_rag_response_v4       — sync RAG response parsing
  4. generate_rag_response_v4_stream — async streaming chunks
  5. get_closest_matches             — retriever result shape
"""

import pytest
from unittest.mock import patch, MagicMock, AsyncMock


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _make_sync_completion(content: str):
    """Build a minimal Groq sync completion mock."""
    choice = MagicMock()
    choice.message.content = content
    response = MagicMock()
    response.choices = [choice]
    return response


def _make_stream_chunks(tokens: list[str]):
    """Build a list of mock async stream chunks (one token each)."""
    chunks = []
    for token in tokens:
        chunk = MagicMock()
        chunk.choices[0].delta.content = token
        chunks.append(chunk)
    # Final chunk with None content (signals end-of-stream)
    end_chunk = MagicMock()
    end_chunk.choices[0].delta.content = None
    chunks.append(end_chunk)
    return chunks


def _sample_docs(n=2):
    return [
        {"id": f"doc_{i}", "document": f"Sales scenario content {i}", "type": "scenario"}
        for i in range(n)
    ]


# ─────────────────────────────────────────────────────────────────────────────
# 1. adaptive_router
# ─────────────────────────────────────────────────────────────────────────────

class TestAdaptiveRouter:

    @patch("src.llm.prompts.get_llm_client")
    def test_returns_chat_for_greeting(self, mock_get_client):
        mock_get_client.return_value.chat.completions.create.return_value = (
            _make_sync_completion("CHAT")
        )
        from src.llm.prompts import adaptive_router
        result = adaptive_router(chat_history="", latest_user_query="Hello!")
        assert result == "CHAT"

    @patch("src.llm.prompts.get_llm_client")
    def test_returns_rag_for_sales_query(self, mock_get_client):
        mock_get_client.return_value.chat.completions.create.return_value = (
            _make_sync_completion("RAG")
        )
        from src.llm.prompts import adaptive_router
        result = adaptive_router(chat_history="", latest_user_query="What is SPIN selling?")
        assert result == "RAG"

    @patch("src.llm.prompts.get_llm_client")
    def test_defaults_to_rag_on_unknown_output(self, mock_get_client):
        """If the LLM returns something unexpected, we should fall back to RAG."""
        mock_get_client.return_value.chat.completions.create.return_value = (
            _make_sync_completion("UNKNOWN_VALUE")
        )
        from src.llm.prompts import adaptive_router
        result = adaptive_router(chat_history="", latest_user_query="anything")
        assert result == "RAG"

    @patch("src.llm.prompts.get_llm_client")
    def test_strips_whitespace_from_llm_output(self, mock_get_client):
        """LLM responses may have trailing newlines; they should still parse."""
        mock_get_client.return_value.chat.completions.create.return_value = (
            _make_sync_completion("  rag\n")
        )
        from src.llm.prompts import adaptive_router
        result = adaptive_router(chat_history="", latest_user_query="Start quiz")
        assert result in ("RAG", "CHAT")

    @patch("src.llm.prompts.get_llm_client")
    def test_passes_chat_history_to_llm(self, mock_get_client):
        """The chat history must be forwarded in the API call."""
        mock_client = mock_get_client.return_value
        mock_client.chat.completions.create.return_value = _make_sync_completion("CHAT")
        from src.llm.prompts import adaptive_router
        adaptive_router(chat_history="User: hi\nAvatar: hello\n", latest_user_query="bye")
        call_kwargs = mock_client.chat.completions.create.call_args
        messages = call_kwargs.kwargs["messages"]
        user_message_content = messages[1]["content"]
        assert "User: hi" in user_message_content


# ─────────────────────────────────────────────────────────────────────────────
# 2. rewrite_query
# ─────────────────────────────────────────────────────────────────────────────

class TestRewriteQuery:

    @patch("src.llm.prompts.get_llm_client")
    def test_returns_rewritten_string(self, mock_get_client):
        mock_get_client.return_value.chat.completions.create.return_value = (
            _make_sync_completion("What is a cold call in B2B sales?")
        )
        from src.llm.prompts import rewrite_query
        result = rewrite_query(
            chat_history="Avatar: What is a cold call?\n",
            latest_user_query="Tell me more about it."
        )
        assert isinstance(result, str)
        assert len(result) > 0

    @patch("src.llm.prompts.get_llm_client")
    def test_standalone_query_returned_unchanged(self, mock_get_client):
        original = "What is objection handling?"
        mock_get_client.return_value.chat.completions.create.return_value = (
            _make_sync_completion(original)
        )
        from src.llm.prompts import rewrite_query
        result = rewrite_query(chat_history="", latest_user_query=original)
        assert result == original


# ─────────────────────────────────────────────────────────────────────────────
# 3. generate_rag_response_v4  (sync)
# ─────────────────────────────────────────────────────────────────────────────

class TestGenerateRagResponseV4:

    @patch("src.llm.prompts.get_llm_client")
    def test_returns_tuple_of_two_strings(self, mock_get_client):
        mock_get_client.return_value.chat.completions.create.return_value = (
            _make_sync_completion(
                "<thought>Thinking...</thought><speech>Good answer, here is the next scenario.</speech>"
            )
        )
        from src.llm.prompts import generate_rag_response_v4
        speech, thought = generate_rag_response_v4(
            user_query="I would build rapport first.",
            retrieved_documents=_sample_docs(),
            chat_history=""
        )
        assert isinstance(speech, str)
        assert isinstance(thought, str)

    @patch("src.llm.prompts.get_llm_client")
    def test_extracts_speech_tag_content(self, mock_get_client):
        mock_get_client.return_value.chat.completions.create.return_value = (
            _make_sync_completion("<thought>Analysing...</thought><speech>Score: 80%</speech>")
        )
        from src.llm.prompts import generate_rag_response_v4
        speech, _ = generate_rag_response_v4(
            user_query="test", retrieved_documents=[], chat_history=""
        )
        assert "Score: 80%" in speech

    @patch("src.llm.prompts.get_llm_client")
    def test_extracts_thought_tag_content(self, mock_get_client):
        mock_get_client.return_value.chat.completions.create.return_value = (
            _make_sync_completion("<thought>My reasoning here.</thought><speech>Answer.</speech>")
        )
        from src.llm.prompts import generate_rag_response_v4
        _, thought = generate_rag_response_v4(
            user_query="test", retrieved_documents=[], chat_history=""
        )
        assert "My reasoning here." in thought

    @patch("src.llm.prompts.get_llm_client")
    def test_falls_back_to_raw_text_when_no_tags(self, mock_get_client):
        """If the LLM omits tags entirely, the raw response is used as speech."""
        raw = "Good effort overall, let us try another scenario."
        mock_get_client.return_value.chat.completions.create.return_value = (
            _make_sync_completion(raw)
        )
        from src.llm.prompts import generate_rag_response_v4
        speech, _ = generate_rag_response_v4(
            user_query="test", retrieved_documents=[], chat_history=""
        )
        assert speech == raw

    @patch("src.llm.prompts.get_llm_client")
    def test_handles_empty_retrieved_documents(self, mock_get_client):
        mock_get_client.return_value.chat.completions.create.return_value = (
            _make_sync_completion("<thought>No context.</thought><speech>Start quiz.</speech>")
        )
        from src.llm.prompts import generate_rag_response_v4
        speech, thought = generate_rag_response_v4(
            user_query="Start quiz", retrieved_documents=[], chat_history=""
        )
        assert len(speech) > 0


# ─────────────────────────────────────────────────────────────────────────────
# 4. generate_rag_response_v4_stream  (async)
# ─────────────────────────────────────────────────────────────────────────────

class TestGenerateRagResponseV4Stream:

    @pytest.mark.asyncio
    @patch("src.llm.prompts.get_async_llm_client")
    async def test_yields_string_chunks(self, mock_get_client):
        chunks = _make_stream_chunks(["<thought>", "ok", "</thought>", "<speech>", "Hello", "</speech>"])

        async def _async_iter():
            for c in chunks:
                yield c

        mock_stream = MagicMock()
        mock_stream.__aiter__ = lambda s: _async_iter().__aiter__()
        mock_get_client.return_value.chat.completions.create = AsyncMock(return_value=mock_stream)

        from src.llm.prompts import generate_rag_response_v4_stream
        collected = [
            c async for c in generate_rag_response_v4_stream(
                user_query="test",
                retrieved_documents=_sample_docs(),
                chat_history=""
            )
        ]
        assert len(collected) > 0
        assert all(isinstance(c, str) for c in collected)

    @pytest.mark.asyncio
    @patch("src.llm.prompts.get_async_llm_client")
    async def test_skips_none_tokens(self, mock_get_client):
        """None tokens (end-of-stream sentinel) must not be yielded."""
        chunks = _make_stream_chunks(["hello", " world"])

        async def _async_iter():
            for c in chunks:
                yield c

        mock_stream = MagicMock()
        mock_stream.__aiter__ = lambda s: _async_iter().__aiter__()
        mock_get_client.return_value.chat.completions.create = AsyncMock(return_value=mock_stream)

        from src.llm.prompts import generate_rag_response_v4_stream
        collected = [
            c async for c in generate_rag_response_v4_stream(
                user_query="test", retrieved_documents=[], chat_history=""
            )
        ]
        assert None not in collected

    @pytest.mark.asyncio
    @patch("src.llm.prompts.get_async_llm_client")
    async def test_empty_retrieved_documents_does_not_crash(self, mock_get_client):
        chunks = _make_stream_chunks(["token"])

        async def _async_iter():
            for c in chunks:
                yield c

        mock_stream = MagicMock()
        mock_stream.__aiter__ = lambda s: _async_iter().__aiter__()
        mock_get_client.return_value.chat.completions.create = AsyncMock(return_value=mock_stream)

        from src.llm.prompts import generate_rag_response_v4_stream
        collected = [
            c async for c in generate_rag_response_v4_stream(
                user_query="test", retrieved_documents=[], chat_history=""
            )
        ]
        assert isinstance(collected, list)


# ─────────────────────────────────────────────────────────────────────────────
# 5. get_closest_matches  (retriever)
# ─────────────────────────────────────────────────────────────────────────────

class TestGetClosestMatches:

    @patch("src.vectorstore.retriever.get_db_client")
    @patch("src.vectorstore.retriever.get_embedding_model")
    def test_returns_list_of_dicts(self, mock_model, mock_db):
        mock_model.return_value.encode.return_value.tolist.return_value = [0.1, 0.2]
        mock_db.return_value.get_or_create_collection.return_value.query.return_value = {
            "ids": [["id_1", "id_2"]],
            "documents": [["Doc A content.", "Doc B content."]],
            "metadatas": [[{"type": "scenario"}, {"type": "rubric"}]],
        }
        from src.vectorstore.retriever import get_closest_matches
        results = get_closest_matches("cold call question", k=2)
        assert isinstance(results, list)
        assert len(results) == 2

    @patch("src.vectorstore.retriever.get_db_client")
    @patch("src.vectorstore.retriever.get_embedding_model")
    def test_result_items_have_required_keys(self, mock_model, mock_db):
        mock_model.return_value.encode.return_value.tolist.return_value = [0.1]
        mock_db.return_value.get_or_create_collection.return_value.query.return_value = {
            "ids": [["id_1"]],
            "documents": [["Some sales content."]],
            "metadatas": [[{"type": "scenario"}]],
        }
        from src.vectorstore.retriever import get_closest_matches
        results = get_closest_matches("test query", k=1)
        assert "id" in results[0]
        assert "document" in results[0]
        assert "type" in results[0]

    @patch("src.vectorstore.retriever.get_db_client")
    @patch("src.vectorstore.retriever.get_embedding_model")
    def test_returns_empty_list_when_no_results(self, mock_model, mock_db):
        mock_model.return_value.encode.return_value.tolist.return_value = [0.1]
        mock_db.return_value.get_or_create_collection.return_value.query.return_value = {
            "ids": [[]],
            "documents": [[]],
            "metadatas": [[]],
        }
        from src.vectorstore.retriever import get_closest_matches
        results = get_closest_matches("obscure query with no matches", k=5)
        assert results == []

    @patch("src.vectorstore.retriever.get_db_client")
    @patch("src.vectorstore.retriever.get_embedding_model")
    def test_k_parameter_is_forwarded_to_db(self, mock_model, mock_db):
        mock_model.return_value.encode.return_value.tolist.return_value = [0.1]
        mock_collection = mock_db.return_value.get_or_create_collection.return_value
        mock_collection.query.return_value = {
            "ids": [[]], "documents": [[]], "metadatas": [[]]
        }
        from src.vectorstore.retriever import get_closest_matches
        get_closest_matches("test", k=7)
        call_kwargs = mock_collection.query.call_args.kwargs
        assert call_kwargs["n_results"] == 7

    @patch("src.vectorstore.retriever.get_db_client")
    @patch("src.vectorstore.retriever.get_embedding_model")
    def test_missing_type_metadata_defaults_to_unknown(self, mock_model, mock_db):
        """Metadata without a 'type' key should default to 'Unknown' gracefully."""
        mock_model.return_value.encode.return_value.tolist.return_value = [0.1]
        mock_db.return_value.get_or_create_collection.return_value.query.return_value = {
            "ids": [["id_1"]],
            "documents": [["Content."]],
            "metadatas": [[{}]],  # no 'type' key
        }
        from src.vectorstore.retriever import get_closest_matches
        results = get_closest_matches("test", k=1)
        assert results[0]["type"] == "Unknown"
