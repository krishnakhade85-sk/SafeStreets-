/**
 * SafeStreets Mumbai - Content Moderation & Privacy Redaction Engine
 * 
 * Automatically detects and redacts Personally Identifiable Information (PII),
 * including phone numbers, emails, vehicle numbers, and private residential patterns.
 */

const PII_PATTERNS = {
  // Indian phone numbers: +91, 0, or 10-digit starting with 6-9, with optional separators
  phone: /(?:(?:\+91|91|0)[\s.-]?)?[6-9]\d{4}[\s.-]?\d{5}\b|\b(?:\d{3}[\s.-]?\d{3}[\s.-]?\d{4})\b/g,
  
  // Email addresses
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
  
  // Indian vehicle registration plates (e.g. MH 01 AB 1234, MH02CD5678)
  vehiclePlate: /\b(?:MH|DL|KA|TN|GJ|HR|UP|WB)[\s.-]?\d{1,2}[\s.-]?[A-Z]{1,3}[\s.-]?\d{3,4}\b/gi,
  
  // Residential addresses, flat/house numbers, building names
  residentialAddress: /\b(?:flat|apt|apartment|room|bldg|building|wing|house|chawl|chawla)[\s#.-]*\d+[A-Za-z0-9\s,-]*(?:co-op|chs|society|nagar|lane)?\b/gi,
  
  // Suspicious name prefixes (e.g. "my name is ...", "named Rahul", "driver Ramesh")
  identifyingNames: /(?:my name is|named|driver\s+(?:is\s+)?|contact|call\s+)(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
  
  // Social media handles (@username)
  socialHandle: /@[a-zA-Z0-9_]{3,25}\b/g
};

// Sensitive or inappropriate terminology that triggers automatic moderation escalation
const SENSITIVE_TERMS = [
  'kill', 'assault', 'weapon', 'rape', 'murder', 'bomb', 'blackmail'
];

/**
 * Scans text and redacts any detected PII, returning flags and sanitized text.
 * @param {string} text - Raw review or text input
 * @returns {Object} { hasPII: boolean, detectedFlags: string[], redactedText: string, requiresEscalation: boolean }
 */
function scanAndRedact(text) {
  if (!text || typeof text !== 'string') {
    return { hasPII: false, detectedFlags: [], redactedText: '', requiresEscalation: false };
  }

  let sanitized = text;
  const detectedFlags = [];
  let hasPII = false;
  let requiresEscalation = false;

  // 1. Phone numbers
  if (PII_PATTERNS.phone.test(sanitized)) {
    detectedFlags.push('phone_number');
    hasPII = true;
    sanitized = sanitized.replace(PII_PATTERNS.phone, '[REDACTED PHONE]');
  }

  // 2. Email addresses
  if (PII_PATTERNS.email.test(sanitized)) {
    detectedFlags.push('email_address');
    hasPII = true;
    sanitized = sanitized.replace(PII_PATTERNS.email, '[REDACTED EMAIL]');
  }

  // 3. Vehicle registration plates
  if (PII_PATTERNS.vehiclePlate.test(sanitized)) {
    detectedFlags.push('vehicle_number');
    hasPII = true;
    sanitized = sanitized.replace(PII_PATTERNS.vehiclePlate, '[REDACTED VEHICLE NO]');
  }

  // 4. Residential addresses
  if (PII_PATTERNS.residentialAddress.test(sanitized)) {
    detectedFlags.push('residential_address');
    hasPII = true;
    sanitized = sanitized.replace(PII_PATTERNS.residentialAddress, '[REDACTED ADDRESS]');
  }

  // 5. Social handles
  if (PII_PATTERNS.socialHandle.test(sanitized)) {
    detectedFlags.push('social_handle');
    hasPII = true;
    sanitized = sanitized.replace(PII_PATTERNS.socialHandle, '[REDACTED HANDLE]');
  }

  // 6. Name patterns
  if (PII_PATTERNS.identifyingNames.test(sanitized)) {
    detectedFlags.push('personal_name');
    hasPII = true;
    sanitized = sanitized.replace(PII_PATTERNS.identifyingNames, (match) => {
      return match.replace(/[A-Z][a-z]+(\s+[A-Z][a-z]+)?$/, '[REDACTED NAME]');
    });
  }

  // 7. Check for acute sensitive terminology requiring escalation
  const lower = text.toLowerCase();
  for (const term of SENSITIVE_TERMS) {
    if (lower.includes(term)) {
      detectedFlags.push(`urgent_keyword_${term}`);
      requiresEscalation = true;
    }
  }

  return {
    hasPII,
    detectedFlags,
    redactedText: sanitized,
    requiresEscalation
  };
}

module.exports = {
  scanAndRedact,
  PII_PATTERNS
};
