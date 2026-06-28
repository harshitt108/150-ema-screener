#!/bin/bash
set -e

echo "Starting NSE EMA Scanner..."

# Kill any existing processes
pkill -f "uvicorn main:app" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1

# Start backend
echo "Starting backend (FastAPI) on port 8000..."
cd "$(dirname "$0")/backend"
python3 -m uvicorn main:app --port 8000 &
BACKEND_PID=$!

# Start frontend
echo "Starting frontend (React) on port 5173..."
cd "$(dirname "$0")/frontend"
npm run dev -- --port 5173 &
FRONTEND_PID=$!

echo ""
echo "================================"
echo "  NSE EMA Scanner is running!"
echo "  Open: http://localhost:5173"
echo "================================"
echo ""
echo "Press Ctrl+C to stop"

cleanup() {
  echo "Shutting down..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

wait
