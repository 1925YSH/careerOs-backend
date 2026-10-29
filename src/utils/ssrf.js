const { URL } = require('url');
const dns = require('dns').promises;

// Private and reserved IP blocks (IPv4 and IPv6)
const BLOCKED_IP_PATTERNS = [
  /^0\./, // 0.0.0.0/8
  /^127\./, // 127.0.0.0/8 (Loopback)
  /^10\./, // 10.0.0.0/8 (Private)
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12 (Private)
  /^192\.168\./, // 192.168.0.0/16 (Private)
  /^169\.254\./, // 169.254.0.0/16 (Link-local / AWS metadata 169.254.169.254)
  /^::1$/, // IPv6 loopback
  /^fc00:/i, // IPv6 Unique Local Address
  /^fe80:/i, // IPv6 Link-local
];

const BLOCKED_HOSTNAMES = [
  'localhost',
  'metadata.google.internal',
  '169.254.169.254',
  'instance-data',
];

/**
 * Validates a URL against Server-Side Request Forgery (SSRF)
 * Ensures scheme is http or https, hostname is not a private IP, and resolves to public IP only.
 * @param {string} inputUrl
 * @returns {Promise<{ isValid: boolean, error?: string, parsedUrl?: URL }>}
 */
async function validateSafeUrl(inputUrl) {
  try {
    const parsed = new URL(inputUrl);

    // Only allow HTTP/HTTPS
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { isValid: false, error: 'Only http and https protocols are supported' };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check blocked hostnames
    if (BLOCKED_HOSTNAMES.includes(hostname)) {
      return { isValid: false, error: 'Access to loopback or cloud metadata services is forbidden' };
    }

    // Direct IP address check in hostname
    for (const pattern of BLOCKED_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return { isValid: false, error: 'Access to private or local network IP addresses is forbidden' };
      }
    }

    // DNS Resolution check to prevent DNS rebinding or private DNS targets
    try {
      const addresses = await dns.lookup(hostname, { all: true });
      for (const addr of addresses) {
        for (const pattern of BLOCKED_IP_PATTERNS) {
          if (pattern.test(addr.address)) {
            return { isValid: false, error: 'Resolved domain points to a private or reserved network IP' };
          }
        }
      }
    } catch (dnsErr) {
      return { isValid: false, error: `Domain could not be resolved: ${dnsErr.message}` };
    }

    return { isValid: true, parsedUrl: parsed };
  } catch (err) {
    return { isValid: false, error: 'Invalid URL format' };
  }
}

module.exports = {
  validateSafeUrl,
};

