const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs-extra');  // Use fs-extra for better file operations
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

let clientStatus = 'not ready';  // Store the status of the client
let lastQRUrl = '';  // Store the last QR code URL

const renameAndDeleteDirectory = async (directoryPath, retries = 10, delay = 2000) => {
    const tempDirPath = directoryPath + '_temp';
    
    for (let i = 0; i < retries; i++) {
        try {
            // Rename the directory
            if (fs.existsSync(directoryPath)) {
                await fs.rename(directoryPath, tempDirPath);
            }

            // Now delete the renamed directory
            if (fs.existsSync(tempDirPath)) {
                await fs.remove(tempDirPath);
            }
            return;  // Exit if deletion is successful
        } catch (err) {
            if (err.code === 'EBUSY' && i < retries - 1) {
                console.warn(`File is busy, retrying (${i + 1}/${retries})...`);
                await new Promise(resolve => setTimeout(resolve, delay));  // Wait before retry
            } else {
                console.error(`Failed to delete directory after ${i + 1} attempts:`, err);
                throw err;  // Rethrow error if retries are exhausted or another error occurs
            }
        }
    }
};

const createClient = () => {
    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: "YOUR_CLIENT_ID"
        })
    });

    client.on('qr', (qr) => {
        qrcode.toDataURL(qr, (err, url) => {
            if (err) {
                console.error('Failed to generate QR code', err);
                return;
            }
            lastQRUrl = url;
            io.emit('qr', url);
            clientStatus = 'qr';  // Update status to QR code generation
        });
    });

    client.once('ready', () => {
        console.log('Client is ready!');
        clientStatus = 'ready';  // Update status to ready
        io.emit('ready', 'Client is ready!');
    });

    client.on('disconnected', async (reason) => {
      try {
          await client.destroy();
          const sessionPath = path.join(__dirname, '.wwebjs_auth', 'session-YOUR_CLIENT_ID');
          
          // Ensure the path is valid and clean
          if (fs.existsSync(sessionPath)) {
              await renameAndDeleteDirectory(sessionPath);
          }
          
          setTimeout(() => {
              client = createClient();  // Reinitialize the client
              client.initialize();
          }, 10000);  // Reinitialize after 10 seconds
      } catch (error) {
          console.error('Error during client logout and cleanup:', error);
      }
        console.log('Client was logged out', reason);
        clientStatus = 'not ready';
        io.emit('disconnected', 'Client was logged out');

    });

    client.initialize();

    return client;
};

let client = createClient();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const api = async (req, res) => {
    let nohp = req.query.nohp || req.body.nohp;
    const pesan = req.query.pesan || req.body.pesan;

    try {
        if (nohp.startsWith('0')) {
            nohp = '62' + nohp.slice(1) + '@c.us';
        } else if (nohp.startsWith('62')) {
            nohp = nohp + '@c.us';
        } else {
            nohp = '62' + nohp + '@c.us';
        }

        const user = await client.isRegisteredUser(nohp);

        if (user) {
            client.sendMessage(nohp, pesan);
            res.json({ status: "berhasil terkirim", pesan });
        } else {
            res.json({ status: "gagal terkirim", pesan: 'nomor wa tidak terdaftar' });
        }
    } catch (error) {
        console.log(error);
        res.status(500).json({ status: 'error', pesan: 'server error' });
    }
};

app.post('/api', api);

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    if (clientStatus === 'ready') {
        socket.emit('ready', 'Client is ready!');
    } else if (clientStatus === 'qr') {
        socket.emit('qr', lastQRUrl);  // Send the last QR code URL if available
    } else if (clientStatus === 'not ready') {
        socket.emit('disconnected', 'Client was logged out');
    }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
