const cheerio = require('cheerio');

// Selectors for elements that never contain genuine job description content
const NOISE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'svg',
  'canvas',
  'iframe',
  'embed',
  'object',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'button',
  'input',
  'select',
  'textarea',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[aria-hidden="true"]',
  // Cookie notices and GDPR banners
  '[id*="cookie" i]',
  '[class*="cookie" i]',
  '[id*="consent" i]',
  '[class*="consent" i]',
  '[id*="gdpr" i]',
  '[class*="gdpr" i]',
  '[class*="banner" i]',
  // Modals, popups and newsletter overlays
  '[class*="modal" i]',
  '[class*="popup" i]',
  '[class*="newsletter" i]',
  '[class*="dialog" i]',
  // Social share and tracker bars
  '[class*="share" i]',
  '[class*="social" i]',
];

/**
 * Purifies raw HTML into clean, semantic DOM for extraction
 * Strips script tags, styles, navigation, footer, cookie banners, and base64 payloads.
 * @param {string} rawHtml
 * @returns {{ $: cheerio.Root, cleanedHtml: string, cleanedText: string }}
 */
function cleanHtml(rawHtml) {
  if (!rawHtml || typeof rawHtml !== 'string') {
    return {
      $: cheerio.load(''),
      cleanedHtml: '',
      cleanedText: '',
    };
  }

  const $ = cheerio.load(rawHtml, {
    xmlMode: false,
    decodeEntities: true,
  });

  // 1. Remove all noise tags and banners
  NOISE_SELECTORS.forEach((selector) => {
    $(selector).remove();
  });

  // 2. Remove comments
  $('*')
    .contents()
    .each(function () {
      if (this.type === 'comment') {
        $(this).remove();
      }
    });

  // 3. Strip base64 image data attributes to prevent memory spikes
  $('img').each(function () {
    const src = $(this).attr('src');
    if (src && src.startsWith('data:')) {
      $(this).removeAttr('src');
    }
  });

  // 4. Strip inline style attributes with base64 or background-image
  $('[style]').each(function () {
    const style = $(this).attr('style');
    if (style && (style.includes('data:') || style.includes('base64'))) {
      $(this).removeAttr('style');
    }
  });

  // 5. Extract cleaned text with normalized whitespace
  const body = $('body').length > 0 ? $('body') : $.root();
  const cleanedText = body
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();

  const cleanedHtml = body.html() || '';

  return {
    $,
    cleanedHtml,
    cleanedText,
  };
}

module.exports = {
  cleanHtml,
  NOISE_SELECTORS,
};

