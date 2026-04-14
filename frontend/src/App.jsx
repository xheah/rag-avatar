import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Send, 
  Trash2, 
  Loader2, 
  BrainCircuit, 
  Mic, 
  MicOff 
} from 'lucide-react';
import Markdown from 'react-markdown';
import { CartoonAvatar } from './components/CartoonAvatar';
import { wordToVisemes } from './avatarUtils';

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

  // ─── Refs ─────────────────────────────────────────────────────────────────
  const audioContextRef = useRef(null);
  const nextStartTimeRef = useRef(0);
  const isSpeakingRef = useRef(false);
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const transcriptRef = useRef('');
  const vadRef = useRef(null);
  const controlWsRef = useRef(null);
  const chatEndRef = useRef(null);
  const voiceModeRef = useRef(false);
  const visemeQueueRef = useRef([]);
  const animFrameRef = useRef(null);
  const segStartTimesRef = useRef({});
  const lastSegIdxRef = useRef(null);

  // ─── Formatting ───────────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ─── Helper Functions ─────────────────────────────────────────────────────

  const interruptAudio = useCallback(() => {
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try { audioContextRef.current.close(); } catch (_) {}
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
    if (!text || orbState === 'thinking' || orbState === 'speaking') return;

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

            } else if (payload.type === 'word_timestamps') {
              const { words, start, end } = payload.content;
              const seg = payload.seg ?? lastSegIdxRef.current ?? 0;
              const baseTime = segStartTimesRef.current[seg] ?? audioCtx.currentTime;

              words.forEach((word, wi) => {
                const wordAbsStart = baseTime + start[wi];
                const wordDuration = end[wi] - start[wi];
                const visemes = wordToVisemes(word);
                const timePerVis = wordDuration / Math.max(visemes.length, 1);
                visemes.forEach((viseme, vi) => {
                  visemeQueueRef.current.push({ viseme, absoluteTime: wordAbsStart + vi * timePerVis });
                });
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

      setTimeout(() => {
        isSpeakingRef.current = false;
        setOrbState(voiceModeRef.current ? 'listening' : 'idle');
      }, 1000);

    } catch (error) {
      console.error('Chat error', error);
      isSpeakingRef.current = false;
      setOrbState(voiceModeRef.current ? 'listening' : 'idle');
    }
  }, [inputValue, orbState, stopListening]);

  const startListening = useCallback(async () => {
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
              stopListening();
              controlWsRef.current?.send(JSON.stringify({ type: 'turn_start' }));
              handleSend(finalStr);
            }
          }
        }
      };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      try { vadRef.current.pause(); await vadRef.current.destroy?.(); } catch (_) {}
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
        if (isSpeakingRef.current) {
          interruptAudio();
          controlWsRef.current?.send(JSON.stringify({ type: 'barge_in' }));
        }
        setOrbState('listening');
        startListening();
      },
      onSpeechEnd: () => {
        if (!voiceModeRef.current) return;
        setOrbState('thinking');
      },
    });
    vadRef.current = vad;
    vad.start();
    setOrbState('listening');
  }, [destroyVAD, interruptAudio, startListening]);

  const toggleVoiceMode = useCallback(async () => {
    const next = !voiceModeRef.current;
    voiceModeRef.current = next;
    setVoiceModeActive(next);
    if (next) {
      await initVAD();
    } else {
      await destroyVAD();
      stopListening();
      interruptAudio();
      setOrbState('idle');
    }
  }, [initVAD, destroyVAD, stopListening, interruptAudio]);

  const driveVisemes = useCallback(() => {
    if (!audioContextRef.current) return;
    const now = audioContextRef.current.currentTime;
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
    } catch (e) {}
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  const statusLabel = { idle: 'Online', listening: 'Listening…', thinking: 'Analyzing…', speaking: 'Speaking…' }[orbState];
  const miniOrbClass = {
    idle: 'bg-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.8)]',
    listening: 'bg-indigo-400 shadow-[0_0_12px_rgba(99,102,241,1)] animate-pulse',
    thinking: 'bg-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.9)] animate-pulse',
    speaking: 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]',
  }[orbState];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950 text-slate-50 flex justify-center items-center p-4 font-sans">
      <div className="flex flex-col md:flex-row w-full max-w-6xl h-[90vh] bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl rounded-3xl overflow-hidden">
        
        {/* Avatar Panel */}
        <div className="flex-1 flex flex-col justify-center items-center border-b md:border-b-0 md:border-r border-white/5 relative overflow-hidden gap-4 py-8">
          <div className="absolute inset-0 bg-indigo-500/10 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
          <div className="z-10 flex flex-col items-center">
            <div className={`w-4 h-4 rounded-full mb-1 transition-all duration-300 ${miniOrbClass}`} />
            <div className="uppercase tracking-widest text-[10px] font-semibold text-slate-400 mb-3">{statusLabel}</div>
          </div>
          <div className="z-10"><CartoonAvatar viseme={activeViseme} orbState={orbState} /></div>
          <button
            onClick={toggleVoiceMode}
            className={`z-10 relative flex flex-col items-center gap-2 px-8 py-3 rounded-2xl mt-4 font-semibold text-sm tracking-wide transition-all border ${
              voiceModeActive ? 'bg-indigo-500/20 border-indigo-400/60 text-indigo-200' : 'bg-white/5 border-white/10 text-slate-400'
            }`}
          >
            <div className="flex items-center gap-3">{voiceModeActive ? <><Mic size={20} /><span>Active</span></> : <><MicOff size={20} /><span>Voice Mode</span></>}</div>
          </button>
        </div>

        {/* Chat Panel */}
        <div className="flex-[1.5] flex flex-col p-6 relative">
          <div className="flex justify-end mb-4"><button onClick={handleClear} className="text-rose-300 hover:text-white text-xs flex items-center gap-1"><Trash2 size={14} /> Clear</button></div>
          <div className="flex-1 overflow-y-auto flex flex-col gap-6 pr-3 pb-4">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex max-w-[85%] flex-col gap-2 ${msg.role === 'user' ? 'self-end' : 'self-start'}`}>
                {msg.role === 'avatar' && msg.thoughts && (
                  <div className="text-xs font-mono bg-black/40 border border-white/5 p-4 rounded-2xl text-slate-300">
                    <div className="text-indigo-400 font-bold mb-1 uppercase tracking-tighter text-[10px]">Strategic Analysis</div>
                    <div className="opacity-70 italic">{msg.thoughts}</div>
                  </div>
                )}
                <div className={`p-5 rounded-2xl shadow-xl leading-relaxed text-[15px] ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white/10 border border-white/10 text-slate-200'}`}>
                  {msg.content ? (
                    <div className="prose prose-invert max-w-none">
                      <Markdown>{msg.content}</Markdown>
                    </div>
                  ) : msg.role === 'avatar' && (
                    <div className="flex gap-2 items-center py-2">
                      <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" />
                      <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                      <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="mt-4 flex gap-3 bg-black/20 p-2 pl-4 rounded-full border border-white/5">
            <input 
              type="text" className="flex-1 bg-transparent border-none outline-none text-white placeholder-slate-400" 
              placeholder="Type here..." value={inputValue} onChange={e => setInputValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} 
            />
            <button onClick={() => handleSend()} className="p-2 text-indigo-400 hover:bg-white/5 rounded-full"><Send size={18} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
