const chatHistory = document.getElementById('chat-history');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const orb = document.querySelector('.orb');
const statusText = document.getElementById('status');
const thoughtBox = document.getElementById('thought-box');

// Auto-scroll on load
chatHistory.scrollTop = chatHistory.scrollHeight;

function appendMessage(sender, text) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', sender);
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    contentDiv.textContent = text;
    
    msgDiv.appendChild(contentDiv);
    chatHistory.appendChild(msgDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

function setOrbState(state) {
    orb.className = 'orb'; // Reset to default
    if (state === 'thinking') {
        orb.classList.add('thinking');
        statusText.textContent = 'Thinking...';
        statusText.style.color = '#f43f5e';
    } else if (state === 'speaking') {
        orb.classList.add('speaking');
        statusText.textContent = 'Speaking...';
        statusText.style.color = '#34d399';
        
        // Auto reset speaking state after 3.5 seconds (until we get real audio tracking)
        setTimeout(() => setOrbState('idle'), 3500);
    } else {
        statusText.textContent = 'Online';
        statusText.style.color = '#f8fafc';
    }
}

async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    // UI Update immediately
    appendMessage('user', text);
    chatInput.value = '';
    thoughtBox.classList.add('hidden');
    setOrbState('thinking');

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, session_id: "demo_user" })
        });
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }

        // Show thoughts if RAG routing was used
        if (data.route === 'RAG') {
            thoughtBox.textContent = `[System Logic (Hidden from Audio)]: ${data.thoughts}`;
            thoughtBox.classList.remove('hidden');
        }

        setOrbState('speaking');
        appendMessage('avatar', data.response);

    } catch (error) {
        console.error('API Error:', error);
        appendMessage('avatar', 'Oops! Something went wrong connecting to the backend. Please check the terminal.');
        setOrbState('idle');
    }
}

// Event Listeners
sendBtn.addEventListener('click', sendMessage);

chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Mock mic button interaction for Phase 1
document.getElementById('mic-btn').addEventListener('click', () => {
    alert("Microphone integration coming in Phase 2!");
});
