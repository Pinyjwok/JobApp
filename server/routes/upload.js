import express from 'express';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { extractText } from 'unpdf';
import { WORKSPACE_DIR } from '../config/constants.js';

const router = express.Router();
export default router;

router.post('/', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  const originalName = req.query.filename ?? '';
  const target = req.query.target;
  const isPdf  = originalName.toLowerCase().endsWith('.pdf');

  if (!target || !/^(cv_raw|jd_raw|cover_letter_sample)$/.test(target)) {
    return res.status(400).json({ error: 'target must be cv_raw, jd_raw, or cover_letter_sample' });
  }

  try {
    let text;
    if (isPdf) {
      const { text: pages } = await extractText(new Uint8Array(req.body), { mergePages: true });
      text = pages;
    } else {
      text = req.body.toString('utf8');
    }
    if (text.trim().length < 150) {
      return res.status(400).json({ error: 'File appears empty or too short' });
    }
    writeFileSync(join(WORKSPACE_DIR, `${target}.txt`), text, 'utf8');
    console.log(`[upload] ${originalName} → ${target}.txt (${text.length} chars)`);
    res.json({ ok: true, filename: `${target}.txt` });
  } catch (err) {
    console.error('[upload] error:', err);
    res.status(500).json({ error: err.message });
  }
});
