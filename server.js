const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// A map to store active sessions. Key: uniqueCode, Value: WebSocket connection
const sessions = new Map();

// Serve the index.html file from the root directory
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// A route for starting a new recording session and generating a code
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
                console.log(`Received start message with code: ${code}`);

                // Check if the provided code is valid and not already in use
                if (sessions.has(code) && sessions.get(code) === null) {
                    sessionCode = code;
                    sessions.set(sessionCode, ws); // Associate the WebSocket with the code
                    console.log(`Guest connected with code: ${sessionCode}`);

                    // Create a new file stream for the audio data
                    const filename = `recording-${sessionCode}.webm`;
                    const filePath = path.join(__dirname, 'recordings', filename);
                    console.log(`Creating file stream at: ${filePath}`);
                    fileStream = fs.createWriteStream(filePath);
                    ws.send(JSON.stringify({ type: 'status', message: 'Recording started.' }));
                } else {
                    console.log(`Invalid or already in-use code: ${code}`);
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid or already in-use session code.' }));
                    ws.close();
                }
            } else if (data.type === 'audio' && sessionCode) {
                // Write the incoming audio data to the file
                if (fileStream) {
                    fileStream.write(Buffer.from(data.audioData, 'base64'));
                }
            } else if (data.type === 'stop' && sessionCode) {
                console.log(`Received stop message for session: ${sessionCode}`);
                // Finalize the file and clean up the session
                if (fileStream) {
                    fileStream.end();
                    console.log(`Recording for session ${sessionCode} saved to disk.`);
                    ws.send(JSON.stringify({ type: 'recording_saved', message: 'Recording saved successfully.' }));
                }
                sessions.delete(sessionCode);
            }
        } catch (e) {
            console.error('Error handling message:', e);
            ws.send(JSON.stringify({ type: 'error', message: 'An unexpected error occurred.' }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected.');
        // If the connection closes unexpectedly, clean up the file stream
        if (fileStream && !fileStream.writableEnded) {
            console.log('Client disconnected unexpectedly. Ending file stream.');
            fileStream.end();
        }
    });

    ws.on('error', error => {
        console.error('WebSocket error:', error);
    });
});

// --- Create the 'recordings' directory if it doesn't exist ---
const recordingsDir = path.join(__dirname, 'recordings');
if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir);
    console.log('Created the "recordings" directory.');
} else {
    console.log('The "recordings" directory already exists.');
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Use /start-session to create a new code.');
});