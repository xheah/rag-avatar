import { useRef, useCallback } from 'react';

export function useWebRTC({ onTranscriptFinal, onTranscriptInterim }) {
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const transcriptRef = useRef('');

  const stopWebRTC = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    dcRef.current = null;
  }, []);

  const startWebRTC = useCallback(async () => {
    stopWebRTC();
    transcriptRef.current = '';
    
    try {
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      const dc = pc.createDataChannel('chat');
      dcRef.current = dc;
      
      dc.onmessage = (event) => {
        const received = JSON.parse(event.data);
        if (received.type === 'Results' && received.channel?.alternatives?.[0]) {
          const t = received.channel.alternatives[0].transcript;
          if (t) {
            if (received.is_final) {
              transcriptRef.current += (transcriptRef.current ? ' ' : '') + t;
              if (onTranscriptInterim) onTranscriptInterim(transcriptRef.current);
            } else {
              if (onTranscriptInterim) onTranscriptInterim(transcriptRef.current + (transcriptRef.current ? ' ' : '') + t);
            }
          }
          if (received.speech_final) {
            const finalStr = transcriptRef.current.trim();
            if (finalStr.length > 0) {
              transcriptRef.current = '';
              if (onTranscriptFinal) onTranscriptFinal(finalStr);
            }
          }
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true } 
      });
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      const res = await fetch('/api/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp: pc.localDescription.sdp, type: pc.localDescription.type }),
      });
      const answer = await res.json();
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error('WebRTC error', err);
      stopWebRTC();
    }
  }, [stopWebRTC, onTranscriptFinal, onTranscriptInterim]);

  return { startWebRTC, stopWebRTC, transcriptRef };
}
