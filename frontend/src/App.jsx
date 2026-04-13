import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Trash2, Loader2, BrainCircuit, Upload, Mic, MicOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

// ─── helpers ─────────────────────────────────────────────────────────────────

const SESSION_ID = 'react_user';

function App() {
  // ── message history ────────────────────────────────────────────────────────
  const [messages, setMessages] = useState([
    {
      role: 'avatar',
      content:
        "Welcome to your Sales Training Simulator! I'm your Senior Sales Director. When you're ready, say 'Start Quiz' to receive your first scenario.",
      thoughts: null,
    },
  ]);

  const [inputValue, setInputValue] = useState('');

  // ── orb state: 'idle' | 'listening' | 'thinking' | 'speaking' ─────────────
  const [orbState, setOrbState] = useState('idle');

  // ── voice mode toggle ──────────────────────────────────────────────────────
  const [voiceModeActive, setVoiceModeActive] = useState(false);
  const voiceModeRef = useRef(false); // ref mirror so callbacks stay fresh

  // ── WebRTC (Deepgram STT) ──────────────────────────────────────────────────
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const transcriptRef = useRef('');

  // ── file upload ────────────────────────────────────────────────────────────
  const fileInputRef = useRef(null);

  // ── AudioContext (Cartesia TTS playback) ─────────────────────────────────
  const audioContextRef = useRef(null);
  const nextStartTimeRef = useRef(0);
  const isSpeakingRef = useRef(false); // true while AI audio is scheduled to play

  // ── Silero VAD ────────────────────────────────────────────────────────────
  const vadRef = useRef(null);

  // ── Control WebSocket (/ws/control) ─────────────────────────────────────
  const controlWsRef = useRef(null);

  // ── scroll anchor ─────────────────────────────────────────────────────────
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Control WebSocket: connect once on mount, reconnect on drop ───────────
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(
        `ws://${location.host}/ws/control?session_id=${SESSION_ID}`
      );
      ws.onopen = () => console.log('[Control WS] Connected');
      ws.onclose = () => {
        console.log('[Control WS] Disconnected – reconnecting in 2s…');
        setTimeout(connect, 2000);
      };
      ws.onerror = (e) => console.error('[Control WS] Error', e);
      controlWsRef.current = ws;
    };
    connect();
    return () => controlWsRef.current?.close();
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Audio helpers
  // ─────────────────────────────────────────────────────────────────────────

  const interruptAudio = useCallback(() => {
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close();
      } catch (e) {
        console.error('Audio stop error', e);
      }
    }
    audioContextRef.current = null;
    nextStartTimeRef.current = 0;
    isSpeakingRef.current = false;
    setOrbState((prev) => (prev === 'speaking' ? 'idle' : prev));
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // WebRTC / Deepgram STT helpers
  // ─────────────────────────────────────────────────────────────────────────

  const stopListening = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    dcRef.current = null;
  }, []);

  const startListening = useCallback(async () => {
    // Tear down any existing connection first
    stopListening();
    transcriptRef.current = '';
    setInputValue('');

    try {
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const dc = pc.createDataChannel('chat');
      dcRef.current = dc;

      dc.onmessage = (event) => {
        const received = JSON.parse(event.data);
        if (received.type === 'Results' && received.channel?.alternatives?.[0]) {
          const transcript = received.channel.alternatives[0].transcript;
          if (transcript) {
            if (received.is_final) {
              transcriptRef.current +=
                (transcriptRef.current ? ' ' : '') + transcript;
              setInputValue(transcriptRef.current);
            } else {
              setInputValue(
                transcriptRef.current +
                  (transcriptRef.current ? ' ' : '') +
                  transcript
              );
            }
          }
          // speech_final → turn is complete → trigger RAG pipeline
          if (received.speech_final) {
            const finalStr = transcriptRef.current.trim();
            if (finalStr.length > 0) {
              stopListening();
              // Signal backend: new turn starting
              controlWsRef.current?.send(
                JSON.stringify({ type: 'turn_start' })
              );
              handleSend(finalStr);
            }
          }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const response = await fetch('/api/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp: pc.localDescription.sdp,
          type: pc.localDescription.type,
        }),
      });
      const answer = await response.json();
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error('WebRTC error', err);
      alert('Microphone access denied or WebRTC failure.');
      stopListening();
    }
  }, [stopListening]);

  // ─────────────────────────────────────────────────────────────────────────
  // Silero VAD lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  const destroyVAD = useCallback(async () => {
    if (vadRef.current) {
      try {
        vadRef.current.pause();
        await vadRef.current.destroy?.();
      } catch (e) {
        // ignore
      }
      vadRef.current = null;
    }
  }, []);

  const initVAD = useCallback(async () => {
    await destroyVAD();

    const { MicVAD } = await import('@ricky0123/vad-web');

    const vad = await MicVAD.new({
      positiveSpeechThreshold: 0.8,
      negativeSpeechThreshold: 0.3,
      redemptionFrames: 8, // ~500 ms silence before speech_end fires

      onSpeechStart: () => {
        if (!voiceModeRef.current) return;
        console.log('[VAD] speech_start');

        // Barge-in: kill AI audio if it's playing
        if (isSpeakingRef.current) {
          interruptAudio();
          controlWsRef.current?.send(JSON.stringify({ type: 'barge_in' }));
        }

        // Start streaming to Deepgram
        setOrbState('listening');
        startListening();
      },

      onSpeechEnd: (_audio) => {
        if (!voiceModeRef.current) return;
        console.log('[VAD] speech_end – awaiting Deepgram speech_final');
        // Deepgram endpointing=500 will fire speech_final which calls handleSend
        setOrbState('thinking');
      },

      onVADMisfire: () => console.log('[VAD] misfire – too short'),
    });

    vadRef.current = vad;
    vad.start();
    console.log('[VAD] started');
    setOrbState('listening');
  }, [destroyVAD, interruptAudio, startListening]);

  // ─────────────────────────────────────────────────────────────────────────
  // Voice Mode toggle
  // ─────────────────────────────────────────────────────────────────────────

  const toggleVoiceMode = useCallback(async () => {
    const nextActive = !voiceModeRef.current;
    voiceModeRef.current = nextActive;
    setVoiceModeActive(nextActive);

    if (nextActive) {
      await initVAD();
    } else {
      await destroyVAD();
      stopListening();
      interruptAudio();
      setOrbState('idle');
    }
  }, [initVAD, destroyVAD, stopListening, interruptAudio]);

  // Tear down VAD on unmount
  useEffect(() => {
    return () => {
      destroyVAD();
    };
  }, [destroyVAD]);

  // ─────────────────────────────────────────────────────────────────────────
  // File upload (audio → WebRTC transcript) – unchanged logic
  // ─────────────────────────────────────────────────────────────────────────

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      transcriptRef.current = '';
      setInputValue('');

      const audioUrl = URL.createObjectURL(file);
      const audioEl = new Audio(audioUrl);
      audioEl.muted = true;
      await audioEl.play();

      const stream = audioEl.captureStream
        ? audioEl.captureStream()
        : audioEl.mozCaptureStream();

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      const dc = pc.createDataChannel('chat');
      dcRef.current = dc;

      dc.onmessage = (event) => {
        const received = JSON.parse(event.data);
        if (received.type === 'Results' && received.channel?.alternatives?.[0]) {
          const transcript = received.channel.alternatives[0].transcript;
          if (transcript) {
            if (received.is_final) {
              transcriptRef.current +=
                (transcriptRef.current ? ' ' : '') + transcript;
              setInputValue(transcriptRef.current);
            } else {
              setInputValue(
                transcriptRef.current +
                  (transcriptRef.current ? ' ' : '') +
                  transcript
              );
            }
          }
        }
      };

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const response = await fetch('/api/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp: pc.localDescription.sdp,
          type: pc.localDescription.type,
        }),
      });
      const answer = await response.json();
      await pc.setRemoteDescription(new RTCSessionDescription(answer));

      audioEl.onended = () => {
        setTimeout(() => {
          const finalStr = transcriptRef.current.trim();
          stopListening();
          if (finalStr.length > 0) handleSend(finalStr);
        }, 1000);
      };
    } catch (err) {
      console.error('File upload WebRTC error:', err);
      alert('Failed to inject audio file.');
      stopListening();
    }
    event.target.value = null;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Filler audio
  // ─────────────────────────────────────────────────────────────────────────

  const playLocalFiller = async (url, tSend) => {
    try {
      let audioCtx = audioContextRef.current;
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 44100,
        });
        audioContextRef.current = audioCtx;
      }
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);

      const tFillerStart = performance.now();
      const startTime = Math.max(nextStartTimeRef.current, audioCtx.currentTime);
      source.start(startTime);
      nextStartTimeRef.current = startTime + audioBuffer.duration;
      setOrbState('speaking');

      return {
        start: tFillerStart - tSend,
        end: tFillerStart - tSend + audioBuffer.duration * 1000,
      };
    } catch (e) {
      console.error('Filler playback error', e);
      return null;
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Main send handler
  // ─────────────────────────────────────────────────────────────────────────

  const handleSend = async (autoMessage = null) => {
    const textToSend =
      typeof autoMessage === 'string' ? autoMessage : inputValue.trim();
    if (!textToSend || orbState === 'thinking' || orbState === 'speaking') return;

    // Stop any current manual listening
    if (!voiceModeRef.current) stopListening();

    const tSend = performance.now();
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: textToSend, thoughts: null },
    ]);
    setInputValue('');
    transcriptRef.current = '';
    setOrbState('thinking');

    // Telemetry
    let telemetry = {
      query: textToSend,
      t_filler_start_ms: 0,
      t_filler_end_ms: 0,
      t_audio_start_ms: 0,
      t_llm_1st_ms: 0,
      t_llm_done_ms: 0,
    };

    const fillerTimer = setTimeout(async () => {
      const result = await playLocalFiller('/hmm-letsseee.wav', tSend);
      if (result) {
        telemetry.t_filler_start_ms = result.start;
        telemetry.t_filler_end_ms = result.end;
      }
    }, 200);

    try {
      const response = await fetch('/api/chat_stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: textToSend, session_id: SESSION_ID }),
      });

      if (!response.ok) throw new Error('Failed to connect');

      let msgIndex = null;
      setMessages((prev) => {
        msgIndex = prev.length;
        return [...prev, { role: 'avatar', content: '', thoughts: null }];
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

      let currentRaw = '';
      let isDone = false;
      let eventBuffer = '';

      let audioCtx = audioContextRef.current;
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 44100,
        });
        audioContextRef.current = audioCtx;
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      nextStartTimeRef.current = Math.max(
        nextStartTimeRef.current,
        audioCtx.currentTime
      );

      while (!isDone) {
        const { value, done } = await reader.read();
        if (done) break;

        eventBuffer += decoder.decode(value, { stream: true });
        const events = eventBuffer.split('\n\n');
        eventBuffer = events.pop();

        for (const event of events) {
          if (!event.startsWith('data: ')) continue;
          try {
            const payloadStr = event.substring(6).trim();
            if (payloadStr === '[DONE]') continue;
            const payload = JSON.parse(payloadStr);

            if (payload.type === 'chunk') {
              currentRaw += payload.content;

              let parsedContent = '';
              let parsedThoughts = null;

              const thoughtMatch = currentRaw.match(
                /<thought>([\s\S]*?)(?:<\/thought>|(?=<speech>)|$)/i
              );
              const speechMatch = currentRaw.match(
                /<speech>([\s\S]*?)(?:<\/speech>|$)/i
              );

              if (thoughtMatch) {
                parsedThoughts = thoughtMatch[1]
                  .replace(/<thought>|<\/thought>/gi, '')
                  .trim();
              }

              if (speechMatch) {
                setOrbState('speaking');
                parsedContent = speechMatch[1]
                  .replace(/<speech>|<\/speech>/gi, '')
                  .trim();
              } else if (currentRaw.includes('<speech>')) {
                setOrbState('speaking');
                const parts = currentRaw.split(/<speech>/i);
                parsedContent = parts[parts.length - 1]
                  .replace(/<\/speech>/gi, '')
                  .trim();
              } else if (currentRaw.includes('<thought>')) {
                parsedContent = '';
              } else {
                setOrbState('speaking');
                parsedContent = currentRaw;
              }

              setMessages((prev) => {
                const newArray = [...prev];
                newArray[msgIndex] = {
                  ...newArray[msgIndex],
                  content: parsedContent,
                  thoughts: parsedThoughts,
                };
                return newArray;
              });
            } else if (payload.type === 'audio_chunk') {
              clearTimeout(fillerTimer);
              isSpeakingRef.current = true;
              if (telemetry.t_audio_start_ms === 0) {
                telemetry.t_audio_start_ms = performance.now() - tSend;
              }

              try {
                const b64Data = payload.content;
                const binaryStr = atob(b64Data);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) {
                  bytes[i] = binaryStr.charCodeAt(i);
                }
                const floats = new Float32Array(
                  bytes.buffer,
                  bytes.byteOffset,
                  bytes.byteLength / 4
                );

                const audioBuffer = audioCtx.createBuffer(
                  1,
                  floats.length,
                  44100
                );
                audioBuffer.getChannelData(0).set(floats);

                const source = audioCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioCtx.destination);

                const startTime = Math.max(
                  nextStartTimeRef.current,
                  audioCtx.currentTime
                );
                source.start(startTime);
                nextStartTimeRef.current = startTime + audioBuffer.duration;
              } catch (ce) {
                console.error('Audio chunk decode error', ce);
              }
            } else if (payload.type === 'error') {
              throw new Error(payload.content);
            } else if (payload.type === 'done') {
              isDone = true;
              if (payload.server_metrics) {
                telemetry.t_llm_1st_ms =
                  payload.server_metrics.t_first_token * 1000;
                telemetry.t_llm_done_ms =
                  payload.server_metrics.t_llm_done * 1000;
              }
              fetch('/api/telemetry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(telemetry),
              }).catch((e) => console.error('Telemetry failed', e));
            }
          } catch (e) {
            // Unparseable / incomplete JSON – skip
          }
        }
      }

      // Wait for audio buffer to drain, then flip state
      let delayMs = 3000;
      if (audioContextRef.current) {
        const remaining =
          nextStartTimeRef.current - audioContextRef.current.currentTime;
        if (remaining > 0) delayMs = Math.ceil(remaining * 1000) + 500;
      }

      setTimeout(() => {
        isSpeakingRef.current = false;
        // Return to listening if voice mode is on, otherwise idle
        setOrbState(voiceModeRef.current ? 'listening' : 'idle');
        // If voice mode is on, re-arm Deepgram (VAD handles next speech_start)
      }, delayMs);
    } catch (error) {
      clearTimeout(fillerTimer);
      console.error(error);
      setMessages((prev) => {
        const newArray = [...prev];
        const last = newArray[newArray.length - 1];
        if (last.role === 'user') {
          newArray.push({
            role: 'avatar',
            content: 'Oops! Error connecting to the backend.',
            thoughts: null,
          });
        } else {
          last.content = 'Oops! Error connecting to the backend.';
        }
        return newArray;
      });
      isSpeakingRef.current = false;
      setOrbState(voiceModeRef.current ? 'listening' : 'idle');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Clear chat
  // ─────────────────────────────────────────────────────────────────────────

  const handleClear = async () => {
    try {
      if (orbState === 'thinking' || orbState === 'speaking') return;
      await fetch('/api/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '', session_id: SESSION_ID }),
      });
      setMessages([
        {
          role: 'avatar',
          content: 'Chat history cleared. How can I assist you now?',
          thoughts: null,
        },
      ]);
    } catch (error) {
      console.error('Failed to clear chat:', error);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Derived helpers
  // ─────────────────────────────────────────────────────────────────────────

  const isBusy = orbState === 'thinking' || orbState === 'speaking';
  const statusLabel = {
    idle: 'Online',
    listening: 'Listening…',
    thinking: 'Analyzing…',
    speaking: 'Speaking…',
  }[orbState];

  const statusColor = {
    idle: 'text-slate-50',
    listening: 'text-indigo-300',
    thinking: 'text-rose-400',
    speaking: 'text-emerald-400',
  }[orbState];

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950 text-slate-50 flex justify-center items-center p-4">
      <div className="flex flex-col md:flex-row w-full max-w-6xl h-[90vh] bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl rounded-3xl overflow-hidden">

        {/* ── Visualiser Panel ──────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col justify-center items-center border-b md:border-b-0 md:border-r border-white/5 relative overflow-hidden gap-8 py-8">
          <div className="absolute inset-0 bg-indigo-500/10 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />

          {/* Orb */}
          <div className="relative flex items-center justify-center z-10">
            {/* Outer ping ring – only in listening state */}
            {orbState === 'listening' && (
              <span className="absolute inline-flex h-52 w-52 rounded-full bg-indigo-500/20 animate-ping-slow" />
            )}

            <div
              className={[
                'relative w-48 h-48 rounded-full transition-all duration-300',
                orbState === 'idle'
                  ? 'bg-[radial-gradient(circle_at_30%_30%,#a5b4fc,#6366f1,#312e81)] animate-float shadow-[0_0_40px_rgba(99,102,241,0.6),inset_0_0_20px_rgba(255,255,255,0.5)]'
                  : '',
                orbState === 'listening'
                  ? 'bg-[radial-gradient(circle_at_30%_30%,#818cf8,#4f46e5,#1e1b4b)] animate-pulse-slow shadow-[0_0_60px_rgba(99,102,241,0.9),inset_0_0_20px_rgba(255,255,255,0.5)]'
                  : '',
                orbState === 'thinking'
                  ? 'bg-[radial-gradient(circle_at_30%_30%,#fda4af,#e11d48,#881337)] animate-pulse-fast shadow-[0_0_80px_rgba(244,63,94,0.6),inset_0_0_20px_rgba(255,255,255,0.5)]'
                  : '',
                orbState === 'speaking'
                  ? 'bg-[radial-gradient(circle_at_30%_30%,#6ee7b7,#10b981,#064e3b)] animate-wave shadow-[0_0_60px_rgba(52,211,153,0.6),inset_0_0_20px_rgba(255,255,255,0.5)]'
                  : '',
              ].join(' ')}
            />
          </div>

          {/* Status label */}
          <div className="uppercase tracking-widest text-sm font-semibold z-10 flex gap-2">
            <span className="text-slate-400">Status:</span>
            <span className={statusColor}>{statusLabel}</span>
          </div>

          {/* ── Voice Mode Button ──────────────────────────────────────── */}
          <button
            onClick={toggleVoiceMode}
            title={voiceModeActive ? 'Disable Voice Mode' : 'Enable Voice Mode'}
            className={[
              'z-10 relative flex flex-col items-center gap-2 px-8 py-4 rounded-2xl',
              'font-semibold text-sm tracking-wide transition-all duration-300',
              'border focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900',
              voiceModeActive
                ? [
                    'bg-indigo-500/20 border-indigo-400/60 text-indigo-200',
                    'shadow-[0_0_24px_rgba(99,102,241,0.5)]',
                    'focus:ring-indigo-400',
                    'hover:bg-indigo-500/30',
                  ].join(' ')
                : [
                    'bg-white/5 border-white/10 text-slate-400',
                    'hover:bg-white/10 hover:text-slate-200 hover:border-white/20',
                    'focus:ring-slate-400',
                  ].join(' '),
            ].join(' ')}
          >
            {/* Animated ring behind icon when active */}
            {voiceModeActive && (
              <span className="absolute inset-0 rounded-2xl bg-indigo-500/10 animate-pulse-slow pointer-events-none" />
            )}

            <div className="relative flex items-center gap-3">
              {voiceModeActive ? (
                <>
                  <div className="relative">
                    <Mic size={22} className="text-indigo-300" />
                    {/* Live dot */}
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-indigo-400 animate-ping" />
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-indigo-400" />
                  </div>
                  <span>Voice Mode On</span>
                </>
              ) : (
                <>
                  <MicOff size={22} />
                  <span>Enable Voice Mode</span>
                </>
              )}
            </div>

            <span className={`text-xs font-normal ${voiceModeActive ? 'text-indigo-300/70' : 'text-slate-500'}`}>
              {voiceModeActive ? 'Click to disable' : 'Continuous listening'}
            </span>
          </button>
        </div>

        {/* ── Chat Panel ────────────────────────────────────────────────── */}
        <div className="flex-[1.5] flex flex-col p-6 relative">

          {/* Clear button */}
          <div className="flex justify-end mb-4">
            <button
              onClick={handleClear}
              disabled={isBusy}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                !isBusy
                  ? 'text-rose-300 hover:text-white hover:bg-rose-500/20'
                  : 'text-slate-500 cursor-not-allowed'
              }`}
            >
              <Trash2 size={14} /> Clear Chat
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-6 pr-3 pb-4">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex max-w-[85%] flex-col gap-2 ${
                  msg.role === 'user' ? 'self-end' : 'self-start'
                }`}
              >
                {/* Reasoning Process */}
                {msg.role === 'avatar' && msg.thoughts !== null && (
                  <div className="w-full mb-1">
                    <div className="text-xs font-mono bg-black/60 border border-white/5 p-4 rounded-2xl text-slate-300 shadow-inner flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-indigo-400/80 font-bold uppercase tracking-widest text-[10px]">
                        {!msg.content && orbState === 'thinking' ? (
                          <Loader2 className="animate-spin" size={12} />
                        ) : (
                          <BrainCircuit size={12} />
                        )}
                        Reasoning Process
                      </div>
                      <div className="whitespace-pre-wrap leading-relaxed opacity-70 text-[12px] italic">
                        {msg.thoughts || 'Evaluating Sales Scenarios…'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Speech bubble */}
                {(msg.role === 'user' || msg.content) && (
                  <div
                    className={`p-5 rounded-2xl shadow-xl leading-relaxed text-[15px] ${
                      msg.role === 'user'
                        ? 'bg-gradient-to-br from-indigo-500 to-indigo-800 text-white rounded-br-sm'
                        : 'bg-white/5 border border-white/10 text-slate-200 rounded-bl-sm'
                    }`}
                  >
                    {msg.content ? (
                      <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10 prose-headings:text-indigo-300">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : msg.role === 'avatar' &&
                      (orbState === 'thinking' || orbState === 'speaking') ? (
                      <div className="flex gap-1.5 items-center py-2">
                        <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" />
                        <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                        <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                      </div>
                    ) : (
                      ''
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Input bar */}
          <div className="mt-4 flex gap-3 items-center bg-black/20 p-2 pl-4 rounded-full border border-white/5">
            <input
              type="text"
              className="flex-1 bg-transparent border-none outline-none text-white placeholder-slate-400 disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder={
                orbState === 'listening'
                  ? 'Listening…'
                  : isBusy
                  ? 'Processing…'
                  : 'Type your message…'
              }
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              disabled={isBusy}
            />

            {/* Send */}
            <button
              onClick={() => handleSend()}
              disabled={isBusy || voiceModeActive}
              title="Send message"
              className={`p-2.5 rounded-full transition-colors ${
                !isBusy && !voiceModeActive
                  ? 'text-indigo-400 hover:text-white hover:bg-indigo-500/20'
                  : 'text-slate-500 cursor-not-allowed'
              }`}
            >
              <Send size={18} />
            </button>

            {/* Audio file upload */}
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              title="Upload Audio File (Library Mode)"
              className={`p-2.5 rounded-full transition-colors mr-1 ${
                !isBusy
                  ? 'text-slate-400 hover:text-white hover:bg-slate-500/20'
                  : 'text-slate-500 cursor-not-allowed'
              }`}
            >
              <Upload size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
