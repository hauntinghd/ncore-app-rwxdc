export type ShieldSeverity = 'none' | 'low' | 'medium' | 'high';
export type ShieldAction = 'allow' | 'warn' | 'block';

export interface ShieldFinding {
  code: string;
  severity: Exclude<ShieldSeverity, 'none'>;
  label: string;
  detail: string;
}

export interface ShieldAssessment {
  severity: ShieldSeverity;
  action: ShieldAction;
  findings: ShieldFinding[];
  riskScore: number;
}

interface MessageShieldInput {
  text?: string | null;
  fileNames?: string[];
  trustedDomains?: string[];
}

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b/;
const SECRET_PATTERNS = [
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/i,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/i,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i,
  /\bAIza[0-9A-Za-z\-_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bSG\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/,
];
const URL_PATTERN = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
const RISKY_FILE_PATTERN = /\.(?:exe|msi|scr|bat|cmd|ps1|jar|vbs|reg|com|pif|hta|iso|dll|apk|dmg|deb|rpm|appimage)$/i;
const SHORTENED_URL_DOMAINS = [
  'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'is.gd', 'buff.ly',
  'rebrand.ly', 'bl.ink', 'rb.gy', 'cutt.ly', 'shorturl.at', 'tiny.cc',
];

// Homograph attack detection: maps confusable Unicode chars to their ASCII lookalikes.
const CONFUSABLE_MAP: Record<string, string> = {
  '\u0430': 'a', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p', '\u0441': 'c',
  '\u0443': 'y', '\u0445': 'x', '\u0456': 'i', '\u0458': 'j', '\u04BB': 'h',
  '\u0501': 'd', '\u050D': 'k', '\u051B': 'q', '\u051D': 'w',
  '\u0261': 'g', '\u0251': 'a', '\u025B': 'e', '\u0254': 'o',
  '\u01C3': '!', '\uFF0E': '.', '\u2024': '.', '\uFE52': '.',
};
const WELL_KNOWN_DOMAINS = [
  'discord.com', 'discordapp.com', 'discord.gg', 'ncore.gg', 'nyptidindustries.com',
  'google.com', 'github.com', 'twitter.com', 'x.com', 'youtube.com', 'steam.com',
  'steampowered.com', 'paypal.com', 'stripe.com', 'microsoft.com', 'apple.com',
];

const SOCIAL_ENGINEERING_PHRASES = [
  { pattern: /\bfree\s+(?:nitro|boost|gift|money)\b/i, code: 'free_offer', detail: 'Common lure language used in account scams.' },
  { pattern: /\b(?:verify|reverify|confirm)\s+(?:your\s+)?(?:account|email|session|token)\b/i, code: 'account_verify', detail: 'Requests to verify account/session details are a common phishing vector.' },
  { pattern: /\b(?:paste|copy)\s+(?:your\s+)?(?:token|auth token|session token|browser token)\b/i, code: 'token_request', detail: 'Requests for tokens or session material should never be trusted.' },
  { pattern: /\b(?:run|paste)\s+(?:this\s+)?(?:script|command|powershell|console)\b/i, code: 'command_execution', detail: 'Prompts to run commands are a common takeover path.' },
  { pattern: /\bqr\s*code\b/i, code: 'qr_lure', detail: 'QR login requests are frequently used for account hijacking.' },
  { pattern: /\b(?:gift|support|claim)\s+code\b/i, code: 'gift_code', detail: 'Gift/support code prompts often accompany social engineering.' },
];

function isPrivateIpv4(hostname: string): boolean {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  if (a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function extractUrls(text: string): string[] {
  const matches = text.match(URL_PATTERN) || [];
  return Array.from(new Set(matches.map((entry) => entry.trim())));
}

function isTrustedDomain(hostname: string, trustedDomains: string[]): boolean {
  const normalized = hostname.trim().toLowerCase();
  return trustedDomains.some((domain) => {
    const candidate = String(domain || '').trim().toLowerCase();
    return Boolean(candidate) && (normalized === candidate || normalized.endsWith(`.${candidate}`));
  });
}

function pushFinding(findings: ShieldFinding[], finding: ShieldFinding): void {
  if (findings.some((entry) => entry.code === finding.code && entry.detail === finding.detail)) return;
  findings.push(finding);
}

/**
 * Detect homograph/IDN attacks by checking if a domain contains mixed-script
 * characters that visually resemble ASCII domain names.
 */
function detectHomograph(hostname: string): { isHomograph: boolean; confusedWith: string } {
  let hasNonAscii = false;
  let normalized = '';
  for (const char of hostname) {
    if (CONFUSABLE_MAP[char]) {
      hasNonAscii = true;
      normalized += CONFUSABLE_MAP[char];
    } else {
      normalized += char;
    }
  }
  if (!hasNonAscii) return { isHomograph: false, confusedWith: '' };
  const match = WELL_KNOWN_DOMAINS.find((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
  return { isHomograph: Boolean(match), confusedWith: match || '' };
}

/**
 * Check if a URL uses a known URL shortener that could hide the real destination.
 */
function isShortenedUrl(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^www\./, '');
  return SHORTENED_URL_DOMAINS.includes(normalized);
}

/**
 * Detect display name impersonation against a list of privileged names.
 * Uses Levenshtein distance to catch near-matches.
 */
export function detectImpersonation(
  displayName: string,
  privilegedNames: string[],
  threshold: number = 3,
): { isImpersonation: boolean; similarTo: string } {
  const normalized = displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalized || normalized.length < 2) return { isImpersonation: false, similarTo: '' };

  for (const privilegedName of privilegedNames) {
    const target = privilegedName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!target) continue;
    if (normalized === target) continue; // Exact match is OK (same user)

    const distance = levenshteinDistance(normalized, target);
    if (distance > 0 && distance <= threshold) {
      return { isImpersonation: true, similarTo: privilegedName };
    }
  }
  return { isImpersonation: false, similarTo: '' };
}

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}

export function analyzeExternalUrl(url: string, trustedDomains: string[] = []): ShieldAssessment {
  const findings: ShieldFinding[] = [];
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) {
    return { severity: 'none', action: 'allow', findings, riskScore: 0 };
  }

  try {
    const parsed = new URL(normalizedUrl.startsWith('http') ? normalizedUrl : `https://${normalizedUrl}`);
    const hostname = parsed.hostname.toLowerCase();
    const trusted = isTrustedDomain(hostname, trustedDomains);

    if (!['https:', 'http:'].includes(parsed.protocol)) {
      pushFinding(findings, {
        code: 'unsupported_protocol',
        severity: 'high',
        label: 'Unsupported protocol',
        detail: 'Only normal web links are allowed.',
      });
    }
    if (parsed.protocol === 'http:' && !trusted) {
      pushFinding(findings, {
        code: 'plain_http',
        severity: 'medium',
        label: 'Unencrypted link',
        detail: 'This link does not use HTTPS.',
      });
    }
    if (parsed.username || parsed.password) {
      pushFinding(findings, {
        code: 'url_credentials',
        severity: 'high',
        label: 'Credential-style URL',
        detail: 'Links with embedded credentials are blocked.',
      });
    }
    if (hostname === 'localhost' || isPrivateIpv4(hostname)) {
      pushFinding(findings, {
        code: 'private_host',
        severity: 'high',
        label: 'Local/private host',
        detail: 'Links to local or private network hosts are blocked.',
      });
    }
    if (hostname.includes('xn--')) {
      pushFinding(findings, {
        code: 'punycode_domain',
        severity: 'medium',
        label: 'Lookalike domain',
        detail: 'This domain uses punycode and may be impersonating another site.',
      });
    }

    // Homograph/IDN attack detection
    const homograph = detectHomograph(hostname);
    if (homograph.isHomograph) {
      pushFinding(findings, {
        code: 'homograph_attack',
        severity: 'high',
        label: 'Impersonation domain',
        detail: `This domain uses unicode characters to impersonate ${homograph.confusedWith}.`,
      });
    }

    // Shortened URL detection
    if (!trusted && isShortenedUrl(hostname)) {
      pushFinding(findings, {
        code: 'shortened_url',
        severity: 'medium',
        label: 'Shortened link',
        detail: 'Shortened URLs can hide the real destination. Exercise caution.',
      });
    }

    // Data URI / javascript: in query params
    const fullUrl = parsed.toString().toLowerCase();
    if (fullUrl.includes('javascript:') || fullUrl.includes('data:text/html')) {
      pushFinding(findings, {
        code: 'script_injection',
        severity: 'high',
        label: 'Script injection URL',
        detail: 'This link contains embedded scripts and was blocked.',
      });
    }

    const riskText = `${hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
    if (!trusted && /(token|oauth|session|verify|login|signin|password|gift|nitro|boost|support)/.test(riskText)) {
      pushFinding(findings, {
        code: 'phishing_keywords',
        severity: 'medium',
        label: 'Sensitive-link keywords',
        detail: 'This link contains high-risk account or token keywords.',
      });
    }
  } catch {
    pushFinding(findings, {
      code: 'invalid_url',
      severity: 'high',
      label: 'Invalid URL',
      detail: 'The link is malformed and was blocked.',
    });
  }

  return finalizeShieldAssessment(findings);
}

export function analyzeMessageShield(input: MessageShieldInput): ShieldAssessment {
  const text = String(input.text || '');
  const fileNames = Array.from(new Set((input.fileNames || []).map((name) => String(name || '').trim()).filter(Boolean)));
  const findings: ShieldFinding[] = [];

  if (JWT_PATTERN.test(text)) {
    pushFinding(findings, {
      code: 'jwt_like_token',
      severity: 'high',
      label: 'Token-like secret detected',
      detail: 'This message appears to contain a live auth/session token.',
    });
  }

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      pushFinding(findings, {
        code: 'api_secret',
        severity: 'high',
        label: 'API secret detected',
        detail: 'This message appears to contain a live secret or access key.',
      });
      break;
    }
  }

  for (const phrase of SOCIAL_ENGINEERING_PHRASES) {
    if (phrase.pattern.test(text)) {
      pushFinding(findings, {
        code: phrase.code,
        severity: phrase.code === 'token_request' || phrase.code === 'command_execution' ? 'high' : 'medium',
        label: 'Suspicious social-engineering language',
        detail: phrase.detail,
      });
    }
  }

  for (const url of extractUrls(text)) {
    const urlAssessment = analyzeExternalUrl(url, input.trustedDomains);
    for (const finding of urlAssessment.findings) {
      pushFinding(findings, finding);
    }
  }

  for (const fileName of fileNames) {
    if (RISKY_FILE_PATTERN.test(fileName)) {
      pushFinding(findings, {
        code: 'executable_file',
        severity: 'high',
        label: 'Executable attachment',
        detail: `${fileName} is a high-risk executable/script attachment.`,
      });
    }
  }

  return finalizeShieldAssessment(findings);
}

export function describeShieldAssessment(assessment: ShieldAssessment): string {
  if (assessment.findings.length === 0) return 'No immediate risk signals detected.';
  return assessment.findings
    .slice(0, 3)
    .map((finding) => finding.detail)
    .join(' ');
}

export function getShieldProtectionItems(): Array<{ label: string; description: string }> {
  return [
    {
      label: 'Token leak blocking',
      description: 'Stops outbound messages that look like session tokens, JWTs, or API keys.',
    },
    {
      label: 'Phishing link screening',
      description: 'Flags or blocks risky links, credential-style URLs, and private-network redirects.',
    },
    {
      label: 'Homograph attack detection',
      description: 'Detects domains using unicode lookalike characters to impersonate trusted sites.',
    },
    {
      label: 'Impersonation detection',
      description: 'Flags display names that closely resemble admins, moderators, or system accounts.',
    },
    {
      label: 'Shortened URL warnings',
      description: 'Warns about links from URL shorteners that can hide malicious destinations.',
    },
    {
      label: 'Executable attachment warnings',
      description: 'Warns before suspicious scripts or executable attachments are sent.',
    },
    {
      label: 'Script injection blocking',
      description: 'Blocks URLs containing embedded JavaScript or data URIs.',
    },
    {
      label: 'Auth abuse throttling',
      description: 'Slows repeated failed sign-ins to reduce brute-force and credential-stuffing attempts.',
    },
  ];
}

function finalizeShieldAssessment(findings: ShieldFinding[]): ShieldAssessment {
  const severity: ShieldSeverity = findings.some((finding) => finding.severity === 'high')
    ? 'high'
    : findings.some((finding) => finding.severity === 'medium')
      ? 'medium'
      : findings.some((finding) => finding.severity === 'low')
        ? 'low'
        : 'none';

  const action: ShieldAction = severity === 'high'
    ? 'block'
    : severity === 'medium'
      ? 'warn'
      : 'allow';

  const riskScore = findings.reduce((total, finding) => {
    if (finding.severity === 'high') return total + 55;
    if (finding.severity === 'medium') return total + 20;
    return total + 8;
  }, 0);

  return {
    severity,
    action,
    findings,
    riskScore,
  };
}
