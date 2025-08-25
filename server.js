// --- Copy the content below into the file named server.js ---
const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

// Ensure the recordings directory exists before starting the server
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

// Map to store WebSocket connections, file streams, and readiness state by session code
const sessions = {};

// Helper function to create a unique 6-digit session code
const generateSessionCode = () => {
  let code = '';
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (sessions[code]);
  return code;
};

// Route to handle session code generation and session creation
app.get('/start-session', (req, res) => {
  const uniqueCode = generateSessionCode();
  // Create the session object immediately with empty streams and a readiness state
  sessions[uniqueCode] = {
    host: null,
    guest: null,
    hostReady: false,
    guestReady: false,
    hostStream: null,
    guestStream: null,
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

    // Get the session object using the provided code
    const session = sessions[data.code];
    if (!session) {
      ws.send(JSON.stringify({ type: 'error', message: 'Session not found.' }));
      return;
    }

    switch (data.type) {
      case 'host_connect':
        session.host = ws;
        console.log(`Host connected to session: ${data.code}`);
        break;

      case 'guest_connect':
        session.guest = ws;
        console.log(`Guest connected to session: ${data.code}`);
        break;

      case 'host_ready':
        session.hostReady = true;
        console.log(`Host is ready for session: ${data.code}`);
        // Check if both clients are ready to start
        if (session.hostReady && session.guestReady) {
          console.log(`Both clients are ready. Starting recording for session: ${data.code}`);
          // Send a synchronized start signal to both clients
          const startTime = Date.now() + 1000; // Add a 1 second buffer
          if (session.host) {
            session.host.send(JSON.stringify({ type: 'start_session', startTime }));
          }
          if (session.guest) {
            session.guest.send(JSON.stringify({ type: 'start_session', startTime }));
          }
          // Initialize file streams
          const hostFile = path.join(recordingsDir, `recording-${data.code}-host.webm`);
          session.hostStream = fs.createWriteStream(hostFile);
          const guestFile = path.join(recordingsDir, `recording-${data.code}-guest.webm`);
          session.guestStream = fs.createWriteStream(guestFile);
        }
        break;

      case 'guest_ready':
        session.guestReady = true;
        console.log(`Guest is ready for session: ${data.code}`);
        // Check if both clients are ready to start
        if (session.hostReady && session.guestReady) {
          console.log(`Both clients are ready. Starting recording for session: ${data.code}`);
          // Send a synchronized start signal to both clients
          const startTime = Date.now() + 1000; // Add a 1 second buffer
          if (session.host) {
            session.host.send(JSON.stringify({ type: 'start_session', startTime }));
          }
          if (session.guest) {
            session.guest.send(JSON.stringify({ type: 'start_session', startTime }));
          }
          // Initialize file streams
          const hostFile = path.join(recordingsDir, `recording-${data.code}-host.webm`);
          session.hostStream = fs.createWriteStream(hostFile);
          const guestFile = path.join(recordingsDir, `recording-${data.code}-guest.webm`);
          session.guestStream = fs.createWriteStream(guestFile);
        }
        break;

      case 'host_audio':
        // Host is sending audio data
        if (session.hostStream) {
          session.hostStream.write(Buffer.from(data.audioData, 'base64'));
        }
        break;

      case 'guest_audio':
        // Guest is sending audio data, write it to their own file stream
        if (session.guestStream) {
          session.guestStream.write(Buffer.from(data.audioData, 'base64'));
        }
        break;
      
      case 'stop':
        // A stop message was received from the host
        console.log(`Stopping recording for session: ${data.code}`);

        // Close all active file streams
        if (session.hostStream) {
          session.hostStream.end();
          session.hostStream = null;
        }
        if (session.guestStream) {
          session.guestStream.end();
          session.guestStream = null;
        }
        
        // Notify the host and guest that the recording is saved
        const downloadUrls = [];
        if (session.host) {
            downloadUrls.push(`/recordings/recording-${data.code}-host.webm`);
        }
        if (session.guest) {
            downloadUrls.push(`/recordings/recording-${data.code}-guest.webm`);
        }
        
        if (session.host) {
          session.host.send(JSON.stringify({ type: 'recording_saved', downloadUrls }));
        }
        if (session.guest) {
          session.guest.send(JSON.stringify({ type: 'recording_saved' }));
        }

        // Clean up the session
        delete sessions[data.code];
        break;
    }
  });

  // Handle client disconnection
  ws.on('close', () => {
    console.log('Client disconnected.');
    // Check which session the client belonged to and clean up
    for (const code in sessions) {
      if (sessions[code].host === ws || sessions[code].guest === ws) {
        // Find which stream to end
        let streamToEnd = null;
        if (sessions[code].host === ws) {
          console.log(`Host disconnected unexpectedly. Ending file stream for session: ${code}`);
          streamToEnd = sessions[code].hostStream;
          sessions[code].hostStream = null;
        } else if (sessions[code].guest === ws) {
          console.log(`Guest disconnected unexpectedly. Ending file stream for session: ${code}`);
          streamToEnd = sessions[code].guestStream;
          sessions[code].guestStream = null;
        }

        if (streamToEnd) {
          streamToEnd.end();
        }
        
        // Check if both streams are null, if so delete the session
        if (!sessions[code].hostStream && !sessions[code].guestStream) {
            delete sessions[code];
        }
        break;
      }
    }
  });
});
