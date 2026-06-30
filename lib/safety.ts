// Lightweight, deterministic safety gate. This is intentionally simple and
// errs toward caution: if a message looks like an emergency or self-harm, we
// do NOT let the model attempt an answer — we return crisis guidance instead.
const EMERGENCY_PATTERNS: RegExp[] = [
  /chest pain/i,
  /can'?t breathe|trouble breathing|short(ness)? of breath/i,
  /heart attack/i,
  /stroke|face drooping|slurred speech/i,
  /suicid|kill myself|end my life|want to die/i,
  /self[-\s]?harm|hurt myself/i,
  /overdose|overdosed/i,
  /unconscious|passed out|unresponsive/i,
  /severe bleeding|bleeding (a lot|heavily|badly)/i,
  /anaphylaxis|throat closing/i,
  /seizure/i,
];

export function detectEmergency(text: string): boolean {
  return EMERGENCY_PATTERNS.some((re) => re.test(text));
}

export const EMERGENCY_MESSAGE = [
  "This may be a medical emergency, and I can't help with urgent or crisis situations.",
  "",
  "• If you or someone else is in immediate danger, call 911 now (or your local emergency number).",
  "• If you're thinking about harming yourself, call or text 988 — the Suicide & Crisis Lifeline (US) — available 24/7.",
  "",
  "Please reach out to one of these resources right away.",
].join("\n");
