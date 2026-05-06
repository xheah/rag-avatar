/**
 * SubtitleCaption.jsx — Netflix-style subtitle captions
 *
 * Displays avatar speech text as synced captions below the avatar.
 * Text is chunked and animated in/out based on audio playback timing.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Split text into display-friendly subtitle chunks.
 * Aims for ~60 chars per chunk, splitting at sentence/clause boundaries.
 */
function chunkText(text) {
  if (!text) return [];

  // First split by sentences
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];

  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/);
    if (words.length <= 12) {
      if (sentence.trim()) chunks.push(sentence.trim());
    } else {
      // Split long sentences at clause boundaries
      const clauses = sentence.split(/(?<=[,;—–])\s+/);
      let bufferWords = [];
      for (const clause of clauses) {
        const clauseWords = clause.trim().split(/\s+/);
        if (bufferWords.length + clauseWords.length > 10 && bufferWords.length > 0) {
          chunks.push(bufferWords.join(' '));
          bufferWords = clauseWords;
        } else {
          bufferWords = bufferWords.concat(clauseWords);
        }
      }
      if (bufferWords.length > 0) chunks.push(bufferWords.join(' '));
    }
  }

  return chunks;
}

export function SubtitleCaption({ text, orbState }) {
  const [visibleChunk, setVisibleChunk] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  
  const chunksRef = useRef([]);
  const chunkIndexRef = useRef(0);
  const timerRef = useRef(null);
  const isPacingRef = useRef(false);

  // Keep chunks updated as text streams
  useEffect(() => {
    chunksRef.current = chunkText(text);
  }, [text]);

  // Pacing logic: Display chunks sequentially with appropriate reading time
  useEffect(() => {
    if (orbState === 'speaking' || orbState === 'thinking') {
      let isSubscribed = true;

      const runPacer = () => {
        if (!isSubscribed) return;

        const chunks = chunksRef.current;
        const currentIndex = chunkIndexRef.current;

        // Display chunk if it is fully formed (a newer chunk exists)
        // This ensures we show the ENTIRE chunk at once, preventing word-by-word reveal
        if (chunks.length > currentIndex + 1) {
          const chunkToDisplay = chunks[currentIndex];
          
          // Clear current chunk completely before showing the next
          setIsExiting(true);
          setTimeout(() => {
            if (!isSubscribed) return;
            setVisibleChunk(chunkToDisplay);
            setIsExiting(false);
            setIsVisible(true);
            
            // Calculate natural reading duration for this chunk
            const wordCount = chunkToDisplay.split(/\s+/).length;
            const punctuationCount = (chunkToDisplay.match(/[,;—–.!?]/g) || []).length;
            const durationMs = wordCount * 330 + punctuationCount * 250 + 250;
            
            timerRef.current = setTimeout(() => {
              chunkIndexRef.current = currentIndex + 1;
              runPacer();
            }, durationMs);
          }, 150); // 150ms exit animation ensures clean UI
        } else {
          // Chunk not fully formed yet, wait and check again
          timerRef.current = setTimeout(runPacer, 150);
        }
      };

      if (!isPacingRef.current) {
        isPacingRef.current = true;
        // Reset index if we are starting a new stream
        if (!text || chunkIndexRef.current >= chunksRef.current.length) {
           chunkIndexRef.current = 0;
        }
        runPacer();
      }

      return () => {
        isSubscribed = false;
        clearTimeout(timerRef.current);
        isPacingRef.current = false;
      };
    } else if (orbState === 'idle') {
      // Stream finished, display the final chunk if any remains
      const chunks = chunksRef.current;
      if (chunks.length > 0 && chunkIndexRef.current < chunks.length) {
        setIsExiting(true);
        setTimeout(() => {
          setVisibleChunk(chunks[chunks.length - 1]);
          setIsExiting(false);
          setIsVisible(true);
          
          // Fade out final chunk after 3 seconds of idle time
          timerRef.current = setTimeout(() => {
            setIsExiting(true);
            setTimeout(() => {
              setIsVisible(false);
              setIsExiting(false);
              setVisibleChunk('');
            }, 200);
          }, 3000);
        }, 150);
      } else if (visibleChunk) {
        // If everything was displayed, just fade out
        timerRef.current = setTimeout(() => {
          setIsExiting(true);
          setTimeout(() => {
            setIsVisible(false);
            setIsExiting(false);
            setVisibleChunk('');
          }, 200);
        }, 3000);
      }
      
      // Reset state for next interaction
      chunkIndexRef.current = 0;
      isPacingRef.current = false;
    }
  }, [orbState, text, visibleChunk]);

  if (!visibleChunk) return null;

  return (
    <div className="subtitle-caption-container">
      <div
        className={`subtitle-caption ${isVisible && !isExiting ? 'subtitle-enter' : ''} ${isExiting ? 'subtitle-exit' : ''}`}
      >
        {visibleChunk}
      </div>
    </div>
  );
}

export default SubtitleCaption;
