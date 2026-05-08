import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Trash2,
  Loader2,
  BrainCircuit,
  Mic,
  MicOff,
  Sparkles,
  Bot
} from 'lucide-react';
import Markdown from 'react-markdown';
import { PhotorealisticAvatar } from './components/CartoonAvatar';
import { ipaToViseme } from './avatarUtils';
import { useBlinkMachine } from './useBlinkMachine';
import './App.css';

const SESSION_ID = 'react_user';

function App() {
  // ─── State ────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState([
    {
      role: 'avatar',
      content: "Welcome back. I am your Sales Tutor. Ready for your next scenario?",
      thoughts: null,
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [orbState, setOrbState] = useState('idle');
  const [activeViseme, setActiveViseme] = useState('IDLE');
  const [voiceModeActive, setVoiceModeActive] = useState(false);
  const eyeState = useBlinkMachine();

  // ─── Refs ─────────────────────────────────────────────────────────────────
  const audioContextRef = useRef(null);
  const nextStartTimeRef = useRef(0);
  const isSpeakingRef = useRef(false);
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const transcriptRef = useRef('');
  const vadRef = useRef(null);
  const controlWsRef = useRef(null);
  const voiceModeRef = useRef(false);
  const visemeQueueRef = useRef([]);
  const animFrameRef = useRef(null);
  const segStartTimesRef = useRef({});
  const lastSegIdxRef = useRef(null);
  const speakingTimeoutRef = useRef(null);
  // ─── Barge-in control refs ─────────────────────────────────────────────────
  const isBusyRef = useRef(false);      // synchronous guard against double-sends
  const orbStateRef = useRef('idle');   // mirror of orbState for sync reads inside VAD callbacks
  const streamGenRef = useRef(0);       // incremented per response stream; stale audio chunks are discarded

  // Keep orbStateRef in sync so VAD callbacks can read state synchronously
  useEffect(() => { orbStateRef.current = orbState; }, [orbState]);

  // ─── Helper Functions ─────────────────────────────────────────────────────

  const interruptAudio = useCallback(() => {
    if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try { audioContextRef.current.close(); } catch (_) { }
    }
    audioContextRef.current = null;
    nextStartTimeRef.current = 0;
    isSpeakingRef.current = false;
    visemeQueueRef.current = [];
    segStartTimesRef.current = {};
    setActiveViseme('IDLE');
    setOrbState(prev => (prev === 'speaking' ? 'idle' : prev));
  }, []);

  const stopListening = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    dcRef.current = null;
  }, []);

  const handleSend = useCallback(async (autoMessage = null) => {
    const text = typeof autoMessage === 'string' ? autoMessage : inputValue.trim();
    // Fix #1: use a ref-based guard so the check is always synchronous.
    // The old orbState check was stale inside async closures.
    if (!text || isBusyRef.current) return;
    isBusyRef.current = true;
    // Fix #5: stamp this stream so stale audio chunks from a cancelled
    // response can be detected and discarded.
    const myGen = ++streamGenRef.current;

    if (!voiceModeRef.current) stopListening();

    setMessages(prev => [...prev, { role: 'user', content: text, thoughts: null }]);
    setInputValue('');
    transcriptRef.current = '';
    setOrbState('thinking');

    visemeQueueRef.current = [];
    segStartTimesRef.current = {};
    lastSegIdxRef.current = null;

    try {
      const response = await fetch('/api/chat_stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, session_id: SESSION_ID }),
      });
      if (!response.ok) throw new Error('Stream failed');

      setMessages(prev => [...prev, { role: 'avatar', content: '', thoughts: null }]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let currentRaw = '', isDone = false, eventBuffer = '';

      let audioCtx = audioContextRef.current;
      if (!audioCtx || audioCtx.state === 'closed') {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
        audioContextRef.current = audioCtx;
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioCtx.currentTime);

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
              let parsedContent = '', parsedThoughts = null;

              const thoughtMatch = currentRaw.match(/<thought>([\s\S]*?)<\/thought>/i) || currentRaw.match(/<thought>([\s\S]*)$/i);
              const speechMatch = currentRaw.match(/<speech>([\s\S]*?)<\/speech>/i) || currentRaw.match(/<speech>([\s\S]*)$/i);

              if (thoughtMatch) parsedThoughts = thoughtMatch[1].trim();
              if (speechMatch) {
                setOrbState('speaking');
                parsedContent = speechMatch[1].trim();
              } else if (!currentRaw.includes('<thought>')) {
                setOrbState('speaking');
                parsedContent = currentRaw;
              }

              setMessages(prev => {
                const arr = [...prev];
                const target = arr[arr.length - 1];
                if (target && target.role === 'avatar') {
                  arr[arr.length - 1] = { ...target, content: parsedContent, thoughts: parsedThoughts };
                }
                return arr;
              });

            } else if (payload.type === 'audio_chunk') {
              // Fix #5: discard chunks that belong to a cancelled stream
              if (streamGenRef.current !== myGen) continue;
              isSpeakingRef.current = true;
              const b64 = payload.content;
              const bin = atob(b64);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              const floats = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
              const audioBuf = audioCtx.createBuffer(1, floats.length, 44100);
              audioBuf.getChannelData(0).set(floats);

              const src = audioCtx.createBufferSource();
              src.buffer = audioBuf;
              src.connect(audioCtx.destination);
              const startTime = Math.max(nextStartTimeRef.current, audioCtx.currentTime);
              src.start(startTime);

              const seg = payload.seg ?? 0;
              if (segStartTimesRef.current[seg] === undefined) segStartTimesRef.current[seg] = startTime;
              lastSegIdxRef.current = seg;
              nextStartTimeRef.current = startTime + audioBuf.duration;

            } else if (payload.type === 'phoneme_timestamps') {
              if (streamGenRef.current !== myGen) continue;
              const { phonemes, start, end } = payload.content;
              const seg = payload.seg ?? lastSegIdxRef.current ?? 0;
              const baseTime = segStartTimesRef.current[0] ?? audioCtx.currentTime;

              phonemes.forEach((phoneme, pi) => {
                const pAbsStart = baseTime + start[pi];
                const viseme = ipaToViseme(phoneme);
                visemeQueueRef.current.push({ viseme, absoluteTime: pAbsStart });
              });
              visemeQueueRef.current.sort((a, b) => a.absoluteTime - b.absoluteTime);

            } else if (payload.type === 'done') {
              isDone = true;
            }
          } catch (e) {
            console.error('Event parsing error', e);
          }
        }
      }

      if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);

      let waitTime = 1000;
      if (audioContextRef.current) {
        const remainingTime = nextStartTimeRef.current - audioContextRef.current.currentTime;
        if (remainingTime > 0) {
          waitTime = (remainingTime * 1000) + 500; // Add 500ms safety buffer
        }
      }

      speakingTimeoutRef.current = setTimeout(() => {
        isSpeakingRef.current = false;
        isBusyRef.current = false; // Fix #1: release the lock when audio finishes
        setOrbState(voiceModeRef.current ? 'listening' : 'idle');
      }, waitTime);

    } catch (error) {
      console.error('Chat error', error);
      isSpeakingRef.current = false;
      isBusyRef.current = false; // Fix #1: release the lock on error
      setOrbState(voiceModeRef.current ? 'listening' : 'idle');
    }
  }, [inputValue, stopListening]); // orbState removed: guard now uses isBusyRef

  const startWebRTC = useCallback(async () => {
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
          const t = received.channel.alternatives[0].transcript;
          if (t) {
            if (received.is_final) {
              transcriptRef.current += (transcriptRef.current ? ' ' : '') + t;
              setInputValue(transcriptRef.current);
            } else {
              setInputValue(transcriptRef.current + (transcriptRef.current ? ' ' : '') + t);
            }
          }
          if (received.speech_final) {
            const finalStr = transcriptRef.current.trim();
            if (finalStr.length > 0) {
              transcriptRef.current = '';
              // Fix #2: 'turn_start' was sent immediately after 'barge_in', creating a
              // race where the server cleared cancel_event before the old LLM loop
              // could check it. The cancel_event is now cleared only inside
              // chat_stream_generator at the start of the new request.
              handleSend(finalStr);
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
      stopListening();
    }
  }, [stopListening, handleSend]);

  const destroyVAD = useCallback(async () => {
    if (vadRef.current) {
      try { vadRef.current.pause(); await vadRef.current.destroy?.(); } catch (_) { }
      vadRef.current = null;
    }
  }, []);

  const initVAD = useCallback(async () => {
    await destroyVAD();
    const { MicVAD } = await import('@ricky0123/vad-web');

    // Tell ONNX where to find the WebAssembly files
    if (window.ort && window.ort.env && window.ort.env.wasm) {
      window.ort.env.wasm.wasmPaths = '/';
    }

    const vad = await MicVAD.new({
      workletURL: '/vad.worklet.bundle.min.js',
      modelURL: '/silero_vad_v5.onnx',
      positiveSpeechThreshold: 0.8,
      negativeSpeechThreshold: 0.3,
      redemptionFrames: 8,
      onSpeechStart: () => {
        if (!voiceModeRef.current) return;
        // Fix #3: isSpeakingRef can be false at the very start of speech onset
        // (before the first audio_chunk sets it). Use orbStateRef for a synchronous
        // read of the current UI state as a broader fallback.
        const currentState = orbStateRef.current;
        if (isSpeakingRef.current || currentState === 'speaking' || currentState === 'thinking') {
          interruptAudio();
          // Fix #1: release the busy lock so the barge-in can trigger handleSend
          isBusyRef.current = false;
          controlWsRef.current?.send(JSON.stringify({ type: 'barge_in' }));
        }
        setOrbState('listening');
        transcriptRef.current = '';
        setInputValue('');
      },
      onSpeechEnd: () => {
        if (!voiceModeRef.current) return;
        // Deepgram speech_final handles the true end of turn and sends to LLM.
      },
    });
    vadRef.current = vad;
    vad.start();
    setOrbState('listening');
  }, [destroyVAD, interruptAudio]);

  const toggleVoiceMode = useCallback(async () => {
    const next = !voiceModeRef.current;
    voiceModeRef.current = next;
    setVoiceModeActive(next);
    if (next) {
      startWebRTC();
      await initVAD();
    } else {
      await destroyVAD();
      stopListening();
      interruptAudio();
      setOrbState('idle');
    }
  }, [startWebRTC, initVAD, destroyVAD, stopListening, interruptAudio]);

  const driveVisemes = useCallback(() => {
    if (!audioContextRef.current) return;
    const now = audioContextRef.current.currentTime;
    
    // Viseme Sync
    const queue = visemeQueueRef.current;
    while (queue.length > 0 && queue[0].absoluteTime <= now) {
      setActiveViseme(queue.shift().viseme);
    }
    if (queue.length === 0 && !isSpeakingRef.current) {
      setActiveViseme('IDLE');
    }

    animFrameRef.current = requestAnimationFrame(driveVisemes);
  }, []);

  // ─── Effects ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(`ws://${location.host}/ws/control?session_id=${SESSION_ID}`);
      ws.onopen = () => console.log('Control WS Connected');
      ws.onclose = () => setTimeout(connect, 2000);
      controlWsRef.current = ws;
    };
    connect();
    return () => controlWsRef.current?.close();
  }, []);

  useEffect(() => {
    if (orbState === 'speaking') {
      animFrameRef.current = requestAnimationFrame(driveVisemes);
    } else {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      setActiveViseme('IDLE');
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [orbState, driveVisemes]);

  useEffect(() => () => { destroyVAD(); }, [destroyVAD]);

  const handleClear = async () => {
    try {
      await fetch('/api/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '', session_id: SESSION_ID }),
      });
      setMessages([{ role: 'avatar', content: 'Chat history cleared.', thoughts: null }]);
    } catch (e) { }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  const statusLabel = {
    idle: 'System Online',
    listening: 'Listening to you...',
    thinking: 'Analyzing input...',
    speaking: 'Avatar Speaking...'
  }[orbState];
  
  const statusColor = {
    idle: 'bg-indigo-500 shadow-indigo-500/50',
    listening: 'bg-indigo-400 shadow-indigo-400/80 animate-pulse',
    thinking: 'bg-rose-500 shadow-rose-500/80 animate-pulse',
    speaking: 'bg-emerald-500 shadow-emerald-500/80'
  }[orbState];

  return (
    <div className="min-h-screen bg-[#0a0f1c] bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-900/20 via-[#0a0f1c] to-[#0a0f1c] text-slate-100 font-sans flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-7xl h-[85vh] bg-slate-900/40 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] shadow-[0_0_80px_rgba(79,70,229,0.15)] flex flex-col lg:flex-row overflow-hidden relative">
        
        {/* Left: Avatar Panel */}
        <div className="flex-1 lg:flex-[0.8] border-b lg:border-b-0 lg:border-r border-white/5 relative flex flex-col items-center justify-center p-8 bg-gradient-to-b from-indigo-500/5 to-transparent">
          <div className="absolute top-8 left-8 flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full shadow-lg transition-colors duration-300 ${statusColor}`} />
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">{statusLabel}</span>
          </div>

          <div className="relative w-full max-w-[320px] aspect-square flex items-center justify-center">
            {/* Ambient glow */}
            <div className={`absolute inset-0 rounded-full blur-3xl opacity-20 transition-colors duration-1000 ${statusColor}`} />
            <PhotorealisticAvatar viseme={activeViseme} eyeState={eyeState} orbState={orbState} />
          </div>

          <button
            onClick={toggleVoiceMode}
            className={`mt-12 px-8 py-4 rounded-2xl flex items-center gap-3 font-semibold text-sm transition-all duration-300 backdrop-blur-md border ${
              voiceModeActive 
                ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-200 hover:bg-indigo-500/30 shadow-[0_0_30px_rgba(99,102,241,0.2)]' 
                : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200'
            }`}
          >
            {voiceModeActive ? <Mic size={18} /> : <MicOff size={18} />}
            {voiceModeActive ? 'Voice Mode Active' : 'Enable Voice Mode'}
          </button>
        </div>

        {/* Right: Chat Panel */}
        <div className="flex-[1.2] flex flex-col relative bg-black/20">
          {/* Chat Header */}
          <div className="px-8 py-6 border-b border-white/5 flex justify-between items-center bg-white/5 backdrop-blur-sm z-10">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/20 rounded-lg border border-indigo-500/20 text-indigo-400">
                <Bot size={20} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-100 leading-tight">Sales Tutor</h2>
                <p className="text-xs text-slate-400">Interactive Training Session</p>
              </div>
            </div>
            <button onClick={handleClear} className="text-rose-400/70 hover:text-rose-400 transition-colors flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl hover:bg-rose-500/10">
              <Trash2 size={16} />
              Clear
            </button>
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-8 scroll-smooth">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex max-w-[85%] flex-col gap-2 ${msg.role === 'user' ? 'self-end' : 'self-start'}`}>
                {msg.role === 'avatar' && msg.thoughts && (
                  <div className="bg-black/40 backdrop-blur-md border border-white/5 rounded-2xl p-5 text-sm text-slate-300 font-mono shadow-inner">
                    <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold uppercase tracking-wider mb-2">
                      <Sparkles size={14} /> Strategic Analysis
                    </div>
                    <div className="opacity-80 leading-relaxed">{msg.thoughts}</div>
                  </div>
                )}
                <div className={`p-5 rounded-2xl shadow-lg leading-relaxed text-[15px] ${
                  msg.role === 'user' 
                    ? 'bg-indigo-600 text-white rounded-br-sm' 
                    : 'bg-white/10 border border-white/10 text-slate-200 rounded-bl-sm backdrop-blur-md'
                }`}>
                  {msg.content ? (
                    <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10">
                      <Markdown>{msg.content}</Markdown>
                    </div>
                  ) : msg.role === 'avatar' && (
                    <div className="flex gap-2 items-center py-2 px-1">
                      <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" />
                      <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.15s]" />
                      <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.3s]" />
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={(el) => el && el.scrollIntoView({ behavior: 'smooth' })} />
          </div>

          {/* Chat Input */}
          <div className="p-6 bg-gradient-to-t from-black/40 to-transparent">
            <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-2 flex items-center shadow-2xl focus-within:bg-white/10 focus-within:border-indigo-500/50 transition-all duration-300">
              <input
                type="text"
                className="flex-1 bg-transparent border-none outline-none text-slate-100 placeholder-slate-500 px-4 py-2 font-light"
                placeholder="Type your response..."
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
              />
              <button
                onClick={() => handleSend()}
                disabled={!inputValue.trim() || orbState === 'thinking'}
                className="p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
