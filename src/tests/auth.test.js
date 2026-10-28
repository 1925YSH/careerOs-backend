const request = require('supertest');
const app = require('../app');

describe('AI CareerOS - Security & RBAC Boundary Tests (Phase 1)', () => {
  describe('Health Endpoint', () => {
    it('GET /health returns healthy status and uptime', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.headers['x-request-id']).toBeDefined();
    });
  });

  describe('Security Boundary: Role-Based Registration', () => {
    it('STRICT: blocks self-registration as admin role (HTTP 400 validation)', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: 'attacker@example.com',
        password: 'Password123!',
        role: 'admin',
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.category).toBe('validation');
    });

    it('STRICT: enforces password complexity on registration', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: 'candidate@example.com',
        password: 'weak',
        role: 'candidate',
        name: 'Test Candidate',
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.category).toBe('validation');
    });

    it('STRICT: rejects malformed email addresses', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: 'not-an-email',
        password: 'Password123!',
        role: 'candidate',
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.category).toBe('validation');
    });
  });

  describe('Security Boundary: Protected Routes & Session Isolation', () => {
    it('GET /api/auth/me returns 401 AuthenticationError when unauthenticated', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.category).toBe('authentication');
    });

    it('GET /api/admin/overview returns 401 when accessed without admin session', async () => {
      const res = await request(app).get('/api/admin/overview');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.category).toBe('authentication');
    });

    it('GET /api/admin/audit-logs returns 401 when unauthenticated', async () => {
      const res = await request(app).get('/api/admin/audit-logs');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('POST /api/resumes/presign returns 401 when unauthenticated', async () => {
      const res = await request(app).post('/api/resumes/presign').send({
        fileName: 'resume.pdf',
        mimeType: 'application/pdf',
        size: 1024,
      });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Security Boundary: Error Taxonomy & Header Verification', () => {
    it('returns standardized JSON error envelope for 404 routes', async () => {
      const res = await request(app).get('/api/non-existent-endpoint');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toHaveProperty('category', 'not-found');
      expect(res.body).toHaveProperty('requestId');
    });

    it('sets OWASP-recommended security headers on all responses', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-dns-prefetch-control']).toBeDefined();
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });
});
