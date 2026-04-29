#!/bin/bash

# Define cleanup function to kill background processes on exit
cleanup() {
    echo "Stopping applications..."
    # Kill the background processes
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit 0
}

# Set up the trap to catch SIGINT (Ctrl+C) and SIGTERM
trap cleanup SIGINT SIGTERM EXIT

echo "Starting Backend (FastAPI)..."
# Start uvicorn in the background
uvicorn src.api:app --reload &
BACKEND_PID=$!

echo "Starting Frontend (React/Vite)..."
# Navigate to frontend and start it in the background
cd frontend || exit 1
npm run dev &
FRONTEND_PID=$!

echo "Both applications are running! Press Ctrl+C to stop both."

# Wait for background processes to keep the script running
wait
