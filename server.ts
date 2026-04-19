import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import { Readable } from 'stream';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.set('trust proxy', 1);

  // Logging middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  // Google OAuth Client Setup
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/auth/callback`
  );

  app.use(express.json({ limit: '50mb' }));
  app.use(cookieParser());
  app.use(session({
    secret: 'site-lens-ai-secret',
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: true,
      sameSite: 'none',
      httpOnly: true,
    }
  }));

  const apiRouter = express.Router();

  apiRouter.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), env: { 
      GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
      APP_URL: !!process.env.APP_URL 
    }});
  });

  apiRouter.get('/auth/url', (req, res) => {
    try {
      console.log('Generating auth URL...');
      const scopes = [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.file'
      ];
      const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent'
      });
      res.json({ url });
    } catch (error: any) {
      console.error('Failed to generate auth URL:', error);
      res.status(500).json({ error: error.message });
    }
  });

  apiRouter.get('/auth/status', (req, res) => {
    res.json({ authenticated: !!(req.session as any).tokens });
  });

  apiRouter.get('/drive/list', async (req, res) => {
    const tokens = (req.session as any).tokens;
    if (!tokens) return res.status(401).json({ error: 'Unauthorized' });

    oauth2Client.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    try {
      const q = req.query.q as string || "mimeType = 'application/vnd.google-apps.folder' or mimeType contains 'image/'";
      const folderId = req.query.folderId as string || 'root';
      
      const response = await drive.files.list({
        q: `'${folderId}' in parents and (${q}) and trashed = false`,
        fields: 'files(id, name, mimeType, thumbnailLink, webViewLink)',
        orderBy: 'folder,name'
      });
      res.json(response.data.files);
    } catch (error: any) {
      console.error('Drive listing error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  apiRouter.get('/drive/file/:fileId', async (req, res) => {
    const tokens = (req.session as any).tokens;
    if (!tokens) return res.status(401).json({ error: 'Unauthorized' });

    oauth2Client.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    try {
      const fileId = req.params.fileId;
      const response = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      
      const fileMeta = await drive.files.get({ fileId, fields: 'mimeType,name' });
      
      res.set('Content-Type', fileMeta.data.mimeType || 'image/jpeg');
      res.send(Buffer.from(response.data as any));
    } catch (error: any) {
      console.error('File download error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  apiRouter.post('/drive/upload', async (req, res) => {
    const tokens = (req.session as any).tokens;
    if (!tokens) return res.status(401).json({ error: 'Unauthorized' });

    oauth2Client.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    try {
      const { name, mimeType, base64, folderId } = req.body;
      const buffer = Buffer.from(base64.split(',')[1], 'base64');
      
      const response = await drive.files.create({
        requestBody: {
          name,
          parents: folderId ? [folderId] : undefined,
          mimeType
        },
        media: {
          mimeType,
          body: Readable.from(buffer)
        }
      });
      
      res.json(response.data);
    } catch (error: any) {
      console.error('Upload error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.use('/api', apiRouter);

  app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('No code provided');

    try {
      const { tokens } = await oauth2Client.getToken(code as string);
      (req.session as any).tokens = tokens;
      
      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. You can close this window.</p>
          </body>
        </html>
      `);
    } catch (error: any) {
      console.error('Error exchanging code for tokens:', error);
      res.status(500).send('Authentication failed');
    }
  });

  // Vite Middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
