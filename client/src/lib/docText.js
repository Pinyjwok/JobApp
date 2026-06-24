// Serialize a structured CV ({name, contact, profile, skills, experience, education}) to plain text
// for Copy / file download. Shared by DocumentPreview (per-tab) and CompletionBubble (both docs).
// No PDF lib in the stack yet, so downloads are .txt.
export function cvToText(cv) {
  const lines = [];
  if (cv.name) lines.push(cv.name);
  if (cv.contact) lines.push(cv.contact);
  if (cv.profile) lines.push('', 'PROFILE', cv.profile);
  const sk = cv.skills ?? {};
  if (sk.technical?.length) lines.push('', 'SKILLS', `Technical: ${sk.technical.join(' · ')}`);
  if (sk.core?.length) lines.push(`Core: ${sk.core.join(' · ')}`);
  if (sk.certifications?.length) lines.push(`Certifications: ${sk.certifications.join(' · ')}`);
  if (cv.experience?.length) {
    lines.push('', 'EXPERIENCE');
    for (const r of cv.experience) {
      lines.push([r.title, r.dates].filter(Boolean).join('  '));
      if (r.employer) lines.push(r.employer);
      for (const b of (r.bullets ?? [])) lines.push(`- ${b}`);
      lines.push('');
    }
  }
  if (cv.education?.length) lines.push('EDUCATION & CERTIFICATIONS', ...cv.education);
  return lines.join('\n').trim();
}

// CV + cover letter as one plain-text blob (the completion "Download both"). Single source so the
// separator/ordering can't drift between callers (UI-11).
export function bothToText(doc) {
  const cv = doc?.cv ? cvToText(doc.cv) : '';
  const cl = doc?.coverLetter ?? '';
  return [cv, cl && '\n\n' + '='.repeat(48) + '\n\nCOVER LETTER\n\n' + cl].filter(Boolean).join('');
}

// Trigger a browser download of `text` as `${filename}.txt`. Centralized so the blob/anchor dance
// isn't re-implemented in every component that offers a download (UI-11).
export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
