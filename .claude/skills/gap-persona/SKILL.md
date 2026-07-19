---
name: gap-persona
description: Answer gap-interview questions in-character as the persona under test — realistic first-time-user answers drawn only from that persona's real CV/cover-letter/background, never crafted to game the adjudicator. Use during a persona test run when the gap interview asks questions.
argument-hint: [persona] — e.g. "12" or "elena nurse"; omit to auto-detect from workspace
---

# /gap-persona

Answer the gap interview **as the candidate**, the way a real first-time user of the app would — honest, from
the hip, only what that person actually has. The point of a test run is to see the pipeline handle a *natural
spread* of answers. So do **not** write perfect answers. Write true ones.

**Arguments:** `$ARGUMENTS` — a persona hint (`12`, `elena`, `nurse`). If omitted, auto-detect (Step 1).

---

## Step 1 — Identify who you are

The persona is whoever is loaded in the run right now:

1. Read `workspace/cv_raw.txt` (and `workspace/candidate_profile.json`) — this is the candidate actually being
   processed. The name/role there is your identity.
2. Match it to the folder under `docs/personas/NN-...`. If `$ARGUMENTS` names one, trust that.

## Step 2 — Read your ground truth (the ONLY well you draw from)

From the persona folder read the full source, richer than the extracted profile:
- the CV (`cv-*.txt`) — everything this person has really done, in their own voice
- the cover letter (`cover-letter-*.txt` / `*.txt`) — tone, motivations, what they emphasise
- the target PD (`pd.txt`) — what the role is asking for

**This is the boundary.** Every answer must be traceable to something in these files. If it is not in here,
this person did not do it — and a real user cannot invent a career they don't have. No new employers, no new
metrics, no new certs, no new years.

## Step 3 — Get the questions

Either the user pastes the gap-interview questions, or read `workspace/gap_analysis.json` → `gaps[]` (answer to
`gap_text_plain ?? gap_text`; note `id` and `is_structural`). Answer one free-text reply per gap, keyed by
`gap_id`.

---

## The register — how a first-time user actually types

Real people answering a phone form. Not a cover-letter, not a rubric-optimised statement.

- **Short and plain.** One to three sentences, conversational. Occasional lowercase, the odd typo, mild ramble.
  Believable, not a caricature.
- **From memory.** They mention what they did; they often **forget to say where or when**. Leaving some answers
  unanchored is correct and desirable — that's exactly what should trip `REQUIRES_ANCHOR`. Don't reflexively
  bolt on "at [employer] in [year]" to every reply.
- **They don't know the scoring.** No one writes "I have 6 years anchored evidence of…". They just talk.
- **Honesty over closing the gap.** When the CV genuinely has nothing for a requirement, answer like a person
  who's short on it: "no, I haven't done that professionally", "I'm familiar with it but never used it at
  work", "I was actually planning to get that cert". Those *should* land NOT_EVIDENCE / REJECTED. Good.

## The one rule that matters — do not overfit

The tester's temptation is to make the run "pass". Resist it in **both** directions:

- **Don't inflate up.** Do not fabricate a clean, anchored, ACCEPTED-shaped answer for every gap. That tests
  nothing and quietly rewards hallucination-resistance for the wrong reason.
- **Don't reverse-engineer verdicts.** Don't tune an answer to hit `ACCEPTED_MITIGATED` or `REQUIRES_ANCHOR` on
  purpose. You are playing a person, not the adjudicator's rubric.

Just answer honestly, in voice, from the real background — and **let the verdicts fall where they fall.** A
healthy run produces a mix: some ACCEPTED (things they truly did and happen to name), some REQUIRES_ANCHOR
(real but vaguely stated), some REJECTED / NOT_EVIDENCE (genuine shortfalls). If every one of your answers would
score ACCEPTED, you've overfit — rewrite.

**Structural gaps** (`is_structural=true`, e.g. minimum years): answer with the truth of the CV even when it's
short of the bar ("I've got about 1.5 years of UX contracting"). Never pad the number to reach the minimum.

## Step 4 — Deliver

Give the reply per gap in a copy-pasteable form, e.g.:

```
gap_1 → I did IV cannulation and PICC line care every shift on the surgical ward, it was routine for me.
gap_2 → honestly no, I haven't led a team — I've precepted new grads but never managed anyone.
gap_3 → I've used Epic and MedChart a lot. (unanchored on purpose — real but no where/when)
```

Keep a one-line note to yourself when you deliberately left an answer thin or unanchored, so the run's verdict
spread is easy to read against intent. Do not put that note in the answer text itself.

If the interview re-asks (round ≥2, an `anchor_prompt` came back), answer as the same person now being nudged
for the missing detail — give the where/when if they'd plausibly know it, or stay vague if they honestly
wouldn't.
