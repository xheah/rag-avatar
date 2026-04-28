import asyncio
from typing import Dict, Set

class StateManager:
    def __init__(self):
        self._sessions: Dict[str, str] = {}
        self._cancel_events: Dict[str, asyncio.Event] = {}
        self._pcs: Set = set()

    def get_session(self, session_id: str) -> str:
        return self._sessions.get(session_id, "")

    def update_session(self, session_id: str, content: str):
        if session_id not in self._sessions:
            self._sessions[session_id] = content
        else:
            self._sessions[session_id] += content

    def clear_session(self, session_id: str):
        self._sessions[session_id] = ""

    def get_cancel_event(self, session_id: str) -> asyncio.Event:
        if session_id not in self._cancel_events:
            self._cancel_events[session_id] = asyncio.Event()
        return self._cancel_events[session_id]

    def add_pc(self, pc):
        self._pcs.add(pc)

    def remove_pc(self, pc):
        self._pcs.discard(pc)

# Global instance to be used by the application
app_state = StateManager()
