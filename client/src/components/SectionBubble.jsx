// Assembly section → structured bubble. Shows the user the actual content of each CV section
// (profile, skills, work history, credentials, cover letter) plus what we highlighted and any
// suggestions — never the agent's internal build log. Fed by msg.sectionData.kind from the server.
//
// 2026-06 redesign: one shared <SectionDivider> instead of per-body ad-hoc dividers; a tightened
// 3-step type scale (14 prose / 13 secondary / 11 eyebrow); success vs warn given distinct colour;
// labelled contact row; employer dropped to its own line in history.
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { agentLabel } from '../agentLabels';
import { SectionDivider, CheckIcon, WarnIcon } from './primitives';

// Agents emit light markdown (**bold** metrics, the odd link). Render it instead of showing the raw
// asterisks. INLINE collapses the wrapping <p> so bold sits inside the card's own styled text; BLOCK
// keeps paragraph spacing for multi-paragraph bodies (the cover letter).
const INLINE_MD = {
  p: ({ children }) => <>{children}</>,
  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => <code className="text-accent font-mono">{children}</code>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2 hover:opacity-80">{children}</a>,
};
const BLOCK_MD = { ...INLINE_MD, p: ({ children }) => <p className="mb-2.5 last:mb-0">{children}</p> };

function Md({ children, block = false, className = '' }) {
  const Wrapper = block ? 'div' : 'span';
  return (
    <Wrapper className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={block ? BLOCK_MD : INLINE_MD}>
        {String(children ?? '')}
      </ReactMarkdown>
    </Wrapper>
  );
}

// Shared card shell + header (mirrors AnalystBubble).
function Shell({ msg, title, children }) {
  return (
    <div className="animate-fade-in-up relative w-full max-w-[85%] rounded-xl border border-line border-l-[3px] border-l-line-strong bg-surface-2 px-4 py-3 text-sm text-fg shadow-[var(--shadow-panel)]">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-fg-faint" />
        <span className="text-xs text-fg-secondary font-semibold">{agentLabel(msg.agent)}</span>
        {msg.cost != null && (
          <span className="text-xs text-fg-faint font-mono ml-auto">${msg.cost.toFixed(4)}</span>
        )}
      </div>
      <div className="flex items-center gap-2 mb-3 text-base font-semibold text-fg">
        <CheckIcon className="w-3.5 h-3.5 text-success" /> {title}
      </div>
      {children}
    </div>
  );
}

// 3-step type scale helpers.
function Bullets({ items, success = false }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-sm text-fg-secondary leading-snug">
          {success
            ? <CheckIcon className="w-3.5 h-3.5 text-success mt-[1px]" />
            : <span className="text-fg-faint mt-[1px] shrink-0">•</span>}
          <Md>{it}</Md>
        </li>
      ))}
    </ul>
  );
}

function Pills({ items, className }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it, i) => (
        <span key={i} className={`text-xs px-2 py-0.5 rounded-md border ${className}`}>{it}</span>
      ))}
    </div>
  );
}

// ── Per-kind bodies ───────────────────────────────────────────────────────────

function ProfileBody({ d }) {
  const { paragraph, contact, highlights = [], suggestions = [] } = d;
  return (
    <>
      <Md block className="text-sm leading-relaxed text-fg">{paragraph}</Md>

      {contact && (
        <SectionDivider label="Contact">
          <p className="text-xs text-fg-secondary font-mono leading-snug break-words">{contact}</p>
        </SectionDivider>
      )}

      {highlights.length > 0 && (
        <SectionDivider label="What we highlighted" tone="success">
          <Bullets items={highlights} success />
        </SectionDivider>
      )}

      {suggestions.length > 0 && (
        <SectionDivider label="Worth considering" tone="warn" icon={<WarnIcon />}>
          <ul className="space-y-2">
            {suggestions.map((s, i) => (
              <li key={i} className="text-sm leading-snug">
                {s.issue && <span className="text-fg-secondary">{s.issue}</span>}
                {s.suggestion && (
                  <span className="block mt-1 pl-3 border-l-2 border-warn/30 text-fg-muted">→ {s.suggestion}</span>
                )}
              </li>
            ))}
          </ul>
        </SectionDivider>
      )}
    </>
  );
}

function SkillsBody({ d }) {
  const { technical = [], soft = [], certifications = [], note = '' } = d;
  return (
    <>
      {technical.length > 0 && (
        <SectionDivider label="Technical" first>
          <Pills items={technical} className="text-accent bg-accent/10 border-accent/20" />
        </SectionDivider>
      )}
      {soft.length > 0 && (
        <SectionDivider label="Strengths" first={technical.length === 0}>
          <Pills items={soft} className="text-fg-secondary bg-surface-3 border-line" />
        </SectionDivider>
      )}
      {certifications.length > 0 && (
        <SectionDivider label="Certifications" first={technical.length === 0 && soft.length === 0}>
          <Pills items={certifications} className="text-success bg-success/10 border-success/20" />
        </SectionDivider>
      )}
      {note && (
        <SectionDivider label="Note">
          <p className="text-sm text-fg-secondary leading-snug"><Md>{note}</Md></p>
        </SectionDivider>
      )}
    </>
  );
}

function HistoryBody({ d }) {
  const { roles = [] } = d;
  return (
    <div className="space-y-3.5">
      {roles.map((r, i) => (
        <div key={i} className={i > 0 ? 'border-t border-line pt-3' : ''}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-fg">{r.position}</span>
            {r.duration && <span className="text-xs text-fg-muted font-mono shrink-0">{r.duration}</span>}
          </div>
          {r.employer && <div className="text-xs text-fg-secondary mt-0.5 mb-1.5">{r.employer}</div>}
          {r.bullets?.length > 0 && <Bullets items={r.bullets} />}
        </div>
      ))}
    </div>
  );
}

function CredentialsBody({ d }) {
  const { education = [], certifications = [] } = d;
  return (
    <>
      {education.length > 0 && (
        <SectionDivider label="Education" first>
          <Bullets items={education} />
        </SectionDivider>
      )}
      {certifications.length > 0 && (
        <SectionDivider label="Certifications" tone="success" first={education.length === 0}>
          <Bullets items={certifications} success />
        </SectionDivider>
      )}
    </>
  );
}

function CoverLetterBody({ d }) {
  const { letter, register = '', highlights = [] } = d;
  return (
    <>
      <Md block className="text-sm leading-relaxed text-fg">{letter}</Md>
      {highlights.length > 0 && (
        <SectionDivider label="What we highlighted" tone="success">
          <Bullets items={highlights} success />
        </SectionDivider>
      )}
      {register && (
        <p className="text-xs text-fg-faint mt-2.5">Written in a {register.replace(/-/g, ' ')} tone.</p>
      )}
    </>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────

const TITLES = {
  profile:     'Your profile is ready',
  skills:      'Your skills section is ready',
  history:     'Your work history is ready',
  credentials: 'Your education & certifications are ready',
  coverletter: 'Your cover letter is ready',
};

const BODIES = {
  profile:     ProfileBody,
  skills:      SkillsBody,
  history:     HistoryBody,
  credentials: CredentialsBody,
  coverletter: CoverLetterBody,
};

export function SectionBubble({ msg }) {
  const d = msg.sectionData;

  // Defensive: no structured data (old history) → render the raw text so nothing is lost.
  if (!d || !BODIES[d.kind]) {
    return (
      <div className="animate-fade-in-up relative w-full max-w-[85%] rounded-xl border border-line border-l-[3px] border-l-line-strong bg-surface-2 px-4 py-3 text-sm text-fg shadow-[var(--shadow-panel)]">
        <p className="whitespace-pre-wrap leading-relaxed text-fg-secondary">{msg.text}</p>
      </div>
    );
  }

  const Body = BODIES[d.kind];
  return (
    <Shell msg={msg} title={TITLES[d.kind] ?? 'Section ready'}>
      <Body d={d} />
    </Shell>
  );
}
