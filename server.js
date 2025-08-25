const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Map to store active sessions and their unique codes
const sessions = new Map();

// Serve the index.html file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// A route for starting a new recording session
app.get('/start-session', (req, res) => {
    // Generate a new, unique 6-digit code for the session
    const uniqueCode = crypto.randomInt(100000, 999999).toString();
    sessions.set(uniqueCode, null); // Store the code, no active connection yet
    console.log(`New session created with code: ${uniqueCode}`);
    res.json({ uniqueCode });
});

wss.on('connection', ws => {
    console.log('Client connected to WebSocket.');

    let sessionCode = null;
    let fileStream = null;

    ws.on('message', message => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'start') {
                const { code } = data;
                // Check if the provided code is valid and not already in use
                if (sessions.has(code) && sessions.get(code) === null) {
                    sessionCode = code;
                    sessions.set(sessionCode, ws); // Associate the WebSocket with the code
                    console.log(`Guest connected with code: ${sessionCode}`);

                    // Create a new file stream for the audio data
                    const filename = `recording-${sessionCode}.webm`;
                    fileStream = fs.createWriteStream(path.join(__dirname, 'recordings', filename));
                    ws.send(JSON.stringify({ type: 'status', message: 'Recording started.' }));
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid or already in-use session code.' }));
                    ws.close();
                }
            } else if (data.type === 'audio' && sessionCode) {
                // Write the incoming audio data to the file
                fileStream.write(Buffer.from(data.audioData, 'base64'));
            } else if (data.type === 'stop' && sessionCode) {
                // Finalize the file and clean up the session
                if (fileStream) {
                    fileStream.end();
                    console.log(`Recording for session ${sessionCode} saved.`);
                }
                sessions.delete(sessionCode);
                ws.close();
            }
        } catch (e) {
            console.error('Error handling message:', e);
            ws.send(JSON.stringify({ type: 'error', message: 'An unexpected error occurred.' }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected.');
        // Clean up resources if still active
        if (fileStream && !fileStream.writableEnded) {
            fileStream.end();
        }
    });

    ws.on('error', error => {
        console.error('WebSocket error:', error);
    });
});

// Create a directory for recordings if it doesn't exist
const recordingsDir = path.join(__dirname, 'recordings');
if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Use /start-session to create a new code.');
});