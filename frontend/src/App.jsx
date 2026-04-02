import { useState, useRef, useEffect } from 'react';
import { Send, Mic, Trash2, Loader2, BrainCircuit } from 'lucide-react';

function App() {
  const [messages, setMessages] = useState([
    { role: 'avatar', content: 'Hello there! I am your AI Agency Avatar. How can I assist you with your integration projects today?', thoughts: null }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [orbState, setOrbState] = useState('idle'); // idle, thinking, speaking
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!inputValue.trim() || orbState !== 'idle') return;

    const userMessage = inputValue.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMessage, thoughts: null }]);
    setInputValue('');
    setOrbState('thinking');

    try {
      const response = await fetch('/api/chat_stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, session_id: "react_user" })
      });

      if (!response.ok) throw new Error("Failed to connect");

      // Setup initial empty avatar message to be filled
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
                    // It opened <thought> but hasn't written anything inside yet
                    parsedThoughts = "";
                }

                if (speechMatch) {
                  setOrbState('speaking');
                  parsedContent = speechMatch[1].trim();
                } else if (!currentRaw.includes('<speech>') && !currentRaw.includes('<thought>') && currentRaw.length > 20) {
                  // Fallback: Gemini forgot tags entirely, assume it's speaking
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
      if (orbState !== 'idle') return; // Protect clear feature while streaming
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
              {orbState === 'idle' && 'Online'}
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
              disabled={orbState !== 'idle'}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${orbState === 'idle' ? 'text-rose-300 hover:text-white hover:bg-rose-500/20' : 'text-slate-500 cursor-not-allowed'}`}
            >
              <Trash2 size={14} /> Clear Chat
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-6 pr-3 pb-4">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex max-w-[85%] flex-col gap-2 ${msg.role === 'user' ? 'self-end' : 'self-start'}`}>
                
                {/* Thinking UI (Above Avatar Message) */}
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

                {/* Main Speech UI */}
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
              placeholder="Type your message..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              disabled={orbState !== 'idle'}
            />
            
            <button 
              onClick={handleSend}
              disabled={orbState !== 'idle'}
              className={`p-2.5 rounded-full transition-colors ${orbState === 'idle' ? 'text-indigo-400 hover:text-white hover:bg-indigo-500/20' : 'text-slate-500 cursor-not-allowed'}`}
            >
              <Send size={18} />
            </button>
            <button     
              onClick={() => {if(orbState === 'idle') alert("Audio functionality coming in Phase 2!")}}
              disabled={orbState !== 'idle'}
              className={`p-2.5 rounded-full transition-colors mr-1 ${orbState === 'idle' ? 'text-rose-400 hover:text-white hover:bg-rose-500/20' : 'text-slate-500 cursor-not-allowed'}`}
              title="Coming in Phase 2!"
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
