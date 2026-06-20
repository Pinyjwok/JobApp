// Assembly section → structured bubble. Shows the user the actual content of each CV section
// (profile, skills, work history, credentials, cover letter) plus what we highlighted and any
// suggestions — never the agent's internal build log. Fed by msg.sectionData.kind from the server.
import { agentLabel } from '../agentLabels';

function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-success" fill="none" viewBox="0 0 24 24"
      stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

// Shared card shell + header (mirrors AnalystBubble).
function Shell({ msg, title, children }) {
  return (
    <div className="animate-fade-in-up relative w-full max-w-[85%] rounded-xl border border-line border-l-[3px] border-l-line-strong bg-surface-2 px-4 py-3 text-sm text-fg shadow-[var(--shadow-panel)]">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1.5 h-1.5 rounded-full bg-fg-faint" />
        <span className="text-xs text-fg-secondary font-semibold">{agentLabel(msg.agent)}</span>
        {msg.cost != null && (
          <span className="text-[10px] text-fg-faint font-mono ml-0.5">${msg.cost.toFixed(4)}</span>
        )}
      </div>
      <div className="flex items-center gap-2 mb-3 font-bold text-[15px]">
        <CheckIcon /> {title}
      </div>
      {children}
    </div>
  );
}

function SectionHeading({ children }) {
  return (
    <div className="text-[11px] uppercase tracking-wider font-semibold text-fg-muted mb-1.5">
      {children}
    </div>
  );
}

function Bullets({ items, dotClass = 'text-fg-faint' }) {
  return (
    <ul className="space-y-1">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-[12.5px] text-fg-secondary leading-snug">
          <span className={`${dotClass} mt-[1px] flex-shrink-0`}>•</span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

function Pills({ items, className }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it, i) => (
        <span key={i} className={`text-[11.5px] px-2 py-0.5 rounded-md border ${className}`}>{it}</span>
      ))}
    </div>
  );
}

// ── Per-kind bodies ───────────────────────────────────────────────────────────

function ProfileBody({ d }) {
  const { paragraph, contact, highlights = [], suggestions = [] } = d;
  return (
    <>
      <p className="text-[13.5px] leading-relaxed text-fg whitespace-pre-wrap mb-3">{paragraph}</p>
      {contact && (
        <p className="text-[11.5px] text-fg-muted font-mono leading-snug border-t border-line pt-2.5 mb-3 break-words">
          {contact}
        </p>
      )}
      {highlights.length > 0 && (
        <div className="border-t border-line pt-2.5 mb-1">
          <SectionHeading>What we highlighted</SectionHeading>
          <Bullets items={highlights} dotClass="text-success" />
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="border-t border-line pt-2.5 mt-2.5">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-warn mb-1.5">Worth considering</div>
          <ul className="space-y-1.5">
            {suggestions.map((s, i) => (
              <li key={i} className="text-[12.5px] leading-snug">
                {s.issue && <span className="text-fg-secondary">{s.issue}</span>}
                {s.suggestion && <span className="text-fg-muted block mt-0.5">→ {s.suggestion}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function SkillsBody({ d }) {
  const { technical = [], soft = [], certifications = [], note = '' } = d;
  return (
    <div className="space-y-3">
      {technical.length > 0 && (
        <div>
          <SectionHeading>Technical</SectionHeading>
          <Pills items={technical} className="text-accent bg-accent/10 border-accent/20" />
        </div>
      )}
      {soft.length > 0 && (
        <div>
          <SectionHeading>Strengths</SectionHeading>
          <Pills items={soft} className="text-fg-secondary bg-surface-3 border-line" />
        </div>
      )}
      {certifications.length > 0 && (
        <div>
          <SectionHeading>Certifications</SectionHeading>
          <Pills items={certifications} className="text-success bg-success/10 border-success/20" />
        </div>
      )}
      {note && (
        <p className="text-[11.5px] text-fg-muted leading-snug border-t border-line pt-2.5">{note}</p>
      )}
    </div>
  );
}

function HistoryBody({ d }) {
  const { roles = [] } = d;
  return (
    <div className="space-y-3.5">
      {roles.map((r, i) => (
        <div key={i} className={i > 0 ? 'border-t border-line pt-3' : ''}>
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-[13px] font-semibold text-fg">
              {r.position}{r.position && r.employer ? ' · ' : ''}{r.employer}
            </span>
            {r.duration && <span className="text-[11px] text-fg-muted font-mono flex-shrink-0">{r.duration}</span>}
          </div>
          {r.bullets.length > 0 && <Bullets items={r.bullets} />}
        </div>
      ))}
    </div>
  );
}

function CredentialsBody({ d }) {
  const { education = [], certifications = [] } = d;
  return (
    <div className="space-y-3">
      {education.length > 0 && (
        <div>
          <SectionHeading>Education</SectionHeading>
          <Bullets items={education} />
        </div>
      )}
      {certifications.length > 0 && (
        <div>
          <SectionHeading>Certifications</SectionHeading>
          <Bullets items={certifications} dotClass="text-success" />
        </div>
      )}
    </div>
  );
}

function CoverLetterBody({ d }) {
  const { letter, register = '', highlights = [] } = d;
  return (
    <>
      <p className="text-[13px] leading-relaxed text-fg whitespace-pre-wrap mb-3">{letter}</p>
      {highlights.length > 0 && (
        <div className="border-t border-line pt-2.5">
          <SectionHeading>What we highlighted</SectionHeading>
          <Bullets items={highlights} dotClass="text-success" />
        </div>
      )}
      {register && (
        <p className="text-[11px] text-fg-faint mt-2.5">Written in a {register.replace(/-/g, ' ')} tone.</p>
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
