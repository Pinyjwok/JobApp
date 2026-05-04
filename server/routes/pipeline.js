import express from 'express';
import { state } from '../lib/state.js';
import uploadRouter    from './upload.js';
import messageRouter   from './message.js';
import actionRouter    from './action.js';
import workspaceRouter from './workspace.js';
import debugRouter     from './debug.js';

export { initRecipe } from '../lib/recipe-init.js';

const router = express.Router();
export default router;

// SSE stream
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': heartbeat\n\n');
  state.sseClients.add(res);
  req.on('close', () => state.sseClients.delete(res));
});

router.use('/upload',  uploadRouter);
router.use('/message', messageRouter);
router.use('/action',  actionRouter);
router.use('/',        workspaceRouter);
router.use('/',        debugRouter);
