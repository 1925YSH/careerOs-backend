const request = require('supertest');
const app = require('../app');
const { connectDB, disconnectDB } = require('../config/db');

describe('AI CareerOS - Core Job Portal & Discovery API Tests (Phase 2)', () => {
  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await disconnectDB();
  });

  describe('GET /api/jobs - Search and Discovery', () => {
    it('returns 200 with structured pagination and job listings', async () => {
      const res = await request(app).get('/api/jobs');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.jobs)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();
      expect(res.body.data.pagination.page).toBe(1);
    });

    it('filters jobs by workMode=remote safely', async () => {
      const res = await request(app).get('/api/jobs?workMode=remote');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      res.body.data.jobs.forEach((job) => {
        expect(job.workMode).toBe('remote');
      });
    });

    it('safely handles special regex characters in search query (ReDoS & Injection Defense)', async () => {
      const specialCharacters = '.*+?^${}()|[]\\';
      const res = await request(app).get(`/api/jobs?search=${encodeURIComponent(specialCharacters)}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.jobs)).toBe(true);
    });

    it('safely handles non-numeric and negative pagination params without overflowing', async () => {
      const res = await request(app).get('/api/jobs?page=-5&limit=1000');
      expect(res.status).toBe(200);
      expect(res.body.data.pagination.page).toBe(1);
      expect(res.body.data.pagination.limit).toBeLessThanOrEqual(50); // Capped at 50 to prevent DoS
    });
  });

  describe('GET /api/jobs/:id - Job Detail', () => {
    it('returns 404 for invalid ObjectId format without crashing server', async () => {
      const res = await request(app).get('/api/jobs/invalid-id-format');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.category).toBe('not-found');
    });

    it('returns 404 for non-existent 24-character ObjectId', async () => {
      const nonExistentId = '507f1f77bcf86cd799439011';
      const res = await request(app).get(`/api/jobs/${nonExistentId}`);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.category).toBe('not-found');
    });
  });

  describe('GET /api/companies - Company Directory', () => {
    it('returns 200 with list of companies and attached openJobCount', async () => {
      const res = await request(app).get('/api/companies');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.companies)).toBe(true);
      if (res.body.data.companies.length > 0) {
        expect(res.body.data.companies[0]).toHaveProperty('openJobCount');
      }
    });
  });
});
