import { readFileSync } from 'fs';
import { join } from 'path';
import { WORKSPACE_DIR } from '../config/constants.js';
import { state } from './state.js';
import { broadcast } from './broadcast.js';

export function injectReviewerButtons() {
  try {
    if (state.pipelineStatus === 'REVIEW_COMPLETE' || state.pipelineStatus === 'REVIEW_FAILED') {
      state.reviewerGapState = null;
      return;
    }

    let reviewAudit = null;
    try {
      const ra = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'review_audit.json'), 'utf8'));
      if (ra?.issues_found) reviewAudit = ra;
    } catch {}

    if (reviewAudit) {
      state.reviewerGapState = 'issue';
      const BACKABLE = ['A - Evidence Mismatch', 'B - Seniority Inflation', 'D - Missing Context'];
      const hasUnbacked = reviewAudit.issues_found?.some(i =>
        BACKABLE.includes(i.issue_type) && i.user_backed === undefined
      );
      if (hasUnbacked) {
        broadcast({ type: 'action_required', context: 'reviewer_issue', prompt: '', actions: [
          { id: 'reviewer_skip', label: 'Skip — leave flagged', variant: 'ghost' },
        ]});
      }
    } else if (state.reviewerGapState === 'question') {
      broadcast({ type: 'action_required', context: 'reviewer_gap', prompt: '', actions: [
        { id: 'reviewer_skip', label: 'Skip this gap', variant: 'ghost' },
      ]});
    }
  } catch { /* workspace files may not exist */ }
}

