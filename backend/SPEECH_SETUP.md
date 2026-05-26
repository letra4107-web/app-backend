# 🎤 Speech Recognition Setup Guide

## 📋 Prerequisites

1. **OpenAI API Key**: Get one from [OpenAI Platform](https://platform.openai.com/api-keys)
2. **FFmpeg**: Required for audio conversion (m4a → wav)

## ⚙️ Configuration

### 1. Environment Variables

Update your `.env` file in the backend directory:

```env
# OpenAI Configuration (REQUIRED)
OPENAI_API_KEY=sk-your-openai-api-key-here

# Other existing config...
```

### 2. Install Dependencies

```bash
cd backend
npm install
```

### 3. Install FFmpeg (Required for audio conversion)

#### Windows:
- Download from [ffmpeg.org](https://ffmpeg.org/download.html)
- Add to PATH or place in backend directory

#### macOS:
```bash
brew install ffmpeg
```

#### Linux:
```bash
sudo apt install ffmpeg
```

## 🚀 Usage

### Start the Backend

```bash
cd backend
npm start
```

The server will start on `http://localhost:5002`

### Test the Endpoint

Run the test script:

```bash
# Linux/macOS
./test-speech.sh

# Windows
test-speech.bat
```

### API Usage

#### Endpoint: `POST /api/speech/recognize`

**Content-Type**: `multipart/form-data`

**Form Fields**:
- `audio`: Audio file (m4a, wav, mp3, aac supported)
- `language`: Language code (optional, defaults to 'tl' for Tagalog)

**Example Request** (JavaScript/React Native):

```javascript
const formData = new FormData();
formData.append('audio', {
  uri: audioUri,
  type: 'audio/wav',
  name: 'recording.wav',
});
formData.append('language', 'tl');

const response = await fetch('http://localhost:5002/api/speech/recognize', {
  method: 'POST',
  body: formData,
});

const result = await response.json();
```

**Success Response**:
```json
{
  "success": true,
  "text": "recognized speech text here",
  "language": "tl"
}
```

**Error Response**:
```json
{
  "success": false,
  "message": "Speech recognition failed",
  "error": "detailed error message"
}
```

## 🔧 Features

### ✅ Audio Format Support
- **m4a** (iOS/Expo default) - automatically converted to WAV
- **wav** (recommended) - direct processing
- **mp3, aac, mp4** - supported with conversion

### ✅ Automatic Conversion
- m4a files are automatically converted to WAV (16-bit PCM, 16kHz, mono)
- No manual conversion needed from React Native

### ✅ Error Handling
- Invalid files rejected with clear messages
- API failures handled gracefully
- Automatic file cleanup on errors

### ✅ File Management
- Temporary files stored in `uploads/` directory
- Automatic cleanup after processing
- 25MB file size limit

## 🐛 Troubleshooting

### "OpenAI API key not configured"
- Add `OPENAI_API_KEY=your_key_here` to `.env`

### "ffmpeg not found"
- Install FFmpeg and ensure it's in PATH
- Or place ffmpeg.exe in the backend directory

### "Audio file is empty"
- Check that the audio recording actually captured sound
- Verify microphone permissions in Expo app

### 500 Internal Server Error
- Check backend logs for detailed error messages
- Verify OpenAI API key is valid and has credits
- Ensure uploads directory exists and is writable

## 📊 Logging

The endpoint logs detailed information:
- File upload details (size, type, name)
- Conversion process (if applicable)
- API requests and responses
- Errors with stack traces
- File cleanup operations

Check the backend console output for debugging information.