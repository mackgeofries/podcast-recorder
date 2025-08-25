// server.js
const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

// CRITICAL FIX: Ensure the recordings directory exists before starting the server
const recordingsDir = path.join(__dirname, 'recordings');
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir);
  console.log('Created recordings directory.');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Serve files from the 'recordings' directory
app.use('/recordings', express.static(path.join(__dirname, 'recordings')));

const server = app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});

const wss = new WebSocketServer({ server });

// Map to store WebSocket connections and file streams by session code
const sessions = {};

// Helper function to create a unique 6-digit session code
const generateSessionCode = () => {
  let code = '';
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (sessions[code]); // Ensure the code is unique
  return code;
};

// Route to handle session code generation and session creation
app.get('/start-session', (req, res) => {
  const uniqueCode = generateSessionCode();
  // CRITICAL FIX: Create the session object immediately when the code is generated
  sessions[uniqueCode] = {
    host: null,
    guest: null,
    fileStream: null,
    code: uniqueCode
  };
  console.log(`New session created with code: ${uniqueCode}`);
  res.json({ uniqueCode });
});

wss.on('connection', (ws) => {
  console.log('Client connected');

  // Handle incoming messages from the client
  ws.on('message', (message) => {
    const data = JSON.parse(message);

    switch (data.type) {
      case 'start':
        // A guest is joining, link their WS to the session
        if (sessions[data.code]) {
          sessions[data.code].guest = ws;
          console.log(`Guest joined session: ${data.code}`);
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Session not found.' }));
        }
        break;

      case 'host_audio':
        // Host is sending audio data
        if (sessions[data.code]) {
          // If this is the first audio chunk from the host, create the file stream
          if (!sessions[data.code].fileStream) {
            const fileStream = fs.createWriteStream(path.join(recordingsDir, `recording-${data.code}.webm`));
            sessions[data.code].fileStream = fileStream;
            sessions[data.code].host = ws;
            console.log(`Host connected to session: ${data.code}`);
          }
          // Write the audio data to the file stream
          sessions[data.code].fileStream.write(Buffer.from(data.audioData, 'base64'));
        }
        break;

      case 'guest_audio':
        // Guest is sending audio data, write it to the host's file
        if (sessions[data.code] && sessions[data.code].fileStream) {
          sessions[data.code].fileStream.write(Buffer.from(data.audioData, 'base64'));
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Session not found or file stream is closed.' }));
        }
        break;
      
      case 'stop':
        // A stop message was received from the host
        if (sessions[data.code]) {
          console.log(`Stopping recording for session: ${data.code}`);

          // Close the file stream
          if (sessions[data.code].fileStream) {
            sessions[data.code].fileStream.end();
            sessions[data.code].fileStream = null;
          }
          
          // Notify the host and guest that the recording is saved
          const downloadUrl = `/recordings/recording-${data.code}.webm`;
          if (sessions[data.code].host) {
            sessions[data.code].host.send(JSON.stringify({ type: 'recording_saved', downloadUrl }));
          }
          if (sessions[data.code].guest) {
            sessions[data.code].guest.send(JSON.stringify({ type: 'recording_saved' }));
          }

          // Clean up the session
          delete sessions[data.code];
        }
        break;
    }
  });

  // Handle client disconnection
  ws.on('close', () => {
    console.log('Client disconnected.');
    // Check if this was a host and clean up the session
    for (const code in sessions) {
      if (sessions[code].host === ws || sessions[code].guest === ws) {
        if (sessions[code].fileStream) {
          console.log(`Client disconnected unexpectedly. Ending file stream for session: ${code}`);
          sessions[code].fileStream.end();
          sessions[code].fileStream = null;
        }
        
        // Notify the other participant if they are still connected
        if (sessions[code].host && sessions[code].host !== ws) {
          sessions[code].host.send(JSON.stringify({ type: 'recording_ended' }));
        } else if (sessions[code].guest && sessions[code].guest !== ws) {
          sessions[code].guest.send(JSON.stringify({ type: 'recording_ended' }));
        }
        
        delete sessions[code];
        break;
      }
    }
  });
});
