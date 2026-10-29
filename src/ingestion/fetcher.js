const { URL } = require('url');
const { validateSafeUrl } = require('../utils/ssrf');
const { ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

const USER_AGENT = 'AI-CareerOS-Crawler/1.0 (+https://careeros.com/bot; compliance@careeros.com)';
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10000; // 10 seconds
const MAX_CONTENT_LENGTH_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Performs SSRF-safe, rate-respectful HTTP fetching of external career pages
 * @param {string} targetUrl
 * @param {string[]} allowedDomains
 * @param {number} redirectCount
 * @returns {Promise<{ html: string, finalUrl: string, statusCode: number }>}
 */
async function safeFetch(targetUrl, allowedDomains = [], redirectCount = 0) {
  if (redirectCount > MAX_REDIRECTS) {
    throw new ValidationError(`Redirect limit of ${MAX_REDIRECTS} exceeded`);
  }

  // 1. Strict SSRF and DNS Rebinding check on target URL
  const ssrfCheck = await validateSafeUrl(targetUrl);
  if (!ssrfCheck.isValid) {
    throw new ValidationError(`SSRF Security Rejection: ${ssrfCheck.error}`);
  }

  const parsedUrl = ssrfCheck.parsedUrl;
  const hostname = parsedUrl.hostname.toLowerCase();

  // 2. Allowed domain check if specified
  if (allowedDomains && allowedDomains.length > 0) {
    const isDomainAllowed = allowedDomains.some((d) => {
      const normalizedD = d.toLowerCase().trim();
      return hostname === normalizedD || hostname.endsWith(`.${normalizedD}`);
    });

    if (!isDomainAllowed) {
      throw new ValidationError(
        `Domain '${hostname}' is not in the approved allowedDomains list for this source.`
      );
    }
  }

  // 3. Perform HTTP request with timeout and custom User-Agent
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
      redirect: 'manual', // Manually handle redirects to validate each step against SSRF
    });

    clearTimeout(timeoutId);

    // 4. Handle HTTP redirects safely (301, 302, 303, 307, 308)
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const redirectLocation = response.headers.get('location');
      if (!redirectLocation) {
        throw new ValidationError('Redirect status received without Location header.');
      }

      const resolvedRedirectUrl = new URL(redirectLocation, targetUrl).toString();
      logger.info('Following safe redirect', { from: targetUrl, to: resolvedRedirectUrl });

      return await safeFetch(resolvedRedirectUrl, allowedDomains, redirectCount + 1);
    }

    if (!response.ok) {
      throw new ValidationError(`HTTP fetch failed with status ${response.status}: ${response.statusText}`);
    }

    // 5. Check Content-Length to prevent memory exhaustion
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_CONTENT_LENGTH_BYTES) {
      throw new ValidationError('Response size exceeds maximum allowed 5MB limit.');
    }

    const html = await response.text();
    return {
      html,
      finalUrl: targetUrl,
      statusCode: response.status,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new ValidationError(`HTTP request timed out after ${TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
}

module.exports = {
  safeFetch,
  USER_AGENT,
};

