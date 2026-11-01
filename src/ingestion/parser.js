const cheerio = require('cheerio');
const { cleanHtml } = require('./cleaner');
const logger = require('../utils/logger');
const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Normalizes employmentType to AI CareerOS schema enum
 * FULL_TIME | PART_TIME | CONTRACT | INTERNSHIP
 */
function normalizeEmploymentType(rawType) {
  if (!rawType) return 'FULL_TIME';
  const str = String(rawType).toUpperCase().replace(/[\s-_]/g, '');
  if (str.includes('PART') || str.includes('HALF')) return 'PART_TIME';
  if (str.includes('CONTRACT') || str.includes('FREELANCE') || str.includes('TEMP')) return 'CONTRACT';
  if (str.includes('INTERN') || str.includes('TRAINEE')) return 'INTERNSHIP';
  return 'FULL_TIME';
}

/**
 * Normalizes workMode
 * remote | hybrid | on-site
 */
function normalizeWorkMode(rawText, locationStr) {
  const combined = `${rawText || ''} ${locationStr || ''}`.toLowerCase();
  if (combined.includes('remote') || combined.includes('telecommute') || combined.includes('work from home')) {
    return 'remote';
  }
  if (combined.includes('hybrid')) {
    return 'hybrid';
  }
  return 'on-site';
}

/**
 * Strategy 1: Deterministic JSON-LD Extraction
 * Schema.org/JobPosting standard used by Google for Jobs
 */
function extractJsonLd(rawHtml, baseUrl) {
  const $ = cheerio.load(rawHtml);
  const jobs = [];

  $('script[type="application/ld+json"]').each((_, elem) => {
    try {
      const content = $(elem).html();
      if (!content) return;
      const data = JSON.parse(content.trim());

      // Helper to process a single JobPosting object
      const processPosting = (item) => {
        if (!item || (item['@type'] !== 'JobPosting' && !item['@type']?.includes?.('JobPosting'))) {
          return;
        }

        // Title
        const title = item.title?.trim();
        if (!title) return;

        // Description
        let description = '';
        if (typeof item.description === 'string') {
          // Clean HTML inside JSON-LD description
          const descClean = cleanHtml(item.description);
          description = descClean.cleanedText || item.description;
        }

        // Location
        let location = 'Remote';
        if (item.jobLocation) {
          if (typeof item.jobLocation === 'string') {
            location = item.jobLocation;
          } else if (item.jobLocation.address) {
            const addr = item.jobLocation.address;
            if (typeof addr === 'string') {
              location = addr;
            } else {
              const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean);
              if (parts.length > 0) location = parts.join(', ');
            }
          }
        }

        // Work mode
        const isTelecommute = item.jobLocationType === 'TELECOMMUTE' || /remote/i.test(location);
        const workMode = isTelecommute ? 'remote' : normalizeWorkMode(description, location);

        // Employment Type
        const employmentType = normalizeEmploymentType(item.employmentType);

        // Salary
        let salary = { min: undefined, max: undefined, currency: 'USD', isDisclosed: false };
        const baseSalary = item.baseSalary || item.estimatedSalary;
        if (baseSalary && baseSalary.value) {
          const val = baseSalary.value;
          const currency = baseSalary.currency || val.currency || 'USD';
          if (typeof val === 'number') {
            salary = { min: val, max: val, currency, isDisclosed: true };
          } else if (typeof val === 'object') {
            const min = val.minValue || val.value;
            const max = val.maxValue || val.value;
            if (min || max) {
              salary = {
                min: typeof min === 'number' ? min : undefined,
                max: typeof max === 'number' ? max : undefined,
                currency,
                isDisclosed: true,
              };
            }
          }
        }

        // Skills / Qualifications
        const skills = [];
        if (Array.isArray(item.skills)) {
          skills.push(...item.skills.map((s) => String(s).trim().toLowerCase()));
        } else if (typeof item.skills === 'string') {
          skills.push(
            ...item.skills
              .split(',')
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean)
          );
        }

        // Application URL
        let applicationUrl = baseUrl;
        if (item.url && typeof item.url === 'string') {
          try {
            applicationUrl = new URL(item.url, baseUrl).toString();
          } catch {
            applicationUrl = item.url;
          }
        }

        jobs.push({
          title,
          description: description || title,
          location,
          workMode,
          employmentType,
          salary,
          skills: Array.from(new Set(skills)),
          applicationUrl,
          postedAt: item.datePosted ? new Date(item.datePosted) : new Date(),
          strategy: 'json_ld',
        });
      };

      if (Array.isArray(data)) {
        data.forEach(processPosting);
      } else if (data['@graph'] && Array.isArray(data['@graph'])) {
        data['@graph'].forEach(processPosting);
      } else {
        processPosting(data);
      }
    } catch {
      // Ignore JSON parse errors in script tags
    }
  });

  return jobs;
}

/**
 * Strategy 2: Deterministic Semantic HTML Fallback
 * Analyzes purified DOM for job headings, locations, and descriptions
 */
function extractSemanticHtml(rawHtml, baseUrl) {
  const { $, cleanedText } = cleanHtml(rawHtml);

  // Look for Microdata itemprop="title" or h1/job-title elements
  let title = '';
  const titleSelectors = [
    '[itemprop="title"]',
    'h1[class*="job" i]',
    'h1[class*="title" i]',
    'h1[class*="posting" i]',
    'h1',
    '[class*="job-title" i]',
    '[class*="posting-title" i]',
  ];

  for (const sel of titleSelectors) {
    const el = $(sel).first();
    if (el.length > 0 && el.text().trim().length > 3) {
      title = el.text().trim();
      break;
    }
  }

  if (!title) {
    return [];
  }

  // Location detection
  let location = 'Remote';
  const locSelectors = [
    '[itemprop="jobLocation"]',
    '[class*="location" i]',
    '[class*="workplace" i]',
    '[data-testid*="location" i]',
  ];
  for (const sel of locSelectors) {
    const el = $(sel).first();
    if (el.length > 0 && el.text().trim().length > 1) {
      location = el.text().trim().replace(/^location\s*[:\s]*/i, '');
      break;
    }
  }

  // Work mode
  const workMode = normalizeWorkMode(cleanedText, location);

  // Employment Type
  let employmentType = 'FULL_TIME';
  if (/contract|contractor|freelance/i.test(cleanedText)) employmentType = 'CONTRACT';
  else if (/intern|internship/i.test(cleanedText)) employmentType = 'INTERNSHIP';
  else if (/part[-\s]time/i.test(cleanedText)) employmentType = 'PART_TIME';

  // Salary range regex detection (e.g. $120,000 - $160,000 or $80k - $100k)
  let salary = { min: undefined, max: undefined, currency: 'USD', isDisclosed: false };
  const salaryMatch = cleanedText.match(/\$([0-9]{2,3}(?:,[0-9]{3})+|\d{2,3}k)\s*-\s*\$([0-9]{2,3}(?:,[0-9]{3})+|\d{2,3}k)/i);
  if (salaryMatch) {
    const parseNum = (s) => {
      const lower = s.toLowerCase();
      if (lower.endsWith('k')) return parseInt(lower) * 1000;
      return parseInt(lower.replace(/,/g, ''), 10);
    };
    salary = {
      min: parseNum(salaryMatch[1]),
      max: parseNum(salaryMatch[2]),
      currency: 'USD',
      isDisclosed: true,
    };
  }

  // Common tech skills dictionary matching
  const COMMON_SKILLS = [
    'react', 'next.js', 'node.js', 'javascript', 'typescript', 'python', 'java',
    'golang', 'c++', 'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'mongodb',
    'postgresql', 'mysql', 'redis', 'graphql', 'rest api', 'tailwind css', 'ci/cd',
    'linux', 'git', 'system design', 'microservices', 'machine learning', 'ai'
  ];
  const detectedSkills = [];
  const lowerText = cleanedText.toLowerCase();
  for (const skill of COMMON_SKILLS) {
    const escaped = skill.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(lowerText)) {
      detectedSkills.push(skill);
    }
  }

  return [
    {
      title,
      description: cleanedText.slice(0, 5000), // Cap description size
      location,
      workMode,
      employmentType,
      salary,
      skills: detectedSkills,
      applicationUrl: baseUrl,
      postedAt: new Date(),
      strategy: 'semantic_html',
    },
  ];
}

/**
 * Strategy 3: AI Structured Extraction Fallback (Google Gemini)
 * Strict output contract as defined in Section 10.1 of Product Technical Design Report
 */
async function extractWithGemini(cleanedText, baseUrl) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn('GEMINI_API_KEY not configured, falling back to deterministic extraction');
    return [];
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `You are a strict, enterprise job-posting structured data extractor for AI CareerOS.
Analyze the following cleaned career page content and extract the job listing into valid JSON.
Return ONLY raw JSON with no markdown backticks or commentary.

JSON Schema:
{
  "title": "string (Job Title, required)",
  "location": "string (City, Country or Remote)",
  "workMode": "remote" | "hybrid" | "on-site",
  "employmentType": "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERNSHIP",
  "experienceMin": number or null,
  "experienceMax": number or null,
  "skills": ["string", "string"],
  "salary": {
    "min": number or null,
    "max": number or null,
    "currency": "USD",
    "isDisclosed": boolean
  },
  "description": "string (summary of job role and requirements)",
  "applicationUrl": "string (URL to apply)"
}

Input text:
${cleanedText.slice(0, 8000)}
Base URL: ${baseUrl}
`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    // Clean any markdown formatting ```json ... ```
    const cleanedJsonStr = responseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleanedJsonStr);
    if (!parsed.title) return [];

    return [
      {
        title: String(parsed.title).trim(),
        description: parsed.description || String(parsed.title),
        location: parsed.location || 'Remote',
        workMode: ['remote', 'hybrid', 'on-site'].includes(parsed.workMode) ? parsed.workMode : 'on-site',
        employmentType: normalizeEmploymentType(parsed.employmentType),
        experienceMin: typeof parsed.experienceMin === 'number' ? parsed.experienceMin : 0,
        experienceMax: typeof parsed.experienceMax === 'number' ? parsed.experienceMax : undefined,
        salary: {
          min: parsed.salary?.min || undefined,
          max: parsed.salary?.max || undefined,
          currency: parsed.salary?.currency || 'USD',
          isDisclosed: Boolean(parsed.salary?.isDisclosed),
        },
        skills: Array.isArray(parsed.skills) ? parsed.skills.map((s) => String(s).toLowerCase().trim()) : [],
        applicationUrl: parsed.applicationUrl || baseUrl,
        postedAt: new Date(),
        strategy: 'ai_extraction',
      },
    ];
  } catch (err) {
    logger.error('Gemini structured job extraction error', { error: err.message });
    return [];
  }
}

/**
 * Master parser: tries JSON-LD first, then semantic HTML, then AI extraction
 * @param {string} rawHtml
 * @param {string} baseUrl
 * @param {string} strategy
 * @returns {Promise<Array<any>>}
 */
async function parseJobPage(rawHtml, baseUrl, strategy = 'generic_html') {
  // 1. JSON-LD Strategy (highest accuracy)
  if (strategy === 'json_ld' || strategy === 'generic_html') {
    const jsonLdJobs = extractJsonLd(rawHtml, baseUrl);
    if (jsonLdJobs.length > 0) {
      return jsonLdJobs;
    }
  }

  // 2. Deterministic Semantic HTML
  const semanticJobs = extractSemanticHtml(rawHtml, baseUrl);
  if (semanticJobs.length > 0 && semanticJobs[0].title) {
    return semanticJobs;
  }

  // 3. AI Extraction Fallback
  const { cleanedText } = cleanHtml(rawHtml);
  if (cleanedText && cleanedText.length > 100) {
    const aiJobs = await extractWithGemini(cleanedText, baseUrl);
    if (aiJobs.length > 0) {
      return aiJobs;
    }
  }

  return [];
}

module.exports = {
  extractJsonLd,
  extractSemanticHtml,
  extractWithGemini,
  parseJobPage,
  normalizeEmploymentType,
  normalizeWorkMode,
};

