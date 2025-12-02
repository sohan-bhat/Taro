// Load and validate environment first - will throw if missing required vars
import { env } from './config/env';

import express from 'express';
import cors from 'cors';
import { connectDB } from './db/mongo';
import { companiesRouter } from './routes/companies';
import { meetingsRouter } from './routes/meetings';
import { slackRouter } from './routes/slack';
import { commandsRouter } from './routes/commands';
import { webhooksRouter } from './routes/webhooks';
import { API_ROUTES } from '@taro/shared';
import { slackListener } from './services/slackListener';
import { errorHandler } from './middleware/errorHandler';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get(API_ROUTES.HEALTH, (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use(API_ROUTES.COMPANIES, companiesRouter);
app.use(API_ROUTES.MEETINGS, meetingsRouter);
app.use('/api/slack', slackRouter);
app.use('/api/commands', commandsRouter);
app.use('/api/webhooks', webhooksRouter);

// Error handler (must be after routes)
app.use(errorHandler);

// Start server
async function start() {
  try {
    await connectDB();
    console.log('Connected to MongoDB');

    app.listen(env.port, () => {
      console.log(`Taro API server running on port ${env.port}`);
    });

    // Start Slack listener for auto-join (optional - only if token configured)
    if (env.slackAppToken) {
      await slackListener.start();
    } else {
      console.log('Slack listener: Skipped (no SLACK_APP_TOKEN)');
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  process.exit(0);
});

start();
