import { analyzeExternalUrl, describeShieldAssessment } from './securityShield';
import { queueRuntimeEvent } from './runtimeTelemetry';

interface SafeOpenExternalOptions {
  label?: string;
  userId?: string | null;
  trustedDomains?: string[];
}

function normalizeExternalHttpUrl(targetUrl: string, label: string): string {
  const raw = String(targetUrl || '').trim().replace(/^['"]|['"]$/g, '');
  if (!raw) {
    throw new Error(`${label} is missing.`);
  }

  const toHttpUrl = (value: string): string => {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error('Only http/https URLs are supported.');
    }
    return parsed.toString();
  };

  try {
    return toHttpUrl(raw);
  } catch {
    // Try alternate URL forms below.
  }

  const repaired = raw.startsWith('//')
    ? `https:${raw}`
    : raw.startsWith('/')
      ? `https:/${raw}`
      : raw.startsWith('www.')
        ? `https://${raw}`
        : `https://${raw.replace(/^\/+/, '')}`;

  return toHttpUrl(repaired);
}

export async function safeOpenExternalUrl(targetUrl: string, options: SafeOpenExternalOptions = {}): Promise<void> {
  const label = options.label || 'URL';
  const normalized = normalizeExternalHttpUrl(targetUrl, label);
  const assessment = analyzeExternalUrl(normalized, options.trustedDomains || []);
  const domain = (() => {
    try {
      return new URL(normalized).hostname;
    } catch {
      return '';
    }
  })();

  if (assessment.action === 'block') {
    queueRuntimeEvent('shield_external_open_blocked', {
      label,
      domain,
      risk_score: assessment.riskScore,
      findings: assessment.findings.map((finding) => finding.code).join(','),
    }, { userId: options.userId || null });
    throw new Error(`NCore Shield blocked this ${label.toLowerCase()}. ${describeShieldAssessment(assessment)}`);
  }

  if (window.desktopBridge?.openExternalUrl) {
    const result = await window.desktopBridge.openExternalUrl(normalized);
    if (!result.ok) {
      throw new Error(result.message || `Could not open ${label.toLowerCase()}.`);
    }
  } else {
    const popup = window.open(normalized, '_blank', 'noopener,noreferrer');
    if (!popup) {
      window.location.assign(normalized);
    }
  }

  queueRuntimeEvent('shield_external_opened', {
    label,
    domain,
    risk_score: assessment.riskScore,
    severity: assessment.severity,
  }, { userId: options.userId || null });
}
