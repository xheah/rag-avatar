import { useState, useRef, useEffect } from 'react';
import { Send, Mic, Trash2, Loader2, BrainCircuit, Upload } from 'lucide-react';

function App() {
  const [messages, setMessages] = useState([
    { role: 'avatar', content: 'Hello there! I am your AI Agency Avatar. How can I assist you with your integration projects today?', thoughts: null }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [orbState, setOrbState] = useState('idle'); // idle, thinking, speaking
  
  // Voice State
  const [isListening, setIsListening] = useState(false);
  const mediaRecorderRef = useRef(null);
  const sttSocketRef = useRef(null);
  const transcriptRef = useRef('');
  const fileInputRef = useRef(null);
  
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const stopListening = () => {
    setIsListening(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    if (sttSocketRef.current && sttSocketRef.current.readyState === WebSocket.OPEN) {
      sttSocketRef.current.close();
    }
  };

  const startListening = async () => {
    try {
      transcriptRef.current = '';
      setInputValue('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/api/stt`;
      const socket = new WebSocket(wsUrl);
      sttSocketRef.current = socket;

      socket.onopen = () => {
        setIsListening(true);
        mediaRecorder.addEventListener('dataavailable', event => {
          if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
            socket.send(event.data);
          }
        });
        mediaRecorder.start(250); // Send raw WebM chunks to Deepgram every 250ms
      };

      socket.onmessage = (event) => {
        const received = JSON.parse(event.data);
        if (received.type === 'Results' && received.channel?.alternatives?.[0]) {
            const transcript = received.channel.alternatives[0].transcript;
            
            if (transcript) {
                if (received.is_final) {
                    transcriptRef.current += (transcriptRef.current ? ' ' : '') + transcript;
                    setInputValue(transcriptRef.current);
                } else {
                    setInputValue(transcriptRef.current + (transcriptRef.current ? ' ' : '') + transcript);
                }
            }

            if (received.speech_final) {
                const finalStr = transcriptRef.current.trim();
                if (finalStr.length > 0) {
                    stopListening();
                    handleSend(finalStr);
                }
            }
        }
      };

      socket.onerror = (e) => {
          console.error("STT WebSocket Error:", e);
          stopListening();
      };
      
    } catch (err) {
      console.error("Error accessing microphone", err);
      alert("Microphone access denied or unavailable.");
      stopListening();
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
      transcriptRef.current = '';
      setInputValue('');
      setIsListening(true);
      
      const audioUrl = URL.createObjectURL(file);
      const audioEl = new Audio(audioUrl);
      audioEl.muted = true; // Play silently
      await audioEl.play();

      // Capture stream from playing audio
      const stream = audioEl.captureStream ? audioEl.captureStream() : audioEl.mozCaptureStream();
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/api/stt`;
      const socket = new WebSocket(wsUrl);
      sttSocketRef.current = socket;

      socket.onopen = () => {
        mediaRecorder.addEventListener('dataavailable', e => {
          if (e.data.size > 0 && socket.readyState === WebSocket.OPEN) {
            socket.send(e.data);
          }
        });
        mediaRecorder.start(250); 
      };

      audioEl.onended = () => {
         // File playback finished. Give Deepgram 500ms to return final words, 
         // then force a send because the stream won't have trailing silence to trigger speech_final naturally.
         setTimeout(() => {
             const finalStr = transcriptRef.current.trim();
             stopListening();
             if (finalStr.length > 0) {
                 handleSend(finalStr);
             }
         }, 500);
      };

      socket.onmessage = (event) => {
        const received = JSON.parse(event.data);
        if (received.type === 'Results' && received.channel?.alternatives?.[0]) {
            const transcript = received.channel.alternatives[0].transcript;
            
            if (transcript) {
                if (received.is_final) {
                    transcriptRef.current += (transcriptRef.current ? ' ' : '') + transcript;
                    setInputValue(transcriptRef.current);
                } else {
                    setInputValue(transcriptRef.current + (transcriptRef.current ? ' ' : '') + transcript);
                }
            }

            if (received.speech_final) {
                const finalStr = transcriptRef.current.trim();
                if (finalStr.length > 0) {
                    stopListening();
                    handleSend(finalStr);
                }
            }
        }
      };

      socket.onerror = (e) => {
          console.error("STT WebSocket Error:", e);
          stopListening();
      };
      
    } catch (err) {
      console.error("Error with file test:", err);
      alert("Failed to inject audio file.");
      stopListening();
    }
    // clear input
    event.target.value = null;
  };

  const toggleListen = () => {
      if (orbState !== 'idle') return;
      if (isListening) stopListening();
      else startListening();
  };

  const handleSend = async (autoMessage = null) => {
    const textToSend = typeof autoMessage === 'string' ? autoMessage : inputValue.trim();
    if (!textToSend || orbState !== 'idle') return;

    if (isListening) stopListening();

    setMessages(prev => [...prev, { role: 'user', content: textToSend, thoughts: null }]);
    setInputValue('');
    transcriptRef.current = '';
    setOrbState('thinking');

    try {
      const response = await fetch('/api/chat_stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: textToSend, session_id: "react_user" })
      });

      if (!response.ok) throw new Error("Failed to connect");

      let msgIndex = null;
      setMessages(prev => {
        msgIndex = prev.length;
        return [...prev, { role: 'avatar', content: '', thoughts: null }];
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      
      let currentRaw = "";
      let route = "CHAT";
      let isDone = false;

      while (!isDone) {
        const { value, done } = await reader.read();
        if (done) break;
        
        const chunkString = decoder.decode(value, { stream: true });
        const events = chunkString.split('\n\n');
        
        for (const event of events) {
          if (!event.startsWith('data: ')) continue;
          
          try {
            const payload = JSON.parse(event.substring(6));
            
            if (payload.type === 'route') {
              route = payload.route;
            } else if (payload.type === 'chunk') {
              currentRaw += payload.content;
              
              let parsedContent = "";
              let parsedThoughts = null;

              if (route === 'RAG') {
                const thoughtMatch = currentRaw.match(/<thought>([\s\S]*?)(?:<\/thought>|<speech>|$)/i);
                const speechMatch = currentRaw.match(/<speech>([\s\S]*?)(?:<\/speech>|$)/i);
                
                if (thoughtMatch && thoughtMatch[1].trim().length > 0) {
                    parsedThoughts = thoughtMatch[1].trim();
                } else if (currentRaw.includes('<thought>') && !currentRaw.includes('<speech>')) {
                    parsedThoughts = "";
                }

                if (speechMatch) {
                  setOrbState('speaking');
                  parsedContent = speechMatch[1].trim();
                } else if (!currentRaw.includes('<speech>') && !currentRaw.includes('<thought>') && currentRaw.length > 20) {
                  setOrbState('speaking');
                  parsedContent = currentRaw;
                } else {
                  setOrbState('thinking');
                }
              } else {
                setOrbState('speaking');
                parsedContent = currentRaw;
              }

              setMessages(prev => {
                const newArray = [...prev];
                newArray[msgIndex] = { ...newArray[msgIndex], content: parsedContent, thoughts: parsedThoughts };
                return newArray;
              });

            } else if (payload.type === 'error') {
              throw new Error(payload.content);
            } else if (payload.type === 'done') {
              isDone = true;
            }
          } catch (e) {
            // Unparseable or incomplete JSON is ignored
          }
        }
      }

      setTimeout(() => setOrbState('idle'), 3000);

    } catch (error) {
      console.error(error);
      setMessages(prev => {
        const newArray = [...prev];
        if (newArray[newArray.length - 1].role === 'user') {
            newArray.push({ role: 'avatar', content: 'Oops! Error connecting to the backend.', thoughts: null })
        } else {
            newArray[newArray.length - 1].content = 'Oops! Error connecting to the backend.';
        }
        return newArray;
      });
      setOrbState('idle');
    }
  };

  const handleClear = async () => {
    try {
      if (orbState !== 'idle') return;
      await fetch('/api/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: "", session_id: "react_user" })
      });
      setMessages([{ role: 'avatar', content: 'Chat history cleared. How can I assist you now?', thoughts: null }]);
    } catch (error) {
      console.error("Failed to clear chat:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950 text-slate-50 flex justify-center items-center p-4">
      
      <div className="flex flex-col md:flex-row w-full max-w-6xl h-[90vh] bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl rounded-3xl overflow-hidden">
        
        {/* Visualizer Panel */}
        <div className="flex-1 flex flex-col justify-center items-center border-b md:border-b-0 md:border-r border-white/5 relative overflow-hidden">
          <div className="absolute inset-0 bg-indigo-500/10 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"></div>
          
          <div className={`relative w-48 h-48 rounded-full shadow-[0_0_40px_rgba(99,102,241,0.6),inset_0_0_20px_rgba(255,255,255,0.5)] 
            ${orbState === 'idle' ? 'bg-[radial-gradient(circle_at_30%_30%,#a5b4fc,#6366f1,#312e81)] animate-float' : ''}
            ${orbState === 'thinking' ? 'bg-[radial-gradient(circle_at_30%_30%,#fda4af,#e11d48,#881337)] animate-pulse-fast shadow-[0_0_80px_rgba(244,63,94,0.6),inset_0_0_20px_rgba(255,255,255,0.5)]' : ''}
            ${orbState === 'speaking' ? 'bg-[radial-gradient(circle_at_30%_30%,#6ee7b7,#10b981,#064e3b)] animate-wave shadow-[0_0_60px_rgba(52,211,153,0.6),inset_0_0_20px_rgba(255,255,255,0.5)]' : ''}
            transition-all duration-300 z-10`}>
          </div>

          <div className="mt-10 uppercase tracking-widest text-sm font-semibold z-10 flex gap-2">
            <span className="text-slate-400">Status:</span>
            <span className={`
              ${orbState === 'idle' ? 'text-slate-50' : ''}
              ${orbState === 'thinking' ? 'text-rose-400' : ''}
              ${orbState === 'speaking' ? 'text-emerald-400' : ''}
            `}>
              {orbState === 'idle' && (isListening ? 'Listening...' : 'Online')}
              {orbState === 'thinking' && 'Analyzing...'}
              {orbState === 'speaking' && 'Speaking...'}
            </span>
          </div>
        </div>

        {/* Chat Panel */}
        <div className="flex-[1.5] flex flex-col p-6 relative">
          
          <div className="flex justify-end mb-4">
            <button 
              onClick={handleClear}
              disabled={orbState !== 'idle' || isListening}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${orbState === 'idle' && !isListening ? 'text-rose-300 hover:text-white hover:bg-rose-500/20' : 'text-slate-500 cursor-not-allowed'}`}
            >
              <Trash2 size={14} /> Clear Chat
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-6 pr-3 pb-4">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex max-w-[85%] flex-col gap-2 ${msg.role === 'user' ? 'self-end' : 'self-start'}`}>
                
                {/* Thinking UI */}
                {msg.thoughts !== null && (
                  <div className="text-sm font-mono bg-black/40 border border-white/5 p-4 rounded-2xl text-slate-300 w-full shadow-inner flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-indigo-400 font-bold uppercase tracking-wider text-xs">
                      {(!msg.content && orbState === 'thinking') ? <Loader2 className="animate-spin" size={14} /> : <BrainCircuit size={14} />}
                      Reasoning Process
                    </div>
                    <div className="whitespace-pre-wrap leading-relaxed opacity-90 text-[13px] overflow-hidden">
                      {msg.thoughts || 'Processing context...'}
                    </div>
                  </div>
                )}

                {/* Speech UI */}
                {(!msg.thoughts || msg.content) && (
                  <div className={`
                      p-4 rounded-2xl shadow-lg leading-relaxed text-[15px]
                      ${msg.role === 'user' 
                        ? 'bg-gradient-to-br from-indigo-500 to-indigo-800 text-white rounded-br-sm' 
                        : 'bg-white/5 border border-white/10 text-slate-200 rounded-bl-sm'}
                  `}>
                    {msg.content || (msg.role === 'avatar' && orbState !== 'idle' ? <Loader2 className="animate-spin text-indigo-400" size={20} /> : '')}
                  </div>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <div className="mt-4 flex gap-3 items-center bg-black/20 p-2 pl-4 rounded-full border border-white/5">
            <input 
              type="text" 
              className="flex-1 bg-transparent border-none outline-none text-white placeholder-slate-400 disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder={isListening ? "Listening..." : "Type your message..."}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              disabled={orbState !== 'idle'}
            />
            
            <button 
              onClick={() => handleSend()}
              disabled={orbState !== 'idle' || isListening}
              className={`p-2.5 rounded-full transition-colors ${orbState === 'idle' && !isListening ? 'text-indigo-400 hover:text-white hover:bg-indigo-500/20' : 'text-slate-500 cursor-not-allowed'}`}
            >
              <Send size={18} />
            </button>
            
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
            <button     
              onClick={() => fileInputRef.current?.click()}
              disabled={orbState !== 'idle' || isListening}
              className={`p-2.5 rounded-full transition-colors mr-1 
                ${orbState !== 'idle' ? 'text-slate-500 cursor-not-allowed' : 'text-slate-400 hover:text-white hover:bg-slate-500/20'}`}
              title="Upload Audio File (Library Mode)"
            >
              <Upload size={18} />
            </button>

            <button     
              onClick={toggleListen}
              disabled={orbState !== 'idle'}
              className={`p-2.5 rounded-full transition-colors mr-1 
                ${orbState !== 'idle' ? 'text-slate-500 cursor-not-allowed' : 
                  isListening ? 'text-rose-500 bg-rose-500/20 animate-pulse' : 'text-indigo-400 hover:text-white hover:bg-indigo-500/20'}`}
              title="Voice Chat"
            >
              <Mic size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
