#!/bin/bash

# Test script for speech recognition endpoint
echo "🧪 Testing Speech Recognition Endpoint"
echo "====================================="

# Check if backend is running
echo "📡 Checking if backend is running on port 5002..."
if curl -s https://app-backend-production-f32c.up.railway.app/health > /dev/null; then
    echo "✅ Backend is running"
else
    echo "❌ Backend is not running. Please start it with: npm start"
    exit 1
fi

# Test with a sample audio file (you'll need to provide one)
echo ""
echo "🎤 Testing speech recognition endpoint..."

# Create a simple test audio file (beep sound) for testing
echo "📁 Creating test audio file..."
ffmpeg -f lavfi -i "sine=frequency=1000:duration=1" -acodec pcm_s16le -ar 16000 test_audio.wav 2>/dev/null

if [ -f "test_audio.wav" ]; then
    echo "✅ Test audio file created"

    # Test the endpoint
    echo "🔍 Testing /api/speech/recognize endpoint..."
    response=$(curl -s -X POST \
        -F "audio=@test_audio.wav" \
        -F "language=tl" \
        https://app-backend-production-f32c.up.railway.app/api/speech/transcribe)

    echo "📄 Response:"
    echo "$response" | jq . 2>/dev/null || echo "$response"

    # Clean up
    rm -f test_audio.wav
    echo "🧹 Cleaned up test file"
else
    echo "❌ Failed to create test audio file. Please install ffmpeg."
fi

echo ""
echo "✨ Test completed!"
