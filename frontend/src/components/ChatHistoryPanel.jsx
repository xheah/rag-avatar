/**
 * ChatHistoryPanel.jsx — Slide-in chat history overlay
 *
 * Toggleable side panel showing conversation history.
 * Glassmorphism design with smooth slide-in/out animation.
 */
import React, { useRef, useEffect } from 'react';
import { X, Trash2, BrainCircuit } from 'lucide-react';
import Markdown from 'react-markdown';

export function ChatHistoryPanel({ isOpen, onClose, messages, onClear }) {
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      // Small delay to let the panel animate in before scrolling
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    }
  }, [isOpen, messages]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className={`chat-panel-backdrop ${isOpen ? 'chat-panel-backdrop-visible' : ''}`}
        onClick={onClose}
      />

      {/* Panel */}
      <div className={`chat-panel ${isOpen ? 'chat-panel-open' : ''}`}>
        {/* Header */}
        <div className="chat-panel-header">
          <h2 className="chat-panel-title">Chat History</h2>
          <div className="chat-panel-actions">
            <button
              onClick={onClear}
              className="chat-panel-clear-btn"
              title="Clear history"
            >
              <Trash2 size={14} />
              <span>Clear</span>
            </button>
            <button
              onClick={onClose}
              className="chat-panel-close-btn"
              title="Close panel"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="chat-panel-messages custom-scrollbar">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`chat-panel-msg ${msg.role === 'user' ? 'chat-panel-msg-user' : 'chat-panel-msg-avatar'}`}
            >
              {/* Thoughts block */}
              {msg.role === 'avatar' && msg.thoughts && (
                <div className="chat-panel-thoughts">
                  <div className="chat-panel-thoughts-label">
                    <BrainCircuit size={10} />
                    Strategic Analysis
                  </div>
                  <div className="chat-panel-thoughts-text">{msg.thoughts}</div>
                </div>
              )}

              {/* Message bubble */}
              <div
                className={`chat-panel-bubble ${msg.role === 'user' ? 'chat-panel-bubble-user' : 'chat-panel-bubble-avatar'}`}
              >
                {msg.content ? (
                  <div className="prose prose-invert prose-sm max-w-none">
                    <Markdown>{msg.content}</Markdown>
                  </div>
                ) : msg.role === 'avatar' && (
                  <div className="chat-panel-typing">
                    <div className="chat-panel-typing-dot" style={{ animationDelay: '0ms' }} />
                    <div className="chat-panel-typing-dot" style={{ animationDelay: '200ms' }} />
                    <div className="chat-panel-typing-dot" style={{ animationDelay: '400ms' }} />
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
      </div>
    </>
  );
}

export default ChatHistoryPanel;
